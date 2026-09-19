import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const read = name => readFileSync(new URL('../src/lib/generation/' + name + '.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
let status = 200
let contentType = 'image/png'
let expiresAt
let fail = false
const calls = []
const context = vm.createContext({ URL, Date, TextEncoder, console,
  desktopFetch: async (url, options) => {
    calls.push(options)
    if (fail) throw new Error('offline')
    return new Response(null, { status, headers: { 'content-type': contentType, 'content-length': '123', ...(expiresAt ? { 'x-cnote-expires-at': String(expiresAt) } : {}) } })
  },
})
vm.runInContext(ts.transpile([read('media-policy'), read('media-readiness'), read('safe-error'), read('request-diagnostics')].join(String.fromCharCode(10)), { target: ts.ScriptTarget.ES2022 }), context)
const inspect = () => context.inspectMediaUrl('https://media.test/media/file', 'image')
assert.equal((await inspect()).retentionKnown, false)
expiresAt = Date.now() + 14 * 86400000
assert.equal((await inspect()).retentionKnown, true)
expiresAt = Date.now() + 86400000
await assert.rejects(inspect, error => error.recoverable === true)
expiresAt = undefined
for (const code of [404, 410]) { status = code; await assert.rejects(inspect, error => error.recoverable === true) }
for (const code of [401, 403, 429, 503]) { status = code; await assert.rejects(inspect, error => error.recoverable === false) }
status = 200
for (const type of ['text/html', 'application/json', 'video/mp4', '']) { contentType = type; await assert.rejects(inspect, error => error.recoverable === false) }
contentType = 'image/png'
fail = true
await assert.rejects(inspect, /无法匿名检查/)
assert.ok(calls.every(call => call.method === 'HEAD' && call.credentials === 'omit' && !call.headers))
assert.equal(context.mediaRequestSummary({ fields: [], references: [{ type: 'image', transport: 'https' }, { type: 'video', transport: 'https' }, { type: 'audio', transport: 'https' }] }), '请求携带 URL 3·含图片1·视频1·音频1')
assert.equal(context.mediaRequestSummary({ fields: [], references: [{ type: 'image', transport: 'https' }, { type: 'image', transport: 'http' }, { type: 'video', transport: 'https' }] }), '请求携带 URL 3·含图片2·视频1')
assert.equal(context.mediaRequestSummary({ fields: [], references: [{ type: 'audio', transport: 'https' }, { type: 'image', transport: 'inline' }] }), '请求携带 URL 1·含音频1')
assert.equal(context.mediaRequestSummary({ fields: [], references: [] }), '请求携带 URL 0')
const sanitized = context.safeGenerationError('HTTP 400 invalid_ref request-123 task-456 https://media.test/a?signature=secret Bearer private sk-secret data:image/png;base64,secret')
assert.match(sanitized, /HTTP 400 invalid_ref request-123 task-456/)
assert.doesNotMatch(sanitized, /signature|private|sk-secret|base64/)
console.log('media availability, expiry, summary and safe error contracts: PASS')
