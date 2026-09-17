import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://cnote.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLInputElement', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof dom.window[key] === 'function' && key.includes('AnimationFrame') ? dom.window[key].bind(dom.window) : dom.window[key] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
const require = createRequire(import.meta.url)
const cache = new Map()
function load(relative) {
  const filename = fileURLToPath(new URL('../src/' + relative, import.meta.url))
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.endsWith('.css')) return {}
    if (name === '@/lib/content-import') return { emptyContentData: category => ({ kind: 'content', category, source: null }) }
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? name.slice(2) : join(dirname(relative), name).replaceAll('\\', '/')
      const suffix = ['.ts', '.tsx', '/index.ts'].find((extension) => existsSync(new URL('../src/' + path + extension, import.meta.url)))
      return load(path + suffix)
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}


Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event })
const records = new Map()
let failRemoval = false
window.cnoteDesktop = { storage: {
  keys: async () => [...records.keys()],
  read: async key => records.get(key) || null,
  write: async (key, bytes) => { records.set(key, new Uint8Array(bytes)) },
  remove: async key => { if (failRemoval && key.startsWith('resource:')) throw new Error('fixture disk failure'); records.delete(key) },
}, system: { removeManagedResource: async () => {} } }
const { useGraphStore } = load('stores/graph-store.ts')
const { useRuntimeStore } = load('stores/runtime-store.ts')
const graph = load('storage/graph-store.ts')
const library = load('storage/resource-library.ts')
const resource = load('lib/resource-storage.ts')
const policy = load('storage/resource-policy.ts')
const storage = load('lib/localforage-storage.ts').default
const { useSourceStore } = load('stores/use-source-store.ts')
const media = await resource.storeLocalResource(new Blob(['image-a'], { type: 'image/png' }), 'a.png')
const other = await resource.storeLocalResource(new Blob(['image-b'], { type: 'image/png' }), 'b.png')
const image = { id: 'image', kind: 'content', category: 'image', subtype: 'image', label: 'Image', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, source: { kind: 'file', assetId: 'asset-' + media.checksum, mimeType: 'image/png' }, assetId: 'asset-' + media.checksum, generatedBy: { requestNodeId: 'request', runId: 'run', variant: 'image', createdAt: 100 }, payload: { kind: 'image', resources: [{ resource: { resourceId: media.resourceId, url: 'https://fixture.invalid/a.png' } }], activeResourceIndex: 0 } }
const flow = (id, nodes) => ({ id, name: id, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
await graph.createDocument(flow('first', [image, { ...image, id: 'copy' }]))
await graph.createDocument(flow('second', [{ ...image, id: 'shared' }]))
records.set('gallery-index:v1:first', new TextEncoder().encode('broken-index'))
let gallery = await library.loadGallery()
assert.equal(gallery.length, 1, 'one generation entry across node copies')
assert.equal(gallery[0].locations.length, 3)
await library.removeResourceFromFlow('first', media.resourceId)
assert.equal((await graph.loadDocument('first')).doc.nodes.length, 0)
assert.equal((await graph.loadDocument('second')).doc.nodes.length, 1)
assert.ok(await resource.loadLocalResourceBlob(media.resourceId), 'local removal retains shared bytes')
await graph.saveDocument(flow('first', [image, { ...image, id: 'copy' }]))
await library.setGalleryFavorite(gallery[0].id, true)
assert.deepEqual(await library.galleryFavorites(), [gallery[0].id])
await library.deleteFlowWithResources('first')
assert.equal((await library.loadGallery())[0].locations.length, 1)
assert.ok(await resource.loadLocalResourceBlob(media.resourceId), 'shared bytes survive flow deletion')
await assert.rejects(graph.saveDocument(flow('first', [image])), /已删除/, 'stale autosave cannot recreate deleted flow')
const batch = { ...image, id: 'batch', generationBatch: { runId: 'run', expectedCount: 2, resourceKeys: ['0:0', '1:0'], expanded: true, collapsedSize: image.size }, payload: { kind: 'image', activeResourceIndex: 0, resources: [...image.payload.resources, { resource: { resourceId: other.resourceId, url: 'https://fixture.invalid/b.png' } }] } }
await graph.createDocument(flow('batch-flow', [batch]))
useGraphStore.getState().openDocument(flow('batch-flow', [batch]))
useRuntimeStore.getState().putRun({ id: 'running', requestNodeId: 'request', variant: 'image', status: 'running', tasks: [], createdAt: 1 })
await assert.rejects(library.permanentlyDeleteResource(media.resourceId), /生成任务/)
useRuntimeStore.getState().removeRun('running')
const impact = await library.resourceImpact(media.resourceId)
assert.equal(impact.flows.length, 2)
failRemoval = true
await assert.rejects(library.permanentlyDeleteResource(media.resourceId), /disk failure/)
assert.ok(policy.currentResourcePolicy().pending.includes(media.resourceId), 'failed cleanup stays journaled')
failRemoval = false
await library.resumeResourceCleanup()
assert.equal(policy.currentResourcePolicy().pending.length, 0)
assert.equal(records.has('resource:' + media.resourceId), false)
assert.equal((await graph.loadDocument('second')).doc.nodes.length, 0)
const remaining = (await graph.loadDocument('batch-flow')).doc.nodes[0]
assert.equal(remaining.payload.resources.length, 1)
assert.equal(remaining.payload.resources[0].resource.resourceId, other.resourceId)
assert.equal(remaining.assetId, 'asset-' + other.checksum)
assert.equal(remaining.generationBatch.expanded, false)
useGraphStore.getState().undo()
assert.ok(useGraphStore.getState().currentDocument.nodes.every(node => !policy.resourceReferences(node).has(media.resourceId)), 'undo cannot resurrect removed media')
await graph.saveDocument(flow('second', [image]))
assert.equal((await graph.loadDocument('second')).doc.nodes.length, 0, 'old snapshot cannot resurrect removed resource')
assert.equal(await resource.loadLocalResourceBlob(media.resourceId), null)
useGraphStore.getState().closeDocument()
await library.deleteFlowWithResources('batch-flow')
let stats = await library.collectUnusedResources()
assert.ok(stats.pending >= 1, 'first orphan detection retains bytes')
const originalNow = Date.now
Date.now = () => originalNow() + 8 * 86400000
stats = await library.collectUnusedResources()
assert.ok(stats.removed >= 1)
assert.equal(records.has('resource:' + other.resourceId), false)
Date.now = originalNow
const restoredImport = await resource.storeLocalResource(new Blob(['image-b'], { type: 'image/png' }), 'reimport.png')
assert.equal(restoredImport.resourceId, other.resourceId, 'explicit new import may reuse a previously collected content hash')
assert.ok(await resource.loadLocalResourceBlob(other.resourceId))
const indexed = load('storage/gallery-index.ts')
const freshNode = { ...image, assetId: 'asset-' + other.checksum, source: { kind: 'file', assetId: 'asset-' + other.checksum }, payload: { kind: 'image', resources: [{ resource: { resourceId: other.resourceId, url: 'https://fixture.invalid/b.png' } }] } }
const separateRuns = indexed.mergeGalleryEntries([indexed.indexGalleryDocument(flow('runs', [freshNode, { ...freshNode, id: 'new', generatedBy: { ...freshNode.generatedBy, runId: 'another-run' } }]))])
assert.equal(separateRuns.length, 2, 'same bytes produced in distinct requests retain both generation events')
assert.equal(indexed.mergeGalleryEntries([indexed.indexGalleryDocument(flow('one', [{ ...image, generatedBy: { ...image.generatedBy, runId: 'new-run' } }]))]).length, 0, 'deleted resource is absent from index')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { MemoryRouter } = require('react-router-dom')
const { act } = React
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class { observe() {} disconnect() {} } })
await graph.createDocument(flow('gallery-ui', Array.from({ length: 27 }, (_, index) => ({ ...freshNode, id: 'ui-' + index, category: index === 26 ? 'video' : 'image', generatedBy: { ...freshNode.generatedBy, runId: 'ui-run-' + index, createdAt: 1000 + index } }))))
const { Gallery } = load('pages/Gallery.tsx')
const root = createRoot(document.getElementById('app'))
await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Gallery))))
assert.equal(document.querySelectorAll('article').length, 24, 'gallery bounds mounted previews to a page')
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
await act(async () => button('下一页').click())
assert.equal(document.querySelectorAll('article').length, 2)
await act(async () => document.querySelector('[aria-label="最新优先"]').click())
assert.ok(document.querySelector('[aria-label="最早优先"]'))
await act(async () => button('视频').click())
assert.equal(document.querySelectorAll('article').length, 1)
assert.ok(document.querySelector('[aria-label="播放视频"]'))
await act(async () => document.querySelector('article [aria-label="收藏"]').click())
assert.equal(document.querySelector('article [aria-label="收藏"]').getAttribute('aria-pressed'), 'true')
await act(async () => document.querySelector('[aria-label="只看收藏"]').click())
assert.equal(document.querySelectorAll('article').length, 1)
await act(async () => root.unmount())
dom.window.close()
console.log('Resource library PASS: shared bytes, gallery dedup, favorites, delete-flow guard, partial batches, active task guard, journal recovery, stale writes, undo protection, seven-day collection. Fixtures only.')
