import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const policy = readFileSync(new URL('../src/lib/generation/media-policy.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/lib/generation/client.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest, true)
const names = ['prepareReferenceConfig', 'referenceURL', 'isHttpsUrl', 'blobToDataURL']
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
let uploads = 0
const context = vm.createContext({
  TextEncoder, URL, Blob, Uint8Array, btoa, Date, console,
  generationAdapterForModel: () => undefined,
  normalizeGenerationReferences: references => references,
  useMediaStorageStore: { getState: () => ({ baseURL: '' }) },
  referenceBlob: async reference => ({ blob: new Blob(['sample'], { type: reference.mimeType || 'image/png' }) }),
  uploadReference: async () => { uploads++; return 'https://cdn.example.test/file' },
})
vm.runInContext(ts.transpile((policy + '\n' + selected).replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 }), context)
assert.throws(() => vm.runInContext("resolveMediaTransport('auto')", context), /选择本地素材传输方式/)
assert.throws(() => vm.runInContext("resolveMediaTransport('auto', true)", context), /选择本地素材传输方式/)
assert.throws(() => vm.runInContext("resolveMediaTransport('public-url')", context), /选择本地素材传输方式/)
assert.throws(() => vm.runInContext("resolveMediaTransport('presign', true)", context), /选择本地素材传输方式/)
assert.throws(() => vm.runInContext("resolveMediaTransport('custom')", context), /自定义媒体存储/)
assert.equal(vm.runInContext("resolveMediaTransport('custom', true)", context), 'custom')
assert.throws(() => vm.runInContext("resolveMediaTransport('multipart', true)", context), /选择本地素材传输方式/)
assert.throws(() => vm.runInContext('assertMediaLifetime(Date.now())', context), /有效期/)
assert.equal(vm.runInContext("signedMediaExpiry('https://cdn.test/a?X-Amz-Date=20260912T000000Z&X-Amz-Expires=7200')", context), Date.parse('2026-09-12T02:00:00Z'))
assert.throws(() => vm.runInContext("assertInlineRequestSize('x'.repeat(MAX_INLINE_REQUEST_BYTES + 1))", context), /128 MiB/)

const reference = { id: 'test', type: 'image', source: 'local', url: 'blob:test', order: 0 }
async function prepare(transport, references = [reference], path) {
  context.input = { variant: 'video', model: { id: 'test' }, channel: { mediaTransport: transport, mediaUploadPath: path }, config: { references } }
  return vm.runInContext('prepareReferenceConfig(input)', context)
}
for (const mimeType of ['image/png', 'video/mp4', 'audio/mpeg']) {
  const result = await prepare('inline', [{ ...reference, mimeType }])
  assert.equal(result.references[0].url, `data:${mimeType};base64,c2FtcGxl`)
}
assert.equal(uploads, 0)
await assert.rejects(() => prepare('auto'), /选择本地素材传输方式/)
await assert.rejects(() => prepare('public-url', [{ ...reference, url: 'data:image/png;base64,eA==' }]), /选择本地素材传输方式/)
await assert.rejects(() => prepare('auto', [reference], '/presign'), /选择本地素材传输方式/)
for (const transport of [undefined, 'auto', 'public-url', 'inline', 'custom', 'presign', 'multipart']) {
  assert.equal((await prepare(transport, [{ ...reference, url: 'https://cdn.test/a' }])).references[0].url, 'https://cdn.test/a')
}
assert.equal((await prepare(undefined, [])).references.length, 0)
assert.equal(uploads, 0, 'direct HTTPS references and prompt-only inputs never need a transport')
for (const transport of ['presign', 'multipart']) {
  await assert.rejects(() => prepare(transport, [reference], '/upload'), /选择本地素材传输方式/)
}
context.useMediaStorageStore.getState = () => ({ baseURL: 'https://storage.test' })
await prepare('custom')
assert.equal(uploads, 1)
await assert.rejects(() => prepare('auto', [{ ...reference, url: 'https://cdn.test/a', expiresAt: Date.now() }]), /有效期/)
console.log('media policy and actual reference preparation: PASS')
