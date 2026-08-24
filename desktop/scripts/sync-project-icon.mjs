import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectDirectory = path.resolve(desktopDirectory, '..')
const electron = require('electron')
// Keep one checked-in source of truth. The web files are synchronized aliases;
// they must never become the renderer's temporary PNG-JSON output by accident.
const sourceLogoPath = path.join(projectDirectory, 'icon.svg')
const webLogoPaths = [
  path.join(projectDirectory, 'web', 'public', 'icon.svg'),
  path.join(projectDirectory, 'web', 'public', 'cnote-icon.svg'),
]
const iconPaths = [
  path.join(desktopDirectory, 'packaging', 'resources', 'icon.ico'),
  // Keep the manual shortcut on a separate, branded path so Windows Explorer
  // does not reuse a previously failed or square icon lookup from its cache.
  path.join(desktopDirectory, 'packaging', 'resources', 'icon-cnote.ico'),
]
const helperAppPath = path.join(desktopDirectory, 'scripts', 'logo-renderer-app')
const sizes = [16, 32, 48, 64, 128, 256]

function runRenderer(outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [helperAppPath, sourceLogoPath, outputPath], {
      cwd: desktopDirectory,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) return reject(new Error(`Electron logo renderer exited from signal ${signal}`))
      if (code !== 0) return reject(new Error(`Electron logo renderer exited with code ${code}`))
      resolve()
    })
  })
}

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(images.length * 16)
  let offset = header.length + directory.length
  const payloads = []
  images.forEach(({ size, data }, index) => {
    const entryOffset = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset)
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1)
    directory.writeUInt8(0, entryOffset + 2)
    directory.writeUInt8(0, entryOffset + 3)
    directory.writeUInt16LE(1, entryOffset + 4)
    directory.writeUInt16LE(32, entryOffset + 6)
    directory.writeUInt32LE(data.length, entryOffset + 8)
    directory.writeUInt32LE(offset, entryOffset + 12)
    payloads.push(data)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...payloads])
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'cnote-logo-'))
const renderedPath = path.join(temporaryDirectory, 'rendered.json')
try {
  const sourceLogo = await readFile(sourceLogoPath, 'utf8')
  if (!/<svg\b/i.test(sourceLogo)) {
    throw new Error(`Cnote Logo source is not a valid SVG: ${sourceLogoPath}`)
  }
  await Promise.all(webLogoPaths.map((targetPath) => writeFile(targetPath, sourceLogo, 'utf8')))

  await runRenderer(renderedPath)
  const rendered = JSON.parse(await readFile(renderedPath, 'utf8'))
  const images = sizes.map((size) => {
    const base64 = rendered[String(size)]
    if (typeof base64 !== 'string') throw new Error(`Missing rendered Logo size: ${size}`)
    return { size, data: Buffer.from(base64, 'base64') }
  })
  const ico = encodeIco(images)
  await mkdir(path.dirname(iconPaths[0]), { recursive: true })
  await Promise.all(iconPaths.map((iconPath) => writeFile(iconPath, ico)))
  console.log(`Cnote project icons written to ${iconPaths.join(' and ')}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
