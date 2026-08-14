import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workersRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importDashboardScript(name) {
  const source = await readFile(path.join(workersRoot, 'dashboard', `${name}.js`), 'utf8')
  assert.doesNotMatch(source, /__CNOTE_[A-Z_]+__/)
  assert.match(source, /以下内容不用修改/)
  if (name === 'ai-proxy') {
    const upstreamConfig = source.indexOf('globalThis.CNOTE_PROXY_UPSTREAM_URL')
    const headerNameConfig = source.indexOf('globalThis.CNOTE_PROXY_HEADER_NAME')
    const headerValueConfig = source.indexOf('globalThis.CNOTE_PROXY_HEADER_VALUE')
    const internalConfig = source.indexOf('var dashboardProxyConfig')
    assert.ok(upstreamConfig >= 0 && upstreamConfig < headerNameConfig)
    assert.ok(headerNameConfig < headerValueConfig)
    assert.ok(headerValueConfig < internalConfig)
  } else {
    assert.match(source, /部署前先填：访问令牌/)
    assert.match(source, /globalThis\.CNOTE_CONTENT_TOKEN = "";/)
  }
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  return import(moduleUrl + `#${Date.now()}-${name}`)
}

const proxyModule = await importDashboardScript('ai-proxy')
const publicProxyHealth = await proxyModule.default.fetch(new Request('https://worker.example/health'), {}, {})
assert.equal(publicProxyHealth.status, 200)
globalThis.CNOTE_PROXY_HEADER_NAME = 'X-Dashboard-Test'
globalThis.CNOTE_PROXY_HEADER_VALUE = 'dashboard-proxy-secret'
const protectedProxyHealth = await proxyModule.default.fetch(new Request('https://worker.example/health', {
  headers: { 'X-Dashboard-Test': 'dashboard-proxy-secret' },
}), {}, {})
assert.equal(protectedProxyHealth.status, 200)
const deniedProxyHealth = await proxyModule.default.fetch(new Request('https://worker.example/health'), {}, {})
assert.equal(deniedProxyHealth.status, 401)
delete globalThis.CNOTE_PROXY_HEADER_NAME
delete globalThis.CNOTE_PROXY_HEADER_VALUE

const contentModule = await importDashboardScript('content-service')
const publicContentHealth = await contentModule.default.fetch(new Request('https://worker.example/v1/health'), {}, {})
assert.equal(publicContentHealth.status, 200)
globalThis.CNOTE_CONTENT_TOKEN = 'dashboard-content-secret'
const protectedContentHealth = await contentModule.default.fetch(new Request('https://worker.example/v1/health', {
  headers: { Authorization: 'Bearer dashboard-content-secret' },
}), {}, {})
assert.equal(protectedContentHealth.status, 200)
const deniedContentHealth = await contentModule.default.fetch(new Request('https://worker.example/v1/health'), {}, {})
assert.equal(deniedContentHealth.status, 401)
delete globalThis.CNOTE_CONTENT_TOKEN

console.log('Cloudflare dashboard scripts passed.')
