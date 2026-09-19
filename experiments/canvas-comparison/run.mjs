import { build } from '../../web/node_modules/esbuild/lib/main.js'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const directory = path.dirname(fileURLToPath(import.meta.url))
const webRequire = createRequire(path.resolve(directory, '../../web/package.json'))
await mkdir(path.join(directory, 'build'), { recursive: true })
await mkdir(path.join(directory, 'results'), { recursive: true })
await build({
  entryPoints: [path.join(directory, 'fixture.jsx')],
  outfile: path.join(directory, 'build/fixture.js'),
  bundle: true,
  minify: true,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"benchmark","DEV":false,"PROD":true}' },
  alias: {
    '@': path.resolve(directory, '../../web/src'),
    react: path.resolve(directory, '../../web/node_modules/react'),
    'react-dom': path.resolve(directory, '../../web/node_modules/react-dom'),
  },
  loader: { '.woff2': 'dataurl' },
  plugins: [{
    name: 'vite-worker-compatibility',
    setup(builder) {
      builder.onResolve({ filter: /\?worker$/ }, args => ({ path: args.path, namespace: 'fixture-worker' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-worker' }, async args => {
        const source = webRequire.resolve(args.path.replace(/\?worker$/, ''))
        const name = path.basename(source)
        await copyFile(source, path.join(directory, 'build', name))
        return { contents: `export default class extends Worker { constructor(options) { super('/${name}', { ...options, type: 'module' }); } }`, loader: 'js' }
      })
    },
  }],
})
const cssName = (await readdir(path.resolve(directory, '../../web/dist/assets'))).find(name => /^index-.*\.css$/.test(name))
if (!cssName) throw new Error('Build the current web app first: its stylesheet is required for the production reference')
await copyFile(path.resolve(directory, '../../web/dist/assets', cssName), path.join(directory, 'build/current.css'))
await writeFile(path.join(directory, 'build/index.html'), `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'"><link rel="stylesheet" href="/current.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
const executable = path.resolve(directory, '../../desktop/node_modules/electron/dist/electron.exe')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [path.join(directory, 'main.cjs'), ...process.argv.slice(2)], { env: environment, windowsHide: true, stdio: 'inherit' })
const code = await new Promise(resolve => child.on('exit', resolve))
if (code !== 0) throw new Error(`Benchmark Electron exited ${code}`)
const result = JSON.parse(await readFile(path.join(directory, 'results/latest.json'), 'utf8'))
console.log(JSON.stringify({ cases: result.rows.length, failures: result.failures, file: path.join(directory, 'results/latest.json') }, null, 2))
