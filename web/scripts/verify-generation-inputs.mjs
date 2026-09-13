import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
function load(relativePath) {
  const path = resolve(sourceRoot, relativePath)
  if (modules.has(path)) return modules.get(path)
  const result = evaluate(readFileSync(path, 'utf8'), (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2) + '.ts')
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier + '.ts'))
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
let visibleModels = [model]
const getModels = () => visibleModels
const useGenerationStore = create(() => ({ channels: [channel], initializeDefaultChannels: () => {}, getModels, getChannel: () => channel }))
const generationStore = {
  useGenerationStore,
  generationAdapterForModel: (value) => value.adapters?.[0],
  generationAdapterForConfig: (value) => value.adapters?.[0],
  generationChannelSupportsVariant: () => true,
  generationChannelUsesModelInference: () => false,
  generationProtocolForChannel: (value) => value.protocol,
  isVideoGenerationProtocol: (value) => value === 'video-api' || value === 'video-808relay' || value === 'video-kacang',
  generationVideoRequestContractForModel: (_channel, selectedModel) => selectedModel?.videoRequestContract || ({ createPath: '/v1/videos', pollPath: '/v1/videos/{id}', contentPath: '/v1/videos/{id}/content', durationField: 'seconds', resolutionField: 'resolution', aspectRatioField: 'aspect_ratio', firstFrameField: 'input_reference', lastFrameField: 'image_end', imageReferencesField: 'reference_images', videoReferencesField: 'reference_videos', audioReferencesField: 'reference_audios', generateAudioField: 'sound_effects' }),
  generationSecretName: () => 'mock-secret',
  generationMediaUploadSecretName: () => 'mock-upload-secret',
}
mocks.set('@/stores/use-generation-store', generationStore)
mocks.set('@/lib/flow/ai-context', evaluate(declarations('lib/flow/ai-context.ts', ['uniqueText', 'parsedContentText', 'textForAIContextNode'])))
const deletedResources = []
mocks.set('@/lib/resource-storage', {
  loadLocalResourceUrl: async () => undefined,
  loadLocalResourceBlob: async () => new Blob(['fixture'], { type: 'image/png' }),
  revokeManagedObjectUrl: () => {},
  deleteLocalResource: async (resourceId) => deletedResources.push(resourceId),
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
const { withGenerationUpstreamInputs } = load('lib/generation/inputs.ts')
const { normalizeVideoModeConfig, videoModesForModel, videoReferenceError, videoInputTypes } = load('lib/generation/video-mode.ts')
const { submitGenerationTask, testGenerationMediaUpload } = load('lib/generation/client.ts')
const { mediaTransportStatus, normalizeMediaTransport } = load('lib/generation/media-policy.ts')
const base = { ...createGenerationVariantConfig('video'), channelId: channel.id, model: model.id, prompt: 'camera move' }
const imageNode = (id, url) => ({ id, type: 'content', position: { x: 0, y: 0 }, data: { label: id, category: 'image', source: null, payload: { kind: 'image', resources: [{ resource: { url, resourceId: id } }] } } })
const nodes = [imageNode('first', 'https://cdn.test/first.png'), imageNode('last', 'https://cdn.test/last.png'), { id: 'video', type: 'content', data: { category: 'video', source: null, payload: { kind: 'video', playback: 'video', url: 'https://cdn.test/video.mp4' } } }, { id: 'voice', type: 'content', data: { source: { kind: 'file', resourceId: 'voice-resource', mimeType: 'audio/wav' } } }]
const edges = nodes.map((node) => ({ id: node.id, source: node.id, target: 'request' }))
const merged = withGenerationUpstreamInputs('request', 'video', base, nodes, edges)
assert.deepEqual(merged.references.map((reference) => reference.type), ['image', 'image', 'video', 'audio'])
assert.ok(merged.references.every((reference) => reference.upstreamNodeId))
assert.equal(base.references.length, 0, 'upstream references do not become owned files')
assert.equal(withGenerationUpstreamInputs('request', 'video', base, nodes, edges.slice(1)).references.length, 3)
assert.equal(withGenerationUpstreamInputs('request', 'video', base, nodes.map((node) => node.id === 'first' ? { ...node, data: { ...node.data, disabled: true } } : node), edges).references.length, 3)
assert.equal(withGenerationUpstreamInputs('request', 'video', base, nodes, [...edges, edges[0]]).references.length, 4, 'duplicate edges do not duplicate files')
const localCopy = { ...merged.references[0], id: 'local', upstreamNodeId: undefined }
assert.equal(withGenerationUpstreamInputs('request', 'video', { ...base, references: [localCopy] }, nodes, edges).references.length, 4, 'local/upstream assets deduplicate by storage identity')
assert.equal(withGenerationUpstreamInputs('request', 'image', base, nodes, edges).capability, 'image-to-image')
const overrideConfig = { ...base, referenceOverrides: { [merged.references[0].id]: { excluded: true }, [merged.references[1].id]: { role: 'first_frame', order: -1 } } }
const overridden = withGenerationUpstreamInputs('request', 'video', overrideConfig, nodes, edges)
assert.equal(overridden.references.length, 3)
assert.equal(overridden.references[0].upstreamNodeId, 'last')
assert.equal(overridden.references[0].role, 'first_frame')
const requestNode = { id: 'upstream-request', type: 'request', data: { variant: 'image', label: 'Generated' } }
const generated = withGenerationUpstreamInputs('request', 'video', base, [requestNode], [{ source: requestNode.id, target: 'request' }], { [requestNode.id]: { kind: 'generation-result', task: { resultUrls: ['https://cdn.test/result.png'], resultResourceIds: ['result-resource'] } } })
assert.equal(generated.references[0].resourceId, 'result-resource', 'Flow results use the same live input resolver')
const transcript = withGenerationUpstreamInputs('request', 'video', base, nodes, edges, { video: { kind: 'video', playback: 'video', url: 'https://cdn.test/fresh.mp4', transcript: 'fresh transcript' } })
assert.match(transcript.prompt, /fresh transcript/)
assert.equal(transcript.references.find((reference) => reference.type === 'video').url, 'https://cdn.test/fresh.mp4')

const executorText = readFileSync(resolve(sourceRoot, 'lib/flow/executor.ts'), 'utf8')
const executorAst = ts.createSourceFile('executor.ts', executorText, ts.ScriptTarget.Latest, true)
const executorMethod = executorAst.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'FlowExecutor').members.find((member) => member.name?.getText(executorAst) === 'executeRequestNode')
const flowRequests = []
const executeRequestNode = evaluate('import { withGenerationUpstreamInputs, useGenerationStore, runGenerationBatch, runGenerationTask } from "bindings";\nexport ' + executorMethod.getText(executorAst).replace(/^private async executeRequestNode/, 'async function executeRequestNode'), () => ({
  withGenerationUpstreamInputs,
  useGenerationStore,
  ...load('lib/generation/batch.ts'),
  runGenerationTask: async (context) => { flowRequests.push(context); return { status: 'completed', resultUrls: ['https://cdn.test/output.mp4'] } },
})).executeRequestNode
const executableNode = { id: 'request', type: 'request', data: { variant: 'video', video: overrideConfig } }
await executeRequestNode.call({ nodes: [...nodes, executableNode], edges }, executableNode, {})
assert.deepEqual(flowRequests[0].config.references, overridden.references, 'Flow execution applies exactly the same references and overrides as the preview')

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
assert.equal(silentRequest.body.sound_effects, false)
assert.equal(silentRequest.body.no_music, undefined)
assert.equal((await submit({ ...base, generateAudio: true })).body.sound_effects, true)
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
requests.length = 0
await submitGenerationTask({ variant: 'video', model: { ...model, capabilities: ['text-to-video'] }, channel, config: base })
assert.equal(JSON.parse(requests[0].body).sound_effects, undefined, 'hidden unsupported audio parameters are not submitted')

const localConfig = { ...base, references: [{ ...localCopy, url: undefined, previewUrl: undefined }] }
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
const useFlowStore = create((set) => ({
  nodes: [], edges: [],
  updateNode: (id, updates) => set((state) => ({ nodes: state.nodes.map((node) => node.id === id ? { ...node, ...updates } : node) })),
}))
mocks.set('@/stores/use-flow-store', { useFlowStore })
mocks.set('@/lib/generation/client', { runGenerationTask: async () => ({ status: 'completed' }), cancelGenerationTask: async () => {} })
mocks.set('@/lib/generation/results', {})
mocks.set('./NodeChrome', { NodeDragGutters: () => null, NodeHandle: () => null, NodeHoverToolbar: () => null, NodeResizeArc: () => null })
const { RequestNode } = load('components/flow/nodes/RequestNode.tsx')
function Harness() {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === 'request'))
  return React.createElement(RequestNode, { ...node, selected: true })
}
const root = createRoot(document.getElementById('root'))
async function setConfig(config, inputNodes = [], inputEdges = []) {
  await act(async () => {
    useFlowStore.setState({ nodes: [...inputNodes, { id: 'request', type: 'request', data: { variant: 'video', video: config, tasks: { video: { status: 'idle' } } } }], edges: inputEdges })
    root.render(React.createElement(Harness))
  })
}
function button(label) { return document.querySelector(`button[aria-label="${label}"]`) }
async function click(element) { assert.ok(element); await act(async () => element.click()) }
async function setTextareaValue(text) {
  const textarea = document.querySelector('textarea')
  assert.ok(textarea)
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, text)
  textarea.setSelectionRange(text.length, text.length)
  await act(async () => textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
  return textarea
}
const mentionReferences = [
  { id: 'mention-image', type: 'image', label: '角色正面', fileName: 'actor.png', source: 'url', url: 'https://cdn.test/actor.png', previewUrl: 'https://cdn.test/actor.png', order: 0, status: 'ready' },
  { id: 'mention-video', type: 'video', label: '镜头节奏', fileName: 'camera.mp4', source: 'url', url: 'https://cdn.test/camera.mp4', previewUrl: 'https://cdn.test/camera.mp4', order: 1, status: 'ready' },
]
await setConfig({ ...base, prompt: '', references: mentionReferences })
let textarea = await setTextareaValue('参考 @')
assert.ok(document.querySelector('[role="listbox"][aria-label="插入参考素材"]'), 'typing @ opens the reference picker')
const mentionOptions = () => document.querySelectorAll('[role="listbox"][aria-label="插入参考素材"] [role="option"]')
assert.deepEqual([...mentionOptions()].map((option) => option.textContent.includes('角色正面')), [true, false])
await act(async () => textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
assert.equal(mentionOptions()[0].getAttribute('aria-selected'), 'false', 'arrow navigation moves the active option')
await act(async () => textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
assert.equal(useFlowStore.getState().nodes.find((node) => node.id === 'request').data.video.prompt, '参考 @Video1 ', 'keyboard selection inserts the selected token')
assert.equal(useFlowStore.getState().nodes.find((node) => node.id === 'request').data.video.promptMentions['mention-video'], '@Video1')
textarea = await setTextareaValue('使用 @Im')
assert.equal(mentionOptions().length, 1, 'typing after @ filters by token or filename')
await click(mentionOptions()[0])
assert.match(useFlowStore.getState().nodes.find((node) => node.id === 'request').data.video.prompt, /@Image1/)
requests.length = 0
const mentionConfig = useFlowStore.getState().nodes.find((node) => node.id === 'request').data.video
const mentionSubmission = await submitGenerationTask({ variant: 'video', model, channel, config: mentionConfig })
const mentionBody = JSON.parse(requests.find((request) => request.url.endsWith('/v1/videos')).body)
assert.match(mentionBody.prompt, /@Image1/, 'the generated request keeps the selected token in its prompt')
assert.deepEqual(mentionBody.reference_images, ['https://cdn.test/actor.png'], 'the selected token remains connected to the matching reference array')
assert.equal(mentionSubmission.taskId, 'mock-task')
await setConfig({ ...base, prompt: '参考 @Video1', references: mentionReferences })
await click(document.querySelector('button[aria-label="删除视频素材"]'))
assert.equal(useFlowStore.getState().nodes.find((node) => node.id === 'request').data.video.prompt, '参考 [已移除视频]', 'deleting a referenced asset leaves an explicit broken reference')
await setConfig({ ...base, capability: 'audio-reference' }, nodes.slice(0, 1), edges.slice(0, 1))
assert.equal(document.querySelectorAll('img').length, 1, 'connected assets render before Generate is clicked')
assert.deepEqual([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent), ['多模态', '首尾帧'])
assert.equal(document.querySelectorAll('input[aria-label="生成音频"]').length, 1)
assert.equal(document.querySelectorAll('label label').length, 0)
assert.equal(document.querySelectorAll('input[aria-label="不要音乐"]').length, 0)
await click(button('移除上游图片引用'))
assert.equal(document.querySelectorAll('img').length, 0)
assert.deepEqual(deletedResources, [], 'removing upstream references never releases upstream storage')
await click(button('恢复已移除的上游引用'))
assert.equal(document.querySelectorAll('img').length, 1)
await act(async () => useFlowStore.setState({ edges: [] }))
assert.equal(document.querySelectorAll('img').length, 0, 'disconnect updates the node immediately')
await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === '首尾帧'))
assert.ok(document.querySelector('label[aria-label="上传首帧素材"]'))
assert.ok(document.querySelector('label[aria-label="上传尾帧素材"]'))
assert.equal(document.querySelectorAll('input[type="file"]').length, 2)
assert.match(document.querySelector('textarea').placeholder, /两帧/)
assert.equal(button('生成').disabled, true)
await setConfig({ ...base, capability: 'first-last-frame' }, nodes.slice(0, 2), edges.slice(0, 2))
assert.equal(document.querySelectorAll('img').length, 2)
assert.equal(button('生成').disabled, false)
await click(document.querySelector('button[aria-label="设为首帧"]'))
assert.equal(withGenerationUpstreamInputs('request', 'video', useFlowStore.getState().nodes.at(-1).data.video, useFlowStore.getState().nodes, useFlowStore.getState().edges).references.find((reference) => reference.role === 'first_frame').upstreamNodeId, 'last')
await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === '多模态'))
assert.equal(document.querySelectorAll('input[type="file"]').length, 3)
assert.equal(document.querySelectorAll('img').length, 2, 'switching to multimodal keeps both images as references')
assert.equal(document.querySelector('label[aria-label="上传首帧素材"]'), null)
assert.equal(button('生成').disabled, false)
await setConfig(base)
assert.equal(button('生成').disabled, false, 'zero references remain valid in multimodal')
assert.equal(document.querySelectorAll('input[type="file"]').length, 3, 'text and reference generation use the same input area')
await setConfig({ ...base, capability: 'text-to-video', noMusic: true })
assert.equal(document.querySelector('input[aria-label="生成音频"]').checked, false)
await click(document.querySelector('input[aria-label="生成音频"]'))
assert.equal(useFlowStore.getState().nodes.at(-1).data.video.noMusic, undefined)
assert.equal(useFlowStore.getState().nodes.at(-1).data.video.generateAudio, true)
visibleModels = [{ ...model, capabilities: ['text-to-video', 'image-to-video'], inputTypes: ['image'], resolutions: ['720p'] }]
await act(async () => useGenerationStore.setState({ channels: [{ ...channel }] }))
assert.equal(document.querySelectorAll('[role="option"]').length, 1, 'editing channel metadata refreshes the cached model list')
assert.equal(document.querySelectorAll('input[aria-label="生成音频"]').length, 0)
generationStore.generationChannelUsesModelInference = () => true
visibleModels = [model, { id: 'unknown-video', name: 'Unknown Video', capabilities: ['text-to-video'], capabilitySource: 'inferred' }, { id: 'unknown-image', name: 'Unknown Image', capabilities: ['text-to-image'], capabilitySource: 'inferred' }]
await act(async () => useGenerationStore.setState({ channels: [{ ...channel }] }))
assert.match(document.body.textContent, /Unknown Video/)
assert.doesNotMatch(document.body.textContent, /Unknown Image/, 'dual-scope model lists do not promote inferred image models into the video entry')

const messages = []
const savedChannels = []
const mediaStore = create(() => ({ baseURL: '' }))
mocks.set('@/stores/use-media-storage-store', { useMediaStorageStore: mediaStore })
mocks.set('@/lib/app-dialog', { showMessage: (message) => messages.push(message), askConfirmation: async () => false })
mocks.set('@/components/layout/AppShell', { AppShell: ({ children }) => children })
mocks.set('@/components/ui/button', load('components/ui/button.tsx'))
mocks.set('@/components/ui/dialog', load('components/ui/dialog.tsx'))
mocks.set('@/lib/api/client', { AIClient: class {} })
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
const textButton = (label) => [...document.querySelectorAll('button')].find((element) => element.textContent === label)
const deliverySelect = () => document.querySelector('select[aria-label="本地素材传输方式"]')
const protocolSelect = () => document.querySelector('select[aria-label="上传协议"]')
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
console.log('generation inputs, live UI, video modes, audio parameter and production transport contracts: PASS')
