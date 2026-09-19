import { nanoid } from 'nanoid'
import type { ContentNodeSpec } from '@/domain'
import { detectAndParseContent } from '@/lib/content-import'
import { retainLocalResource } from '@/lib/resource-storage'
import { AUDIO_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'

export async function encodeAudioRange(buffer: AudioBuffer, start: number, end: number): Promise<Blob> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || start >= end) throw new Error('截取范围无效，请重新选择。')
  const first = Math.floor(start * buffer.sampleRate)
  const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate))
  const channels = buffer.numberOfChannels
  const bytes = (last - first) * channels * 2
  if (bytes > 100_000_000) throw new Error('截取结果超过 100 MB，请缩短截取范围。')
  const data = new DataView(new ArrayBuffer(44 + bytes))
  const text = (offset: number, value: string) => [...value].forEach((character, index) => data.setUint8(offset + index, character.charCodeAt(0)))
  text(0, 'RIFF'); data.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ')
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, channels, true)
  data.setUint32(24, buffer.sampleRate, true); data.setUint32(28, buffer.sampleRate * channels * 2, true)
  data.setUint16(32, channels * 2, true); data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, bytes, true)
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel))
  for (let frame = first; frame < last; frame++) {
    if ((frame - first) % 32768 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, samples[channel][frame]))
      data.setInt16(44 + ((frame - first) * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' })
}

export async function trimAudioBlob(blob: Blob, start: number, end: number, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) throw new Error('截取范围无效，请重新选择。')
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, WavOutputFormat, Conversion } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined
  const abort = () => { void conversion?.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('文件中没有可读取的音频轨道。')
    const sampleRate = await track.getSampleRate()
    const channels = await track.getNumberOfChannels()
    if (Math.ceil((end - start) * sampleRate) * channels * 2 > 100_000_000) throw new Error('选区超过 100 MB，请缩短截取范围。')
    signal?.throwIfAborted()
    const target = new BufferTarget()
    const output = new Output({ format: new WavOutputFormat(), target })
    conversion = await Conversion.init({ input, output, trim: { start, end }, video: { discard: true }, audio: (candidate) => candidate === track ? { codec: 'pcm-s16', forceTranscode: true } : { discard: true } })
    signal?.throwIfAborted()
    if (!conversion.isValid) throw new Error('当前环境无法截取此音频格式，原文件未修改。')
    await conversion.execute()
    signal?.throwIfAborted()
    if (!target.buffer) throw new Error('未生成有效音频，请重新选择截取范围。')
    return new Blob([target.buffer], { type: 'audio/wav' })
  } finally {
    signal?.removeEventListener('abort', abort)
    await conversion?.cancel().catch(() => undefined)
    input.dispose()
  }
}

export async function createAudioTrimCopy(nodeId: string, blob: Blob): Promise<void> {
  const documentId = useGraphStore.getState().currentDocument?.id
  const parsed = await detectAndParseContent({ kind: 'file', file: new File([blob], '音频截取.wav', { type: 'audio/wav' }) }, 'audio')
  if (parsed.source.kind !== 'file' || parsed.partial) throw new Error('截取文件保存失败，请重试。')
  await retainLocalResource(parsed.source.resourceId)
  const graph = useGraphStore.getState()
  const document = graph.currentDocument
  const original = document?.nodes.find((node) => node.id === nodeId)
  if (!document || document.id !== documentId || graph.isLocked || original?.kind !== 'content') throw new Error('画布已切换、锁定或原节点已删除，未添加截取结果。')
  const size = { ...AUDIO_NODE_DEFAULT_SIZE }
  const position = { x: original.position.x + original.size.width + 64, y: original.position.y }
  while (document.nodes.some((node) => position.x < node.position.x + node.size.width + 24 && position.x + size.width + 24 > node.position.x && position.y < node.position.y + node.size.height + 48 && position.y + size.height + 48 > node.position.y)) position.y += size.height + 64
  const copy: ContentNodeSpec = {
    id: nanoid(), kind: 'content', category: 'audio', subtype: parsed.subtype,
    position, size, label: `${original.label || '音频'} · 截取`, state: 'ready',
    source: { kind: 'file', assetId: parsed.source.resourceId, mimeType: parsed.source.mimeType, fileName: parsed.source.fileName },
    assetId: parsed.source.resourceId, payload: parsed.payload, preview: parsed.preview,
  }
  useRuntimeStore.getState().upsertAsset({ id: parsed.source.resourceId, hash: parsed.source.checksum.replace(/^sha256-/, ''), mimeType: parsed.source.mimeType, size: parsed.source.size })
  graph.addNode(copy)
}
