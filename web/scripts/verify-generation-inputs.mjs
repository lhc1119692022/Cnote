import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { create } from 'zustand'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const mocks = new Map()
const modules = new Map()

function evaluate(source, requireModule = require) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, requireModule)
  return module.exports
}

function sourcePath(relativeOrAbsolute) {
  const base = resolve(sourceRoot, relativeOrAbsolute)
  if (existsSync(base) && /\.(ts|tsx)$/.test(base)) return base
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext
  }
  return base
}

function load(relativePath) {
  const path = sourcePath(relativePath)
  if (modules.has(path)) return modules.get(path)
  const result = evaluate(readFileSync(path, 'utf8'), (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  modules.set(path, result)
  return result
}

function declarations(relativePath, names) {
  const text = readFileSync(resolve(sourceRoot, relativePath), 'utf8')
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, relativePath.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  return source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)).map((statement) => statement.getText(source)).join('\n')
}

const { VIDEO_808_MODELS: models, VIDEO_KACANG_MODELS: kacangModels } = load('lib/generation/video-catalog.ts')
const model = models.find((item) => item.id === 'seedance-2.5-pro')
const channel = { id: 'test-channel', protocol: 'video-api', providerId: 'video', name: 'Mock', baseURL: 'https://provider.test', modelIds: [model.id], enabled: true }
const getModels = () => [model]
const useGenerationStore = create(() => ({ channels: [channel], initializeDefaultChannels: () => {}, getModels, getChannel: () => channel }))
const generationStore = {
  useGenerationStore,
  generationAdapterForModel: (value) => value.adapters?.[0],
  generationAdapterForConfig: (value) => value.adapters?.[0],
  generationChannelSupportsVariant: () => true,
  generationChannelUsesModelInference: () => false,
  generationProtocolForChannel: (value) => value.protocol,
  isVideoGenerationProtocol: (value) => value === 'video-api' || value === 'video-808relay' || value === 'video-kacang',
  generationVideoRequestContractForModel: (_channel, selectedModel) => selectedModel?.videoRequestContract || ({ createPath: '/v1/videos', pollPath: '/v1/videos/{id}', contentPath: '/v1/videos/{id}/content', durationField: 'seconds', resolutionField: 'resolution', aspectRatioField: 'aspect_ratio', firstFrameField: 'input_reference', lastFrameField: 'image_end', imageReferencesField: 'reference_images', videoReferencesField: 'reference_videos', audioReferencesField: 'reference_audios', generateAudioField: 'generate_audio' }),
  generationSecretName: () => 'mock-secret',
  generationMediaUploadSecretName: () => 'mock-upload-secret',
}
mocks.set('@/stores/use-generation-store', generationStore)
const graphStoreState = {
  currentDocument: null,
  currentDocumentId: null,
  commitHistory() {},
}
mocks.set('@/stores/graph-store', {
  useGraphStore: {
    getState() { return graphStoreState },
    setState(partial) {
      Object.assign(graphStoreState, typeof partial === 'function' ? partial(graphStoreState) : partial)
    },
  },
})
mocks.set('@/lib/resource-storage', {
  loadLocalResourceUrl: async () => undefined,
  loadLocalResourceBlob: async () => new Blob(['fixture'], { type: 'image/png' }),
  revokeManagedObjectUrl: () => {},
  deleteLocalResource: async () => {},
  retainLocalResource: async () => {},
  storeLocalResource: async () => ({ resourceId: 'sha256-fixture', checksum: 'sha256-fixture', mimeType: 'image/png', size: 7 }),
  getLocalResourceMeta: async () => undefined,
})
mocks.set('@/lib/desktop-secrets', { ensureDesktopSecret: async () => true, syncDesktopSecret: async () => {} })
const storageSettings = { baseURL: '', getUploadEndpoint: () => 'https://storage.test/upload', fieldName: 'file', responsePath: 'url', getAccessToken: () => '' }
mocks.set('@/stores/use-media-storage-store', { MEDIA_STORAGE_DEFAULTS: { fieldName: 'file', responsePath: 'url' }, useMediaStorageStore: { getState: () => storageSettings } })
const requests = []
let rejectUpload = false
mocks.set('@/lib/desktop-fetch', { desktopFetch: async (url, options = {}) => {
  requests.push({ url, ...options })
  if (rejectUpload && !url.endsWith('/v1/videos')) return new Response('upload failed', { status: 500 })
  if (url.endsWith('/upload')) return Response.json({ url: 'https://cdn.test/uploaded.png' })
  assert.ok(url.endsWith('/v1/videos'), 'no unexpected network endpoint')
  return Response.json({ id: 'mock-task', status: 'queued' })
} })

const { createGenerationVariantConfig } = load('lib/generation/defaults.ts')
const {
  resolveRequestGenerationInputs,
  resultAssetIdsFromResourceIds,
  toLegacyVariantConfig,
  collectOwnedResultNodeIds,
  generationInputProvenanceIds,
  upsertGenerationResultNodes,
  collectUpstreamReferences,
} = load('canvas/contents/request-generation.ts')
{
  const resources = [
    { label: 'first', resource: { url: 'https://cdn.test/first.png', resourceId: 'sha256-first', mimeType: 'image/png', fileName: 'first.png' } },
    { label: 'second', resource: { url: 'https://cdn.test/second.png', mimeType: 'image/png' } },
  ]
  const node = { id: 'parsed-media', kind: 'content', label: 'images', category: 'image', assetId: 'asset-stale', source: { kind: 'url', url: 'https://page.test/original', provider: 'youtube' }, payload: { kind: 'image', resources } }
  const before = JSON.stringify(node)
  const refs = collectUpstreamReferences('image', [node], [node], {}, {})
  assert.equal(refs.length, 2, 'parsed media references supersede the source webpage and stale asset')
  assert.deepEqual(refs.map(ref => ref.url), resources.map(item => item.resource.url))
  assert.equal(refs[0].resourceId, 'sha256-first')
  assert.equal(refs[0].fileName, 'first.png')
  assert.equal(refs[0].source, 'local')
  assert.equal(refs[1].source, 'url')
  assert.ok(refs.every(ref => ref.upstreamNodeId === node.id))
  const split = { ...node, id: 'split-media', payload: { kind: 'image', resources: [resources[1]], activeResourceIndex: 0 } }
  const splitRefs = collectUpstreamReferences('video', [split], [split], {}, {})
  assert.equal(splitRefs.length, 1)
  assert.equal(splitRefs[0].url, resources[1].resource.url)
  assert.equal(splitRefs[0].resourceId, undefined)
  assert.equal(splitRefs[0].upstreamNodeId, split.id)
  const video = { ...node, category: 'video', payload: { kind: 'video', resources: [{ resource: { url: 'https://cdn.test/movie.mp4', mimeType: 'video/mp4' } }] } }
  assert.equal(collectUpstreamReferences('image', [video], [video], {}, {}).length, 0)
  assert.equal(collectUpstreamReferences('video', [video], [video], {}, {})[0].type, 'video')
  assert.equal(JSON.stringify(node), before)
}
const { normalizeVideoModeConfig, videoModesForModel, videoReferenceError, videoInputTypes } = load('lib/generation/video-mode.ts')
const { submitGenerationTask, testGenerationMediaUpload } = load('lib/generation/client.ts')
const { mediaTransportStatus, normalizeMediaTransport } = load('lib/generation/media-policy.ts')

const SIZE = { width: 100, height: 100 }
const POS = { x: 0, y: 0 }
const base = { ...createGenerationVariantConfig('video'), channelId: channel.id, model: model.id, prompt: 'camera move' }
const configBase = { channelId: channel.id, model: model.id, prompt: 'camera move', capability: base.capability }

function contentNode(id, extra = {}) {
  return {
    id,
    kind: 'content',
    position: POS,
    size: SIZE,
    label: extra.label || id,
    category: extra.category ?? null,
    subtype: extra.subtype ?? null,
    source: extra.source ?? null,
    assetId: extra.assetId,
    content: extra.content,
    payload: extra.payload,
    disabled: extra.disabled,
    generatedBy: extra.generatedBy,
  }
}

function requestNode(id, extra = {}) {
  return {
    id,
    kind: 'request',
    position: POS,
    size: SIZE,
    label: extra.label || id,
    variant: extra.variant || 'video',
    image: extra.image || { prompt: '' },
    video: extra.video || { prompt: '' },
    latestRunId: extra.latestRunId,
    resultNodeIds: extra.resultNodeIds,
    disabled: extra.disabled,
  }
}

function stickyNode(id, content) {
  return { id, kind: 'sticky', position: POS, size: SIZE, label: id, content, color: 'yellow', background: 'solid' }
}

function browserNode(id, url) {
  return { id, kind: 'browser', position: POS, size: SIZE, label: id, url }
}

function edge(source, target = 'request') {
  return { id: `${source}->${target}`, source, target }
}

function asset(id, mimeType) {
  return { id, hash: id.replace(/^asset-/, ''), mimeType, size: 10 }
}

function resolveInputs({
  requestNodeId = 'request',
  variant = 'video',
  config = configBase,
  nodes,
  edges,
  assets = {},
  runs = {},
} = {}) {
  return resolveRequestGenerationInputs({ requestNodeId, variant, config, nodes, edges, assets, runs })
}

{
  const parsed = contentNode('parsed-document', { category: 'document', payload: { kind: 'document', plainText: 'Fresh upstream document body' } })
  const result = resolveInputs({ nodes: [parsed], edges: [edge(parsed.id)] })
  assert.equal(result.prompt, 'camera move\n\nFresh upstream document body')
  assert.equal(result.references.length, 0)
}

const imageFirst = contentNode('first', {
  category: 'image',
  subtype: 'image',
  source: { kind: 'url', url: 'https://cdn.test/first.png' },
})
const imageLast = contentNode('last', {
  category: 'image',
  subtype: 'image',
  source: { kind: 'url', url: 'https://cdn.test/last.png' },
})
const videoClip = contentNode('video', {
  category: 'video',
  subtype: 'remote-video',
  source: { kind: 'url', url: 'https://cdn.test/video.mp4' },
  content: 'fresh transcript',
})
const voice = contentNode('voice', {
  source: { kind: 'file', assetId: 'asset-voice', mimeType: 'audio/wav', fileName: 'voice.wav' },
  assetId: 'asset-voice',
})
const nodes = [imageFirst, imageLast, videoClip, voice]
const edges = nodes.map((node) => edge(node.id))
const assets = { 'asset-voice': asset('asset-voice', 'audio/wav') }

const merged = resolveInputs({ nodes, edges, assets })
assert.deepEqual(merged.references.map((reference) => reference.type), ['image', 'image', 'video', 'audio'])
assert.ok(merged.references.every((reference) => reference.upstreamNodeId))
assert.equal(configBase.referenceAssetIds?.length || 0, 0, 'upstream references do not become owned files')
assert.match(merged.prompt, /camera move/)
assert.match(merged.prompt, /fresh transcript/, 'upstream content text is merged into the prompt')

const textNodes = [
  contentNode('note', { category: 'text', subtype: 'plain-text', source: { kind: 'text', mimeType: 'text/plain' }, content: 'hello note' }),
  stickyNode('sticky', 'sticky text'),
  browserNode('browser', 'https://example.test'),
]
const textMerged = resolveInputs({
  config: { ...configBase, prompt: 'base prompt' },
  nodes: textNodes,
  edges: textNodes.map((node) => edge(node.id)),
})
assert.equal(textMerged.prompt, 'base prompt\n\nhello note\n\nsticky text\n\nhttps://example.test')

assert.equal(resolveInputs({ nodes, edges: edges.slice(1), assets }).references.length, 3)
assert.equal(resolveInputs({
  nodes: nodes.map((node) => node.id === 'first' ? { ...node, disabled: true } : node),
  edges,
  assets,
}).references.length, 3)
assert.equal(resolveInputs({ nodes, edges: [...edges, edges[0]], assets }).references.length, 4, 'duplicate edges do not duplicate files')

const localAssetId = 'asset-first'
const localAssetNodes = [
  contentNode('first', {
    category: 'image',
    subtype: 'image',
    assetId: localAssetId,
    source: { kind: 'file', assetId: localAssetId, mimeType: 'image/png', fileName: 'first.png' },
  }),
  imageLast,
  videoClip,
  voice,
]
const localAssets = {
  ...assets,
  [localAssetId]: asset(localAssetId, 'image/png'),
}
assert.equal(resolveInputs({
  config: { ...configBase, referenceAssetIds: [localAssetId] },
  nodes: localAssetNodes,
  edges,
  assets: localAssets,
}).references.length, 4, 'local/upstream assets deduplicate by storage identity')

assert.equal(resolveInputs({ variant: 'image', nodes, edges, assets }).capability, 'image-to-image')
assert.deepEqual(resolveInputs({ variant: 'image', nodes, edges, assets }).references.map((reference) => reference.type), ['image', 'image'])
assert.equal(resolveInputs({ variant: 'image', nodes: textNodes, edges: textNodes.map((node) => edge(node.id)) }).capability, 'text-to-image')
assert.equal(merged.capability, configBase.capability, 'video capability stays on the request config')

const overrideConfig = {
  ...configBase,
  referenceOverrides: {
    [merged.references[0].id]: { excluded: true },
    [merged.references[1].id]: { role: 'first_frame', order: -1 },
  },
}
const overridden = resolveInputs({ config: overrideConfig, nodes, edges, assets })
assert.equal(overridden.references.length, 3)
assert.equal(overridden.references[0].upstreamNodeId, 'last')
assert.equal(overridden.references[0].role, 'first_frame')

const resultAssetId = 'asset-result'
const generatedContent = contentNode('result-1', {
  category: 'image',
  subtype: 'image',
  assetId: resultAssetId,
  source: { kind: 'file', assetId: resultAssetId, mimeType: 'image/png', fileName: 'result.png' },
  generatedBy: { requestNodeId: 'upstream-request', variant: 'image' },
})
const upstreamRequest = requestNode('upstream-request', {
  variant: 'image',
  label: 'Generated',
  resultNodeIds: { image: ['result-1'] },
})
const generated = resolveInputs({
  nodes: [upstreamRequest, generatedContent],
  edges: [edge('upstream-request')],
  assets: { [resultAssetId]: asset(resultAssetId, 'image/png') },
})
assert.equal(generated.references[0].resourceId, 'sha256-result', 'request results use the same live input resolver')
assert.equal(generated.references[0].upstreamNodeId, 'result-1')

const runRequest = requestNode('upstream-run', { variant: 'image', latestRunId: 'run-1' })
const fromRun = resolveInputs({
  nodes: [runRequest],
  edges: [edge('upstream-run')],
  assets: { [resultAssetId]: asset(resultAssetId, 'image/png') },
  runs: {
    'run-1': {
      id: 'run-1',
      status: 'completed',
      createdAt: 0,
      tasks: [{ id: 'task-1', status: 'completed', resultAssetIds: [resultAssetId] }],
    },
  },
})
assert.equal(fromRun.references[0].resourceId, 'sha256-result')
assert.equal(fromRun.references[0].upstreamNodeId, 'upstream-run')

assert.deepEqual(resultAssetIdsFromResourceIds(['sha256-abc', '', 'sha256-def']), ['asset-abc', 'asset-def'])
assert.deepEqual(resultAssetIdsFromResourceIds(undefined), [])
assert.equal(resultAssetIdsFromResourceIds(['result-resource'])[0], 'asset-result-resource')

const extracted = generationInputProvenanceIds([
  {
    id: 'ref-url',
    url: 'https://cdn.test/secret-token?apiKey=abc',
    previewUrl: 'https://cdn.test/preview',
    resourceId: 'sha256-aaa',
    upstreamNodeId: 'node-a',
    rawResponse: { id: 'hidden' },
  },
  { id: 'asset-bbb', resourceId: 'sha256-bbb' },
])
assert.deepEqual(extracted.inputReferenceIds, ['ref-url', 'asset-bbb'])
assert.deepEqual(extracted.inputAssetIds, ['asset-aaa', 'asset-bbb'])
assert.deepEqual(extracted.inputNodeIds, ['node-a'])
assert.equal('url' in extracted, false)
assert.doesNotMatch(JSON.stringify(extracted), /apiKey|rawResponse|cdn\.test/)

const legacyResult = contentNode('legacy-result', {
  category: 'image',
  subtype: 'image',
  generatedBy: { requestNodeId: 'req-legacy', variant: 'image' },
})
const legacyRequest = requestNode('req-legacy', { variant: 'image' })
assert.deepEqual(
  collectOwnedResultNodeIds(legacyRequest, [legacyRequest, legacyResult], 'image'),
  ['legacy-result'],
  'legacy generatedBy with only requestNodeId/variant still owns result nodes',
)

graphStoreState.currentDocument = {
  id: 'doc-1',
  name: 'doc',
  title: 'doc',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    requestNode('req-1', { variant: 'image', latestRunId: 'run-1', label: '图片', resultNodeIds: { image: ['legacy-owned'] } }),
    contentNode('legacy-owned', {
      category: 'image',
      subtype: 'image',
      generatedBy: { requestNodeId: 'req-1', variant: 'image' },
    }),
  ],
  edges: [],
  createdAt: 0,
  updatedAt: 0,
}
graphStoreState.currentDocumentId = 'doc-1'
const createdIds = upsertGenerationResultNodes({
  requestNodeId: 'req-1',
  variant: 'image',
  documentId: 'doc-1',
  runId: 'run-1',
  taskId: 'task-1',
  channelId: 'test-channel',
  providerId: 'video',
  model: 'seedance-2.5-pro',
  inputReferenceIds: ['ref-url', 'asset-bbb'],
  inputAssetIds: ['asset-aaa', 'asset-bbb'],
  inputNodeIds: ['node-a'],
  createdAt: 123,
  results: [{ assetId: 'asset-out', mimeType: 'image/png', fileName: 'out.png' }],
})
assert.equal(createdIds.length, 1)
assert.notEqual(createdIds[0], 'legacy-owned', 'a new run never overwrites the previous result')
const resultNode = graphStoreState.currentDocument.nodes.find((node) => node.id === createdIds[0])
assert.equal(resultNode.generatedBy.requestNodeId, 'req-1')
assert.equal(resultNode.generatedBy.variant, 'image')
assert.equal(resultNode.generatedBy.runId, 'run-1')
assert.equal(resultNode.generatedBy.taskId, 'task-1')
assert.equal(resultNode.generatedBy.channelId, 'test-channel')
assert.equal(resultNode.generatedBy.providerId, 'video')
assert.equal(resultNode.generatedBy.model, 'seedance-2.5-pro')
assert.deepEqual(resultNode.generatedBy.inputReferenceIds, ['ref-url', 'asset-bbb'])
assert.deepEqual(resultNode.generatedBy.inputAssetIds, ['asset-aaa', 'asset-bbb'])
assert.deepEqual(resultNode.generatedBy.inputNodeIds, ['node-a'])
assert.equal(resultNode.generatedBy.createdAt, 123)
assert.equal(resultNode.generatedBy.apiKey, undefined)
assert.equal(resultNode.generatedBy.rawResponse, undefined)
assert.equal(resultNode.generatedBy.requestSnapshot, undefined)
assert.doesNotMatch(JSON.stringify(resultNode.generatedBy), /apiKey|rawResponse|secret/)
assert.deepEqual(
  collectOwnedResultNodeIds(graphStoreState.currentDocument.nodes[0], graphStoreState.currentDocument.nodes, 'image'),
  ['legacy-owned', createdIds[0]],
)
graphStoreState.currentDocument = null
graphStoreState.currentDocumentId = null

const executable = toLegacyVariantConfig('video', overrideConfig, overridden.references, overridden.prompt)
assert.deepEqual(executable.references, overridden.references, 'legacy submit config keeps the same derived references')

assert.deepEqual(videoModesForModel(model), ['reference-to-video', 'first-last-frame'])
assert.deepEqual(videoInputTypes(model, 'first-last-frame'), ['image'])
assert.deepEqual(videoInputTypes(model, 'reference-to-video'), ['image', 'video', 'audio'])
assert.deepEqual(videoModesForModel({ ...model, capabilitySource: 'inferred' }), ['reference-to-video', 'first-last-frame'])
assert.deepEqual(videoInputTypes({ ...model, capabilitySource: 'inferred' }, 'reference-to-video'), ['image', 'video', 'audio'])
assert.equal(base.capability, 'reference-to-video')
assert.equal(videoReferenceError(model, base), undefined, 'multimodal permits prompt-only generation')
assert.match(videoReferenceError({ ...model, capabilities: ['reference-to-video'] }, base), /纯文本生成能力/)
const frames = normalizeVideoModeConfig({ ...base, capability: 'first-last-frame', references: merged.references.slice(0, 2) })
assert.deepEqual(frames.references.map((reference) => reference.role), ['first_frame', 'last_frame'])
assert.equal(videoReferenceError(model, frames), undefined)
assert.match(videoReferenceError(model, normalizeVideoModeConfig({ ...frames, references: [frames.references[0]] })), /首帧和一张尾帧/)
assert.equal(normalizeVideoModeConfig({ ...base, capability: 'audio-reference' }).capability, 'reference-to-video')
assert.equal(normalizeVideoModeConfig({ ...base, capability: 'generate-audio', noMusic: true }).generateAudio, false)
for (const legacyMode of ['text-to-video', 'image-to-video', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio']) {
  assert.equal(normalizeVideoModeConfig({ ...base, capability: legacyMode }).capability, 'reference-to-video')
}
assert.equal(normalizeVideoModeConfig({ ...frames, capability: undefined }).capability, 'first-last-frame', 'legacy frame roles still identify the frame workflow')
const convertedFrames = normalizeVideoModeConfig({ ...frames, capability: 'reference-to-video' })
assert.deepEqual(convertedFrames.references.map((reference) => reference.role), ['reference_image', 'reference_image'])
assert.deepEqual(convertedFrames.references.map((reference) => reference.id), frames.references.map((reference) => reference.id))

async function submit(config, transport, extra = {}) {
  requests.length = 0
  const result = await submitGenerationTask({ variant: 'video', model, channel: { ...channel, mediaTransport: transport, ...extra }, config })
  return { result, body: JSON.parse(requests.find((request) => request.url.endsWith('/v1/videos')).body) }
}
const textRequest = await submit({ ...base, capability: 'text-to-video' })
assert.equal(textRequest.body.input_reference, undefined)
assert.equal(textRequest.body.reference_images, undefined)
const imageRequest = await submit({ ...base, capability: 'image-to-video', references: [merged.references[0]] })
assert.equal(imageRequest.body.input_reference, undefined)
assert.deepEqual(imageRequest.body.reference_images, ['https://cdn.test/first.png'])
const frameRequest = await submit(frames)
assert.equal(frameRequest.body.input_reference, 'https://cdn.test/first.png')
assert.equal(frameRequest.body.image_end, 'https://cdn.test/last.png')
const referenceRequest = await submit({ ...base, capability: 'reference-to-video', references: merged.references.slice(0, 3) })
assert.equal(referenceRequest.body.input_reference, undefined)
assert.equal(referenceRequest.body.reference_images.length, 2)
assert.equal(referenceRequest.body.reference_videos.length, 1)
const silentRequest = await submit({ ...base, noMusic: true, generateAudio: true })
assert.equal(silentRequest.body.generate_audio, false)
assert.equal(silentRequest.body.sound_effects, undefined)
assert.equal(silentRequest.body.no_music, undefined)
const audioRequest = await submit({ ...base, generateAudio: true })
assert.equal(audioRequest.body.generate_audio, true)
assert.equal(audioRequest.body.sound_effects, undefined)
const legacyAudioField = await submitGenerationTask({
  variant: 'video',
  model: { ...model, videoRequestContract: { ...model.videoRequestContract, generateAudioField: 'sound_effects' } },
  channel,
  config: { ...base, generateAudio: true },
})
assert.equal(legacyAudioField.taskId, 'mock-task')
assert.equal(JSON.parse(requests.at(-1).body).generate_audio, true, 'legacy sound_effects contracts still submit generate_audio')
assert.equal(JSON.parse(requests.at(-1).body).sound_effects, undefined)
requests.length = 0
await submitGenerationTask({
  variant: 'video',
  model: { ...model, videoRequestContract: { ...model.videoRequestContract, generateAudioField: undefined } },
  channel,
  config: { ...base, generateAudio: true },
})
assert.equal(JSON.parse(requests.at(-1).body).generate_audio, true, 'audio-capable models still submit generate_audio when the contract omits the field')
const kacangModel = kacangModels.find((item) => item.id === 'doubao-seedance-2.0')
assert(kacangModel, 'Kacang model catalog contains the documented Doubao model')
const kacangConfig = { ...base, model: kacangModel.id, seconds: 8, resolution: '720P', references: [merged.references[0]] }
const kacangResult = await submitGenerationTask({
  variant: 'video',
  model: kacangModel,
  channel: { ...channel, id: 'kacang-channel', protocol: 'video-kacang', baseURL: 'https://kacang.test/v1', mediaTransport: 'inline' },
  config: kacangConfig,
})
assert.equal(kacangResult.taskId, 'mock-task')
const kacangBody = JSON.parse(requests.find((request) => request.url === 'https://kacang.test/v1/videos').body)
assert.equal(kacangBody.duration_seconds, 8, 'Kacang uses duration_seconds')
assert.equal(kacangBody.seconds, undefined, 'Kacang does not use the 808Relay seconds field')
assert.deepEqual(kacangBody.reference_images, ['https://cdn.test/first.png'], 'Doubao uses its documented reference_images field')
assert.equal(kacangBody.referenceImages, undefined, 'Doubao does not use the MiniMax camelCase field')
assert.equal(kacangBody.generate_audio, true, 'Doubao submits generate_audio')
await assert.rejects(() => submitGenerationTask({
  variant: 'video',
  model: kacangModel,
  channel: { ...channel, id: 'kacang-channel', protocol: 'video-kacang', baseURL: 'https://kacang.test/v1', mediaTransport: 'inline' },
  config: { ...base, model: kacangModel.id, references: [{ ...merged.references[0], url: 'https://pub-123.r2.dev/media/sha256-abc' }] },
}), /HTTP 206/)
requests.length = 0
await submitGenerationTask({ variant: 'video', model: { ...model, capabilities: ['text-to-video'] }, channel, config: base })
assert.equal(JSON.parse(requests[0].body).generate_audio, undefined, 'hidden unsupported audio parameters are not submitted')
assert.equal(JSON.parse(requests[0].body).sound_effects, undefined, 'hidden unsupported audio parameters are not submitted')

const mentionReferences = [
  { id: 'mention-image', type: 'image', label: '角色正面', fileName: 'actor.png', source: 'url', url: 'https://cdn.test/actor.png', previewUrl: 'https://cdn.test/actor.png', order: 0, status: 'ready' },
  { id: 'mention-video', type: 'video', label: '镜头节奏', fileName: 'camera.mp4', source: 'url', url: 'https://cdn.test/camera.mp4', previewUrl: 'https://cdn.test/camera.mp4', order: 1, status: 'ready' },
]
requests.length = 0
const mentionSubmission = await submitGenerationTask({
  variant: 'video',
  model,
  channel,
  config: { ...base, prompt: '参考 @Image1 @Video1', promptMentions: { 'mention-image': '@Image1', 'mention-video': '@Video1' }, references: mentionReferences },
})
const mentionBody = JSON.parse(requests.find((request) => request.url.endsWith('/v1/videos')).body)
assert.match(mentionBody.prompt, /@Image1/, 'the generated request keeps the selected token in its prompt')
assert.deepEqual(mentionBody.reference_images, ['https://cdn.test/actor.png'], 'the selected token remains connected to the matching reference array')
assert.equal(mentionSubmission.taskId, 'mock-task')

const localCopy = { ...merged.references[0], id: 'local', upstreamNodeId: undefined, url: undefined, previewUrl: undefined, resourceId: 'sha256-local', source: 'local' }
const localConfig = { ...base, references: [localCopy] }
assert.match((await submit(localConfig, 'inline')).body.reference_images[0], /^data:image\/png;base64,/)
assert.equal(requests.length, 1, 'inline never calls an upload endpoint')
await submit(localConfig, 'custom', { mediaUploadURL: 'https://storage.test/upload' })
assert.equal(requests[0].url, 'https://storage.test/upload')
assert.deepEqual(requests.map((request) => request.method), ['POST', 'POST'])
assert.ok(requests[0].body instanceof FormData, 'custom storage keeps its existing file upload contract')
storageSettings.baseURL = 'https://storage.test'
storageSettings.getAccessToken = () => 'mock-storage-token'
await submit(localConfig, 'custom', { apiKey: 'mock-provider-token' })
assert.equal(requests[0].url, 'https://storage.test/upload', 'custom transport uses global media storage')
assert.ok(requests[0].body instanceof FormData)
assert.equal(requests[0].headers.Authorization, 'Bearer mock-storage-token', 'storage uses an independent credential')
for (const legacyTransport of [undefined, 'auto', 'public-url', 'presign', 'multipart']) {
  await assert.rejects(() => submit(localConfig, legacyTransport, { mediaUploadPath: '/presign' }), /preparation:.*选择本地素材传输方式/)
  assert.equal(requests.length, 0, 'configured storage and endpoints never imply a delivery choice')
}
for (const retiredTransport of ['presign', 'multipart']) {
  await assert.rejects(() => submit(localConfig, 'custom', { adapters: [{ id: 'video-api', protocol: 'video-api', mediaTransport: retiredTransport, mediaUploadPath: '/upload' }] }), /选择本地素材传输方式/)
  assert.equal(requests.length, 0, 'retired adapter transports cannot fall back to the channel or custom storage')
}
storageSettings.baseURL = ''
await assert.rejects(() => submit({ ...localConfig, capability: 'first-last-frame' }, 'custom', { mediaUploadURL: 'https://storage.test/upload' }), /validation/)
assert.equal(requests.length, 0, 'invalid mode is rejected before uploading or creating a task')
assert.equal((await submit({ ...base, capability: 'image-to-video', references: merged.references.slice(0, 2) })).body.reference_images.length, 2, 'legacy image mode merges into multimodal without a single-image constraint')
const mixedInput = await submit({ ...base, references: [...localConfig.references, merged.references[1]] }, 'inline')
assert.match(mixedInput.body.reference_images[0], /^data:/)
assert.equal(mixedInput.body.reference_images[1], 'https://cdn.test/last.png')
assert.equal(requests.length, 1, 'existing HTTPS references are never fetched or uploaded')
rejectUpload = true
await assert.rejects(() => submit(localConfig, 'custom', { mediaUploadURL: 'https://storage.test/upload' }), /preparation/)
assert.equal(requests.length, 1, 'failed preparation never falls back or creates a task')
rejectUpload = false
requests.length = 0
await testGenerationMediaUpload({ ...channel, mediaTransport: 'inline' })
for (const retiredTransport of ['public-url', 'auto', 'presign', 'multipart']) {
  await assert.rejects(() => testGenerationMediaUpload({ ...channel, mediaTransport: retiredTransport, mediaUploadPath: '/upload', mediaUploadURL: 'https://storage.test/upload' }), /选择本地素材传输方式/)
}
assert.equal(requests.length, 0, 'no-upload checks do not claim connectivity')
assert.equal(mediaTransportStatus(undefined).canTestUpload, false)
assert.equal(mediaTransportStatus('presign').canTestUpload, false)
assert.equal(mediaTransportStatus('multipart', true).canTestUpload, false)
assert.equal(mediaTransportStatus('custom', false).canTestUpload, false)
assert.equal(mediaTransportStatus('custom', true).canTestUpload, true)
await testGenerationMediaUpload({ ...channel, mediaTransport: 'custom', mediaUploadURL: 'https://storage.test/upload' })
assert.equal(requests.length, 1, 'upload verification calls only custom storage, not a generation endpoint')
assert.equal(requests[0].url, 'https://storage.test/upload')
assert.ok(requests[0].body instanceof FormData)
const normalizeChannel = evaluate('import { normalizeMediaTransport, generationProtocolForChannel, generationPresetForId, isVideoGenerationProtocol, modelsForGenerationProtocol, generationSecretName, generationMediaUploadSecretName, GENERATION_PROTOCOL_LABELS } from "bindings";\nexport ' + declarations('stores/use-generation-store.ts', ['normalizeChannel']), () => ({
  ...generationStore, normalizeMediaTransport, generationPresetForId: () => undefined, isVideoGenerationProtocol: (value) => value === 'video-api', modelsForGenerationProtocol: () => models, GENERATION_PROTOCOL_LABELS: { 'video-api': '视频 API' },
})).normalizeChannel
for (const legacyTransport of [undefined, 'auto', 'public-url', 'presign', 'multipart']) {
  const normalized = normalizeChannel({ ...channel, supportsImage: false, supportsVideo: true, mediaTransport: legacyTransport, mediaUploadPath: '/presign' })
  assert.equal(normalized.mediaTransport, undefined)
  assert.equal(normalized.adapters[0].mediaTransport, undefined)
  assert.equal(normalized.adapters[0].mediaUploadPath, '/presign', 'legacy configuration is retained, but never selected implicitly')
}
assert.equal(normalizeChannel({ ...channel, supportsImage: false, supportsVideo: true, mediaTransport: 'custom' }).mediaTransport, 'custom')
const legacyAdapter = normalizeChannel({ ...channel, supportsImage: false, supportsVideo: true, mediaTransport: 'inline', adapters: [{ id: 'video-api', protocol: 'video-api', mediaTransport: 'auto', mediaUploadPath: '/presign' }] })
assert.equal(legacyAdapter.mediaTransport, undefined, 'a legacy adapter choice does not silently fall back to the channel')
assert.equal(legacyAdapter.adapters[0].mediaUploadPath, '/presign')

const dom = new JSDOM('<div id="root"></div>', { url: 'https://ui.test' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const messages = []
const savedChannels = []
const mediaStore = create(() => ({ baseURL: '' }))
mocks.set('@/stores/use-media-storage-store', { useMediaStorageStore: mediaStore })
mocks.set('@/lib/app-dialog', { showMessage: (message) => messages.push(message), askConfirmation: async () => false })
mocks.set('@/components/layout/AppShell', { AppShell: ({ children }) => children })
mocks.set('@/components/ui/button', load('components/ui/button.tsx'))
mocks.set('@/components/ui/dialog', load('components/ui/dialog.tsx'))
mocks.set('@/lib/api/client', { AIClient: class {} })
mocks.set('@/lib/generation/client', { runGenerationTask: async () => ({ status: 'completed' }), cancelGenerationTask: async () => {}, testGenerationMediaUpload: async () => ({}) })
Object.assign(generationStore, {
  GENERATION_PROTOCOL_LABELS: { 'video-api': '视频 API' },
  GENERATION_PROTOCOL_OPTIONS: [{ value: 'video-api', label: '视频 API', group: 'video' }],
  modelsForGenerationProtocol: () => models,
})
useGenerationStore.setState({
  getAPIKey: () => null,
  addChannel: (updates) => savedChannels.push(updates),
  updateChannel: (id, updates) => savedChannels.push(updates),
})
const { GenerationChannelsManager } = load('components/settings/GenerationChannelsManager.tsx')
const root = createRoot(document.getElementById('root'))
function textButton(label) { return [...document.querySelectorAll('button')].find((element) => element.textContent === label) }
const deliverySelect = () => document.querySelector('select[aria-label="本地素材传输方式"]')
const protocolSelect = () => document.querySelector('select[aria-label="上传协议"]')
async function click(element) { assert.ok(element); await act(async () => element.click()) }
async function changeSelect(element, value) {
  assert.ok(element)
  await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
async function openChannel(transport, extra = {}) {
  await act(async () => {
    useGenerationStore.setState({ channels: [{ ...channel, mediaTransport: transport, ...extra }] })
    root.render(React.createElement(GenerationChannelsManager, { embedded: true }))
  })
  await click(textButton('编辑'))
}
for (const legacyTransport of [undefined, 'auto', 'public-url', 'presign', 'multipart']) {
  await openChannel(legacyTransport, { mediaUploadPath: '/presign' })
  assert.equal(deliverySelect().value, '', 'old choices require an explicit replacement even with an existing endpoint')
  assert.deepEqual([...deliverySelect().options].map((option) => option.value), ['', 'inline', 'custom'])
  assert.equal(protocolSelect(), null)
  assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /预签名|multipart|供应商上传/)
  assert.equal(textButton('验证上传'), undefined)
  await click(textButton('保存'))
  assert.match(messages.at(-1), /选择本地素材传输方式/)
  assert.equal(savedChannels.length, 0)
  await click(textButton('取消'))
}
await openChannel(undefined)
await changeSelect(deliverySelect(), 'custom')
assert.equal(protocolSelect(), null)
await click(textButton('保存'))
assert.match(messages.at(-1), /本地存储/)
await act(async () => mediaStore.setState({ baseURL: 'https://storage.test' }))
assert.ok(textButton('验证上传'), 'configured custom storage enables only an explicit upload test')
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'custom')
assert.equal(savedChannels.at(-1).adapters[0].mediaTransport, 'custom')
await openChannel('inline')
assert.equal(deliverySelect().value, 'inline')
assert.equal(protocolSelect(), null)
assert.equal(textButton('验证上传'), undefined)
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'inline')
await act(async () => mediaStore.setState({ baseURL: '' }))
await openChannel('custom', { mediaUploadURL: 'https://legacy-storage.test/upload' })
assert.match(document.body.textContent, /此渠道保留的自定义上传配置/)
assert.ok(textButton('验证上传'))
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'custom')
await act(async () => root.render(React.createElement(GenerationChannelsManager, { embedded: true, openNewRequest: 1 })))
assert.ok(document.querySelector('[role="dialog"]'))
assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /渠道预设/, 'new generation channels do not expose a separate preset menu')
await click(textButton('取消'))
await act(async () => root.unmount())
dom.window.close()
console.log('generation inputs, video modes, audio parameter and production transport contracts: PASS')
