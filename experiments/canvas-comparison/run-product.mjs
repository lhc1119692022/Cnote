import { build } from '../../web/node_modules/esbuild/lib/main.js'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'

const directory = path.dirname(fileURLToPath(import.meta.url))
const output = path.join(directory, 'build/product')
const webRequire = createRequire(path.resolve(directory, '../../web/package.json'))
await mkdir(output, { recursive: true })
const built = await build({
  entryPoints: [path.join(directory, 'product-fixture.jsx')], outfile: path.join(output, 'product.js'), bundle: true, minify: true, metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"benchmark","DEV":false,"PROD":true}' },
  alias: { '@': path.resolve(directory, '../../web/src'), react: path.resolve(directory, '../../web/node_modules/react'), 'react-dom': path.resolve(directory, '../../web/node_modules/react-dom') },
  loader: { '.woff2': 'dataurl' },
  plugins: [{ name: 'fixture-worker', setup(builder) {
    builder.onResolve({ filter: /\?worker$/ }, args => ({ path: args.path, namespace: 'fixture-worker' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture-worker' }, async args => {
      const source = webRequire.resolve(args.path.replace(/\?worker$/, ''))
      await copyFile(source, path.join(output, path.basename(source)))
      return { contents: `export default class extends Worker { constructor(options) { super('/${path.basename(source)}', { ...options, type: 'module' }); } }`, loader: 'js' }
    })
  } }],
})
const cssName = (await readdir(path.resolve(directory, '../../web/dist/assets'))).find(name => /^index-.*\.css$/.test(name))
await copyFile(path.resolve(directory, '../../web/dist/assets', cssName), path.join(output, 'current.css'))
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/current.css"><link rel="stylesheet" href="/product.css"></head><body><div id="root" style="width:100vw;height:100vh"></div><script src="/product.js"></script></body></html>')
const hashes = {}
for (const name of Object.keys(built.metafile.inputs)) {
  if (name.includes('node_modules') || name.startsWith('fixture-worker:') || name.startsWith('<')) continue
  hashes[name] = createHash('sha256').update(await readFile(path.resolve(name))).digest('hex')
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(hashes, null, 2))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve(directory, '../../desktop/node_modules/electron/dist/electron.exe'), [path.join(directory, 'product-main.cjs'), ...process.argv.slice(2)], { env: environment, windowsHide: true, stdio: 'inherit' })
const exitCode = await new Promise(resolve => child.on('exit', resolve))
if (exitCode !== 0) throw new Error(`Product verification exited ${exitCode}`)
