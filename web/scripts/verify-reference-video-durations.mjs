import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

// Keep the store, channel resolver and submission client real. Only replace IO;
// resolver-first mocks hide saved model contracts taking precedence at runtime.
const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const modules = new Map()
const mocks = new Map()
const dom = new JSDOM('', { url: 'https://cnote.test' })
for (const key of ['window', 'document', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
globalThis.fetch = async () => { throw new Error('Live network is forbidden in this regression') }

function load(relativePath) {
  const base = resolve(sourceRoot, relativePath)
  const path = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync)
  assert.ok(path, `Source exists: ${relativePath}`)
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }
  modules.set(path, module)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  return module.exports
}

mocks.set('@/lib/localforage-storage', {
  localForageStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
})
mocks.set('@/lib/secure-storage', { decryptAPIKey: (value) => value, encryptAPIKey: (value) => value })
mocks.set('@/lib/desktop-secrets', {
  deleteDesktopSecret: async () => {}, syncDesktopSecretInBackground: () => {},
  ensureDesktopSecret: async () => true, syncDesktopSecret: async () => {},
})
mocks.set('@/lib/resource-storage', {
  loadLocalResourceBlob: async () => { throw new Error('Unexpected local resource read') },
  loadLocalResourceUrl: async () => undefined,
  storeLocalResource: async () => { throw new Error('Unexpected local resource write') },
})
mocks.set('@/stores/use-media-storage-store', {
  MEDIA_STORAGE_DEFAULTS: { fieldName: 'file', responsePath: 'url' },
  notifyMediaStorageChanged: () => {},
  useMediaStorageStore: { getState: () => ({ baseURL: '', getAccessToken: () => '' }) },
})
mocks.set('./media-readiness', {
  inspectMediaUrl: async () => ({}), MediaReadinessError: class extends Error {},
})
const measuredDurations = new Map([['video-a', 4.032], ['video-b', 7.125]])
const inspected = []
mocks.set('./media-inspection', {
  validateOfficialMediaReferences: async () => [],
  loadReferenceForInspection: async (reference) => {
    inspected.push(reference.id)
    return new Blob([reference.id], { type: 'video/mp4' })
  },
  inspectMediaBlob: async (blob) => ({ bytes: blob.size, format: 'mp4', duration: measuredDurations.get(await blob.text()) }),
})
const requests = []
mocks.set('@/lib/desktop-fetch', {
  desktopFetch: async (url, options) => {
    assert.equal(url, 'https://newapi.prompt-hubs.com/v1/videos')
    assert.equal(options.method, 'POST')
    requests.push(JSON.parse(options.body))
    return Response.json({ id: 'mock-duration-task', status: 'queued' })
  },
})

const { generationVideoRequestContractForModel, useGenerationStore } = load('stores/use-generation-store.ts')
const { VIDEO_KACANG_MODELS } = load('lib/generation/video-catalog.ts')
const { submitGenerationTask } = load('lib/generation/client.ts')
const { createGenerationVariantConfig } = load('lib/generation/defaults.ts')
const h3Ids = ['minimax_h3', 'MiniMax-H3-漫剧优化', 'MiniMax-H3-四步采样版']
const image = { id: 'image', type: 'image', source: 'url', url: 'https://media.test/image.png' }
const videoA = { id: 'video-a', type: 'video', source: 'url', url: 'https://media.test/a.mp4' }
const videoB = { id: 'video-b', type: 'video', source: 'url', url: 'https://media.test/b.mp4' }

function savedChannel(modelId = h3Ids[0], contractOverrides = {}) {
  const model = structuredClone(VIDEO_KACANG_MODELS.find((candidate) => candidate.id === modelId))
  assert.ok(model)
  model.mediaRulesSource = 'custom'
  // Match the saved pre-fix configuration, even after updating the catalog.
  delete model.videoRequestContract.referenceVideoDurationsField
  Object.assign(model.videoRequestContract, contractOverrides)
  return {
    id: 'official-video-kacang', name: 'Kacang regression', providerId: 'video',
    protocol: 'video-kacang', presetId: 'video-kacang',
    baseURL: 'https://newapi.prompt-hubs.com/v1', enabled: true,
    modelIds: [modelId], modelCatalog: [model],
  }
}

async function submit(channel, references) {
  requests.length = 0
  inspected.length = 0
  useGenerationStore.setState({ channels: [channel] })
  const model = useGenerationStore.getState().getModels(channel.id)[0]
  const result = await submitGenerationTask({
    variant: 'video', channel, model,
    config: {
      ...createGenerationVariantConfig('video'), channelId: channel.id, model: model.id,
      prompt: 'Duration regression', capability: 'reference-to-video',
      seconds: 5, resolution: '768', aspectRatio: '16:9', references,
    },
  })
  assert.equal(requests.length, 1)
  assert.equal(result.taskId, 'mock-duration-task')
  return requests[0]
}

for (const id of h3Ids) {
  const channel = savedChannel(id)
  const before = structuredClone(channel)
  const body = await submit(channel, [image, videoA])
  assert.deepEqual(body.reference_video_durations, [4.032], `${id}: saved contracts must submit measured video durations`)
  assert.deepEqual(body.reference_videos, [videoA.url])
  assert.deepEqual(body.reference_images, [image.url])
  assert.equal(body.duration_seconds, 5, 'Output length is separate from reference length')
  assert.deepEqual(inspected, ['video-a'])
  assert.deepEqual(channel, before, 'Runtime completion must not mutate saved settings')
  assert.equal(VIDEO_KACANG_MODELS.find((model) => model.id === id).videoRequestContract.referenceVideoDurationsField,
    'reference_video_durations', 'New catalog copies also contain the required field')
}

const ordered = await submit(savedChannel(), [videoB, image, { ...videoA, duration: 4.032 }])
assert.deepEqual(ordered.reference_videos, [videoB.url, videoA.url])
assert.deepEqual(ordered.reference_video_durations, [7.125, 4.032])
assert.deepEqual(inspected, ['video-b'], 'Retain valid metadata instead of probing it again')

const explicit = await submit(savedChannel(h3Ids[0], { referenceVideoDurationsField: 'custom_durations' }), [videoA])
assert.deepEqual(explicit.custom_durations, [4.032], 'An explicitly configured field takes precedence')
assert.equal(explicit.reference_video_durations, undefined)
for (const references of [[], [image]]) {
  const body = await submit(savedChannel(), references)
  assert.equal(body.reference_video_durations, undefined, 'No video means no duration array')
  assert.deepEqual(inspected, [])
}

for (const duration of [undefined, 0, -1, NaN, Infinity]) {
  measuredDurations.set('video-a', duration)
  await assert.rejects(() => submit(savedChannel(), [videoA]), /preparation:.*缺少有效时长/)
  assert.equal(requests.length, 0, 'Unreadable duration must fail before task creation')
}
measuredDurations.set('video-a', 4.032)

const customized = savedChannel(h3Ids[0], { durationField: 'my_seconds', referenceLimits: { video: 2 }, pollPath: '/custom/{id}' })
const originalContract = customized.modelCatalog[0].videoRequestContract
assert.deepEqual(generationVideoRequestContractForModel(customized, customized.modelCatalog[0]), {
  ...originalContract, referenceVideoDurationsField: 'reference_video_durations',
}, 'Only the missing required field is supplemented')

const unchanged = [
  { ...savedChannel(), protocol: 'video-api', presetId: undefined, baseURL: 'https://unrelated.test' },
  { ...savedChannel(), protocol: 'video-808relay', presetId: 'video-808relay' },
  savedChannel(h3Ids[0], { videoReferencesField: undefined }),
  savedChannel(h3Ids[0], { videoReferencesField: 'custom_video_list' }),
  savedChannel(h3Ids[0], { referenceVideoDurationsField: '' }),
]
const renamed = savedChannel()
renamed.modelCatalog[0].id = 'custom-minimax_h3'
unchanged.push(renamed)
const differentModel = savedChannel()
differentModel.modelCatalog[0].id = 'doubao-seedance-2.5'
unchanged.push(differentModel)
for (const channel of unchanged) {
  const model = channel.modelCatalog[0]
  assert.strictEqual(generationVideoRequestContractForModel(channel, model), model.videoRequestContract,
    'Do not infer mandatory fields for unrelated routes or custom wire contracts')
}
const adapterOverride = { ...savedChannel(), adapters: [{ id: 'other', protocol: 'video-808relay' }] }
assert.strictEqual(generationVideoRequestContractForModel(adapterOverride, adapterOverride.modelCatalog[0], 'other'),
  adapterOverride.modelCatalog[0].videoRequestContract, 'Scope completion to the selected adapter')

console.log('Reference video duration regression passed (real store + request client; no live network).')
dom.window.close()
