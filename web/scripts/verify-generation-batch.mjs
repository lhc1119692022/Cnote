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
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.endsWith('.css')) return {}
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? name.slice(2) : join(dirname(relative), name).replaceAll('\\', '/')
      const suffix = ['.ts', '.tsx', '/index.ts'].find((extension) => existsSync(new URL('../src/' + path + extension, import.meta.url)))
      return load(path + suffix)
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}

const { useGraphStore } = load('stores/graph-store.ts')
const { useRuntimeStore } = load('stores/runtime-store.ts')
const { upsertGenerationResultNodes, collectUpstreamReferences } = load('canvas/contents/request-generation.ts')
const { toggleBatchExpanded, detachGenerationBatch, batchSlots, batchGrid, recordMediaDimensions, copyMediaResource } = load('canvas/generation-batch.ts')
const request = { id: 'request', kind: 'request', variant: 'image', label: '图片生成', position: { x: 0, y: 0 }, size: { width: 480, height: 420 }, latestRunId: 'run-1', image: {}, video: {} }
const downstream = { id: 'ai', kind: 'ai', label: 'AI', position: { x: 2000, y: 0 }, size: { width: 400, height: 400 } }
const old = { id: 'old', kind: 'content', category: 'image', subtype: 'image', label: '上一轮', position: { x: 568, y: 0 }, size: { width: 540, height: 430 }, source: { kind: 'url', url: 'https://fixture.invalid/old.png' } }
const originalOld = structuredClone(old)
useGraphStore.getState().openDocument({ id: 'batch-flow', name: 'Batch', nodes: [request, old, downstream], edges: [{ id: 'old-edge', source: request.id, target: old.id }], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
const run = { id: 'run-1', status: 'running', requestNodeId: request.id, variant: 'image', createdAt: 1, tasks: [0, 1, 2].map(index => ({ id: 'task-' + index, status: 'running' })) }
useRuntimeStore.getState().putRun(run)
const options = { documentId: 'batch-flow', requestNodeId: request.id, variant: 'image', runId: run.id, expectedCount: 3 }
const [id] = upsertGenerationResultNodes({ ...options, results: [] })
const node = () => useGraphStore.getState().currentDocument.nodes.find(node => node.id === id)
const documentState = () => useGraphStore.getState().currentDocument
assert.ok(id)
assert.equal(node().payload.resources.length, 0)
assert.ok(node().position.y >= old.size.height + 24, 'new batch avoids old results without moving them')
assert.equal(documentState().edges.filter(edge => edge.target === id).length, 1)
const write = (taskIndex, url) => upsertGenerationResultNodes({ ...options, taskIndex, createIfMissing: false, results: [{ url, mimeType: 'image/png' }] })
write(2, 'https://fixture.invalid/third.png')
assert.equal(node().payload.resources.length, 1)
assert.equal(node().payload.activeResourceIndex, 0)
write(0, 'https://fixture.invalid/first.png')
assert.deepEqual(node().payload.resources.map(item => item.resource.url), ['https://fixture.invalid/first.png', 'https://fixture.invalid/third.png'])
assert.equal(node().payload.activeResourceIndex, 1, 'later arrivals do not replace the preview the user is viewing')
const beforeDuplicate = useGraphStore.getState().historyIndex
write(0, 'https://fixture.invalid/first.png')
assert.equal(useGraphStore.getState().historyIndex, beforeDuplicate, 'repeated completion is idempotent')
assert.deepEqual(batchSlots(node()).map(slot => slot.resourceIndex), [0, undefined, 1])
const normalSize = { ...node().size }
const normalPosition = { ...node().position }
toggleBatchExpanded(id)
assert.ok(!node().generationBatch.expanded, 'running batch cannot expand')
assert.deepEqual(node().position, normalPosition)
assert.equal(detachGenerationBatch(id), false, 'cannot detach a running batch')
useRuntimeStore.getState().updateRun(run.id, { status: 'waiting-for-user' })
assert.equal(detachGenerationBatch(id), false, 'waiting is not finished')
useRuntimeStore.getState().updateRun(run.id, { status: 'failed' })
toggleBatchExpanded(id)
assert.equal(node().generationBatch.expanded, true)
const expandedSnapshot = JSON.parse(JSON.stringify(documentState()))
useGraphStore.getState().openDocument(expandedSnapshot)
assert.equal(node().generationBatch.expanded, true, 'expanded presentation survives reopening')
toggleBatchExpanded(id)
assert.deepEqual(node().size, normalSize)
assert.equal(node().payload.activeResourceIndex, 1)
const upstream = collectUpstreamReferences('image', [node()], documentState().nodes, {}, {})
assert.equal(upstream.length, 1)
assert.equal(upstream[0].url, 'https://fixture.invalid/third.png', 'downstream sees selected result, not entire batch')
useGraphStore.getState().addEdge(id, 'ai')
useRuntimeStore.getState().updateRun(run.id, { status: 'failed' })
toggleBatchExpanded(id)
useGraphStore.setState({ isLocked: true })
assert.equal(detachGenerationBatch(id), false)
useGraphStore.setState({ isLocked: false })
const beforeDetach = structuredClone(documentState())
const grid = batchGrid(normalSize, 2)
assert.equal(detachGenerationBatch(id), true)
assert.equal(node(), undefined)
const independent = documentState().nodes.filter(node => node.kind === 'content' && node.generatedBy?.runId === run.id)
assert.equal(independent.length, 2)
assert.ok(independent.every(node => !node.generationBatch && node.generatedBy.detached && node.payload.resources.length === 1))
assert.equal(documentState().edges.some(edge => independent.some(node => node.id === edge.target)), false, 'all batch inputs are removed')
const selected = independent.find(node => node.payload.resources[0].resource.url.endsWith('third.png'))
assert.ok(documentState().edges.some(edge => edge.source === selected.id && edge.target === 'ai'))
assert.equal(selected.position.x, normalPosition.x + grid.cells[1].x, 'unbind preserves actual resource cell')
assert.equal(selected.position.y, normalPosition.y)
useGraphStore.getState().undo()
assert.deepEqual(documentState(), beforeDetach, 'one undo restores batch, layout and all edges')
useGraphStore.getState().redo()
assert.equal(node(), undefined)
assert.deepEqual(write(1, 'https://fixture.invalid/late.png'), [], 'late completion cannot recreate detached batch')
useGraphStore.getState().undo()
useGraphStore.getState().duplicateNode(id)
const copy = documentState().nodes.find(node => node.id === useGraphStore.getState().selection[0])
assert.equal(copy.generationBatch, undefined)
assert.equal(copy.generatedBy.detached, true)
assert.equal(useGraphStore.getState().splitMediaNode(id), false, 'legacy split cannot corrupt a live batch')
useGraphStore.getState().deleteEdge(documentState().edges.find(edge => edge.source === 'request' && edge.target === id).id)
assert.deepEqual(write(1, 'https://fixture.invalid/disconnected.png'), [])
useGraphStore.getState().updateNode('request', { latestRunId: 'run-2' })
const secondIds = upsertGenerationResultNodes({ ...options, runId: 'run-2', expectedCount: 1, results: [{ url: 'https://fixture.invalid/new.png', mimeType: 'image/png' }] })
assert.notEqual(secondIds[0], id)
assert.deepEqual(documentState().nodes.find(node => node.id === old.id), originalOld)
assert.deepEqual(write(1, 'https://fixture.invalid/stale.png'), [], 'stale run cannot write into new run')
useGraphStore.getState().updateNode('request', { variant: 'video', latestRunId: 'video-run' })
const [videoId] = upsertGenerationResultNodes({ ...options, variant: 'video', runId: 'video-run', expectedCount: 1, results: [{ url: 'https://fixture.invalid/a.mp4', mimeType: 'video/mp4' }, { url: 'https://fixture.invalid/b.mp4', mimeType: 'video/mp4' }] })
assert.equal(documentState().nodes.find(node => node.id === videoId).payload.resources.length, 2)
useGraphStore.getState().deleteNode(videoId)
assert.deepEqual(upsertGenerationResultNodes({ ...options, variant: 'video', runId: 'video-run', createIfMissing: false, results: [] }), [])
assert.equal(upsertGenerationResultNodes({ ...options, documentId: 'other-flow', results: [] }).length, 0)
assert.equal(batchGrid({ width: 300, height: 200 }, 3).columns, 3)
for (const count of [9, 10, 20]) assert.equal(batchGrid({ width: 300, height: 200 }, count).columns, 4)
const mediaFixture = { ...old, id: 'adaptive', payload: { kind: 'image', activeResourceIndex: 0, resources: [{ resource: { url: 'portrait', width: 600, height: 1200 } }, { resource: { url: 'landscape' } }] } }
useGraphStore.getState().openDocument({ ...documentState(), nodes: [mediaFixture], edges: [] })
const adaptive = () => documentState().nodes.find(node => node.id === 'adaptive')
recordMediaDimensions('adaptive', 'portrait', 600, 1200)
assert.deepEqual(adaptive().size, { width: 270, height: 540 })
const unchanged = adaptive()
recordMediaDimensions('adaptive', 'stale-resource', 200, 200)
assert.equal(adaptive(), unchanged, 'stale image load cannot resize another resource')
recordMediaDimensions('adaptive', 'portrait', 600, 1200)
assert.equal(adaptive(), unchanged, 'repeated load does not write again')
recordMediaDimensions('adaptive', 'landscape', 1600, 900)
assert.deepEqual(adaptive().size, { width: 270, height: 540 }, 'inactive resource does not resize collapsed preview')
useGraphStore.getState().updateNode('adaptive', { manualSize: true })
recordMediaDimensions('adaptive', 'portrait', 800, 600)
assert.deepEqual(adaptive().size, { width: 270, height: 540 }, 'manual dimensions are preserved')
useGraphStore.setState({ isLocked: true })
assert.equal(copyMediaResource('adaptive', 0, { x: 900, y: 800 }), null)
useGraphStore.setState({ isLocked: false })
useGraphStore.getState().commitHistory()
const beforeCopy = structuredClone(documentState())
const copyId = copyMediaResource('adaptive', 1, { x: 900, y: 800 })
const copied = documentState().nodes.find(node => node.id === copyId)
assert.deepEqual(copied.size, { width: 640, height: 360 })
assert.deepEqual(copied.position, { x: 580, y: 620 })
assert.equal(copied.payload.resources[0].resource.url, 'landscape')
assert.equal(copied.generationBatch, undefined)
assert.equal(documentState().edges.length, 0)
assert.equal(adaptive().payload.resources.length, 2, 'drag copy leaves original intact')
useGraphStore.getState().undo()
assert.deepEqual(documentState(), beforeCopy, 'copy undo is one step')
dom.window.close()
console.log('Generation batches: per-run identity, progressive ordered results, stable selection, grid, detach/undo, copy isolation, locked/waiting guards, reopen and downstream selection PASS')
