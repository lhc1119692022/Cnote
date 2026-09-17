/**
 * Build the current Desktop/Web sources and launch Electron directly.
 * This is the manual-test path; it intentionally does not package or install.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electron = require('electron')
const environment = {
  ...process.env,
  CNOTE_DEV_LAUNCH: '1',
  CNOTE_DEVTOOLS_PORT: process.env.CNOTE_DEVTOOLS_PORT || '9222',
}
delete environment.ELECTRON_RUN_AS_NODE

function run(command, args, options = {}) {
  const useWindowsCommandShim = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
  const spawnCommand = useWindowsCommandShim ? (process.env.ComSpec || 'cmd.exe') : command
  const spawnArgs = useWindowsCommandShim
    ? ['/d', '/s', '/c', [command, ...args].map((value) => /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value).join(' ')]
    : args
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: desktopDirectory,
      env: environment,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited from signal ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

console.log('Cnote')
console.log('Building Web and Desktop runtime...')
const buildExitCode = await run(npmCommand, ['run', 'build:all'])
if (buildExitCode !== 0) process.exit(buildExitCode)

console.log('Starting Electron...')
const electronExitCode = await run(electron, [desktopDirectory, '--dev'])
process.exitCode = electronExitCode
