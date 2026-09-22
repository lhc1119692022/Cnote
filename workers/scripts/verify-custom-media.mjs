import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../custom-media/worker.js', import.meta.url), 'utf8')
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const entries = new Map()
let writes = 0
const bucket = {
  async head(key) { const entry = entries.get(key); return entry ? { ...entry, key } : null },
  async get(key) { const entry = await this.head(key); return entry ? { ...entry, arrayBuffer: async () => entry.bytes.buffer, body: new Response(entry.bytes).body, writeHttpMetadata: headers => { headers.set('content-type', entry.httpMetadata.contentType) } } : null },
  async put(key, input, options) {
    if (entries.has(key) && options.onlyIf?.etagDoesNotMatch === '*') return null
    const bytes = new Uint8Array(await new Response(input).arrayBuffer())
    writes++
    entries.set(key, { key, size: bytes.length, bytes, uploaded: new Date(), ...options, writeHttpMetadata: headers => headers.set('content-type', options.httpMetadata.contentType) })
    return this.head(key)
  },
  async delete(key) { entries.delete(key) },
  async list() { return { objects: [...entries.values()], truncated: false } },
}
const env = { MEDIA_BUCKET: bucket, CN_MEDIA_TOKEN: 'test-token' }
const request = (path, init = {}) => worker.fetch(new Request('https://media.test' + path, init), env)
const headers = { Authorization: 'Bearer test-token' }
async function upload(name = 'first.png', checksum) {
  const form = new FormData()
  form.append('file', new File(['identical'], name, { type: 'image/png' }))
  if (checksum) form.append('checksum', checksum)
  return request('/upload', { method: 'POST', headers, body: form })
}
const first = await (await upload()).json()
assert.ok(first.key.startsWith('media/'))
assert.ok(first.expiresAt > Date.now() + 13 * 86400000)
assert.equal((await (await upload('renamed.png')).json()).key, first.key)
assert.equal(writes, 1)
await Promise.all([upload(), upload()])
assert.equal(writes, 1)
assert.equal((await upload('wrong.png', 'invalid')).status, 400)
assert.equal((await request('/prepare', { method: 'POST', body: '{}' })).status, 401)
const prepare = key => request('/prepare', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
const oldKey = 'media/2026/01/01/old.png'
entries.set(oldKey, { ...entries.get(first.key), key: oldKey, uploaded: new Date(Date.now() - 13 * 86400000) })
entries.delete(first.key)
const beforeRenewalWrites = writes
const renewed = await (await prepare(oldKey)).json()
assert.equal(writes, beforeRenewalWrites + 1, 'near-expiry media is copied when no fresh object exists')
assert.equal(renewed.renewed, true)
assert.notEqual(renewed.key, oldKey)
assert.ok(entries.has(oldKey), 'renewal never deletes or overwrites an existing task URL')
assert.equal(entries.get(oldKey).uploaded.getTime() < Date.now() - 12 * 86400000, true)
assert.equal((await prepare('media/missing')).status, 404)
assert.equal((await prepare('other/file')).status, 400)
const head = await request(new URL(first.url).pathname, { method: 'HEAD' })
assert.equal(head.status, 200)
assert.equal(head.headers.get('cache-control'), 'no-store')
assert.equal(Number(head.headers.get('content-length')), 'identical'.length)
assert.equal(Number(head.headers.get('x-cnote-expires-at')), renewed.expiresAt)
const plain = await request(new URL(first.url).pathname)
assert.equal(plain.status, 200)
assert.equal(Number(plain.headers.get('content-length')), 'identical'.length)
assert.equal(await plain.text(), 'identical')
const ranged = await request(new URL(first.url).pathname, { headers: { Range: 'bytes=0-1' } })
assert.equal(ranged.status, 200)
assert.equal(await ranged.text(), 'identical')
console.log('custom Worker compatibility, deduplication and non-destructive renewal: PASS')
