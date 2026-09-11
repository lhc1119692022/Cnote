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
assert.equal(vm.runInContext("resolveMediaTransport('auto')", context), 'public-url')
assert.equal(vm.runInContext("resolveMediaTransport('auto', undefined, true)", context), 'custom')
assert.equal(vm.runInContext("resolveMediaTransport('auto', '/presign', true)", context), 'presign')
assert.equal(vm.runInContext("resolveMediaTransport('multipart', '/upload')", context), 'multipart')
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
await assert.rejects(() => prepare('auto'), /未声明/)
await assert.rejects(() => prepare('public-url', [{ ...reference, url: 'data:image/png;base64,eA==' }]), /未声明/)
assert.equal((await prepare('auto', [{ ...reference, url: 'https://cdn.test/a' }])).references[0].url, 'https://cdn.test/a')
await prepare('auto', [reference], '/presign')
assert.equal(uploads, 1)
await assert.rejects(() => prepare('auto', [{ ...reference, url: 'https://cdn.test/a', expiresAt: Date.now() }]), /有效期/)
console.log('media policy and actual reference preparation: PASS')
