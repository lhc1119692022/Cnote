import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importTemplate(name, replacements) {
  let source = await readFile(path.join(webRoot, 'public', 'cloudflare-worker-scripts', `${name}.js`), 'utf8')
  for (const [key, value] of Object.entries(replacements)) {
    source = source.split(`__${key}__`).join(value)
  }
  assert.doesNotMatch(source, /__CNOTE_[A-Z_]+__/)
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  return import(moduleUrl + `#${Date.now()}-${name}`)
}

const proxyModule = await importTemplate('ai-proxy', {
  CNOTE_PROXY_HEADER_NAME: 'X-Template-Access',
  CNOTE_PROXY_HEADER_VALUE: 'template-proxy-secret',
})
const proxyAllowed = await proxyModule.default.fetch(new Request('https://worker.example/health', {
  headers: { 'X-Template-Access': 'template-proxy-secret' },
}), {}, {})
assert.equal(proxyAllowed.status, 200)
const proxyDenied = await proxyModule.default.fetch(new Request('https://worker.example/health'), {}, {})
assert.equal(proxyDenied.status, 401)

const contentModule = await importTemplate('content-service', {
  CNOTE_CONTENT_TOKEN: 'template-content-secret',
})
const contentAllowed = await contentModule.default.fetch(new Request('https://worker.example/v1/health', {
  headers: { Authorization: 'Bearer template-content-secret' },
}), {}, {})
assert.equal(contentAllowed.status, 200)
const contentDenied = await contentModule.default.fetch(new Request('https://worker.example/v1/health'), {}, {})
assert.equal(contentDenied.status, 401)

console.log('Cloudflare dashboard Worker templates passed.')
