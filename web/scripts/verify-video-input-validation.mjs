import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { create } from 'zustand'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../src/', import.meta.url))
const modules = new Map()
const mocks = new Map()
function load(name) {
  const stem = resolve(root, name)
  const path = [stem, `${stem}.ts`, `${stem}/index.ts`].find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'))
  if (!path) throw new Error(`Missing module ${name}`)
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }
  modules.set(path, module)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  return module.exports
}

const graph = create((set) => ({
  currentDocument: null, isLocked: false, commitHistory() {},
  updateNode(id, patch) { set((state) => ({ currentDocument: { ...state.currentDocument, nodes: state.currentDocument.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) } })) },
}))
const runtime = create(() => ({ assets: {}, runs: {} }))
const blobs = new Map()
const released = []
let adaptationCalls = 0
let delay = 0
let sequence = 0
mocks.set('@/stores/graph-store', { useGraphStore: graph })
mocks.set('@/stores/runtime-store', { useRuntimeStore: runtime })
mocks.set('@/stores/use-generation-store', { useGenerationStore: { getState: () => ({ getModels: () => [{ id: request().video.model, capabilities: ['text-to-video', 'image-to-video', 'first-last-frame'], inputTypes: ['image', 'video', 'audio'] }] }) } })
mocks.set('@/runtime/asset-manager', { AssetManager: class {
  async getAsset(id) { return runtime.getState().assets[id] }
  async importAsset(blob) {
    const id = `asset-copy-${++sequence}`
    blobs.set(`sha256-copy-${sequence}`, blob)
    const asset = { id, hash: `copy-${sequence}`, mimeType: blob.type, size: blob.size }
    runtime.setState((state) => ({ assets: { ...state.assets, [id]: asset } }))
    return asset
  }
  async releaseAsset(id) { released.push(id); blobs.delete(id.replace('asset-', 'sha256-')) }
} })
mocks.set('@/lib/resource-storage', { loadLocalResourceBlob: async (id) => blobs.get(id), checksumBlob: async (blob) => `content-${blob.size}` })
mocks.set('@/storage/asset-store', { resourceIdForAsset: (id) => id.replace('asset-', 'sha256-') })
const rules = load('lib/generation/official-media-rules.ts')
mocks.set('@/lib/generation/media-inspection', { loadReferenceForInspection: async (reference) => new Blob([new Uint8Array(reference.size || 1000)], { type: 'image/png' }), prepareOfficialMediaInput: async ({ reference, modelId, adaptImages, signal, blob }) => {
  if (delay) await new Promise((done) => setTimeout(done, delay))
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
  const profile = rules.officialMediaProfile(modelId)
  if (!profile) return { configured: false, adapted: false, violations: [] }
  let metadata = { bytes: blob?.size || reference.size || 1000, format: blob?.type === 'image/webp' ? 'webp' : 'png', width: 1024, height: 1024, ...reference.metadata }
  let result = rules.validateMediaFile(profile, reference, metadata)
  let adapted = false
  if (result.violations.length && adaptImages && reference.type === 'image') {
    adaptationCalls++
    metadata = { ...metadata, bytes: 1000, format: 'webp' }
    result = rules.validateMediaFile(profile, reference, metadata)
    blob = new Blob(['compatible'], { type: 'image/webp' })
    adapted = true
  }
  return { configured: true, adapted, violations: result.violations, metadata, blob }
} })
mocks.set('./contents/request-generation', {
  resolveRequestGenerationInputs({ requestNodeId, config, nodes, edges }) {
    const connected = edges.filter((edge) => edge.target === requestNodeId).flatMap((edge) => {
      const node = nodes.find((node) => node.id === edge.source)
      return node?.references || node?.payload?.resources?.map(({ resource }) => ({ id: `upstream-${node.id}-image-${resource.resourceId || resource.url}`, upstreamNodeId: node.id, type: 'image', resourceId: resource.resourceId, url: resource.url, mimeType: resource.mimeType, size: blobs.get(resource.resourceId)?.size, order: 0 })) || []
    })
    const local = (config.referenceAssetIds || []).map((id) => ({ id, type: 'image', source: 'local', resourceId: id.replace('asset-', 'sha256-'), size: runtime.getState().assets[id]?.size, order: 0 }))
    const references = [...local, ...connected].filter((reference) => !config.referenceOverrides?.[reference.id]?.excluded).map((reference) => {
      const override = config.referenceOverrides?.[reference.id]
      return { ...reference, role: override?.role || reference.role }
    })
    return { references, prompt: config.prompt }
  },
  toLegacyVariantConfig: (_variant, config, references) => ({ ...config, references }),
})
const validation = load('canvas/video-input-validation.ts')
const { connectVideoInput, addVideoInputFile, installVideoInputValidation, useVideoInputFeedback, cancelVideoInputValidation } = validation
function request() { return graph.getState().currentDocument.nodes.find((node) => node.id === 'request') }
function reset({ model = 'wan-3', adapt = false, sizes = [21_000_000, 1000] } = {}) {
  blobs.clear()
  adaptationCalls = 0
  delay = 0
  useVideoInputFeedback.setState({ nodes: {} })
  graph.setState({ currentDocument: {
    id: `doc-${++sequence}`, nodes: [
      { id: 'request', kind: 'request', variant: 'video', position: { x: 800, y: 0 }, size: { width: 540, height: 430 }, video: { model, channelId: 'channel', prompt: 'test', autoAdaptImages: adapt }, image: { prompt: '' } },
      ...sizes.map((size, index) => ({ id: `source-${index}`, kind: 'content', category: 'image', position: { x: 0, y: index * 550 }, size: { width: 540, height: 430 }, references: [{ id: `ref-${index}`, upstreamNodeId: `source-${index}`, type: 'image', source: 'local', resourceId: `sha256-image-${index}`, size, order: index, fileName: `image-${index}.png` }] })),
    ], edges: [],
  } })
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
reset()
await connectVideoInput('source-0', 'request')
assert.equal(graph.getState().currentDocument.edges.length, 0)
assert.match(useVideoInputFeedback.getState().nodes.request.message, /20 MB/)
assert.equal(adaptationCalls, 0)
await connectVideoInput('source-1', 'request')
assert.equal(graph.getState().currentDocument.edges.length, 1)
reset({ adapt: true })
const original = JSON.stringify(graph.getState().currentDocument.nodes[1])
await connectVideoInput('source-0', 'request')
assert.equal(graph.getState().currentDocument.edges.length, 1)
assert.equal(adaptationCalls, 1)
const visibleCopy = graph.getState().currentDocument.nodes.find((node) => node.payload?.kind === 'image')
assert.ok(visibleCopy)
assert.equal(visibleCopy.payload.resources[0].resource.mimeType, 'image/webp')
assert.equal(graph.getState().currentDocument.edges[0].source, visibleCopy.id)
assert.ok(!Object.values(request().video.referenceOverrides).some((override) => override.compatibleCopy))
assert.equal(JSON.stringify(graph.getState().currentDocument.nodes[1]), original)
reset({ model: 'minimax-h3', adapt: true })
await connectVideoInput('source-0', 'request')
await connectVideoInput('source-1', 'request')
const uninstall = installVideoInputValidation()
await sleep(180)
graph.getState().updateNode('request', { video: { ...request().video, model: 'wan-3' } })
await sleep(350)
assert.equal(graph.getState().currentDocument.edges.length, 1)
assert.equal(graph.getState().currentDocument.edges[0].source, 'source-1')
assert.equal(adaptationCalls, 0, 'model change must not generate a compatible copy')
assert.match(useVideoInputFeedback.getState().nodes.request.message, /已断开/)
await connectVideoInput('source-0', 'request')
assert.equal(graph.getState().currentDocument.edges.length, 2)
assert.equal(adaptationCalls, 1, 'only reconnect triggers adaptation')
uninstall()
reset({ adapt: true })
delay = 80
const pending = connectVideoInput('source-0', 'request')
await sleep(10)
cancelVideoInputValidation('request')
await pending
assert.equal(graph.getState().currentDocument.edges.length, 0)
assert.match(useVideoInputFeedback.getState().nodes.request.message, /取消/)
reset({ adapt: true })
delay = 50
const stale = connectVideoInput('source-0', 'request')
await sleep(10)
graph.getState().updateNode('request', { video: { ...request().video, model: 'minimax-h3' } })
await stale
assert.equal(graph.getState().currentDocument.edges.length, 0)
assert.ok(released.length, 'stale imported compatible copy is released')
reset({ adapt: false })
await addVideoInputFile('request', new File([new Uint8Array(20_000_001)], 'large.png', { type: 'image/png' }), 'image')
assert.equal(request().video.referenceAssetIds, undefined)
assert.match(useVideoInputFeedback.getState().nodes.request.message, /添加失败/)
reset({ adapt: true })
await addVideoInputFile('request', new File([new Uint8Array(20_000_001)], 'large.png', { type: 'image/png' }), 'image')
assert.equal(request().video.referenceAssetIds.length, 0)
assert.ok(graph.getState().currentDocument.nodes.some((node) => node.payload?.kind === 'image'))
assert.equal(graph.getState().currentDocument.edges.length, 1)
assert.ok(!Object.values(request().video.referenceOverrides).some((value) => value.compatibleCopy))
reset({ sizes: [1000, 1000] })
await Promise.all([connectVideoInput('source-0', 'request'), connectVideoInput('source-0', 'request'), connectVideoInput('source-1', 'request')])
assert.equal(graph.getState().currentDocument.edges.length, 2)
reset({ model: 'custom-unmapped', adapt: true })
await connectVideoInput('source-0', 'request')
assert.equal(adaptationCalls, 0)
assert.match(useVideoInputFeedback.getState().nodes.request.message, /未配置官方规格/)
reset({ sizes: [1000, 1000] })
const restored = graph.getState().currentDocument
const videoReference = (id, source) => ({ id, upstreamNodeId: source, resourceId: `sha256-${id}`, type: 'video', source: 'local', order: 0, metadata: { bytes: 1000, format: 'mp4', width: 1280, height: 720, fps: 24, duration: 8 } })
restored.nodes[1].references = [videoReference('group-one', 'source-0'), videoReference('group-two', 'source-0')]
restored.nodes[2].references = [videoReference('separate', 'source-1')]
restored.edges = [{ id: 'group-edge', source: 'source-0', target: 'request' }, { id: 'separate-edge', source: 'source-1', target: 'request' }]
graph.setState({ currentDocument: { ...restored } })
const stopGroupValidation = installVideoInputValidation()
await sleep(350)
assert.equal(graph.getState().currentDocument.edges.length, 1)
assert.equal(graph.getState().currentDocument.edges[0].source, 'source-1', 'rejected multi-file edge must not consume duration budget of later valid edges')
stopGroupValidation()
reset({ adapt: true })
const legacyDocument = graph.getState().currentDocument
const legacyCopyId = 'asset-legacy-copy'
blobs.set('sha256-legacy-copy', new Blob(['legacy'], { type: 'image/webp' }))
legacyDocument.edges = [{ id: 'legacy-edge', source: 'source-0', target: 'request' }]
request().video.promptMentions = { 'ref-0': '@首帧' }
request().video.referenceOverrides = { 'ref-0': { role: 'first_frame', order: 4, compatibleCopy: { sourceIdentity: 'sha256-image-0', assetId: legacyCopyId, mimeType: 'image/webp', fileName: 'legacy.webp', size: 6, processingKey: 'legacy' } } }
const stopLegacyValidation = installVideoInputValidation()
await sleep(450)
const restoredCopy = graph.getState().currentDocument.nodes.find((node) => node.payload?.kind === 'image')
assert.ok(restoredCopy, 'legacy hidden copies must become visible nodes')
assert.equal(graph.getState().currentDocument.edges[0].source, restoredCopy.id)
assert.equal(adaptationCalls, 0, 'legacy copy exposure must not re-encode')
const restoredId = `upstream-${restoredCopy.id}-image-sha256-legacy-copy`
assert.equal(request().video.referenceOverrides[restoredId].role, 'first_frame')
assert.equal(request().video.promptMentions[restoredId], '@首帧')
assert.equal(request().video.promptMentions['ref-0'], undefined)
assert.ok(!Object.values(request().video.referenceOverrides).some((override) => override.compatibleCopy))
stopLegacyValidation()
console.log('Video input behavior: rejection, compatible copies, selective disconnection, reconnect, cancellation, stale results, upload and serialization passed.')
