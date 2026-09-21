import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let responseHeaders = { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="自动生成视频.mp4"' }
let statusMessage = '成功'
let hang = false
let requestCount = 0
const timers = new Set()
const source = readFileSync(new URL('../src/runtime/network-port.ts', import.meta.url), 'utf8')
const module = { exports: {} }
const electron = { net: { request() {
  requestCount++
  const request = new EventEmitter()
  let response
  request.setHeader = () => {}
  request.write = () => {}
  request.abort = () => { response?.destroy(); request.emit('close') }
  request.end = () => {
    if (hang) return
    queueMicrotask(() => {
      response = Readable.from([Buffer.from('video-result')])
      response.statusCode = 200
      response.statusMessage = statusMessage
      response.headers = responseHeaders
      response.on('close', () => request.emit('close'))
      request.emit('response', response)
    })
  }
  return request
} } }
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => name === 'electron' ? electron : require(name), module, module.exports,
  callback => { const timer = setTimeout(callback, 25); timers.add(timer); return timer },
  timer => { timers.delete(timer); clearTimeout(timer) })
const port = new module.exports.NativeNetworkPort()
const result = await port.request({ url: 'https://fixture.invalid/video' })
assert.equal(result.status, 200)
assert.equal(result.statusText, '')
assert.equal(Buffer.from(result.headers['content-disposition'], 'latin1').toString('utf8'), responseHeaders['content-disposition'])
assert.equal(await new Response(result.body, result).text(), 'video-result')
assert.equal(timers.size, 0)
responseHeaders = { 'content-type': 'application/json' }
statusMessage = 'OK'
assert.equal((await port.request({ url: 'https://fixture.invalid/task' })).statusText, 'OK')
responseHeaders = { 'bad header': 'invalid' }
await assert.rejects(port.request({ url: 'https://fixture.invalid/bad' }), TypeError)
assert.equal(timers.size, 0, 'invalid response metadata rejects the request without an uncaught callback error')
hang = true
const controller = new AbortController()
const pending = port.request({ url: 'https://fixture.invalid/abort', signal: controller.signal })
controller.abort()
await assert.rejects(pending, { name: 'AbortError' })
await assert.rejects(port.request({ url: 'https://fixture.invalid/timeout', timeoutMs: 1000 }), /超时/)
assert.equal(requestCount, 5, 'no hidden POST or network retries')
assert.equal(timers.size, 0)
console.log('Native network: Unicode response headers, status text, controlled metadata errors, cancellation and timeout passed')
