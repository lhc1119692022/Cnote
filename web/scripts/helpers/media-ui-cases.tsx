import React from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasProvider, useCanvas } from '../../src/canvas/components/CanvasProvider'
import { NodeHoverToolbar } from '../../src/canvas/components/NodeHoverToolbar'
import { RequestContent } from '../../src/canvas/contents/RequestContent'
import { ContentContent } from '../../src/canvas/contents/ContentContent'
import { resolveRequestGenerationInputs } from '../../src/canvas/contents/request-generation'
import { useRuntimeStore } from '../../src/stores/runtime-store'
import { useGraphStore } from '../../src/stores/graph-store'
import { useUiStore } from '../../src/stores/ui-store'
import { useGenerationStore } from '../../src/stores/use-generation-store'
import { useVideoInputFeedback } from '../../src/canvas/video-input-validation'
import { AssetManager } from '../../src/runtime/asset-manager'
import { png, wave } from './media-runtime-cases'
import { importContentIntoNode } from '../../src/canvas/content-import-adapter'
import { REQUEST_NODE_DEFAULT_SIZE } from '../../src/lib/flow/node-dimensions'
import type { RequestNodeSpec } from '../../src/domain'
import '../../src/index.css'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds))
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await sleep(50)
  }
  throw new Error(message)
}

function SurfaceContent() {
  const { nodes } = useCanvas()
  const node = nodes[0] as RequestNodeSpec
  return <>
    <div data-node-id={node.id} style={{ position: 'absolute', left: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height }}>
      <NodeHoverToolbar node={node} selected />
      <div className="h-full w-full rounded-2xl border bg-card shadow-sm"><RequestContent node={node} /></div>
    </div>
    {nodes.filter((item) => item.kind === 'content' && (item.id === 'audio-source' || item.label.includes('适配副本') || item.category === 'audio')).map((item) => item.kind === 'content' && <div key={item.id} data-visible-copy={item.id} style={{ position: 'absolute', left: item.position.x, top: item.position.y, width: item.size.width, height: item.size.height }}>
      <NodeHoverToolbar node={item} selected />
      <div className="h-full w-full rounded-2xl border bg-card shadow-sm"><ContentContent node={item} /></div>
    </div>)}
  </>
}

function Surface() {
  return <CanvasProvider><SurfaceContent /></CanvasProvider>
}

export async function runMediaUiCases() {
  await useGenerationStore.persist.rehydrate()
  const node: RequestNodeSpec = {
    id: 'media-ui-request', kind: 'request', variant: 'video', label: '视频生成', position: { x: 140, y: 160 }, size: { ...REQUEST_NODE_DEFAULT_SIZE },
    image: { prompt: '' }, video: { prompt: '镜头缓慢推进', model: 'wan-3', channelId: 'media-ui-channel', capability: 'reference-to-video', seconds: 5, resolution: '720p', aspectRatio: '16:9' },
  }
  useGenerationStore.setState({ channels: [{ id: 'media-ui-channel', name: '测试渠道', providerId: 'video', protocol: 'video-808relay', baseURL: 'https://unused.invalid', enabled: true, modelIds: ['wan-3', 'minimax_h3'] }] })
  useUiStore.setState({ showNodePanel: false, showExtensionPanel: false })
  useGraphStore.getState().openDocument({ id: 'media-ui-document', name: '素材校验测试', nodes: [node], edges: [], createdAt: Date.now(), updatedAt: Date.now(), viewport: { x: 0, y: 0, zoom: 1 } })
  useGraphStore.getState().setSelection([node.id])
  document.body.innerHTML = '<div id="test-root" style="width:100vw;height:100vh"></div>'
  createRoot(document.getElementById('test-root')!).render(<Surface />)
  await sleep(700)
  const off = document.querySelector<HTMLButtonElement>('button[aria-label="图片无感适配：关闭"]')
  assert(off && off.getAttribute('aria-pressed') === 'false', 'Adaptation must be off by default with accessible state')
  const beforeColor = getComputedStyle(off.querySelector('svg')!).color
  off.click()
  await sleep(100)
  const on = document.querySelector<HTMLButtonElement>('button[aria-label="图片无感适配：开启"]')
  assert(on && on.getAttribute('aria-pressed') === 'true', 'Toggle did not turn on')
  assert(getComputedStyle(on.querySelector('svg')!).color !== beforeColor, 'Toggle state has no color difference')
  assert((useGraphStore.getState().currentDocument!.nodes[0] as RequestNodeSpec).video.autoAdaptImages, 'Toggle state not stored on node')
  useVideoInputFeedback.setState({ nodes: { [node.id]: { pending: true, message: '正在检查素材…' } } })
  await sleep(80)
  assert(document.querySelector('button[aria-label="取消素材检查"]'), 'Pending check has no cancel control')
  useVideoInputFeedback.setState({ nodes: { [node.id]: { pending: false, message: '无法连接：参考图.png 为26.4 MB，当前模型要求不超过20 MB。' } } })
  await sleep(80)
  assert(document.body.textContent?.includes('26.4 MB'), 'Failure reason is not visible')
  const bounds = on.getBoundingClientRect()
  assert(bounds.width === 32 && bounds.height === 32, 'Control does not reuse compact 32px toolbar sizing')
  assert(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Toolbar control is clipped')
  const capsule = on.closest('.node-hover-toolbar')!
  assert(Math.abs(capsule.getBoundingClientRect().right - (node.position.x + node.size.width)) < 2, 'Narrow capsule must align to node right')
  useGraphStore.getState().setSelection([])
  await sleep(100)
  assert(!capsule.classList.contains('is-visible'), 'Unselected toolbar remains visible')
  useGraphStore.getState().setSelection([node.id, 'second-selection'])
  await sleep(100)
  assert(!capsule.classList.contains('is-visible'), 'Multi-selection shows individual toolbar')
  useGraphStore.getState().setSelection([node.id])
  const manager = new AssetManager()
  const large = await manager.importAsset(await png(2600, 2600, true), '大图.png')
  const small = await manager.importAsset(await png(1024, 1024), '合规.png')
  for (const [id, asset] of [['large-source', large], ['small-source', small]] as const) {
    useGraphStore.getState().addNode({ id, kind: 'content', label: id, position: { x: 850, y: 180 }, size: { width: 240, height: 200 }, category: 'image', subtype: 'image', assetId: asset.id, source: { kind: 'file', assetId: asset.id, mimeType: 'image/png' }, state: 'ready' } as never)
  }
  const currentRequest = () => useGraphStore.getState().currentDocument!.nodes[0] as RequestNodeSpec
  useGraphStore.getState().updateNode(node.id, { video: { ...currentRequest().video, model: 'minimax_h3' } })
  useGraphStore.getState().addEdge('large-source', node.id)
  useGraphStore.getState().addEdge('small-source', node.id)
  await until(() => useGraphStore.getState().currentDocument!.edges.length === 2 && !useVideoInputFeedback.getState().nodes[node.id]?.pending, 'Real connection pipeline did not accept H3 inputs')
  useGraphStore.getState().updateNode(node.id, { video: { ...currentRequest().video, model: 'wan-3' } })
  await until(() => useGraphStore.getState().currentDocument!.edges.length === 1 && !useVideoInputFeedback.getState().nodes[node.id]?.pending, 'Model switch did not selectively disconnect large image')
  assert(useGraphStore.getState().currentDocument!.edges[0].source === 'small-source', 'Compliant connection was disconnected')
  assert(!Object.values(currentRequest().video.referenceOverrides || {}).some((override) => override.compatibleCopy), 'Model switch generated a copy')
  useGraphStore.getState().addEdge('large-source', node.id)
  await until(() => useGraphStore.getState().currentDocument!.edges.length === 2 && !useVideoInputFeedback.getState().nodes[node.id]?.pending, 'Reconnect did not create and validate a compatible copy')
  const copyEdge = useGraphStore.getState().currentDocument!.edges.find((edge) => edge.source !== 'small-source')!
  const copyNode = useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === copyEdge.source)
  assert(copyNode?.kind === 'content' && copyNode.payload?.kind === 'image', 'Visible compatible image node is missing')
  const copyResource = copyNode.payload.resources?.[0].resource
  assert(copyResource?.resourceId && copyResource.mimeType === 'image/webp', 'Visible copy has no actual WebP resource')
  const { loadLocalResourceBlob } = await import('../../src/lib/resource-storage')
  const copy = await loadLocalResourceBlob(copyResource.resourceId)
  assert(copy && copy.size <= 20_000_000, 'Visible copy file is missing or oversized')
  assert(copyEdge.source !== 'large-source', 'Connection still uses the original image node')
  assert(!Object.values(currentRequest().video.referenceOverrides || {}).some((override) => override.compatibleCopy), 'Hidden copy override persisted')
  const currentDocument = useGraphStore.getState().currentDocument!
  const runtime = useRuntimeStore.getState()
  const submitted = resolveRequestGenerationInputs({ requestNodeId: node.id, variant: 'video', config: currentRequest().video, nodes: currentDocument.nodes, edges: currentDocument.edges, assets: runtime.assets, runs: runtime.runs })
  assert(submitted.references.some((reference) => reference.upstreamNodeId === copyNode.id && reference.resourceId === copyResource.resourceId), 'Submission does not use the visible copy')
  assert(!submitted.references.some((reference) => reference.upstreamNodeId === 'large-source'), 'Submission still uses original source')
  await until(() => Array.from(window.document.querySelectorAll(`[data-visible-copy="${copyNode.id}"] img`)).some((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0), 'Visible copy image did not render')
  assert(useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === 'large-source')?.kind === 'content', 'Original node removed')
  const restoredSnapshot = JSON.parse(JSON.stringify(useGraphStore.getState().currentDocument!))
  useGraphStore.getState().undo()
  assert(!useGraphStore.getState().currentDocument!.nodes.some((item) => item.id === copyNode.id), 'Undo left an orphan visible copy')
  useGraphStore.getState().redo()
  assert(useGraphStore.getState().currentDocument!.edges.some((edge) => edge.source === copyNode.id && edge.target === node.id), 'Redo failed to restore copy connection')
  useGraphStore.getState().openDocument(restoredSnapshot)
  await sleep(350)
  await until(() => !useVideoInputFeedback.getState().nodes[node.id]?.pending && useGraphStore.getState().currentDocument!.edges.some((edge) => edge.source === copyNode.id), 'Restore lost visible copy connection')
  assert(useGraphStore.getState().currentDocument!.nodes.filter((item) => item.kind === 'content' && item.label.includes('适配副本')).length === 1, 'Restore created duplicate copies')
  useGraphStore.getState().addNode({ id: 'audio-source', kind: 'content', label: '音频', position: { x: 100, y: 720 }, size: { width: 540, height: 430 }, category: null, subtype: null, source: null } as never)
  await sleep(100)
  const picker = document.querySelector('[data-visible-copy="audio-source"]')!
  const categories = [...picker.querySelectorAll('.grid.grid-cols-3 button')]
  assert(categories.map((button) => button.textContent).join(',') === '文本,视频,社媒,图片,音频,文档,思维导图,演示文稿,数据', 'Category order mismatch')
  ;(categories[4] as HTMLButtonElement).click()
  await sleep(100)
  const fileInput = picker.querySelector<HTMLInputElement>('input[type="file"]')!
  assert(fileInput?.isConnected, 'Picker unmounted before file selection')
  const files = new DataTransfer()
  files.items.add(new File([wave(3)], '参考.wav', { type: 'audio/wav' }))
  fileInput.files = files.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => useGraphStore.getState().currentDocument!.nodes.some((item) => item.id === 'audio-source' && item.kind === 'content' && item.category === 'audio'), 'First-click audio import failed')
  assert(useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === 'audio-source')!.size.height === 220, 'Audio default is not compact')
  assert(useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === 'audio-source')?.kind === 'content', 'Audio import missing')
  useGraphStore.getState().addEdge('audio-source', node.id)
  await until(() => useGraphStore.getState().currentDocument!.edges.some((edge) => edge.source === 'audio-source') && !useVideoInputFeedback.getState().nodes[node.id]?.pending, 'Audio reference connection rejected')
  await until(() => Boolean(document.querySelector('audio')?.duration === 3 && document.querySelector('svg[aria-label="音频波形"]')), 'Audio metadata or real waveform missing')
  const waveformElement = document.querySelector<SVGSVGElement>('svg[aria-label="音频波形"]')!
  assert(waveformElement.getBoundingClientRect().height > waveformElement.parentElement!.getBoundingClientRect().height * 0.6, 'Waveform SVG collapsed inside flex layout')
  assert([...waveformElement.querySelectorAll('line')].some((line) => line.getBoundingClientRect().height > 10), 'Real waveform appears as a flat line')
  const audioDocument = useGraphStore.getState().currentDocument!
  const audioInputs = resolveRequestGenerationInputs({ requestNodeId: node.id, variant: 'video', config: currentRequest().video, nodes: audioDocument.nodes, edges: audioDocument.edges, assets: useRuntimeStore.getState().assets, runs: useRuntimeStore.getState().runs })
  assert(audioInputs.references.some((reference) => reference.upstreamNodeId === 'audio-source' && reference.type === 'audio'), 'Audio reference was not passed to video generation')
  const audioContainer = document.querySelector('audio')!.parentElement!
  const lightColor = getComputedStyle(audioContainer).backgroundColor
  document.documentElement.classList.add('dark')
  await sleep(100)
  assert(getComputedStyle(audioContainer).backgroundColor !== lightColor, 'Audio theme colors did not change')
  document.documentElement.classList.remove('dark')
  const beforeBars = document.querySelector('svg[aria-label="音频波形"]')!.querySelectorAll('line').length
  useGraphStore.getState().updateNode('audio-source', { size: { width: 760, height: 220 } })
  await sleep(150)
  assert(document.querySelector('svg[aria-label="音频波形"]')!.querySelectorAll('line').length > beforeBars, 'Waveform bars did not increase with width')
  const beforeTrimHeight = document.querySelector('svg[aria-label="音频波形"]')!.getBoundingClientRect().height
  const beforeNodeHeight = document.querySelector('[data-visible-copy="audio-source"]')!.getBoundingClientRect().height
  const portFixture = document.createElement('div')
  portFixture.dataset.nodeId = 'port-visibility-test'
  portFixture.dataset.nodeSelected = 'true'
  portFixture.style.cssText = 'position:fixed;left:-10000px;top:-10000px'
  portFixture.innerHTML = '<input /><div class="node-connection-handle"></div>'
  document.body.append(portFixture)
  const port = portFixture.querySelector<HTMLElement>('.node-connection-handle')!
  assert(getComputedStyle(port).opacity === '0' && getComputedStyle(port).pointerEvents === 'none', 'Selection alone keeps ports visible')
  portFixture.querySelector('input')!.focus()
  await sleep(250)
  assert(getComputedStyle(port).opacity === '0' && getComputedStyle(port).pointerEvents === 'none', 'Input focus must not keep connection points visible')
  portFixture.dataset.nodeHovered = 'true'
  await sleep(250)
  assert(getComputedStyle(port).opacity === '1', 'Hover must reveal connection points')
  delete portFixture.dataset.nodeHovered
  await sleep(250)
  assert(getComputedStyle(port).opacity === '0', 'Connection points remain after pointer leaves')
  for (const state of ['valid', 'invalid']) {
    portFixture.dataset.nodeConnectionTarget = state
    await sleep(250)
    assert(getComputedStyle(port).opacity === '1' && getComputedStyle(port).pointerEvents === 'auto', 'Connection target feedback must remain visible without hover')
  }
  delete portFixture.dataset.nodeConnectionTarget
  await sleep(250)
  assert(getComputedStyle(port).opacity === '0', 'Ports must hide after connection targeting ends even if still selected')
  portFixture.remove()
  const originalAudio = JSON.stringify(useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === 'audio-source'))
  const originalEdges = JSON.stringify(useGraphStore.getState().currentDocument!.edges)
  document.querySelector<HTMLButtonElement>('button[aria-label="截取音频"]')!.click()
  await until(() => Boolean(document.querySelector<HTMLButtonElement>('button[title="生成 WAV 截取副本，保留原音频"]') && !document.querySelector<HTMLButtonElement>('button[title="生成 WAV 截取副本，保留原音频"]')!.disabled), 'Trim decoding failed')
  await sleep(50)
  assert(Math.abs(document.querySelector('svg[aria-label="音频波形"]')!.getBoundingClientRect().height - beforeTrimHeight) < 1, 'Trimming compressed the waveform')
  assert(document.querySelector('[data-visible-copy="audio-source"]')!.getBoundingClientRect().height === beforeNodeHeight + 48, 'Audio trim did not add its own height')
  const waveformBounds = document.querySelector('audio')!.parentElement!.getBoundingClientRect()
  for (const handle of document.querySelectorAll('button[aria-label^="拖动截取"]')) {
    const bounds = handle.getBoundingClientRect()
    assert(bounds.left >= waveformBounds.left && bounds.right <= waveformBounds.right, 'Trim handle is clipped at an endpoint')
  }
  const { encodeAudioRange, trimAudioBlob } = await import('../../src/canvas/audio-trim')
  const context = new AudioContext()
  const buffer = await context.decodeAudioData(await wave(3).arrayBuffer())
  const cropped = await encodeAudioRange(buffer, 0.5, 1.5)
  const decodedCrop = await context.decodeAudioData(await cropped.arrayBuffer())
  assert(Math.abs(decodedCrop.duration - 1) < 0.001, 'WAV range duration incorrect')
  const streamed = await trimAudioBlob(wave(3), 0.5, 1.5)
  const streamedBuffer = await context.decodeAudioData(await streamed.arrayBuffer())
  assert(Math.abs(streamedBuffer.duration - 1) < 0.001, 'Streaming trim range duration incorrect')
  assert(streamedBuffer.getChannelData(0).some((sample) => Math.abs(sample) > 0.1), 'Streaming trim lost audio samples')
  const longHeader = new Uint8Array((await wave(1).arrayBuffer()).slice(0, 44))
  const longView = new DataView(longHeader.buffer)
  const bytesPerSecond = 48000 * 2 * 2
  longView.setUint32(4, 36 + bytesPerSecond * 396, true)
  longView.setUint16(22, 2, true)
  longView.setUint32(24, 48000, true)
  longView.setUint32(28, bytesPerSecond, true)
  longView.setUint16(32, 4, true)
  longView.setUint32(40, bytesPerSecond * 396, true)
  const longAudio = new Blob([longHeader, ...Array.from({ length: 396 }, () => new Uint8Array(bytesPerSecond).fill(16))], { type: 'audio/wav' })
  assert(396 * 48000 * 2 * 4 > 128_000_000, 'Long fixture must exceed the former decoded-memory limit')
  const longCrop = await trimAudioBlob(longAudio, 102.5, 103.5)
  const longDecoded = await context.decodeAudioData(await longCrop.arrayBuffer())
  assert(Math.abs(longDecoded.duration - 1) < 0.001 && longDecoded.numberOfChannels === 2, 'Long-source trim failed or changed channels')
  assert(longDecoded.getChannelData(0).some((sample) => Math.abs(sample) > 0.1), 'Long-source trim lost audio')
  await context.close()
  document.querySelector<HTMLButtonElement>('button[aria-label="截取音频"]')!.click()
  await sleep(50)
  assert(document.querySelector('input[aria-label="截取结束时间"]'), 'Capsule action must only open trimming')
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await sleep(50)
  assert(!document.querySelector('input[aria-label="截取结束时间"]'), 'Outside click must close trimming')
  assert(document.querySelector('[data-visible-copy="audio-source"]')!.getBoundingClientRect().height === beforeNodeHeight, 'Closing trim did not restore height')
  document.querySelector<HTMLButtonElement>('button[aria-label="截取音频"]')!.click()
  await sleep(50)
  const endInput = document.querySelector<HTMLInputElement>('input[aria-label="截取结束时间"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(endInput, '00:01')
  endInput.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(50)
  endInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  await sleep(50)
  document.querySelector<HTMLButtonElement>('button[title="生成 WAV 截取副本，保留原音频"]')!.click()
  await until(() => useGraphStore.getState().currentDocument!.nodes.some((item) => item.label.endsWith(' · 截取')), 'Visible audio trim copy missing')
  const trimCopy = useGraphStore.getState().currentDocument!.nodes.find((item) => item.label.endsWith(' · 截取'))!
  assert(trimCopy.kind === 'content' && trimCopy.assetId, 'Trim copy has no saved resource')
  const savedTrim = await loadLocalResourceBlob(trimCopy.assetId)
  assert(savedTrim, 'Trim file not persisted')
  const verifyContext = new AudioContext()
  const savedBuffer = await verifyContext.decodeAudioData(await savedTrim.arrayBuffer())
  assert(Math.abs(savedBuffer.duration - 1) < 0.001, 'UI selected end did not reach saved WAV')
  await verifyContext.close()
  assert(JSON.stringify(useGraphStore.getState().currentDocument!.nodes.find((item) => item.id === 'audio-source')) === originalAudio, 'Trimming modified original audio')
  assert(JSON.stringify(useGraphStore.getState().currentDocument!.edges) === originalEdges, 'Trimming changed original connections')
  useGraphStore.getState().undo()
  assert(!useGraphStore.getState().currentDocument!.nodes.some((item) => item.id === trimCopy.id), 'Trim copy cannot undo atomically')
  useGraphStore.getState().redo()
  assert(useGraphStore.getState().currentDocument!.nodes.some((item) => item.id === trimCopy.id), 'Trim redo lost result')
  useGraphStore.getState().setSelection(['audio-source'])
  useUiStore.getState().setNodeChrome('audio-source', { audioTrim: true })
  await sleep(150)
  return { passed: true, defaultSize: node.size, controlSize: [bounds.width, bounds.height], stateSaved: true, errorVisible: true, realConnections: true, copyBytes: copy.size }
}
