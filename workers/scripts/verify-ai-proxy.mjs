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
  CN_PROXY_ROUTES: JSON.stringify({
    gemini: 'https://generativelanguage.googleapis.com',
    openai: 'https://api.openai.com',
  }),
  CN_PROXY_HEADER_NAME: 'X-Cnote-Proxy-Key',
  CN_PROXY_HEADER_VALUE: 'contract-proxy-token',
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

const setup = await request('/')
assert.equal(setup.status, 200)
const setupText = await setup.text()
assert.match(setupText, /gemini: https:\/\/proxy\.example\.test\/proxy\/gemini/)
assert.match(setupText, /openai: https:\/\/proxy\.example\.test\/proxy\/openai/)
assert.match(setupText, /不要删掉 \/proxy\/线路名/)

const health = await request('/health')
assert.equal(health.status, 200)
const healthPayload = await health.json()
assert.equal(healthPayload.channels.length, 2)
assert.equal(healthPayload.channels[0].address, 'https://proxy.example.test/proxy/gemini')

const preflight = await request('/proxy/gemini/v1beta/openai/chat/completions', {
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

const unauthorized = await request('/proxy/openai/v1/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
assert.equal(unauthorized.status, 401)

globalThis.CNOTE_PROXY_ROUTES = { dashboard: 'https://dashboard-upstream.example/v1' }
globalThis.CNOTE_PROXY_HEADER_NAME = 'X-Dashboard-Access'
globalThis.CNOTE_PROXY_HEADER_VALUE = 'dashboard-proxy-token'
const dashboardSetup = await request('/', {}, {})
assert.match(await dashboardSetup.text(), /https:\/\/proxy\.example\.test\/proxy\/dashboard/)
const dashboardUnauthorized = await request('/proxy/dashboard/v1/models', {}, {})
assert.equal(dashboardUnauthorized.status, 401)
await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://dashboard-upstream.example/v1/models')
  return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/proxy/dashboard/v1/models', {
    headers: { 'X-Dashboard-Access': 'dashboard-proxy-token' },
  }, {})
  assert.equal(response.status, 200)
})
delete globalThis.CNOTE_PROXY_ROUTES
delete globalThis.CNOTE_PROXY_HEADER_NAME
delete globalThis.CNOTE_PROXY_HEADER_VALUE

const emptySetup = await request('/', {}, {})
assert.match(await emptySetup.text(), /尚未配置第三方 API 线路/)
const emptyRequest = await request('/v1/models', {}, {})
assert.equal(emptyRequest.status, 404)

const directPathWithMultipleRoutes = await request('/v1/models', { headers: accessHeaders })
assert.equal(directPathWithMultipleRoutes.status, 404)
assert.match((await directPathWithMultipleRoutes.json()).message, /Worker 地址\/proxy\/线路名/)

const missingRoute = await request('/proxy/missing/v1/models', { headers: accessHeaders })
assert.equal(missingRoute.status, 404)
assert.match((await missingRoute.json()).error, /没有找到线路/)

const blockedEndpoint = await request('/proxy/openai/v1/files', {
  method: 'GET',
  headers: accessHeaders,
})
assert.equal(blockedEndpoint.status, 404)

const blockedGeminiOperation = await request('/proxy/gemini/v1beta/models/gemini-3-pro:delete', {
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
  const response = await request('/proxy/gemini/v1beta/openai/chat/completions?alt=sse', {
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
  const response = await request('/proxy/gemini/v1beta/models?pageSize=1000', {
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
  const response = await request('/proxy/gemini/v1beta/models/gemini-3-pro:generateContent', {
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
  const response = await request('/proxy/gemini/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse', {
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
  const response = await request('/proxy/openai/v1/models', {
    method: 'GET',
    headers: accessHeaders,
  })
  assert.equal(response.status, 200)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://third-party.example/api/v1/models')
  return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/proxy/versioned/v1/models', {
    method: 'GET',
    headers: accessHeaders,
  }, {
    ...environment,
    CN_PROXY_ROUTES: JSON.stringify({ versioned: 'https://third-party.example/api/v1' }),
  })
  assert.equal(response.status, 200)
})

await withMockedFetch(async (input, init) => {
  const forwarded = input instanceof Request ? input : new Request(input, init)
  assert.equal(forwarded.url, 'https://legacy.example/v1/models')
  return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1/models', {
    method: 'GET',
    headers: accessHeaders,
  }, {
    CN_PROXY_UPSTREAM_URL: 'https://legacy.example/v1',
    CN_PROXY_HEADER_NAME: environment.CN_PROXY_HEADER_NAME,
    CN_PROXY_HEADER_VALUE: environment.CN_PROXY_HEADER_VALUE,
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
const oversized = await request('/proxy/openai/v1/responses', {
  method: 'POST',
  headers: accessHeaders,
  body: oversizedBody,
  duplex: 'half',
})
assert.equal(oversized.status, 413)

console.log('AI Proxy contract tests passed.')
