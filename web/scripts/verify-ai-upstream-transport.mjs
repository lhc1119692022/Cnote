import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const cache = new Map()
const assets = new Map([['asset-logo', 'data:image/png;base64,aW1hZ2UtZml4dHVyZQ==']])
const nativeJobs = []
const mocks = {
  '@/storage/asset-store': { assetIdForResource: id => id.replace('sha256-', 'asset-'), loadAssetUrl: async id => assets.get(id) || null },
  '@/lib/desktop-native-jobs': { runDesktopNativeJob: async request => {
    nativeJobs.push(request)
    checkRequest(request.input)
    return { status: 200, statusText: 'OK', headers: {}, bodyBase64: btoa('{}') }
  } },
}
function load(relative) {
  if (cache.has(relative)) return cache.get(relative).exports
  const module = { exports: {} }
  cache.set(relative, module)
  const source = readFileSync(new URL('../src/' + relative, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (mocks[name]) return mocks[name]
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? name.slice(2) : join(dirname(relative), name).replaceAll('\\', '/')
      const extension = ['.ts', '/index.ts'].find(suffix => existsSync(new URL('../src/' + path + suffix, import.meta.url)))
      return load(path + extension)
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}
const actualFetch = globalThis.fetch
let localReads = 0
globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^(data:image\/|blob:)/, 'test must never contact a remote provider')
  localReads++
  return actualFetch(url, options)
}
const secrets = new Map()
const requests = []
let failNetwork = false
let responseBody = { data: [{ id: 'video-fixture' }, { id: 'image-fixture' }] }
function checkRequest(request) {
  assert.equal(Object.keys(request.headers || {}).some(header => /authorization|api-key|cookie/i.test(header)), false, 'no raw credential may enter native network payload')
  for (const name of Object.values(request.secretRefs || {})) assert.ok(secrets.has(name), 'reference exists before native request starts')
}
globalThis.window = { cnoteDesktop: {
  secrets: { set: async (name, value) => { secrets.set(name, value) }, has: async name => secrets.has(name), delete: async name => { secrets.delete(name) } },
  network: { request: async request => {
    checkRequest(request)
    requests.push({ ...request, resolvedSecrets: Object.fromEntries(Object.entries(request.secretRefs || {}).map(([header, name]) => [header, secrets.get(name)])) })
    if (failNetwork) throw new Error('fixture network failure')
    await Promise.resolve()
    return { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(responseBody)) }
  } },
} }
const { AIClient } = load('lib/api/client.ts')
const { desktopFetch } = load('lib/desktop-fetch.ts')
for (const baseURL of ['https://fixture.invalid', 'https://fixture.invalid/v1', 'https://fixture.invalid/v1/openai']) {
  const client = new AIClient({ id: 'test', name: 'Test', baseURL, protocol: 'chatCompletions', models: [] }, 'fixture-key')
  assert.deepEqual(await client.listModels(), ['image-fixture', 'video-fixture'])
  assert.equal(requests.at(-1).resolvedSecrets.authorization, 'Bearer fixture-key')
  assert.ok(!requests.at(-1).url.includes('/v1/v1/'))
  assert.equal(secrets.size, 0, 'unsaved credential is removed after request')
}
responseBody = { models: [{ name: 'models/image-fixture' }] }
assert.deepEqual(await new AIClient({ id: 'google', baseURL: 'https://fixture.invalid', protocol: 'gemini' }, 'fixture-google').listModels(), ['image-fixture'])
assert.equal(requests.at(-1).resolvedSecrets['x-goog-api-key'], 'fixture-google')
assert.ok(requests.at(-1).url.endsWith('/v1beta/models?pageSize=1000'))
secrets.set('saved-channel', 'Bearer saved-fixture')
await new AIClient({ id: 'saved', baseURL: 'https://fixture.invalid', protocol: 'chatCompletions' }, '', 'saved-channel').listModels()
assert.equal(requests.at(-1).resolvedSecrets.authorization, 'Bearer saved-fixture')
assert.equal(secrets.get('saved-channel'), 'Bearer saved-fixture', 'saved credential survives')
await Promise.all(['first', 'second'].map(value => desktopFetch('https://fixture.invalid/v1/models', { headers: { Authorization: value } })))
assert.notEqual(requests.at(-1).secretRefs.authorization, requests.at(-2).secretRefs.authorization, 'concurrent edits use isolated references')
assert.deepEqual([...secrets.keys()], ['saved-channel'])
failNetwork = true
await assert.rejects(desktopFetch('https://fixture.invalid', { headers: { 'X-API-Key': 'fixture-failure' } }), /fixture network failure/)
assert.deepEqual([...secrets.keys()], ['saved-channel'], 'failure cleans temporary secrets')
failNetwork = false
const controller = new AbortController()
controller.abort()
const requestCount = requests.length
await assert.rejects(desktopFetch('https://fixture.invalid', { headers: { Authorization: 'fixture-abort' }, signal: controller.signal }), { name: 'AbortError' })
assert.equal(requests.length, requestCount)
assert.deepEqual([...secrets.keys()], ['saved-channel'])
const bridge = window.cnoteDesktop.network
window.cnoteDesktop.network = undefined
window.cnoteDesktop.jobs = { enqueueNative() {} }
await desktopFetch('https://fixture.invalid', { headers: { Authorization: 'fixture-job' } })
assert.equal(nativeJobs.length, 1)
assert.deepEqual([...secrets.keys()], ['saved-channel'])
window.cnoteDesktop.network = bridge

const { resolveAIContextEntries } = load('lib/flow/ai-context.ts')
const { compileAiPromptParts } = load('lib/flow/ai-prompt.ts')
const image = { id: 'logo', kind: 'content', category: 'image', label: '客户Logo.png', source: { kind: 'file', assetId: 'asset-logo', mimeType: 'image/png' } }
const text = { id: 'text', kind: 'content', category: 'text', content: '上游正文' }
const entries = [{ nodeId: 'logo', label: '客户Logo.png', text: '客户Logo.png' }, { nodeId: 'text', label: '说明', text: '上游正文' }]
const implicit = await resolveAIContextEntries(entries, [image, text], '识别图片')
assert.equal(implicit[0].images[0].kind, 'base64')
assert.equal(implicit[0].images[0].data, 'aW1hZ2UtZml4dHVyZQ==')
const implicitParts = compileAiPromptParts('识别图片', implicit)
assert.equal(implicitParts.filter(part => part.type === 'image').length, 1)
assert.ok(implicitParts.some(part => part.type === 'text' && part.text.includes('上游正文')))
const explicit = await resolveAIContextEntries(entries, [image, text], '{{node:logo}} 请识别 {{node:logo}}')
assert.equal(explicit.length, 1)
assert.equal(compileAiPromptParts('{{node:logo}} 请识别 {{node:logo}}', explicit).filter(part => part.type === 'image').length, 1)
const missing = { ...image, source: { ...image.source, assetId: 'missing' } }
await assert.rejects(resolveAIContextEntries(entries, [missing, text], '识别'), /图片资源已丢失/)
await assert.rejects(resolveAIContextEntries(entries, [image, text], '{{node:disconnected}}'), /已断开/)
assert.equal((await resolveAIContextEntries(entries, [missing, text], '{{node:text}}')).length, 1, 'unselected missing image does not block explicit text')
const remote = { ...image, source: { kind: 'url', url: 'https://fixture.invalid/logo.png' } }
assert.deepEqual((await resolveAIContextEntries(entries, [remote, text], '识别'))[0].images, [{ kind: 'url', url: remote.source.url }])
const selected = { ...image, payload: { kind: 'image', activeResourceIndex: 1, resources: [{ resource: { url: 'https://fixture.invalid/first.png' } }, { resource: { resourceId: 'sha256-logo' } }] } }
assert.equal((await resolveAIContextEntries(entries, [selected], '{{node:logo}}'))[0].images[0].kind, 'base64')
const content = implicitParts.map(part => part.type === 'image' ? { type: 'image', source: part.image } : part)
for (const protocol of ['chatCompletions', 'responses', 'messages', 'gemini']) {
  responseBody = { choices: [{ message: { content: 'fixture response' } }], output_text: 'fixture response', content: [{ type: 'text', text: 'fixture response' }], candidates: [{ content: { parts: [{ text: 'fixture response' }] } }] }
  const client = new AIClient({ id: 'multimodal', baseURL: 'https://fixture.invalid', protocol }, 'fixture-key')
  assert.equal(await client.complete({ model: 'fixture-model', messages: [{ role: 'user', content }] }), 'fixture response')
  const body = JSON.parse(requests.at(-1).body)
  assert.ok(JSON.stringify(body).includes('aW1hZ2UtZml4dHVyZQ=='), protocol + ' contains actual image bytes')
  assert.ok(!JSON.stringify(body).includes('blob:'), 'ephemeral local URL never leaves renderer')
}
assert.ok(localReads >= 3)
assert.deepEqual([...secrets.keys()], ['saved-channel'])
globalThis.fetch = actualFetch
console.log('AI upstream and secure transport: model discovery, saved/unsaved keys, cleanup, concurrent requests, image/variable/asset selection, four multimodal protocols PASS (fixtures only)')
