import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://cnote.test' })
for (const key of ['window', 'document', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}

const require = createRequire(import.meta.url)
const cache = new Map()
function load(relative) {
  const filename = fileURLToPath(new URL('../src/' + relative, import.meta.url))
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.startsWith('@/')) {
      const path = name.slice(2)
      const base = new URL('../src/' + path, import.meta.url)
      return load(path + (existsSync(new URL(base.href + '.ts')) ? '.ts' : '.tsx'))
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}

const {
  FLOW_VIEWPORT_STORAGE_KEY,
  sameViewport,
  readFlowViewports,
  writeFlowViewport,
  applyStoredViewport,
} = load('lib/flow/viewport-storage.ts')
const { createViewportMoveGate, VIEWPORT_MOVE_IDLE_MS } = load('lib/flow/viewport-move.ts')

assert.equal(sameViewport({ x: 1, y: 2, zoom: 3 }, { x: 1, y: 2, zoom: 3 }), true)
assert.equal(sameViewport({ x: 1, y: 2, zoom: 3 }, { x: 1, y: 2, zoom: 4 }), false)
assert.equal(sameViewport(undefined, { x: 0, y: 0, zoom: 1 }), false)

writeFlowViewport('flow-a', { x: 10, y: 20, zoom: 0.8 })
writeFlowViewport('flow-a', { x: 10, y: 20, zoom: 0.8 })
assert.deepEqual(readFlowViewports()['flow-a'], { x: 10, y: 20, zoom: 0.8 })
assert.equal(JSON.parse(window.localStorage.getItem(FLOW_VIEWPORT_STORAGE_KEY))['flow-a'].zoom, 0.8)

const withStored = applyStoredViewport({ id: 'flow-a', viewport: { x: 0, y: 0, zoom: 1 } })
assert.deepEqual(withStored.viewport, { x: 10, y: 20, zoom: 0.8 })
const unchanged = applyStoredViewport({ id: 'flow-a', viewport: { x: 10, y: 20, zoom: 0.8 } })
assert.equal(unchanged.viewport.x, 10)

let starts = 0
let idles = 0
const gate = createViewportMoveGate(20, {
  onStart: () => { starts += 1 },
  onIdle: () => { idles += 1 },
})
gate.start()
gate.end()
gate.start()
gate.end()
gate.start()
gate.end()
assert.equal(starts, 1)
assert.equal(idles, 0)
assert.equal(gate.moving, true)
await new Promise((resolve) => setTimeout(resolve, 50))
assert.equal(starts, 1)
assert.equal(idles, 1)
assert.equal(gate.moving, false)

gate.start()
assert.equal(starts, 2)
gate.flush()
assert.equal(idles, 2)
assert.equal(gate.moving, false)
assert.equal(VIEWPORT_MOVE_IDLE_MS, 160)

const editorSource = readFileSync(new URL('../src/components/flow/FlowEditor.tsx', import.meta.url), 'utf8')
assert.match(editorSource, /viewportMoveGate\.start/)
assert.match(editorSource, /saveCurrentViewport/)
assert.doesNotMatch(editorSource, /saveLightweight/)
assert.match(editorSource, /markFlowRendererUnloading/)

const storeSource = readFileSync(new URL('../src/stores/use-flow-store.ts', import.meta.url), 'utf8')
assert.match(storeSource, /saveCurrentViewport/)
assert.match(storeSource, /liveGraphUnchanged/)
assert.match(storeSource, /pendingPersistWrite/)
assert.match(storeSource, /rendererUnloading/)

console.log('canvas navigation performance checks passed')
