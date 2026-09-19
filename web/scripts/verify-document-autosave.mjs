import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const mocks = new Map()
const modules = new Map()

function evaluate(source, requireModule = require) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, requireModule)
  return module.exports
}

function sourcePath(relativeOrAbsolute) {
  const base = resolve(sourceRoot, relativeOrAbsolute)
  if (existsSync(base) && /\.(ts|tsx)$/.test(base)) return base
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext
  }
  return base
}

function load(relativePath) {
  const path = sourcePath(relativePath)
  if (modules.has(path)) return modules.get(path)
  const result = evaluate(readFileSync(path, 'utf8'), (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  modules.set(path, result)
  return result
}

const storage = new Map()
const calls = []
const localForageStorage = {
  async getItem(name) {
    calls.push(`get:${name}`)
    return storage.has(name) ? storage.get(name) : null
  },
  async setItem(name, value) {
    calls.push(`set:${name}`)
    storage.set(name, value)
    return value
  },
  async removeItem(name) {
    calls.push(`remove:${name}`)
    storage.delete(name)
  },
}
mocks.set('@/lib/localforage-storage', { localForageStorage, default: localForageStorage })

const {
  GRAPH_AUTOSAVE_DELAY_MS,
  isGraphDirty,
  withCurrentViewport,
  persistCurrentGraph,
  persistGraphDocument,
  flushGraphPersist,
  rememberOpenedGraph,
  getLastGraphSnapshot,
  resetGraphSessionForTests,
} = load('storage/graph-session.ts')
const { loadDocument, listDocuments } = load('storage/graph-store.ts')
const { FLOW_LIST_INDEX_KEY, docKey } = load('storage/keys.ts')

assert.equal(GRAPH_AUTOSAVE_DELAY_MS, 450)

const viewA = { x: 10, y: 20, zoom: 1 }
const viewB = { x: 40, y: 20, zoom: 1 }
const doc = {
  id: 'flow-a',
  name: 'Demo',
  title: 'Demo',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  createdAt: 1,
  updatedAt: 10,
}

assert.equal(isGraphDirty(null, viewA, null), false)
assert.equal(isGraphDirty(doc, viewA, null), true)
rememberOpenedGraph(doc, viewA)
assert.equal(isGraphDirty(doc, viewA, getLastGraphSnapshot()), false)
assert.equal(isGraphDirty({ ...doc, updatedAt: 11 }, viewA, getLastGraphSnapshot()), true)
assert.equal(isGraphDirty(doc, viewB, getLastGraphSnapshot()), true)

const persisted = withCurrentViewport(doc, viewB)
assert.equal(persisted.updatedAt, 10)
assert.deepEqual(persisted.viewport, viewB)
assert.equal(withCurrentViewport(persisted, viewB), persisted)

resetGraphSessionForTests()
await persistGraphDocument(withCurrentViewport(doc, viewA))
const loaded = await loadDocument('flow-a')
assert.equal(loaded.ok, true)
assert.deepEqual(loaded.doc.viewport, viewA)
assert.equal(loaded.doc.updatedAt, 10)
const listed = await listDocuments()
assert.equal(listed.some((item) => item.id === 'flow-a'), true)
assert.ok(storage.has(docKey('flow-a')))
assert.ok(storage.has(FLOW_LIST_INDEX_KEY))

resetGraphSessionForTests()
rememberOpenedGraph(doc, viewA)
const writesBefore = calls.filter((item) => item.startsWith('set:')).length
await persistCurrentGraph(() => ({ doc, view: viewA }))
const writesAfterClean = calls.filter((item) => item.startsWith('set:')).length
assert.equal(writesAfterClean, writesBefore)

await persistCurrentGraph(() => ({ doc: { ...doc, updatedAt: 12 }, view: viewA }))
const reloaded = await loadDocument('flow-a')
assert.equal(reloaded.ok, true)
assert.equal(reloaded.doc.updatedAt, 12)

resetGraphSessionForTests()
rememberOpenedGraph(doc, viewA)
const captured = { doc: { ...doc, updatedAt: 13, name: 'Kept' }, view: viewA }
await flushGraphPersist(() => captured)
const switched = await loadDocument('flow-a')
assert.equal(switched.ok, true)
assert.equal(switched.doc.name, 'Kept')
assert.equal(switched.doc.updatedAt, 13)

{
  const { legacyFlowToDocument } = load('runtime/legacy-loader.ts')
  const { documentToLegacyFlow } = load('canvas/document-legacy.ts')
  const document = { version: 1, format: 'tiptap-json', plainText: '格式保留', json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '格式保留', marks: [{ type: 'bold' }] }] }] } }
  const legacy = { ...doc, id: 'sticky-rich-roundtrip', nodes: [{ id: 'sticky', type: 'sticky', position: { x: 0, y: 0 }, data: { label: '贴纸', content: document.plainText, document, color: 'green', background: 'solid' } }] }
  const converted = legacyFlowToDocument(legacy)
  assert.deepEqual(converted.nodes[0].document, document)
  assert.notEqual(converted.nodes[0].document, document)
  await persistGraphDocument(converted, viewA)
  const reopened = await loadDocument(converted.id)
  assert.equal(reopened.ok, true)
  assert.deepEqual(reopened.doc.nodes[0].document, document)
  const exported = documentToLegacyFlow(reopened.doc)
  assert.deepEqual(exported.nodes[0].data.document, document)
  assert.deepEqual(legacyFlowToDocument(exported).nodes[0].document, document)
  const plain = structuredClone(legacy)
  delete plain.nodes[0].data.document
  assert.equal(legacyFlowToDocument(plain).nodes[0].document, undefined)
  const stale = structuredClone(legacy)
  stale.nodes[0].data.content = '已修改正文'
  assert.equal(legacyFlowToDocument(stale).nodes[0].document, undefined)
}

{
  const { useGraphStore } = load('stores/graph-store.ts')
  const { stageCanvasViewport, useCanvasViewportStore } = load('stores/canvas-viewport-store.ts')
  const { currentGraphSource } = load('storage/graph-session.ts')
  resetGraphSessionForTests()
  useGraphStore.getState().openDocument(doc)
  const pendingView = { x: 125, y: -45, zoom: 1.4 }
  stageCanvasViewport(pendingView)
  assert.deepEqual(useCanvasViewportStore.getState().view, doc.viewport)
  await flushGraphPersist(currentGraphSource)
  const savedBeforeFrame = await loadDocument(doc.id)
  assert.equal(savedBeforeFrame.ok, true)
  assert.deepEqual(savedBeforeFrame.doc.viewport, pendingView)
  const closingSource = currentGraphSource()
  useGraphStore.getState().openDocument({ ...doc, id: 'next-flow' })
  await flushGraphPersist(() => closingSource)
  assert.deepEqual((await loadDocument(doc.id)).doc.viewport, pendingView)
  assert.deepEqual(currentGraphSource().view, doc.viewport)
  const page = readFileSync(resolve(sourceRoot, 'pages/CanvasEditorPage.tsx'), 'utf8')
  assert.doesNotMatch(page, /function currentGraphSource\(/)
  assert.match(page, /currentGraphSource,[\s\S]+from '@\/storage'/)
  assert.equal((page.match(/const source = currentGraphSource\(\)/g) || []).length, 2)
}

console.log('document autosave: PASS (including pending-frame save and route-close snapshot)')
