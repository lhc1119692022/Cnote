import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/generation/media-upload-cache.ts', import.meta.url), 'utf8')
const policy = readFileSync(new URL('../src/lib/generation/media-policy.ts', import.meta.url), 'utf8')
const readiness = readFileSync(new URL('../src/lib/generation/media-readiness.ts', import.meta.url), 'utf8')
const persisted = new Map()
let uploads = 0
let status = 200
const checks = []
function createContext() {
  const context = vm.createContext({
    crypto, Blob, TextEncoder, Uint8Array, URL, Date, Promise,
    localForageStorage: {
      getItem: async key => persisted.get(key),
      setItem: async (key, value) => { persisted.set(key, value) },
      removeItem: async key => { persisted.delete(key) },
    },
    desktopFetch: async (url, options) => {
      checks.push({ url, ...options })
      return new Response(null, { status, headers: { 'content-type': 'image/png' } })
    },
  })
  vm.runInContext(ts.transpile((policy + String.fromCharCode(10) + readiness.replace(/^import .*$/gm, '') + String.fromCharCode(10) + source.replace(/^import .*$/gm, '')).replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 }), context)
  return context
}
let context = createContext()
const file = new Blob(['identical bytes'], { type: 'image/png' })
const upload = async checksum => { uploads++; status = 200; assert.match(checksum, /^[a-f0-9]{64}$/); return 'https://media.test/' + checksum }
const reuse = (scope = 'storage-a', blob = file, operation = upload, signal) => context.reuseMediaUpload(scope, blob, operation, signal)
const urls = await Promise.all([reuse(), reuse(), reuse()])
assert.equal(new Set(urls).size, 1)
assert.equal(uploads, 1, 'concurrent tasks share a content upload')
context = createContext()
await reuse()
assert.equal(uploads, 1, 'reuse survives a fresh client instance')
assert.ok(checks.every(check => check.method === 'HEAD' && !check.headers), 'public validation never sends storage credentials')
status = 404
await reuse()
assert.equal(uploads, 2, 'deleted remote objects are uploaded again')
status = 503
await assert.rejects(() => reuse(), /HTTP 503/)
assert.equal(uploads, 2, 'temporary verification errors do not create duplicate objects')
status = 200
await reuse('storage-b')
assert.equal(uploads, 3, 'different services or credentials never share a cache entry')
await reuse('storage-a', new Blob(['different bytes'], { type: 'image/png' }))
assert.equal(uploads, 4, 'names and sizes are not used as content identity')
const abort = new AbortController()
abort.abort()
await assert.rejects(() => reuse('cancelled', file, upload, abort.signal), { name: 'AbortError' })
assert.equal(uploads, 4)
await assert.rejects(() => reuse('failed', file, async () => { throw new Error('upload failed') }), /upload failed/)
await reuse('failed')
assert.equal(uploads, 5, 'failed attempts do not poison later uploads')
assert.ok([...persisted.keys()].every(key => /^media-upload:[a-f0-9]{64}:[a-f0-9]{64}$/.test(key)))
console.log('persistent content upload reuse: PASS')
