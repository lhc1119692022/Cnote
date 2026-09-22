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
mocks.set('./media-inspection', { validateOfficialMediaReferences: async () => [], loadReferenceForInspection: async () => new Blob(['video'], { type: 'video/mp4' }), inspectMediaBlob: async () => ({ bytes: 5, format: 'mp4', duration: 4 }) })
mocks.set('@/canvas/video-input-validation', { useVideoInputFeedback: create(() => ({ nodes: {} })), addVideoInputFile: async () => {} })
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

const { VIDEO_808_MODELS: models, VIDEO_KACANG_MODELS: kacangModels, resolveKacangModel, videoRequestMode, resolveVideoModelAdapter } = load('lib/generation/video-catalog.ts')
const { officialMediaProfile } = load('lib/generation/official-media-rules.ts')
const public808ModelIds = JSON.parse(readFileSync(new URL('./fixtures/808-video-model-ids.json', import.meta.url), 'utf8'))
const supplied808Contracts = JSON.parse(readFileSync(new URL('./fixtures/808-provided-contracts.json', import.meta.url), 'utf8'))
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
  generationVideoRequestContractForModel: (channel, selectedModel) => resolveKacangModel(channel, selectedModel?.id)?.videoRequestContract || resolveVideoModelAdapter(channel, selectedModel?.id)?.requestContract || selectedModel?.videoRequestContract || ({ createPath: '/v1/videos', pollPath: '/v1/videos/{id}', contentPath: '/v1/videos/{id}/content', durationField: 'seconds', resolutionField: 'resolution', aspectRatioField: 'aspect_ratio', firstFrameField: 'input_reference', lastFrameField: 'image_end', imageReferencesField: 'reference_images', videoReferencesField: 'reference_videos', audioReferencesField: 'reference_audios', generateAudioField: 'generate_audio' }),
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
mocks.set('./media-upload-cache', { reuseMediaUpload: async (_scope, _blob, upload) => upload('a'.repeat(64)) })
mocks.set('@/stores/use-media-storage-store', { notifyMediaStorageChanged: () => {}, MEDIA_STORAGE_DEFAULTS: { fieldName: 'file', responsePath: 'url' }, useMediaStorageStore: { getState: () => storageSettings } })
const requests = []
const reportedSeedanceModes = new Set(['auto', 'text-to-video', 'image-to-video', 'reference-to-video', 'start-end-to-video', 'edit-video', 'video-extension'])
let rejectUpload = false
let pollFailure
let resumePollError
let creationFailure
let mediaStatus = 200
mocks.set('@/lib/desktop-fetch', { desktopFetch: async (url, options = {}, transportOptions = {}) => {
  if (options.method === 'HEAD') return new Response(null, { status: mediaStatus, headers: { 'content-type': 'application/octet-stream', 'content-length': '10' } })
  if (url.endsWith('/prepare')) return Response.json({ url: 'https://storage.test/media/prepared', expiresAt: Date.now() + 14 * 86400000 })
  requests.push({ url, ...options })
  if (url.endsWith('/v1/videos/task-resume') && options.method === 'GET') {
    if (resumePollError) throw new Error(resumePollError)
    assert.equal(transportOptions.timeoutMs, 30000)
    return Response.json({ id: 'task-resume', status: 'completed', video_url: 'https://cdn.test/finished.mp4' })
  }
  if (url === 'https://cdn.test/finished.mp4') return new Response('video', { headers: { 'content-type': 'video/mp4' } })
  if (pollFailure && options.method === 'GET' && url.endsWith('/v1/videos/task-wan-failed')) return Response.json(pollFailure)
  if (rejectUpload && !url.endsWith('/v1/videos')) return new Response('upload failed', { status: 500 })
  if (url.endsWith('/upload')) return Response.json({ url: 'https://cdn.test/uploaded.png' })
  if (url === 'https://cdn.test/clip.mp4') return new Response('video', { headers: { 'content-type': 'video/mp4' } })
  if (creationFailure && options.method === 'POST') return Response.json(creationFailure, { status: 400, headers: { 'x-request-id': 'request-create-123' } })
  assert.ok(url.endsWith('/v1/videos'), 'no unexpected network endpoint')
  if (options.method === 'POST') {
    const body = JSON.parse(options.body)
    if (body.mode !== undefined && !reportedSeedanceModes.has(body.mode)) {
      return Response.json({ code: 'invalid_request', message: 'mode must be one of auto, text-to-video, image-to-video, reference-to-video, start-end-to-video, edit-video or video-extension', data: null }, { status: 400 })
    }
  }
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
  removeFailedGenerationPlaceholders,
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
{
  const { useRuntimeStore } = load('stores/runtime-store.ts')
  const placeholder = { ...resultNode, id: 'failed-placeholder', assetId: undefined, source: null, content: undefined, payload: { kind: 'image', resources: [] }, generationBatch: { ...resultNode.generationBatch, runId: 'failed-run', resourceKeys: [] } }
  const detached = { ...placeholder, id: 'detached-placeholder', generatedBy: { ...placeholder.generatedBy, detached: true } }
  graphStoreState.currentDocument.nodes.push(placeholder, detached)
  graphStoreState.currentDocument.edges.push({ id: 'failed-edge', source: 'req-1', target: placeholder.id })
  graphStoreState.currentDocument.nodes[0].resultNodeIds.image.push(placeholder.id)
  graphStoreState.selection = [placeholder.id, resultNode.id]
  const failedRun = { id: 'failed-run', requestNodeId: 'req-1', variant: 'image', status: 'failed', tasks: [{ id: 'failed-task', status: 'failed', error: 'upstream failure' }], resultNodeId: placeholder.id }
  useRuntimeStore.getState().putRun(failedRun)
  assert.deepEqual(removeFailedGenerationPlaceholders({ ...failedRun, status: 'running' }), [])
  assert.deepEqual(removeFailedGenerationPlaceholders({ ...failedRun, tasks: [{ status: 'running' }] }), [])
  assert.deepEqual(removeFailedGenerationPlaceholders({ ...failedRun, requestNodeId: 'other-request' }), [])
  assert.deepEqual(removeFailedGenerationPlaceholders({ ...failedRun, id: 'run-1' }), [], 'partial successful results are kept')
  assert.deepEqual(removeFailedGenerationPlaceholders(failedRun), [placeholder.id])
  assert.ok(graphStoreState.currentDocument.nodes.some(node => node.id === detached.id))
  assert.ok(graphStoreState.currentDocument.nodes.some(node => node.id === resultNode.id))
  assert.ok(!graphStoreState.currentDocument.edges.some(edge => edge.target === placeholder.id))
  assert.ok(!graphStoreState.currentDocument.nodes[0].resultNodeIds.image.includes(placeholder.id))
  assert.deepEqual(graphStoreState.selection, [resultNode.id])
  assert.equal(useRuntimeStore.getState().runs['failed-run'].resultNodeId, undefined)
  assert.equal(useRuntimeStore.getState().runs['failed-run'].tasks[0].error, 'upstream failure', 'request error survives result cleanup')
  assert.deepEqual(removeFailedGenerationPlaceholders(failedRun), [], 'cleanup is idempotent')
}
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
assert.match(videoReferenceError({ ...model, capabilities: ['reference-to-video'] }, base) || '', /纯文本生成能力/, 'channel capability declarations may further restrict the official baseline')
const frames = normalizeVideoModeConfig({ ...base, capability: 'first-last-frame', references: merged.references.slice(0, 2) })
assert.deepEqual(frames.references.map((reference) => reference.role), ['first_frame', 'last_frame'])
assert.equal(videoReferenceError(model, frames), undefined)
assert.equal(videoReferenceError(model, normalizeVideoModeConfig({ ...frames, references: [frames.references[0]] })), undefined)
assert.equal(normalizeVideoModeConfig({ ...base, capability: 'audio-reference' }).capability, 'reference-to-video')
assert.equal(normalizeVideoModeConfig({ ...base, capability: 'generate-audio', noMusic: true }).generateAudio, false)
for (const legacyMode of ['text-to-video', 'image-to-video', 'video-reference', 'audio-reference', 'generate-audio']) {
  assert.equal(normalizeVideoModeConfig({ ...base, capability: legacyMode }).capability, 'reference-to-video')
}
assert.equal(normalizeVideoModeConfig({ ...frames, capability: undefined }).capability, 'first-last-frame', 'legacy frame roles still identify the frame workflow')
assert.equal(normalizeVideoModeConfig({ ...base, capability: 'video-edit' }).capability, 'video-edit', 'editing input duration rules must remain distinguishable')
const convertedFrames = normalizeVideoModeConfig({ ...frames, capability: 'reference-to-video' })
assert.deepEqual(convertedFrames.references.map((reference) => reference.role), ['reference_image', 'reference_image'])
assert.deepEqual(convertedFrames.references.map((reference) => reference.id), frames.references.map((reference) => reference.id))
for (const type of ['audio', 'video']) {
  const normalized = normalizeVideoModeConfig({ ...base, capability: undefined, references: [{ id: 'stale-role', type, role: 'last_frame' }] })
  assert.equal(normalized.capability, 'reference-to-video', 'only image frame roles may restore legacy frame mode')
  assert.equal(normalized.references[0].role, `reference_${type}`)
}

async function submit(config, transport, extra = {}) {
  requests.length = 0
  const result = await submitGenerationTask({ variant: 'video', model, channel: { ...channel, mediaTransport: transport, ...extra }, config })
  return { result, body: JSON.parse(requests.find((request) => request.url.endsWith('/v1/videos')).body) }
}
const textRequest = await submit({ ...base, capability: 'text-to-video' })
{
  const { runGenerationTask } = load('lib/generation/client.ts')
  const context = { variant: 'video', model, channel, config: base }
  requests.length = 0
  resumePollError = 'response cannot be decoded'
  const interrupted = await runGenerationTask(context, { taskId: 'task-resume', timeoutMs: 60000 })
  assert.equal(interrupted.status, 'unknown')
  assert.equal(interrupted.rawStatus, 'poll_interrupted')
  assert.equal(interrupted.taskId, 'task-resume')
  resumePollError = undefined
  const resumed = await runGenerationTask(context, { taskId: interrupted.taskId, timeoutMs: 60000 })
  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.resultResourceIds.length, 1)
  assert.ok(requests.every(request => !request.method || request.method === 'GET'), 'resume must never resubmit a paid generation POST')
  const timedOut = await runGenerationTask(context, { taskId: 'task-resume', timeoutMs: 1, submittedAt: Date.now() - 100 })
  assert.equal(timedOut.rawStatus, 'poll_timeout')
  assert.equal(timedOut.taskId, 'task-resume')
}
{
  requests.length = 0
  mediaStatus = 404
  await assert.rejects(() => submitGenerationTask({ variant: 'video', model, channel, config: { ...base, references: [{ id: 'missing', type: 'image', source: 'url', url: 'https://cdn.test/missing.png' }] } }), /preparation:.*missing.*404/)
  assert.equal(requests.length, 0, 'unrecoverable missing reference never submits generation')
  mediaStatus = 403
  await assert.rejects(() => submitGenerationTask({ variant: 'video', model, channel, config: { ...base, references: [{ id: 'denied', type: 'image', source: 'url', resourceId: 'sha256-fixture', url: 'https://cdn.test/denied.png' }] } }), /preparation:.*403/)
  assert.equal(requests.length, 0, 'permission failure does not upload or generate even with local bytes')
  mediaStatus = 200
}

{
  creationFailure = { error: { code: 'unsupported_reference', message: 'reference videos support at most 0 URLs https://secret.test/path?token=secret' } }
  let prepared
  const reference = { id: 'video-test', type: 'video', source: 'url', url: 'https://cdn.test/video.mp4' }
  await assert.rejects(() => submitGenerationTask({ variant: 'video', model, channel, config: { ...base, references: [reference] } }, undefined, diagnostics => { prepared = diagnostics }), /creation:.*HTTP 400.*unsupported_reference.*request-create-123/)
  assert.equal(prepared.references.length, 1)
  assert.equal(prepared.references[0].type, 'video')
  assert.ok(!JSON.stringify(prepared).includes('cdn.test'))
  creationFailure = undefined
}

{
  const wan = models.find((entry) => entry.id === 'wan-3')
  const staleModel = { ...model, id: 'wan-3.0', capabilitySource: 'inferred' }
  const wanChannel = { ...channel, protocol: 'video-808relay', mediaTransport: 'inline' }
  const runWan = (config, overrides = {}) => submitGenerationTask({ variant: 'video', model: staleModel, channel: wanChannel, config: { ...base, generateAudio: true, ...config }, ...overrides })
  requests.length = 0
  await runWan({ references: [] })
  assert.deepEqual(JSON.parse(requests[0].body), { model: 'wan-3.0', duration: 5, resolution: '720p', aspect_ratio: base.aspectRatio, prompt: base.prompt, generate_audio: true })
  requests.length = 0
  const publicImage = { id: 'wan-image', type: 'image', source: 'url', url: 'https://public.r2.dev/image.png' }
  await runWan({ references: [publicImage] })
  assert.deepEqual(JSON.parse(requests[0].body).image_urls, [publicImage.url])
  assert.equal(JSON.parse(requests[0].body).reference_images, undefined)
  for (const invalid of [
    { seconds: 31 },
    { seconds: 1.5 },
    { resolution: '1080p' },
    { references: [publicImage, { ...publicImage, id: 'second' }, { ...publicImage, id: 'third' }] },
  ]) {
    requests.length = 0
    await assert.rejects(() => runWan(invalid))
    assert.equal(requests.length, 0, 'invalid Wan inputs never reach the network')
  }
  requests.length = 0
  await runWan({ resolution: '1080p', aspectRatio: 'auto' }, { model: { ...staleModel, id: 'wan-3.0-1080p' } })
  assert.equal(JSON.parse(requests[0].body).model, 'wan-3.0-1080p')
  assert.equal(JSON.parse(requests[0].body).resolution, '1080p')
  assert.equal(JSON.parse(requests[0].body).aspect_ratio, '16:9')
  requests.length = 0
  await runWan({ seconds: 2, references: [publicImage] }, { model: { ...staleModel, id: 'wan-3' } })
  assert.equal(JSON.parse(requests[0].body).seconds, 2)
  assert.deepEqual(JSON.parse(requests[0].body).reference_images, [publicImage.url])
  assert.equal(JSON.parse(requests[0].body).duration, undefined)
  assert.equal(JSON.parse(requests[0].body).image_urls, undefined)
  for (const variant of ['provider/wan-3.0-fast', 'WAN-3-custom']) {
    requests.length = 0
    await runWan({ seconds: 1, resolution: 'custom-tier', references: [publicImage, { ...publicImage, id: 'second' }, { ...publicImage, id: 'third' }] }, { model: { ...staleModel, id: variant } })
    const body = JSON.parse(requests[0].body)
    assert.equal(body.model, variant)
    assert.equal(body.image_urls.length, 3)
    assert.equal(body.duration, 1)
    assert.equal(body.resolution, 'custom-tier')
  }
  requests.length = 0
  await runWan({ references: [{ ...publicImage, url: 'http://cdn.test/ref.png' }] })
  assert.deepEqual(JSON.parse(requests[0].body).image_urls, ['http://cdn.test/ref.png'])
  requests.length = 0
  await assert.rejects(() => runWan({ references: [{ ...publicImage, source: 'local', resourceId: 'sha256-fixture', url: undefined }] }), /自定义媒体存储/)
  assert.equal(requests.length, 0, 'legacy inline mode cannot bypass storage')
  requests.length = 0
  await runWan({ capability: 'first-last-frame', references: [{ ...publicImage, role: 'first_frame' }] })
  assert.equal(JSON.parse(requests[0].body).input_reference, publicImage.url)
  assert.equal(JSON.parse(requests[0].body).image_end, undefined)
  requests.length = 0
  await runWan({ references: [{ id: 'audio', type: 'audio', source: 'url', url: 'https://cdn.test/audio.mp3' }] })
  assert.deepEqual(JSON.parse(requests[0].body).audio_urls, ['https://cdn.test/audio.mp3'])
  requests.length = 0
  await runWan({ references: [{ ...publicImage, source: 'local', url: undefined, resourceId: 'sha256-fixture' }] }, { channel: { ...wanChannel, mediaTransport: 'custom', mediaUploadURL: 'https://storage.test/upload' } })
  assert.deepEqual(requests.map(entry => entry.url), ['https://storage.test/upload', 'https://provider.test/v1/videos'])
  assert.deepEqual(JSON.parse(requests[1].body).image_urls, ['https://cdn.test/uploaded.png'])
  assert.equal(wan.maxImages, 10)
  storageSettings.baseURL = 'https://storage.test'
  const diagnosticResult = await runWan({ references: [{ ...publicImage, source: 'local', resourceId: 'sha256-fixture', url: undefined }] })
  assert.equal(diagnosticResult.requestDiagnostics.durationField, 'duration')
  assert.equal(diagnosticResult.requestDiagnostics.duration, 5)
  assert.ok(diagnosticResult.requestDiagnostics.fields.includes('image_urls'))
  assert.deepEqual(diagnosticResult.requestDiagnostics.references, [{ type: 'image', transport: 'https', role: 'reference_image' }])
  assert.ok(!JSON.stringify(diagnosticResult.requestDiagnostics).includes('Zml4dHVyZQ'))
  assert.equal(diagnosticResult.requestDiagnostics.prompt, undefined)
  const staleAdapter = [{ id: 'video-808relay', protocol: 'video-808relay', mediaTransport: 'custom' }]
  requests.length = 0
  storageSettings.baseURL = 'https://storage.test'
  await runWan({ references: [{ ...publicImage, source: 'local', url: undefined, resourceId: 'sha256-fixture' }] }, { channel: { ...wanChannel, adapters: staleAdapter } })
  assert.equal(requests.length, 2, 'old inline settings now upload before generation')
  storageSettings.baseURL = ''
  requests.length = 0
  await runWan({ references: [{ ...publicImage, source: 'local', url: undefined, resourceId: 'sha256-fixture' }] }, { channel: { ...wanChannel, mediaTransport: 'custom', mediaUploadURL: 'https://storage.test/upload', adapters: [{ ...staleAdapter[0], mediaTransport: 'inline' }] } })
  assert.equal(requests[0].url, 'https://storage.test/upload', '808 channel custom selection wins over stale inline adapter')
  pollFailure = { id: 'task-wan-failed', status: 'failed', request_id: 'request-wan', error: { code: 'generation_failed', type: 'generation_failed', message: '生成失败' }, authorization: 'not-for-storage' }
  const { pollGenerationTask } = load('lib/generation/client.ts')
  const polled = await pollGenerationTask({ variant: 'video', model: wan, channel: wanChannel, config: base }, 'task-wan-failed')
  assert.equal(polled.task.status, 'failed')
  assert.match(polled.task.error, /generation_failed/)
  assert.match(polled.task.error, /task-wan-failed/)
  const { generationFailureDetails } = evaluate('export ' + declarations('canvas/contents/RequestContent.tsx', ['generationFailureDetails']))
  assert.deepEqual(generationFailureDetails(polled.task.rawResponse), { code: 'generation_failed', type: 'generation_failed', requestId: 'request-wan' })
  pollFailure = undefined
}
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
const multimodalWithVoice = {
  ...base,
  capability: 'reference-to-video',
  references: [
    { id: 'actor', type: 'image', role: 'first_frame', source: 'url', url: 'https://cdn.test/actor.png', status: 'ready' },
    { id: 'voice', type: 'audio', source: 'url', url: 'https://cdn.test/voice.wav', status: 'ready' },
  ],
}
for (const extra of [
  { protocol: 'video-808relay' },
  { protocol: 'video-api', baseURL: 'https://api.808relay.com' },
  { protocol: 'video-api', baseURL: 'https://va.808relay.com' },
  { protocol: 'video-api', presetId: 'video-808relay' },
]) {
  const { body, result } = await submit(multimodalWithVoice, 'custom', extra)
  assert.equal(result.requestDiagnostics.mode, undefined)
  assert.deepEqual(result.requestDiagnostics.references.map(reference => reference.role), ['reference_image', 'reference_audio'])
  const { mediaRequestDetails, parseRequestDiagnostics } = load('lib/generation/request-diagnostics.ts')
  assert.deepEqual(parseRequestDiagnostics(JSON.parse(JSON.stringify(result.requestDiagnostics))), result.requestDiagnostics)
  assert.match(mediaRequestDetails(result.requestDiagnostics), /未发送 mode/)
  assert.doesNotMatch(mediaRequestDetails(result.requestDiagnostics), /cdn.test|actor.png|voice.wav|first_frame|input_reference/)
  assert.equal(body.mode, undefined, 'documented Pro route derives reference mode from media fields')
  assert.deepEqual(body.reference_images, ['https://cdn.test/actor.png'])
  assert.deepEqual(body.reference_audios, ['https://cdn.test/voice.wav'])
  assert.equal(body.input_reference, undefined)
  assert.equal(body.image_end, undefined)
}
assert.equal((await submit({ ...base, references: [] }, 'custom', { protocol: 'video-808relay' })).body.mode, undefined)
assert.equal((await submit(frames, 'custom', { protocol: 'video-808relay' })).body.mode, undefined)
assert.equal((await submit({ ...multimodalWithVoice, references: multimodalWithVoice.references.slice(0, 1) }, 'custom', { protocol: 'video-808relay' })).body.mode, undefined)
const referenceImage = multimodalWithVoice.references[0]
const referenceAudio = multimodalWithVoice.references[1]
const referenceVideo = { id: 'clip', type: 'video', source: 'url', url: 'https://cdn.test/clip.mp4', status: 'ready' }
const seedanceRouteCases = [
  ...Array.from({ length: 8 }, (_, mask) => {
    const references = [referenceImage, referenceVideo, referenceAudio].filter((_, index) => mask & (1 << index))
    return ['reference-to-video', references, references.length ? 'reference-to-video' : 'text-to-video']
  }),
  ['reference-to-video', [referenceImage, { ...referenceImage, id: 'second-image', role: 'last_frame' }], 'reference-to-video'],
  ['first-last-frame', [referenceImage], 'image-to-video'],
  ['first-last-frame', frames.references, 'start-end-to-video'],
]
const seedanceRouteChannels = [
  { protocol: 'video-808relay' },
  { protocol: 'video-api', baseURL: 'https://api.808relay.com' },
  { protocol: 'video-api', baseURL: 'https://va.808relay.com' },
  { protocol: 'video-api', presetId: 'video-808relay' },
]
const seedanceRouteModelIds = [...new Set([...public808ModelIds.seedanceModelIds, 'sd2-5', 'S-2.5', 'provider/SD2_5-fast'])]
let auditedSeedanceRoutes = 0
for (const modelId of seedanceRouteModelIds) {
  for (const routeChannel of seedanceRouteChannels) {
    for (const [capability, references, expectedMode] of seedanceRouteCases) {
      requests.length = 0
      const audioOnly = references.length > 0 && references.every((reference) => reference.type === 'audio')
      if (audioOnly && officialMediaProfile(modelId)?.id === 'seedance-2.0') {
        await assert.rejects(() => submitGenerationTask({
          variant: 'video', model: { ...model, id: modelId },
          channel: { ...channel, ...routeChannel, modelIds: [modelId] },
          config: { ...base, model: modelId, capability, references, resolution: '720p', aspectRatio: '9:16' },
        }), /参考音频必须同时提供参考图片或参考视频/, `${modelId} (${routeChannel.protocol}) must reject audio-only input`)
        continue
      }
      await submitGenerationTask({
        variant: 'video', model: { ...model, id: modelId },
        channel: { ...channel, ...routeChannel, modelIds: [modelId] },
        config: { ...base, model: modelId, capability, references, resolution: '720p', aspectRatio: '9:16' },
      })
      const body = JSON.parse(requests.find(request => request.url.endsWith('/v1/videos')).body)
      assert.equal(body.model, modelId, 'keep the user-selected model alias')
      assert.equal(body.mode, supplied808Contracts.fieldSelectedModels.includes(modelId) ? undefined : expectedMode, `${modelId} uses its documented route`)
      const urlFields = supplied808Contracts.urlArrayModels.includes(modelId)
      assert.equal(body.omni_reference_task_type, undefined, '808 docs do not define official subtask passthrough')
      for (const field of urlFields ? ['reference_images', 'reference_videos', 'reference_audios'] : ['image_urls', 'video_urls', 'audio_urls']) {
        assert.equal(body[field], undefined, 'do not submit duplicate media aliases')
      }
      if (capability === 'reference-to-video') {
        assert.equal(body.input_reference, undefined)
        assert.equal(body.image_end, undefined)
        assert.deepEqual(body[urlFields ? 'image_urls' : 'reference_images'], references.some(reference => reference.type === 'image') ? references.filter(reference => reference.type === 'image').map(reference => reference.url) : undefined)
        assert.deepEqual(body[urlFields ? 'audio_urls' : 'reference_audios'], references.some(reference => reference.type === 'audio') ? references.filter(reference => reference.type === 'audio').map(reference => reference.url) : undefined)
        assert.deepEqual(body[urlFields ? 'video_urls' : 'reference_videos'], references.some(reference => reference.type === 'video') ? references.filter(reference => reference.type === 'video').map(reference => reference.url) : undefined)
      } else {
        assert.equal(body.input_reference, references[0].url)
        assert.equal(body.image_end, references[1]?.url)
        assert.equal(body.reference_images, undefined)
      }
      auditedSeedanceRoutes++
    }
  }
}
for (const modelId of [...public808ModelIds.nonSeedanceModelIds, ...kacangModels.map(item => item.id), ...seedanceRouteModelIds]) {
  for (const [capability, references] of seedanceRouteCases) {
    for (const protocol of ['video-kacang', 'openai-images', 'google-images']) {
      assert.equal(videoRequestMode({ ...channel, protocol, baseURL: 'https://api.808relay.com' }, modelId, { ...base, capability, references }), undefined, 'explicit other protocols must not inherit 808 modes from the host')
    }
    assert.equal(videoRequestMode(channel, modelId, { ...base, capability, references }), undefined, 'generic video channels must not inherit 808 modes')
  }
}
for (const modelId of public808ModelIds.nonSeedanceModelIds) {
  for (const routeChannel of seedanceRouteChannels) {
    for (const [capability, references] of seedanceRouteCases) {
      assert.equal(videoRequestMode({ ...channel, ...routeChannel }, modelId, { ...base, capability, references }), undefined, `${modelId} must not receive Seedance mode values`)
    }
  }
}
console.log(`Seedance mode contracts: ${public808ModelIds.seedanceModelIds.length} public IDs plus aliases, ${auditedSeedanceRoutes} request routes and cross-protocol isolation passed`)
for (const references of [
  [referenceImage],
  [referenceImage, { ...referenceImage, id: 'second-image', role: 'last_frame', url: 'https://cdn.test/second.png' }],
  [referenceVideo],
  [referenceAudio],
  [referenceImage, referenceVideo],
  [referenceVideo, referenceAudio],
  [referenceImage, referenceVideo, referenceAudio],
]) {
  const { body } = await submit({ ...base, capability: 'reference-to-video', prompt: '把参考图作为起始画面，随后镜头推进', references }, 'custom', { protocol: 'video-808relay' })
  assert.equal(body.mode, undefined, 'documented Pro route infers reference mode from reference fields')
  assert.equal(body.input_reference, undefined)
  assert.equal(body.image_end, undefined)
  for (const [type, field] of [['image', 'reference_images'], ['video', 'reference_videos'], ['audio', 'reference_audios']]) {
    const urls = references.filter(reference => reference.type === type).map(reference => reference.url)
    assert.deepEqual(body[field], urls.length ? urls : undefined)
  }
}
const singleFrameRequest = await submit({ ...base, capability: 'first-last-frame', references: [referenceImage] }, 'custom', { protocol: 'video-808relay' })
assert.equal(singleFrameRequest.body.mode, undefined, 'documented Pro route infers frame mode from frame fields')
assert.equal(singleFrameRequest.body.input_reference, referenceImage.url)
assert.equal(singleFrameRequest.body.image_end, undefined)
assert.equal(singleFrameRequest.body.reference_images, undefined)
for (const references of [[], [referenceAudio], [referenceImage, referenceAudio], [referenceImage, referenceVideo], [{ ...referenceImage, role: 'last_frame' }]]) {
  await assert.rejects(() => submit({ ...base, capability: 'first-last-frame', references }, 'custom', { protocol: 'video-808relay' }), /validation:/)
  assert.equal(requests.length, 0, 'invalid frame inputs fail locally instead of rerouting to multimodal')
}
assert.equal((await submit(multimodalWithVoice, 'custom', { protocol: 'video-kacang', baseURL: 'https://api.808relay.com' })).body.mode, undefined)
assert.equal((await submit(multimodalWithVoice)).body.mode, undefined)
for (const role of ['first_frame', 'last_frame']) {
  const { body } = await submit({ ...multimodalWithVoice, references: multimodalWithVoice.references.map(reference => ({ ...reference, role })) })
  assert.equal(body.input_reference, undefined)
  assert.equal(body.image_end, undefined)
  assert.deepEqual(body.reference_audios, ['https://cdn.test/voice.wav'])
}
let auditedRequests = 0
let auditedFrameRoutes = 0
for (const [catalog, providerProtocol] of [[models, 'video-808relay'], [kacangModels, 'video-kacang']]) {
  for (const selectedModel of catalog) {
    const acceptedTypes = videoInputTypes(selectedModel, 'reference-to-video')
    const availableReferences = [referenceImage, referenceVideo, referenceAudio].filter(reference => acceptedTypes.includes(reference.type))
    for (const references of [[], ...availableReferences.map(reference => [reference]), availableReferences]) {
      requests.length = 0
      const routedContract = providerProtocol === 'video-kacang'
        ? resolveKacangModel(channel, selectedModel.id, providerProtocol)?.videoRequestContract || selectedModel.videoRequestContract
        : selectedModel.videoRequestContract
      const submission = submitGenerationTask({
        variant: 'video', model: selectedModel,
        channel: { ...channel, protocol: providerProtocol },
        config: { ...base, model: selectedModel.id, capability: 'reference-to-video', generateAudio: false,
          seconds: selectedModel.defaultDuration || selectedModel.allowedDurations?.[0] || selectedModel.minDuration || 5,
          resolution: selectedModel.resolutions?.[0], aspectRatio: selectedModel.aspectRatios?.[0], references },
      })
      if (selectedModel.id === 'gemini-omni-1.1' && references.length === 1 && references[0].type === 'video') {
        await assert.rejects(submission, /参考视频必须同时提供首帧或参考图片/)
        assert.equal(requests.length, 0)
        continue
      }
      if (references.length > 0 && references.every((reference) => reference.type === 'audio') && officialMediaProfile(selectedModel.id)?.id === 'seedance-2.0') {
        await assert.rejects(submission, /参考音频必须同时提供参考图片或参考视频|至少需要.*参考图片/)
        assert.equal(requests.length, 0)
        continue
      }
      if (routedContract.minReferenceImages && !references.some(reference => reference.type === 'image')) {
        await assert.rejects(submission, /至少需要.*参考图片/)
        assert.equal(requests.length, 0)
        continue
      }
      if (references.some(reference => !routedContract[`${reference.type}ReferencesField`])) {
        await assert.rejects(submission, /请求字段/)
        assert.equal(requests.length, 0)
        continue
      }
      await submission
      const body = JSON.parse(requests.find(request => request.url.endsWith('/v1/videos')).body)
      const contract = routedContract
      if (contract.firstFrameField) assert.equal(body[contract.firstFrameField], undefined)
      if (contract.lastFrameField) assert.equal(body[contract.lastFrameField], undefined)
      for (const [type, field] of [['image', contract.imageReferencesField], ['video', contract.videoReferencesField], ['audio', contract.audioReferencesField]]) {
        const urls = references.filter(reference => reference.type === type).map(reference => reference.url)
        if (field) assert.deepEqual(body[field], urls.length ? urls : undefined)
      }
      if (providerProtocol === 'video-kacang') assert.equal(body.mode, undefined)
      auditedRequests++
    }
    if (videoModesForModel(selectedModel).includes('first-last-frame')) {
      requests.length = 0
      const frameSubmission = submitGenerationTask({
        variant: 'video', model: selectedModel, channel: { ...channel, protocol: providerProtocol },
        config: { ...base, capability: 'first-last-frame', generateAudio: false,
          seconds: selectedModel.defaultDuration || selectedModel.allowedDurations?.[0] || selectedModel.minDuration || 5,
          resolution: selectedModel.resolutions?.[0], aspectRatio: selectedModel.aspectRatios?.[0], references: frames.references },
      })
      const contract = selectedModel.videoRequestContract
      if (!contract.firstFrameField || !contract.lastFrameField) {
        await assert.rejects(frameSubmission, /validation:.*(?:请求字段|至少需要.*参考图片)/)
        assert.equal(requests.length, 0)
      } else {
        await frameSubmission
        const body = JSON.parse(requests.find(request => request.url.endsWith('/v1/videos')).body)
        assert.equal(body[contract.firstFrameField], frames.references[0].url)
        assert.equal(body[contract.lastFrameField], frames.references[1].url)
        assert.equal(body[contract.imageReferencesField], undefined)
        assert.equal(body[contract.audioReferencesField], undefined)
      }
      auditedFrameRoutes++
    }
  }
}
requests.length = 0
await assert.rejects(() => submitGenerationTask({
  variant: 'video', model: kacangModels.find(item => item.id === 'minimax_h3'), channel: { ...channel, protocol: 'video-kacang' },
  config: { ...base, resolution: '768', capability: 'first-last-frame', generateAudio: false, references: [{ ...referenceImage, source: 'local', resourceId: 'sha256-frame', url: undefined }] },
}), /validation:.*(?:首帧.*请求字段|尚未配置.*首尾帧能力)/)
assert.equal(requests.length, 0, 'missing provider frame contract fails before uploading local media')
console.log(`Cross-channel video contracts: ${models.length + kacangModels.length} catalog models, ${auditedRequests} reference requests and ${auditedFrameRoutes} frame routes passed`)
async function submitKacang(modelId, overrides = {}, staleModel = {}) {
  const selectedModel = kacangModels.find(item => item.id === modelId) || resolveKacangModel({ ...channel, protocol: 'video-kacang' }, modelId)
  requests.length = 0
  await submitGenerationTask({
    variant: 'video', model: { ...selectedModel, ...staleModel },
    channel: { ...channel, protocol: 'video-kacang' },
    config: { ...base, model: modelId, capability: 'reference-to-video', generateAudio: false,
      seconds: selectedModel.defaultDuration, resolution: selectedModel.resolutions[0],
      aspectRatio: '16:9', references: [referenceImage], ...overrides },
  })
  return JSON.parse(requests.find(request => request.url.endsWith('/v1/videos')).body)
}
const grokReference = await submitKacang('grok-imagine-video')
assert.deepEqual(grokReference.images, [referenceImage.url])
assert.equal(grokReference.image, undefined, 'a single multimodal image must never become a Grok first frame')
const grokFrame = await submitKacang('grok-imagine-video', { capability: 'first-last-frame' })
assert.equal(grokFrame.image, referenceImage.url)
assert.equal(grokFrame.images, undefined)
const h3Reference = await submitKacang('minimax_h3', {}, { videoRequestContract: { imageReferencesField: 'input_reference' } })
assert.deepEqual(h3Reference.reference_images, [referenceImage.url], 'stale H3 mappings are repaired on submission')
assert.equal(h3Reference.input_reference, undefined)
for (const [modelId, config, expected] of [
  ['doubao-seedance-2.0', { capability: 'first-last-frame' }, /首帧和一张尾帧/],
  ['S-2.0mini-线路三', { references: [referenceVideo] }, /不支持这些素材类型/],
  ['S-2.0mini-线路三', { resolution: '720p', seconds: 13 }, /最长 12 秒/],
  ['S-2.0-933-线路六', { references: [] }, /至少需要 1 张参考图片/],
  ['S-2.0-933-线路六', { seconds: 10 }, /只能为 15 秒/],
  ['S-2.0-933-线路六', { prompt: '文'.repeat(5001) }, /最多 5000/],
  ['S-2.5-九图-线路三', { references: Array.from({ length: 10 }, (_, index) => ({ ...referenceImage, id: `ref-${index}` })) }, /最多支持 9/],
  ['grok-imagine-video-1.5', { resolution: '1080p' }, /参考图模式仅支持/],
  ['grok-imagine-video', { capability: 'first-last-frame', references: frames.references }, /尾帧.*请求字段/],
]) {
  await assert.rejects(() => submitKacang(modelId, config), expected)
  assert.equal(requests.length, 0, `${modelId} rejects invalid input before uploads or task creation`)
}
const s25_301010Body = await submitKacang('S-2.5-301010-内置过脸', {
  seconds: 30,
  resolution: '720p',
  aspectRatio: '9:16',
  references: [referenceImage, referenceVideo, referenceAudio],
})
assert.equal(s25_301010Body.duration_seconds, 30)
assert.equal(s25_301010Body.resolution, '720p')
assert.equal(s25_301010Body.aspect_ratio, '9:16')
assert.deepEqual(s25_301010Body.reference_videos, [referenceVideo.url])
assert.deepEqual(s25_301010Body.reference_images, [referenceImage.url])
assert.deepEqual(s25_301010Body.reference_audios, [referenceAudio.url])
const s25_301010References = [
  ...Array.from({ length: 30 }, (_, index) => ({ ...referenceImage, id: `s25-301010-image-${index}` })),
  ...Array.from({ length: 10 }, (_, index) => ({ ...referenceAudio, id: `s25-301010-audio-${index}` })),
  { ...referenceVideo, id: 's25-301010-video' },
]
await assert.rejects(() => submitKacang('S-2.5-301010-内置过脸', { references: s25_301010References }), /最多支持 40 个参考素材/)
assert.equal(requests.length, 0, 'S-2.5 301010 rejects more than 40 mixed references before uploads or task creation')
await assert.rejects(() => submitKacang('S-2.5-301010-25 秒-线路三', { seconds: 26 }), /4-25 秒/)
const public301010Body = await submitKacang('S-2.5-301010-25 秒-线路三', { seconds: 25, references: [referenceImage, referenceAudio] })
assert.equal(public301010Body.duration_seconds, 25)
assert.deepEqual(public301010Body.reference_images, [referenceImage.url])
assert.deepEqual(public301010Body.reference_audios, [referenceAudio.url])
assert.equal(public301010Body.reference_videos, undefined, 'the public 301010 catalog entry keeps its original no-video-reference contract')
await submitKacang('S-2.0mini-线路三', { resolution: '720p', seconds: 12 })
await submitKacang('S-2.0mini-线路三', { resolution: '480p', seconds: 15 })
await submitKacang('doubao-seedance-2.0', { capability: 'first-last-frame', references: frames.references })
const h3Mixed = await submitKacang('minimax_h3', { references: [referenceImage, referenceVideo, referenceAudio] })
assert.deepEqual(h3Mixed.reference_images, [referenceImage.url])
assert.deepEqual(h3Mixed.reference_videos, [referenceVideo.url])
assert.deepEqual(h3Mixed.reference_video_durations, [4], 'MiniMax H3 sends one valid duration for every reference video')
assert.deepEqual(h3Mixed.reference_audios, [referenceAudio.url])
assert.equal(h3Mixed.content, undefined, 'native MiniMax content is not a Kacang wire field')
async function submitRenamedModel(modelId, routeChannel, overrides = {}) {
  requests.length = 0
  await submitGenerationTask({
    variant: 'video', model: { ...model, id: modelId, videoRequestContract: { ...model.videoRequestContract, imageReferencesField: 'stale_images', firstFrameField: 'stale_first_frame' } },
    channel: { ...channel, ...routeChannel, modelIds: [modelId] },
    config: { ...base, model: modelId, capability: 'reference-to-video', resolution: '720p', seconds: 5, aspectRatio: '16:9', generateAudio: false, references: [referenceImage, referenceVideo, referenceAudio], ...overrides },
  })
  return JSON.parse(requests.find(request => request.url.endsWith('/v1/videos')).body)
}
const renamedSeedanceIds = ['供应商/sd2-5-720p-新名称', '供应商-Seedance v2.0 Pro-新名称', '镜像/S-满血2.0-新线路', '【新名称】ＳＤ２－５－７２０Ｐ', 'S20', 'S25-720', 'SD25-1080', 'doubao2.5', 's2-720', 'sd2-1080']
const renamedChannelCases = [
  ...seedanceRouteChannels.map(routeChannel => [routeChannel, '808relay']),
  [{ protocol: 'video-kacang' }, 'kacang'],
  [{ protocol: 'video-api', baseURL: 'https://newapi.prompt-hubs.com/v1' }, 'kacang'],
  [{ protocol: 'video-api', presetId: 'video-kacang' }, 'kacang'],
]
let renamedRequests = 0
for (const modelId of renamedSeedanceIds) {
  for (const [routeChannel, provider] of renamedChannelCases) {
    for (const [capability, references, mode] of seedanceRouteCases) {
      const audioOnly = references.length > 0 && references.every((reference) => reference.type === 'audio')
      if (audioOnly && officialMediaProfile(modelId)?.id === 'seedance-2.0') {
        await assert.rejects(() => submitRenamedModel(modelId, routeChannel, { capability, references }), /参考音频必须同时提供参考图片或参考视频|至少需要.*参考图片/)
        assert.equal(requests.length, 0, 'renamed Seedance 2.0 aliases cannot bypass the audio-only restriction')
        continue
      }
      if (provider === 'kacang' && capability === 'first-last-frame') {
        await assert.rejects(() => submitRenamedModel(modelId, routeChannel, { capability, references }), /请求字段/)
        assert.equal(requests.length, 0, 'Kacang S aliases cannot borrow 808 frame fields from stale model metadata')
        continue
      }
      const body = await submitRenamedModel(modelId, routeChannel, { capability, references })
      assert.equal(body.model, modelId)
      assert.equal(body.mode, provider === '808relay' ? mode : undefined)
      assert.equal(body[provider === '808relay' ? 'seconds' : 'duration_seconds'], 5)
      assert.equal(body[provider === '808relay' ? 'duration_seconds' : 'seconds'], undefined)
      assert.equal(body.stale_images, undefined)
      assert.equal(body.stale_first_frame, undefined)
      if (capability === 'reference-to-video') {
        assert.equal(body.input_reference, undefined)
        assert.equal(body.start_frame, undefined)
        for (const [type, field] of [['image', 'reference_images'], ['video', 'reference_videos'], ['audio', 'reference_audios']]) {
          const urls = references.filter(reference => reference.type === type).map(reference => reference.url)
          assert.deepEqual(body[field], urls.length ? urls : undefined)
        }
      } else {
        assert.equal(body.input_reference, references[0].url)
        assert.equal(body.image_end, references[1]?.url)
      }
      renamedRequests++
    }
  }
}
const kacangRoute = { protocol: 'video-kacang' }
const renamedDoubao = '新供应商/doubao_seedance_2_5-高速'
const renamedDoubaoFrames = await submitRenamedModel(renamedDoubao, kacangRoute, { capability: 'first-last-frame', references: frames.references })
assert.equal(renamedDoubaoFrames.model, renamedDoubao)
assert.equal(renamedDoubaoFrames.start_frame, frames.references[0].url)
assert.equal(renamedDoubaoFrames.end_frame, frames.references[1].url)
assert.equal(renamedDoubaoFrames.input_reference, undefined)
assert.equal(renamedDoubaoFrames.mode, undefined)
await assert.rejects(() => submitRenamedModel(renamedDoubao, kacangRoute, { capability: 'first-last-frame', references: [referenceImage] }), /首帧和一张尾帧/)
assert.equal(requests.length, 0)
const renamedH3 = await submitRenamedModel('新供应商/H3-高速', kacangRoute, { resolution: '768' })
assert.deepEqual(renamedH3.reference_images, [referenceImage.url])
assert.deepEqual(renamedH3.reference_videos, [referenceVideo.url])
assert.deepEqual(renamedH3.reference_video_durations, [4])
assert.deepEqual(renamedH3.reference_audios, [referenceAudio.url])
assert.equal(renamedH3.mode, undefined)
const renamedGrok = await submitRenamedModel('新供应商/grok-imagine-video-1.5-高速', kacangRoute, { references: [referenceImage] })
assert.deepEqual(renamedGrok.images, [referenceImage.url])
assert.equal(renamedGrok.image, undefined)
const renamedWan = await submitRenamedModel('新供应商/万相3.0-高速', { protocol: 'video-808relay' })
assert.deepEqual(renamedWan.image_urls, [referenceImage.url])
assert.deepEqual(renamedWan.video_urls, [referenceVideo.url])
assert.deepEqual(renamedWan.audio_urls, [referenceAudio.url])
assert.equal(renamedWan.mode, undefined)
await assert.rejects(() => submitRenamedModel('新渠道/S-2.0mini-线路三-镜像', kacangRoute, { references: [referenceImage], resolution: '720p', seconds: 13 }), /最长 12 秒/)
assert.equal(requests.length, 0, 'decorated known line IDs retain their channel-specific restrictions')
console.log(`Renamed models: ${renamedRequests} cross-provider requests, family-specific fields and frame isolation passed`)
for (const unrelatedModel of [models.find((item) => item.id === 'wan-3'), models.find((item) => item.id === 'gemini-omni-1.1')]) {
  requests.length = 0
  await submitGenerationTask({ variant: 'video', model: unrelatedModel, channel: { ...channel, protocol: 'video-808relay' }, config: { ...base, model: unrelatedModel.id, references: [] } })
  assert.equal(JSON.parse(requests[0].body).mode, undefined, 'other 808 models keep their existing contracts')
}
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
await assert.rejects(() => submit(localConfig, 'inline'), /自定义媒体存储/)
assert.equal(requests.length, 0, 'missing storage blocks local media before generation')
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
  await submit(localConfig, legacyTransport, { mediaUploadPath: '/presign' })
  assert.equal(requests[0].url, 'https://storage.test/upload', 'retired transports use only configured custom storage')
}
storageSettings.baseURL = ''
await submit({ ...localConfig, capability: 'first-last-frame' }, 'custom', { mediaUploadURL: 'https://storage.test/upload' })
assert.equal(requests.length, 2, 'single first frame is accepted under official input rules')
assert.equal((await submit({ ...base, capability: 'image-to-video', references: merged.references.slice(0, 2) })).body.reference_images.length, 2, 'legacy image mode merges into multimodal without a single-image constraint')
const mixedInput = await submit({ ...base, references: [...localConfig.references, merged.references[1]] }, 'custom', { mediaUploadURL: 'https://storage.test/upload' })
assert.equal(mixedInput.body.reference_images[0], 'https://cdn.test/uploaded.png')
assert.equal(mixedInput.body.reference_images[1], 'https://cdn.test/last.png')
assert.equal(requests.length, 2, 'only the local reference uploads; existing HTTPS references are unchanged')
rejectUpload = true
await assert.rejects(() => submit(localConfig, 'custom', { mediaUploadURL: 'https://storage.test/upload' }), /preparation/)
assert.equal(requests.length, 1, 'failed preparation never falls back or creates a task')
rejectUpload = false
requests.length = 0
await assert.rejects(() => testGenerationMediaUpload({ ...channel, mediaTransport: 'inline' }), /自定义媒体存储/)
assert.equal(requests.length, 0, 'missing storage cannot claim connectivity')
assert.equal(mediaTransportStatus(undefined).canTestUpload, false)
assert.equal(mediaTransportStatus('presign').canTestUpload, false)
assert.equal(mediaTransportStatus('multipart', true).canTestUpload, true)
assert.equal(mediaTransportStatus('custom', false).canTestUpload, false)
assert.equal(mediaTransportStatus('custom', true).canTestUpload, true)
await testGenerationMediaUpload({ ...channel, mediaTransport: 'custom', mediaUploadURL: 'https://storage.test/upload' })
assert.equal(requests.length, 1, 'upload verification calls only custom storage, not a generation endpoint')
assert.equal(requests[0].url, 'https://storage.test/upload')
assert.ok(requests[0].body instanceof FormData)
const normalizeChannel = evaluate('import { is808VideoChannel, normalizeMediaTransport, generationProtocolForChannel, generationPresetForId, isVideoGenerationProtocol, modelsForGenerationProtocol, generationSecretName, generationMediaUploadSecretName, GENERATION_PROTOCOL_LABELS } from "bindings";\nexport ' + declarations('stores/use-generation-store.ts', ['normalizeChannel']), () => ({
  ...generationStore, is808VideoChannel: load('lib/generation/video-catalog.ts').is808VideoChannel, normalizeMediaTransport, generationPresetForId: () => undefined, isVideoGenerationProtocol: (value) => value === 'video-api', modelsForGenerationProtocol: () => models, GENERATION_PROTOCOL_LABELS: { 'video-api': '视频 API' },
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
async function openChannel(transport, extra = {}) {
  await act(async () => {
    useGenerationStore.setState({ channels: [{ ...channel, mediaTransport: transport, ...extra }] })
    root.render(React.createElement(GenerationChannelsManager, { embedded: true }))
  })
  await click(textButton('编辑'))
}
for (const legacyTransport of [undefined, 'auto', 'public-url', 'presign', 'multipart']) {
  await openChannel(legacyTransport, { mediaUploadPath: '/presign' })
  assert.deepEqual([...deliverySelect().options].map(option => option.value), ['custom'], 'only custom storage appears in the compact selector')
  assert.equal(protocolSelect(), null)
  assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /预签名|multipart|供应商上传/)
  assert.equal(textButton('验证上传').disabled, true)
  const previousSaveCount = savedChannels.length
  const previousMessageCount = messages.length
  await click(textButton('保存'))
  assert.equal(messages.length, previousMessageCount, 'missing storage does not show a save warning')
  assert.equal(savedChannels.length, previousSaveCount + 1)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(document.body.textContent, /上传服务未连接/)
}
await openChannel(undefined)
assert.equal(protocolSelect(), null)
await act(async () => mediaStore.setState({ baseURL: 'https://storage.test' }))
assert.ok(textButton('验证上传'), 'configured custom storage enables only an explicit upload test')
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'custom')
assert.equal(savedChannels.at(-1).adapters[0].mediaTransport, 'custom')
await openChannel('inline')
assert.equal(deliverySelect().value, 'custom')
assert.equal(protocolSelect(), null)
assert.ok(textButton('验证上传'))
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'custom')
await act(async () => mediaStore.setState({ baseURL: '' }))
await openChannel('custom', { mediaUploadURL: 'https://legacy-storage.test/upload' })
assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /已有 HTTPS 素材随请求直接引用|仅验证上传接口/)
assert.ok(textButton('验证上传'))
await click(textButton('保存'))
assert.equal(savedChannels.at(-1).mediaTransport, 'custom')
await act(async () => root.render(React.createElement(GenerationChannelsManager, { embedded: true, openNewRequest: 1 })))
assert.ok(document.querySelector('[role="dialog"]'))
assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /渠道预设/, 'new generation channels do not expose a separate preset menu')
await click(textButton('关闭'))
await act(async () => root.unmount())
dom.window.close()
console.log('generation inputs, video modes, audio parameter and production transport contracts: PASS')
