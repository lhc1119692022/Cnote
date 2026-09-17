import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const mocks = new Map()
const modules = new Map()

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://cnote.test' })
for (const key of ['window', 'document', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}

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
const localForageStorage = {
  async getItem(name) {
    return storage.has(name) ? storage.get(name) : null
  },
  async setItem(name, value) {
    storage.set(name, value)
    return value
  },
  async removeItem(name) {
    storage.delete(name)
  },
}
mocks.set('@/lib/localforage-storage', { localForageStorage, default: localForageStorage })

const { useGraphStore } = load('stores/graph-store.ts')
const { useRuntimeStore } = load('stores/runtime-store.ts')
const { loadDocument } = load('storage/graph-store.ts')
const { runtimeRunKey } = load('storage/keys.ts')
const {
  hydrateRuntimeStore,
  resetRuntimePersistenceForTests,
} = load('storage/runtime-persistence.ts')
const { persistSessionForExit } = load('storage/session-exit.ts')
const { resetGraphSessionForTests } = load('storage/graph-session.ts')

const doc = {
  id: 'flow-exit',
  name: 'Exit',
  title: 'Exit',
  viewport: { x: 4, y: 8, zoom: 1.5 },
  nodes: [{
    id: 'req-1',
    kind: 'request',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 80 },
    label: '生成',
    variant: 'image',
    latestRunId: 'run-live',
  }],
  edges: [],
  createdAt: 1,
  updatedAt: 10,
}

const running = {
  id: 'run-live',
  status: 'running',
  createdAt: 1,
  requestNodeId: 'req-1',
  variant: 'image',
  tasks: [{
    id: 't1',
    status: 'running',
    remoteTaskId: 'remote-1',
    requestNodeId: 'req-1',
    variant: 'image',
    channelId: 'ch-1',
    model: 'gpt-image',
    inputVersion: 'v1',
    requestSnapshot: {
      variant: 'image',
      channelId: 'ch-1',
      providerId: 'openai',
      baseURL: 'https://api.example.com',
      model: 'gpt-image',
      inputVersion: 'v1',
      config: { prompt: 'x', references: [] },
    },
  }],
}

resetGraphSessionForTests()
useGraphStore.getState().openDocument(doc)
useGraphStore.getState().setViewport({ x: 12, y: 24, zoom: 2 })
useRuntimeStore.setState({
  sessions: {},
  captures: {},
  assets: {},
  aiSessions: {},
  runs: { 'run-live': running },
})

await persistSessionForExit()

assert.equal(useRuntimeStore.getState().runs['run-live']?.status, 'waiting-for-user')
assert.equal(useRuntimeStore.getState().runs['run-live']?.tasks[0]?.recovery?.state, 'waiting-for-user')

const saved = await loadDocument('flow-exit')
assert.equal(saved.ok, true)
assert.deepEqual(saved.doc.viewport, { x: 12, y: 24, zoom: 2 })
assert.equal(saved.doc.nodes[0]?.latestRunId, 'run-live')
assert.equal(typeof storage.get(runtimeRunKey('run-live')), 'string')
assert.equal(JSON.parse(storage.get(runtimeRunKey('run-live'))).status, 'waiting-for-user')

useRuntimeStore.setState({
  sessions: {},
  captures: {},
  assets: {},
  aiSessions: {},
  runs: {},
})
await resetRuntimePersistenceForTests()
await hydrateRuntimeStore()

assert.equal(useRuntimeStore.getState().runs['run-live']?.status, 'waiting-for-user')
assert.equal(useRuntimeStore.getState().runs['run-live']?.tasks[0]?.remoteTaskId, 'remote-1')
assert.equal(useRuntimeStore.getState().runs['run-live']?.tasks[0]?.requestSnapshot?.model, 'gpt-image')

console.log('session exit close/reopen: PASS')
