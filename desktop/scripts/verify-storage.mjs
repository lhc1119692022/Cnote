import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { encodeStorageKey, NativeStoragePort } from '../dist/runtime/storage-port.js'

const root = await mkdtemp(path.join(tmpdir(), 'cnote-storage-'))
const port = new NativeStoragePort(root)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

try {
  assert.equal(await port.read('missing-key'), null)

  await port.write('doc:flow:demo', encoder.encode('{"ok":true}'))
  assert.equal(decoder.decode(await port.read('doc:flow:demo')), '{"ok":true}')

  await port.write('doc:flow:demo', encoder.encode('{"ok":false}'))
  assert.equal(decoder.decode(await port.read('doc:flow:demo')), '{"ok":false}')

  await port.write('resource:sha256-abc', new Uint8Array([1, 2, 3, 4]))
  assert.deepEqual([...(await port.read('resource:sha256-abc'))], [1, 2, 3, 4])

  await port.remove('doc:flow:demo')
  assert.equal(await port.read('doc:flow:demo'), null)

  await port.write('../escape', encoder.encode('nope'))
  await port.write('..\\..\\secrets.json', encoder.encode('nope'))
  await port.write('C:\\Windows\\System32\\x', encoder.encode('nope'))
  await port.write('/etc/passwd', encoder.encode('nope'))

  const encoded = encodeStorageKey('../escape')
  assert.equal(encoded.includes('/'), false)
  assert.equal(encoded.includes('\\'), false)
  assert.equal(encoded.includes('..'), false)

  const entries = await readdir(root)
  assert.ok(entries.every((entry) => !entry.includes('..') && !entry.includes('/') && !entry.includes('\\')))
  for (const entry of entries) {
    const filePath = path.join(root, entry)
    assert.equal(path.dirname(filePath), root)
    assert.ok((await stat(filePath)).isFile())
  }
  assert.equal(decoder.decode(await port.read('../escape')), 'nope')
  assert.equal(decoder.decode(await port.read('C:\\Windows\\System32\\x')), 'nope')

  await assert.rejects(() => port.write('', encoder.encode('x')), /storage key is required/)
  await assert.rejects(() => port.write('x\0y', encoder.encode('x')), /storage key is invalid/)
  assert.throws(() => new NativeStoragePort('relative-root'), /absolute path/)

  console.log('Desktop storage port tests passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
