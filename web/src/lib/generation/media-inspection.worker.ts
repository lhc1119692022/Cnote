import { BlobSource, Input, MP4, MP3, QTFF, WAVE } from 'mediabunny'
import type { MediaKind, MediaMetadata } from './official-media-rules'

export interface MediaWorkerRequest {
  blob: Blob
  type: MediaKind
  operation: 'inspect' | 'adapt'
  maxBytes?: number
  exclusiveBytes?: boolean
  maxSide?: number
}

async function imageFormat(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
  const text = new TextDecoder('latin1').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes[0] === 0x89 && text.slice(1, 4) === 'PNG') return 'png'
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp'
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'gif'
  if (text.startsWith('BM')) return 'bmp'
  if (text.startsWith('II*\0') || text.startsWith('MM\0*')) return 'tiff'
  if (text.slice(4, 8) === 'ftyp') {
    if (/hei[cx]|hev[cx]/.test(text.slice(8))) return 'heic'
    if (/mif1|msf1/.test(text.slice(8))) return 'heif'
    if (/avif|avis/.test(text.slice(8))) return 'avif'
  }
  throw new Error('无法识别实际图片格式，不能仅按文件扩展名验证')
}

async function inspectImage(blob: Blob): Promise<MediaMetadata> {
  const format = await imageFormat(blob)
  const bitmap = await createImageBitmap(blob)
  try { return { bytes: blob.size, format, width: bitmap.width, height: bitmap.height } }
  finally { bitmap.close() }
}

async function inspectTimedMedia(blob: Blob, type: MediaKind): Promise<MediaMetadata> {
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MP3, WAVE] })
  try {
    const format = await input.getFormat()
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (type === 'video' && !video) throw new Error('文件不包含可读取的视频轨道')
    if (type === 'audio' && (!audio || video)) throw new Error('文件不是独立音频素材')
    const audioCodec = await audio?.getCodec()
    const videoCodec = await video?.getCodec()
    const stats = await video?.computePacketStats()
    return {
      bytes: blob.size,
      format: format === MP4 ? 'mp4' : format === QTFF ? 'mov' : format === MP3 ? 'mp3' : format === WAVE ? 'wav' : format.name,
      duration: await input.computeDuration(),
      width: await video?.getDisplayWidth(), height: await video?.getDisplayHeight(),
      fps: stats?.averagePacketRate,
      videoCodec: videoCodec === 'avc' ? 'h264' : videoCodec || undefined,
      hasAudio: Boolean(audio), audioCodec: audioCodec?.startsWith('pcm-') ? 'pcm' : audioCodec || undefined,
    }
  } finally { input.dispose() }
}

async function adaptImage(request: MediaWorkerRequest): Promise<{ blob: Blob; metadata: MediaMetadata }> {
  const bitmap = await createImageBitmap(request.blob)
  try {
    if (bitmap.width * bitmap.height > 80_000_000) throw new Error('图片超过本地处理预算（8000万像素），未降低质量或继续尝试')
    const render = async (width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height)
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('当前环境无法创建本地图片副本')
        context.drawImage(bitmap, 0, 0, width, height)
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 1 })
        if (blob.type !== 'image/webp') throw new Error('当前环境不支持 WebP 编码，未切换其他格式')
        return blob
      } finally { canvas.width = 1; canvas.height = 1 }
    }
    let blob = request.blob
    if (request.maxBytes !== undefined && (request.exclusiveBytes ? blob.size >= request.maxBytes : blob.size > request.maxBytes)) {
      blob = await render(bitmap.width, bitmap.height)
    }
    const scale = Math.min(1, (request.maxSide || Infinity) / Math.max(bitmap.width, bitmap.height))
    if (scale < 1) blob = await render(Math.max(1, Math.floor(bitmap.width * scale)), Math.max(1, Math.floor(bitmap.height * scale)))
    return { blob, metadata: await inspectImage(blob) }
  } finally { bitmap.close() }
}

self.onmessage = async (event: MessageEvent<MediaWorkerRequest>) => {
  try {
    const request = event.data
    const result = request.operation === 'adapt'
      ? await adaptImage(request)
      : { metadata: request.type === 'image' ? await inspectImage(request.blob) : await inspectTimedMedia(request.blob, request.type) }
    self.postMessage({ ok: true, ...result })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
