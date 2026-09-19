import { build } from '../../web/node_modules/esbuild/lib/main.js'
import { spawn, execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../..')
const webSource = path.join(repository, 'web/src')
const output = path.join(directory, 'build/final-product')
const webRequire = createRequire(path.join(repository, 'web/package.json'))
const hash = content => createHash('sha256').update(content).digest('hex')
const snapshot = JSON.parse(await readFile(path.join(directory, 'build/before-optimization/fixture.js.map'), 'utf8'))
const original = new Map(snapshot.sources.map((name, index) => [path.resolve(directory, 'build', name), snapshot.sourcesContent[index]]))
const restoredFiles = new Set(['canvas/contents/ContentContent.tsx', 'canvas/contents/BrowserContent.tsx'])
const beforeProvider = original.get(path.join(webSource, 'canvas/components/CanvasProvider.tsx'))
if (!beforeProvider || beforeProvider.includes('createFrameTask')) throw new Error('The frozen baseline is not the pre-optimization provider')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
const manifest = { revision, baselineMapSha256: hash(await readFile(path.join(directory, 'build/before-optimization/fixture.js.map'))), sources: {}, harness: {} }
for (const filename of ['final-product-fixture.jsx', 'final-product-main.cjs', 'final-product-preload.cjs', 'run-final-product.mjs']) manifest.harness[filename] = hash(await readFile(path.join(directory, filename)))
for (const version of ['before', 'after']) {
  const target = path.join(output, version)
  await mkdir(target, { recursive: true })
  const sources = {}
  await build({
    entryPoints: [path.join(directory, 'final-product-fixture.jsx')], outfile: path.join(target, 'product.js'), bundle: true, minify: true,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"benchmark","DEV":false,"PROD":true}' },
    alias: { '@': webSource, react: path.join(repository, 'web/node_modules/react'), 'react-dom': path.join(repository, 'web/node_modules/react-dom') },
    loader: { '.woff2': 'dataurl' },
    plugins: [{ name: 'frozen-product-source', setup(builder) {
      builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        if (!args.path.startsWith(webSource + path.sep)) return
        const relative = path.relative(webSource, args.path).replaceAll('\\', '/')
        let contents
        let provenance = 'current-shared-module'
        if (version === 'before' && original.has(args.path)) {
          contents = original.get(args.path)
          provenance = 'frozen-source-map'
        } else if (version === 'before' && restoredFiles.has(relative)) {
          contents = execFileSync('git', ['show', `${revision}:web/src/${relative}`], { cwd: repository, encoding: 'utf8' })
          provenance = 'git-original-content-wrapper'
        } else contents = await readFile(args.path, 'utf8')
        sources[relative] = { sha256: hash(contents), provenance }
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'jsx' }
      })
    } }, { name: 'fixture-worker', setup(builder) {
      builder.onResolve({ filter: /\?worker$/ }, args => ({ path: args.path, namespace: 'fixture-worker' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-worker' }, async args => {
        const source = webRequire.resolve(args.path.replace(/\?worker$/, ''))
        await copyFile(source, path.join(output, path.basename(source)))
        return { contents: `export default class extends Worker { constructor(options) { super('/${path.basename(source)}', { ...options, type: 'module' }); } }`, loader: 'js' }
      })
    } }],
  })
  manifest.sources[version] = sources
  const cssName = (await readdir(path.join(repository, 'web/dist/assets'))).find(name => /^index-.*\.css$/.test(name))
  await copyFile(path.join(repository, 'web/dist/assets', cssName), path.join(target, 'current.css'))
  await writeFile(path.join(target, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="current.css"><link rel="stylesheet" href="product.css"></head><body><div id="root" style="width:100vw;height:100vh"></div><script>window.fixtureErrors=[];window.addEventListener("error",event=>window.fixtureErrors.push(event.message));</script><script src="product.js"></script></body></html>')
  manifest[`${version}BundleSha256`] = hash(await readFile(path.join(target, 'product.js')))
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(repository, 'desktop/node_modules/electron/dist/electron.exe'), [path.join(directory, 'final-product-main.cjs'), ...process.argv.slice(2)], { env: environment, windowsHide: true, stdio: 'inherit' })
const exitCode = await new Promise(resolve => child.on('exit', resolve))
if (exitCode !== 0) throw new Error(`Final product verification exited ${exitCode}`)
