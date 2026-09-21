import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

const require = createRequire(import.meta.url)
const web = fileURLToPath(new URL('../src/', import.meta.url))
const desktop = fileURLToPath(new URL('../../desktop/src/', import.meta.url))
const modules = new Map()
let source
let nativeSignal
let nativeRequests = 0
let responseFactory
const headersSeen = []
const electron = { net: { fetch: async (_url, options) => {
  nativeRequests++
  nativeSignal = options.signal
  headersSeen.push(options.headers)
  if (responseFactory) return responseFactory(options)
  const body = new ReadableStream({
    start(controller) { source = controller },
  })
  options.signal.addEventListener('abort', () => { try { source.error(new DOMException('Stopped', 'AbortError')) } catch {} }, { once: true })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
} } }
electron.net.request = options => {
  const request = new EventEmitter()
  const controller = new AbortController()
  const headers = {}
  let incoming
  request.setHeader = (name, value) => { headers[name] = value }
  request.write = () => {}
  request.abort = () => { controller.abort(); incoming?.destroy(); request.emit('close') }
  request.end = () => {
    void electron.net.fetch(options.url, { ...options, headers, signal: controller.signal }).then(response => {
      incoming = response.body ? Readable.fromWeb(response.body) : Readable.from([])
      incoming.statusCode = response.status
      incoming.statusMessage = response.statusText
      incoming.headers = Object.fromEntries(response.headers)
      incoming.on('close', () => request.emit('close'))
      request.emit('response', incoming)
    }).catch(error => request.emit('error', error))
  }
  return request
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const source = readFileSync(filename, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'electron') return electron
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? resolve(web, name.slice(2)) : resolve(dirname(filename), name)
      const suffix = ['.ts', '/index.ts'].find(value => existsSync(base + value))
      return load(base + suffix)
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}
const { NativeNetworkPort } = load(resolve(desktop, 'runtime/network-port.ts'))
const { NetworkStreamRegistry } = load(resolve(desktop, 'runtime/network-stream-registry.ts'))
const port = new NativeNetworkPort()
const registry = new NetworkStreamRegistry(input => port.openStream(input))
const secrets = new Map()
const ids = []
const bridge = {
  openStream(input) {
    assert.deepEqual(Object.keys(input.headers).filter(name => /authorization|api-key/i.test(name)), [], 'IPC excludes credential values')
    ids.push(input.requestId)
    return registry.open(1, input, async () => ({ ...input.headers, ...Object.fromEntries(Object.entries(input.secretRefs || {}).map(([header, name]) => { assert.ok(secrets.has(name)); return [header, secrets.get(name)] })) }))
  },
  readStream: id => registry.read(1, id),
  abort: id => registry.abort(1, id),
  request() { throw new Error('SSE must not use the buffered transport') },
}
globalThis.window = { cnoteDesktop: { network: bridge, secrets: { set: async (name, value) => secrets.set(name, value), delete: async name => secrets.delete(name) } } }
const { AIClient } = load(resolve(web, 'lib/api/client.ts'))
const { desktopFetch } = load(resolve(web, 'lib/desktop-fetch.ts'))
const turn = () => new Promise(resolve => setTimeout(resolve, 0))
async function ready() { for (let attempt = 0; attempt < 30 && !source; attempt++) await turn(); assert.ok(source) }
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Streaming test timed out')), 2500) })]) } finally { clearTimeout(timer) }
}
function emit(payload) {
  const bytes = new TextEncoder().encode('data: ' + JSON.stringify(payload) + '\r\n\r\n')
  for (let offset = 0; offset < bytes.length; offset += 3) source.enqueue(bytes.slice(offset, offset + 3))
}
const request = { model: 'fixture-model', messages: [{ role: 'user', content: 'test' }] }
for (const [protocol, payload] of [
  ['chatCompletions', text => ({ choices: [{ delta: { content: text } }] })],
  ['responses', text => ({ type: 'response.output_text.delta', delta: text })],
  ['messages', text => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })],
  ['gemini', text => ({ candidates: [{ content: { parts: [{ text }] } }] })],
]) {
  source = undefined
  const client = new AIClient({ id: 'fixture', baseURL: 'https://fixture.invalid', protocol }, 'fixture-only')
  const controller = new AbortController()
  const stream = client.completeStream(request, controller.signal)
  const first = stream.next()
  await ready()
  emit(payload('第一段'))
  assert.deepEqual(await bounded(first), { value: '第一段', done: false }, protocol + ' yields before native response finishes')
  assert.equal(nativeSignal.aborted, false)
  const next = stream.next()
  emit(payload('第二段'))
  assert.equal((await bounded(next)).value, '第二段')
  const waiting = stream.next()
  const stopped = assert.rejects(waiting, error => error.name === 'AbortError')
  controller.abort()
  await bounded(stopped)
  assert.equal(nativeSignal.aborted, true)
  assert.equal(await registry.abort(1, ids.at(-1)), false, 'cancel removes registry entry')
  assert.equal(secrets.size, 0)
}
source = undefined
const beforeTextController = new AbortController()
const beforeTextClient = new AIClient({ id: 'early-text', baseURL: 'https://fixture.invalid', protocol: 'chatCompletions' }, 'fixture-only')
const beforeText = beforeTextClient.completeStream(request, beforeTextController.signal).next()
const beforeTextCheck = assert.rejects(beforeText, { name: 'AbortError' })
await ready()
beforeTextController.abort()
await bounded(beforeTextCheck)
assert.equal(nativeSignal.aborted, true, 'stop works before the first token')
source = undefined
const client = new AIClient({ id: 'done', baseURL: 'https://fixture.invalid', protocol: 'chatCompletions' }, 'fixture-only')
const doneStream = client.completeStream(request)
const doneRead = doneStream.next()
await ready()
emit({ choices: [{ delta: { content: 'done' } }] })
assert.equal((await bounded(doneRead)).value, 'done')
const completion = doneStream.next()
source.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
assert.equal((await bounded(completion)).done, true)
assert.equal(nativeSignal.aborted, true, 'DONE releases the native reader without waiting for connection close')
source = undefined
const errorStream = client.completeStream(request)
const errorRead = errorStream.next()
const errorCheck = assert.rejects(errorRead, /fixture rejection/)
await ready()
emit({ error: { message: 'fixture rejection' } })
await bounded(errorCheck)
assert.equal(nativeSignal.aborted, true)
source = undefined
const response = await desktopFetch('https://fixture.invalid', {}, { stream: true })
await assert.rejects(registry.read(2, ids.at(-1)), /已关闭/, 'different renderer cannot read stream')
await registry.closeOwner(1)
await assert.rejects(response.text())
assert.equal(nativeSignal.aborted, true)
responseFactory = async () => new Response(JSON.stringify({ error: { message: 'fixture denied' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
await assert.rejects(client.completeStream(request).next(), /fixture denied/)
responseFactory = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'nonstream fixture' } }] }), { headers: { 'Content-Type': 'application/json' } })
const fallback = client.completeStream(request)
assert.equal((await fallback.next()).value, 'nonstream fixture')
assert.equal((await fallback.next()).done, true)
const controller = new AbortController()
controller.abort()
const beforeAbort = nativeRequests
await assert.rejects(client.completeStream(request, controller.signal).next(), { name: 'AbortError' })
assert.equal(nativeRequests, beforeAbort)
assert.equal(secrets.size, 0)
assert.ok(headersSeen.some(headers => headers.authorization === 'Bearer fixture-only'))
const earlyRegistry = new NetworkStreamRegistry(() => { throw new Error('must not open after early cancellation') })
let releaseHeaders
const opening = earlyRegistry.open(1, { requestId: 'early', url: 'https://fixture.invalid' }, () => new Promise(resolve => { releaseHeaders = resolve }))
await earlyRegistry.abort(1, 'early')
releaseHeaders({})
await assert.rejects(opening, /已停止/)
console.log('Desktop streaming: early deltas, UTF-8 boundaries, four protocols, abort, DONE, errors, JSON fallback, owner isolation, reload cleanup and temporary secrets PASS (mock network only)')
