import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const sourcePath = fileURLToPath(new URL('../src/media-upload.ts', import.meta.url))
const bundled = await build({
  entryPoints: [sourcePath],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  target: 'es2022',
})
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
const { default: worker } = await import(moduleUrl)

const entries = new Map()
const bucket = {
  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer())
    entries.set(key, { bytes, options, uploaded: new Date('2026-01-01T00:00:00.000Z'), etag: `etag-${key}` })
  },
  async get(key) {
    const entry = entries.get(key)
    if (!entry) return null
    return {
      body: new Response(entry.bytes).body,
      size: entry.bytes.byteLength,
      httpEtag: entry.etag,
      etag: entry.etag,
      uploaded: entry.uploaded,
      customMetadata: entry.options.customMetadata,
      writeHttpMetadata(headers) {
        headers.set('Content-Type', entry.options.httpMetadata?.contentType || 'application/octet-stream')
        headers.set('Content-Disposition', entry.options.httpMetadata?.contentDisposition || 'inline')
      },
    }
  },
  async delete(key) {
    entries.delete(key)
  },
  async list(options = {}) {
    const objects = [...entries.entries()].map(([key, entry]) => ({
      key,
      size: entry.bytes.byteLength,
      uploaded: entry.uploaded,
      etag: entry.etag,
      customMetadata: entry.options.customMetadata,
    }))
    const limit = options.limit || 1000
    return { objects: objects.slice(0, limit), truncated: false, cursor: undefined }
  },
}

const environment = { MEDIA_BUCKET: bucket, CN_MEDIA_UPLOAD_TOKEN: 'media-contract-token' }
const accessHeaders = { Authorization: 'Bearer media-contract-token' }

async function request(path, init = {}) {
  return worker.fetch(new Request(`https://media.example.test${path}`, init), environment, {})
}

const health = await request('/health')
assert.equal(health.status, 200)
assert.deepEqual(await health.json(), { ok: true, uploadConfigured: true })

const unauthorizedUsage = await request('/usage')
assert.equal(unauthorizedUsage.status, 401)

const file = new File([new TextEncoder().encode('media-contract')], 'reference.mp4', { type: 'video/mp4' })
const form = new FormData()
form.append('file', file)
const uploaded = await request('/upload', { method: 'POST', headers: accessHeaders, body: form })
assert.equal(uploaded.status, 200)
const uploadedPayload = await uploaded.json()
assert.match(uploadedPayload.url, /^https:\/\/media\.example\.test\/media\/sha256-[a-f0-9]{64}$/)
assert.equal(uploadedPayload.key, uploadedPayload.url.split('/').pop())

const sameFile = new FormData()
sameFile.append('file', new File([new TextEncoder().encode('media-contract')], 'renamed.mp4', { type: 'video/mp4' }))
const deduplicated = await request('/upload', { method: 'POST', headers: accessHeaders, body: sameFile })
assert.equal((await deduplicated.json()).key, uploadedPayload.key)
assert.equal(entries.size, 1)

const mediaPath = new URL(uploadedPayload.url).pathname
const head = await request(mediaPath, { method: 'HEAD' })
assert.equal(head.status, 200)
assert.equal(head.headers.get('content-type'), 'video/mp4')
assert.equal(Number(head.headers.get('content-length')), file.size)
assert.equal(head.headers.get('accept-ranges'), 'none')
assert.equal((await request(mediaPath)).status, 200)
const ranged = await request(mediaPath, { headers: { Range: 'bytes=0-1' } })
assert.equal(ranged.status, 200, 'Range requests still return the complete file as HTTP 200')
assert.equal(ranged.headers.get('accept-ranges'), 'none')
assert.equal(ranged.headers.get('content-range'), null)
assert.equal((await ranged.arrayBuffer()).byteLength, file.size)

const usage = await request('/usage', { headers: accessHeaders })
assert.equal(usage.status, 200)
const usagePayload = await usage.json()
assert.equal(usagePayload.objectCount, 1)
assert.equal(usagePayload.totalBytes, file.size)
assert.equal(usagePayload.truncated, false)
assert.match(usagePayload.measuredAt, /^20\d\d-/)

const objects = await request('/objects?limit=10', { headers: accessHeaders })
assert.equal(objects.status, 200)
const objectPayload = await objects.json()
assert.equal(objectPayload.objects.length, 1)
assert.equal(objectPayload.objects[0].key, uploadedPayload.key)
assert.equal(objectPayload.objects[0].originalName, 'renamed.mp4')

const deletedWithoutToken = await request(`/media/${encodeURIComponent(uploadedPayload.key)}`, { method: 'DELETE' })
assert.equal(deletedWithoutToken.status, 401)
const deleted = await request(`/media/${encodeURIComponent(uploadedPayload.key)}`, { method: 'DELETE', headers: accessHeaders })
assert.equal(deleted.status, 200)
assert.equal((await request(mediaPath)).status, 404)

console.log('Media upload contract tests passed.')
