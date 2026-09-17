import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
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

const localforageCalls = []
const localforageStore = new Map()
const localforageMock = {
  config() {},
  async getItem(key) {
    localforageCalls.push(`get:${key}`)
    return localforageStore.has(key) ? localforageStore.get(key) : null
  },
  async setItem(key, value) {
    localforageCalls.push(`set:${key}`)
    localforageStore.set(key, value)
    return value
  },
  async removeItem(key) {
    localforageCalls.push(`remove:${key}`)
    localforageStore.delete(key)
  },
  async keys() {
    localforageCalls.push('keys')
    return [...localforageStore.keys()]
  },
  async clear() {
    localforageCalls.push('clear')
    localforageStore.clear()
  },
}
localforageMock.default = localforageMock
mocks.set('localforage', localforageMock)

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:cnote-test'
  URL.revokeObjectURL = () => {}
}

const kv = new Map()
const desktop = {
  storage: {
    async read(key) {
      return kv.has(key) ? kv.get(key) : null
    },
    async write(key, data) {
      if (!(data instanceof Uint8Array)) throw new Error('storage data is invalid')
      kv.set(key, new Uint8Array(data))
    },
    async remove(key) {
      kv.delete(key)
    },
  },
}

globalThis.window = { cnoteDesktop: desktop }

const {
  localForageStorage,
  saveFlow,
  loadFlow,
  deleteFlow,
} = load('lib/localforage-storage.ts')
const {
  storeLocalResource,
  retainLocalResource,
  deleteLocalResource,
  loadLocalResourceBlob,
  getLocalResourceMeta,
  hasLocalResource,
} = load('lib/resource-storage.ts')

await localForageStorage.setItem('cnote-doc', '{"id":"1"}')
assert.equal(await localForageStorage.getItem('cnote-doc'), '{"id":"1"}')
await localForageStorage.removeItem('cnote-doc')
assert.equal(await localForageStorage.getItem('cnote-doc'), null)

await saveFlow('flow-1', { name: 'Demo' })
assert.deepEqual(await loadFlow('flow-1'), { name: 'Demo' })
await deleteFlow('flow-1')
assert.equal(await loadFlow('flow-1'), null)

const file = new Blob(['hello-resource'], { type: 'text/plain' })
const stored = await storeLocalResource(file, 'note.txt')
assert.match(stored.resourceId, /^sha256-[a-f0-9]{64}$/)
assert.equal(await hasLocalResource(stored.resourceId), true)
assert.equal((await getLocalResourceMeta(stored.resourceId)).refCount, 1)
assert.equal(await (await loadLocalResourceBlob(stored.resourceId)).text(), 'hello-resource')

await retainLocalResource(stored.resourceId)
assert.equal((await getLocalResourceMeta(stored.resourceId)).refCount, 2)
await deleteLocalResource(stored.resourceId)
assert.equal((await getLocalResourceMeta(stored.resourceId)).refCount, 1)
await deleteLocalResource(stored.resourceId)
assert.equal(await getLocalResourceMeta(stored.resourceId), null)
assert.equal(await hasLocalResource(stored.resourceId), false)
assert.equal(kv.has(`resource:${stored.resourceId}`), false)
assert.equal(kv.has(`resource-meta:${stored.resourceId}`), false)

assert.deepEqual(localforageCalls, [])

const failing = {
  storage: {
    async read() {
      throw new Error('desktop read failed')
    },
    async write() {
      throw new Error('desktop write failed')
    },
    async remove() {
      throw new Error('desktop remove failed')
    },
  },
}
window.cnoteDesktop = failing
await assert.rejects(() => localForageStorage.setItem('secret-doc', 'value'), /desktop write failed/)
await assert.rejects(() => localForageStorage.getItem('secret-doc'), /desktop read failed/)
await assert.rejects(() => storeLocalResource(new Blob(['x'], { type: 'text/plain' })), /desktop (read|write) failed/)
assert.deepEqual(localforageCalls, [])

delete window.cnoteDesktop
await localForageStorage.setItem('web-only', 'ok')
assert.equal(await localForageStorage.getItem('web-only'), 'ok')
assert.ok(localforageCalls.includes('set:web-only'))
assert.ok(localforageCalls.includes('get:web-only'))

console.log('Web desktop-storage adapter tests passed.')
