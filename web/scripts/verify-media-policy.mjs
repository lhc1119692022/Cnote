import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const policy = readFileSync(new URL('../src/lib/generation/media-policy.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/lib/generation/client.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest, true)
const names = ['prepareReferenceConfig', 'referenceURL', 'isHttpsUrl']
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
let uploads = 0
const context = vm.createContext({
  TextEncoder, URL, Blob, Uint8Array, btoa, Date, console,
  inspectMediaUrl: async () => ({ expiresAt: undefined }),
  prepareManagedReference: async (_channel, reference) => reference.url,
  MediaReadinessError: class extends Error {},
  generationAdapterForModel: () => undefined,
  is808VideoChannel: () => false,
  mediaUploadSettings: channel => ({ transport: channel.mediaTransport }),
  generationVideoRequestContractForModel: () => undefined,
  normalizeGenerationReferences: references => references,
  useMediaStorageStore: { getState: () => ({ baseURL: '' }) },
  referenceBlob: async reference => ({ blob: new Blob(['sample'], { type: reference.mimeType || 'image/png' }) }),
  uploadReference: async () => { uploads++; return 'https://cdn.example.test/file' },
})
vm.runInContext(ts.transpile((policy + '\n' + selected).replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 }), context)
assert.throws(() => vm.runInContext("resolveMediaTransport('auto')", context), /自定义媒体存储/)
assert.equal( vm.runInContext("resolveMediaTransport('auto', true)", context), 'custom')
assert.throws(() => vm.runInContext("resolveMediaTransport('public-url')", context), /自定义媒体存储/)
assert.equal( vm.runInContext("resolveMediaTransport('presign', true)", context), 'custom')
assert.throws(() => vm.runInContext("resolveMediaTransport('custom')", context), /自定义媒体存储/)
assert.equal(vm.runInContext("resolveMediaTransport('custom', true)", context), 'custom')
assert.equal( vm.runInContext("resolveMediaTransport('multipart', true)", context), 'custom')
assert.throws(() => vm.runInContext('assertMediaLifetime(Date.now())', context), /有效期/)
assert.equal(vm.runInContext("isRangeIncompatiblePublicHost('https://pub-123.r2.dev/media/sha256-abc')", context), true)
assert.equal(vm.runInContext("isRangeIncompatiblePublicHost('https://cnote-media.example.workers.dev/media/sha256-abc')", context), false)
assert.throws(() => vm.runInContext("assertAnonymousCompleteFileUrl('https://pub-123.r2.dev/media/sha256-abc')", context), /HTTP 206/)
assert.equal(vm.runInContext("signedMediaExpiry('https://cdn.test/a?X-Amz-Date=20260912T000000Z&X-Amz-Expires=7200')", context), Date.parse('2026-09-12T02:00:00Z'))
assert.throws(() => vm.runInContext("assertGenerationRequestSize('x'.repeat(MAX_GENERATION_REQUEST_BYTES + 1))", context), /128 MiB/)

const reference = { id: 'test', type: 'image', source: 'local', url: 'blob:test', order: 0 }
async function prepare(transport, references = [reference], path) {
  context.input = { variant: 'video', model: { id: 'test' }, channel: { mediaTransport: transport, mediaUploadPath: path }, config: { references } }
  return vm.runInContext('prepareReferenceConfig(input)', context)
}
for (const mimeType of ['image/png', 'video/mp4', 'audio/mpeg']) {
  await assert.rejects(() => prepare('inline', [{ ...reference, mimeType }]), /自定义媒体存储/)
}
assert.equal(uploads, 0)
await assert.rejects(() => prepare('auto'), /自定义媒体存储/)
await assert.rejects(() => prepare('public-url', [{ ...reference, url: 'data:image/png;base64,eA==' }]), /自定义媒体存储/)
await assert.rejects(() => prepare('auto', [reference], '/presign'), /自定义媒体存储/)
for (const transport of [undefined, 'auto', 'public-url', 'inline', 'custom', 'presign', 'multipart']) {
  assert.equal((await prepare(transport, [{ ...reference, url: 'https://cdn.test/a' }])).references[0].url, 'https://cdn.test/a')
}
assert.equal((await prepare(undefined, [])).references.length, 0)
assert.equal(uploads, 0, 'direct HTTPS references and prompt-only inputs never need a transport')
for (const transport of ['presign', 'multipart']) {
  await assert.rejects(() => prepare(transport, [reference], '/upload'), /自定义媒体存储/)
}
context.useMediaStorageStore.getState = () => ({ baseURL: 'https://storage.test' })
await prepare('custom')
assert.equal(uploads, 1)
for (const transport of ['inline', undefined]) {
  const result = await prepare(transport)
  assert.equal(result.references[0].url, 'https://cdn.example.test/file')
}
assert.equal(uploads, 3)
assert.equal((await prepare('auto', [{ ...reference, url: 'https://cdn.test/a', expiresAt: Date.now() }])).references[0].expiresAt, undefined, 'fresh remote inspection supersedes stale local expiry')
console.log('media policy and actual reference preparation: PASS')
