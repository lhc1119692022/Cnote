import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const sourcePath = fileURLToPath(new URL('../src/proxy.ts', import.meta.url))
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

const environment = {
  CN_PROXY_UPSTREAM_URL: 'https://generativelanguage.googleapis.com',
  CN_PROXY_HEADER_NAME: 'X-Cnote-Proxy-Key',
  CN_PROXY_HEADER_VALUE: 'contract-proxy-token',
}
const openAIEnvironment = {
  ...environment,
  CN_PROXY_UPSTREAM_URL: 'https://api.openai.com',
}
const accessHeaders = {
  Origin: 'https://app.example.test',
  Authorization: 'Bearer provider-key',
  'Content-Type': 'application/json',
  'X-Cnote-Proxy-Key': 'contract-proxy-token',
}
const geminiAccessHeaders = {
  Origin: 'https://app.example.test',
  'Content-Type': 'application/json',
  'X-Cnote-Proxy-Key': 'contract-proxy-token',
  'x-goog-api-key': 'gemini-provider-key',
}

async function request(path, init = {}, targetEnvironment = environment) {
  return worker.fetch(new Request('https://proxy.example.test' + path, init), targetEnvironment, {})
}

async function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const preflight = await request('/v1beta/openai/chat/completions', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://app.example.test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type, x-goog-api-key, x-cnote-proxy-key',
  },
})
assert.equal(preflight.status, 204)
assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-Cnote-Proxy-Key/i)
assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-goog-api-key/i)

const unauthorized = await request('/v1/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
assert.equal(unauthorized.status, 401)

globalThis.CNOTE_PROXY_HEADER_NAME = 'X-Dashboard-Access'
globalThis.CNOTE_PROXY_HEADER_VALUE = 'dashboard-proxy-token'
globalThis.CNOTE_PROXY_UPSTREAM_URL = 'https://dashboard-upstream.example/v1'
const dashboardConfiguredHealth = await request('/health', {
  headers: { 'X-Dashboard-Access': 'dashboard-proxy-token' },
}, {})
assert.equal(dashboardConfiguredHealth.status, 200)
const dashboardConfiguredUnauthorized = await request('/health', {}, {})
assert.equal(dashboardConfiguredUnauthorized.status, 401)
delete globalThis.CNOTE_PROXY_HEADER_NAME
delete globalThis.CNOTE_PROXY_HEADER_VALUE
delete globalThis.CNOTE_PROXY_UPSTREAM_URL

const missingUpstream = await request('/v1/models', {
  method: 'GET',
}, {})
assert.equal(missingUpstream.status, 500)
assert.match((await missingUpstream.json()).message, /填写第三方 API 原接口地址/)

const blockedEndpoint = await request('/v1/files', {
  method: 'GET',
  headers: accessHeaders,
})
assert.equal(blockedEndpoint.status, 404)

const blockedGeminiOperation = await request('/v1beta/models/gemini-3-pro:delete', {
  method: 'POST',
  headers: geminiAccessHeaders,
  body: '{}',
})
assert.equal(blockedGeminiOperation.status, 404)

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?alt=sse')
  assert.equal(init?.redirect, 'manual')
  assert.equal(forwarded.method, 'POST')
  assert.equal(forwarded.headers.get('authorization'), 'Bearer provider-key')
  assert.equal(forwarded.headers.get('x-cnote-proxy-key'), null)
  assert.equal(forwarded.headers.get('origin'), null)
  assert.equal(forwarded.headers.get('cookie'), null)
  assert.deepEqual(await forwarded.json(), { model: 'gemini-3.6-flash', messages: [] })
  return new Response(JSON.stringify({ choices: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1beta/openai/chat/completions?alt=sse', {
    method: 'POST',
    headers: { ...accessHeaders, Cookie: 'must-not-forward=1' },
    body: JSON.stringify({ model: 'gemini-3.6-flash', messages: [] }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  assert.equal(forwarded.headers.get('x-goog-api-key'), 'gemini-provider-key')
  return new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1beta/models?pageSize=1000', {
    method: 'GET',
    headers: geminiAccessHeaders,
  })
  assert.equal(response.status, 200)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent')
  assert.equal(forwarded.method, 'POST')
  assert.equal(forwarded.headers.get('x-goog-api-key'), 'gemini-provider-key')
  assert.equal(forwarded.headers.get('x-cnote-proxy-key'), null)
  assert.deepEqual(await forwarded.json(), { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] })
  return new Response(JSON.stringify({ candidates: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1beta/models/gemini-3-pro:generateContent', {
    method: 'POST',
    headers: geminiAccessHeaders,
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] }),
  })
  assert.equal(response.status, 200)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse')
  return new Response('data: {"candidates":[]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
}, async () => {
  const response = await request('/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse', {
    method: 'POST',
    headers: geminiAccessHeaders,
    body: '{}',
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://api.openai.com/v1/models')
  assert.equal(forwarded.headers.get('authorization'), 'Bearer provider-key')
  return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1/models', {
    method: 'GET',
    headers: accessHeaders,
  }, openAIEnvironment)
  assert.equal(response.status, 200)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://third-party.example/api/v1/models')
  return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/proxy/old-channel/v1/models', {
    method: 'GET',
    headers: accessHeaders,
  }, {
    ...environment,
    CN_PROXY_UPSTREAM_URL: 'https://third-party.example/api/v1',
  })
  assert.equal(response.status, 200)
})

let chunks = 0
const oversizedBody = new ReadableStream({
  pull(controller) {
    if (chunks >= 21) {
      controller.close()
      return
    }
    chunks += 1
    controller.enqueue(new Uint8Array(1024 * 1024))
  },
})
const oversized = await request('/v1/responses', {
  method: 'POST',
  headers: accessHeaders,
  body: oversizedBody,
  duplex: 'half',
})
assert.equal(oversized.status, 413)

console.log('AI Proxy contract tests passed.')
