import { generationAdapterForConfig, generationAdapterForModel, generationMediaUploadSecretName, generationProtocolForChannel, generationSecretName, generationVideoRequestContractForModel, isVideoGenerationProtocol, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { MEDIA_STORAGE_DEFAULTS, useMediaStorageStore } from '@/stores/use-media-storage-store'
import type { GenerationReference, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'
import { normalizeGenerationReferences } from '@/lib/generation/defaults'
import { normalizeVideoModeConfig, videoReferenceError } from './video-mode'
import { loadLocalResourceBlob, loadLocalResourceUrl, storeLocalResource } from '@/lib/resource-storage'
import { desktopFetch } from '@/lib/desktop-fetch'
import { resolveMediaTransport, assertInlineRequestSize, assertMediaLifetime, signedMediaExpiry, MAX_INLINE_REQUEST_BYTES } from './media-policy'
import { ensureDesktopSecret, syncDesktopSecret } from '@/lib/desktop-secrets'

export interface GenerationRequestContext {
  channel: GenerationChannel
  model: GenerationModel
  config: GenerationVariantConfig
  variant: 'image' | 'video'
}

export interface GenerationTaskResponse {
  taskId: string
  resultUrls?: string[]
  resultResourceIds?: string[]
  resultMimeTypes?: string[]
  resultFileNames?: string[]
  /** Config after local video references have been prepared for the provider. */
  preparedConfig?: GenerationVariantConfig
  raw?: unknown
}

export interface GenerationPollResponse {
  task: GenerationTaskState
  raw?: unknown
}

export class GenerationStageError extends Error {
  constructor(public readonly stage: 'validation' | 'preparation' | 'creation' | 'polling' | 'download', message: string, public readonly cause?: unknown) {
    super(`${stage}: ${message}`)
    this.name = 'GenerationStageError'
  }
}

export interface GenerationRunOptions {
  taskId?: string
  submittedAt?: number
  timeoutMs: number
  signal?: AbortSignal
  onTaskUpdate?: (task: GenerationTaskState) => void
  onConfigPrepared?: (config: GenerationVariantConfig) => void
  onCancel?: (taskId: string) => Promise<void> | void
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/$/, '')
}

function authHeaders(channel: GenerationChannel, adapterId?: string) {
  const apiKey = channel.apiKey?.trim().replace(/^Bearer\s+/i, '')
  if (protocolFor(channel, adapterId) === 'google-images') {
    return {
      'Content-Type': 'application/json',
      ...(apiKey ? (/^sk-/i.test(apiKey) ? { Authorization: `Bearer ${apiKey}` } : { 'x-goog-api-key': apiKey }) : {}),
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

function protocolFor(channel: GenerationChannel, adapterId?: string, modelId?: string) {
  if (adapterId || modelId) return generationAdapterForModel(channel, modelId || '', adapterId)?.protocol || generationProtocolForChannel(channel)
  return channel.protocol || generationAdapterForConfig(channel, undefined)?.protocol || generationProtocolForChannel(channel)
}

function authSecretRefs(channel: GenerationChannel, adapterId?: string) {
  if (typeof window === 'undefined' || !window.cnoteDesktop) return undefined
  const secretName = channel.secretName || generationSecretName(channel.id)
  return { [protocolFor(channel, adapterId) === 'google-images' && !/^sk-/i.test(channel.apiKey?.trim() || '') ? 'x-goog-api-key' : 'Authorization']: secretName }
}

async function assertDesktopSecretReady(channel: GenerationChannel, adapterId?: string) {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  if (!desktop?.secrets) return
  const secretName = channel.secretName || generationSecretName(channel.id)
  const refs = authSecretRefs(channel, adapterId)
  if (!refs) return
  const currentKey = channel.apiKey?.trim().replace(/^Bearer\s+/i, '')
  if (currentKey) {
    const header = protocolFor(channel, adapterId) === 'google-images' && !/^sk-/i.test(currentKey || '') ? 'x-goog-api-key' : 'Authorization'
    await syncDesktopSecret(secretName, header === 'Authorization' ? `Bearer ${currentKey}` : currentKey)
    return
  }
  const missing = (await Promise.all(Object.values(refs).map(async (name) => ({ name, present: await ensureDesktopSecret(name) })))).find((item) => !item.present)
  if (missing) throw new Error('当前渠道的 API Key 尚未保存到桌面安全存储，请在“渠道”中重新保存 API Key。')
}

function normalizeVideoResolution(value: string | undefined) {
  const normalized = String(value || '720p').trim().toLowerCase().replace(/\s+/g, '')
  const aliases: Record<string, string> = {
    '360': '360p', '640x360': '360p', '360x640': '360p', '480': '480p', '854x480': '480p', '640x480': '480p',
    '720': '720p', '1280x720': '720p', '720x1280': '720p', '1080': '1080p', '1920x1080': '1080p', '1080x1920': '1080p',
    '4k': '4k', '2160p': '4k', '3840x2160': '4k', '2160x3840': '4k',
  }
  return aliases[normalized] || normalized
}

function videoResolutionForModel(value: string | undefined, model: GenerationModel) {
  const normalized = normalizeVideoResolution(value).toLowerCase()
  return model.resolutions?.find((resolution) => normalizeVideoResolution(resolution).toLowerCase() === normalized) || normalizeVideoResolution(value)
}

function validateVideoConfig(model: GenerationModel, config: GenerationVariantConfig) {
  const referenceError = videoReferenceError(model, config)
  if (referenceError) throw new Error(referenceError)
  if (config.generateAudio && !model.capabilities.includes('generate-audio')) throw new Error(`${model.name} 未配置生成音频能力`)
  const inferredVideoModel = model.capabilitySource === 'inferred' && model.capabilities.some((capability) => capability.endsWith('-to-video') || ['video-reference', 'audio-reference', 'video-edit', 'generate-audio'].includes(capability))
  const seconds = config.seconds ?? 5
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('视频时长必须是正整数秒数')
  if (!inferredVideoModel && model.allowedDurations?.length && !model.allowedDurations.includes(seconds)) throw new Error(`${model.name} 时长只能为 ${model.allowedDurations.join(' 或 ')} 秒`)
  if (!inferredVideoModel && (model.minDuration && seconds < model.minDuration || model.maxDuration && seconds > model.maxDuration)) throw new Error(`${model.name} 时长必须为 ${model.minDuration}-${model.maxDuration} 秒`)
  const resolution = videoResolutionForModel(config.resolution, model)
  if (!inferredVideoModel && model.resolutions?.length && !model.resolutions.some((item) => normalizeVideoResolution(item).toLowerCase() === normalizeVideoResolution(resolution).toLowerCase())) throw new Error(`${model.name} 不支持 ${resolution}`)
  if (!inferredVideoModel && model.aspectRatios?.length && config.aspectRatio && !model.aspectRatios.includes(config.aspectRatio)) throw new Error(`${model.name} 不支持 ${config.aspectRatio} 画幅`)
  const images = config.references.filter((reference) => reference.type === 'image')
  const videos = config.references.filter((reference) => reference.type === 'video')
  const audios = config.references.filter((reference) => reference.type === 'audio')
  for (const [type, max] of [['image', model.maxImages], ['video', model.maxVideos], ['audio', model.maxAudios] ] as const) {
    const count = config.references.filter((reference) => reference.type === type).length
    if (max !== undefined && count > max) throw new Error(`${model.name} 最多支持 ${max} 个${type}参考素材`)
  }
  if (model.id === 'gemini-omni-1.1' && audios.length) throw new Error('Gemini Omni 1.1 不支持参考音频')
  const firstFrame = images.filter((reference) => reference.role === 'first_frame')
  const lastFrame = images.filter((reference) => reference.role === 'last_frame')
  const ordinaryImages = images.filter((reference) => !['first_frame', 'last_frame'].includes(reference.role || ''))
  if (lastFrame.length && !firstFrame.length) throw new Error('尾帧必须同时提供首帧')
  if (firstFrame.length > 1 || lastFrame.length > 1) throw new Error('首帧和尾帧各只能提供一张')
  if (firstFrame.length && (ordinaryImages.length || videos.length || audios.length) && model.id !== 'gemini-omni-1.1') throw new Error('首尾帧不能与参考媒体混用')
  if (model.id === 'gemini-omni-1.1' && firstFrame.length && ordinaryImages.length) throw new Error('Gemini Omni 1.1 的首帧不能与参考图片混用')
  if (audios.length && !ordinaryImages.length && !videos.length && !model.allowsAudioOnlyReference) throw new Error(`${model.name} 的参考音频必须同时提供参考图片或参考视频`)
  if (model.id === 'gemini-omni-1.1' && videos.length && !ordinaryImages.length && !firstFrame.length) throw new Error('Gemini Omni 1.1 的参考视频必须同时提供首帧或参考图片')
  if (model.promptRequired !== false && !config.prompt.trim()) throw new Error(`${model.name} 需要填写提示词`)
  if (model.promptRequired === false && model.promptlessWithReferences && !config.prompt.trim() && !ordinaryImages.length && !firstFrame.length) throw new Error(`${model.name} 省略提示词时必须提供首帧或参考图片`)
  return resolution
}
function isGPTImage25(model: GenerationModel) {
  return /^gpt-image-2\.5(?:-|$)/i.test(model.id)
}

function validateImageConfig(model: GenerationModel, config: GenerationVariantConfig) {
  const quality = config.quality === 'standard' ? 'medium' : config.quality || model.defaultQuality || 'auto'
  if (model.resolutions?.length && config.resolution && !model.resolutions.includes(config.resolution)) throw new Error(`${model.name} 不支持 ${config.resolution} 分辨率`)
  if (model.aspectRatios?.length && config.aspectRatio && !model.aspectRatios.includes(config.aspectRatio)) throw new Error(`${model.name} 不支持 ${config.aspectRatio} 画幅`)
  if (!model.qualities?.includes(quality as NonNullable<GenerationModel['qualities']>[number])) throw new Error(`${model.name} 不支持 ${quality} 质量档位`)
  if ((quality === 'xhigh' || quality === 'max') && !isGPTImage25(model)) throw new Error(`${quality} 质量档位仅支持 GPT Image 2.5 系列模型`)
  if (!isGPTImage25(model) && (config.background || config.outputFormat || config.outputCompression !== undefined)) throw new Error(`${model.name} 不支持背景、输出格式或压缩质量参数`)
  if (config.background === 'transparent' && config.outputFormat === 'jpeg') throw new Error('透明背景不能使用 JPEG 输出格式')
  if (config.outputCompression !== undefined && (!Number.isInteger(config.outputCompression) || config.outputCompression < 0 || config.outputCompression > 100)) throw new Error('输出压缩质量必须是 0-100 的整数')
  if (config.outputCompression !== undefined && !['jpeg', 'webp'].includes(config.outputFormat || 'png')) throw new Error('输出压缩参数仅支持 JPEG 或 WebP')
  if (config.outputCount !== undefined && (!Number.isInteger(config.outputCount) || config.outputCount < 1 || config.outputCount > 10)) throw new Error('图片数量必须是 1-10 的整数')
}
function referenceURL(reference: GenerationReference) {
  return reference.url || reference.previewUrl || ''
}

function joinVersionedEndpoint(baseURL: string, path: string) {
  const base = normalizeBaseURL(baseURL)
  if (base.endsWith('/v1') && path.startsWith('/v1/')) return `${base}${path.slice(3)}`
  if (!base.endsWith('/v1') && path.startsWith('/v1/')) return `${base}${path}`
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function openAIImagesEndpoint(baseURL: string, operation: 'generations' | 'edits') {
  const base = normalizeBaseURL(baseURL)
  return `${base.endsWith('/v1') ? base : `${base}/v1`}/images/${operation}`
}

function geminiGenerateContentEndpoint(baseURL: string, model: string) {
  const parsed = new URL(baseURL)
  let pathname = parsed.pathname.replace(/\/$/, '')
  if (pathname.endsWith('/v1')) pathname = `${pathname.slice(0, -3)}/v1beta`
  else if (!pathname.endsWith('/v1beta')) pathname += '/v1beta'
  parsed.pathname = `${pathname}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`
  return parsed.toString()
}

function imageSizeForConfig(config: GenerationVariantConfig, model: GenerationModel) {
  if (config.resolution && /x/i.test(config.resolution)) return config.resolution
  const resolution = String(config.resolution || 'auto').toLowerCase()
  if (resolution === 'auto') return 'auto'
  const edge = resolution.includes('4') ? 2048 : resolution.includes('2') ? 1536 : 1024
  const aspect = config.aspectRatio || '1:1'
  const [widthRatio, heightRatio] = aspect.split(':').map(Number)
  if (!widthRatio || !heightRatio) return 'auto'
  const width = Math.max(16, Math.round(Math.sqrt(edge * edge * widthRatio / heightRatio) / 16) * 16)
  const height = Math.max(16, Math.round(Math.sqrt(edge * edge * heightRatio / widthRatio) / 16) * 16)
  if (/dall-e-3/i.test(model.id)) {
    if (widthRatio > heightRatio * 1.2) return '1792x1024'
    if (heightRatio > widthRatio * 1.2) return '1024x1792'
    return '1024x1024'
  }
  return `${width}x${height}`
}

async function referenceBlob(reference: GenerationReference) {
  const directURL = referenceURL(reference)
  if (reference.resourceId && !isRemoteMediaURL(directURL) && !/^data:/i.test(directURL)) {
    const localBlob = await loadLocalResourceBlob(reference.resourceId)
    if (localBlob) return { blob: localBlob, fileName: reference.fileName || `${reference.id}.${localBlob.type.split('/')[1] || 'bin'}` }
  }
  const url = directURL || (reference.resourceId ? await loadLocalResourceUrl(reference.resourceId) : '')
  if (!url) throw new Error(`参考文件“${reference.label || reference.id}”没有可读取的地址`)
  const response = await desktopFetch(url)
  if (!response.ok) throw new Error(`无法读取参考文件“${reference.label || reference.id}”`)
  const blob = await response.blob()
  return { blob, fileName: reference.fileName || `${reference.id}.${blob.type.split('/')[1] || 'bin'}` }
}

function isHttpsUrl(value: string) {
  return /^https:\/\//i.test(value)
}

function isRemoteMediaURL(value: string) {
  return /^https?:\/\//i.test(value)
}

async function blobToDataURL(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary)
}

function valueAtPath(payload: unknown, path: string) {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, payload)
}

function uploadedReferenceUrl(payload: any, responsePath = 'url') {
  return firstString(
    valueAtPath(payload, responsePath),
    payload?.url,
    payload?.file_url,
    payload?.download_url,
    payload?.data?.url,
    payload?.data?.file_url,
    payload?.data?.download_url,
  )
}

interface MediaUploadEndpoint {
  endpoint: string
  fieldName: string
  responsePath: string
  token?: string
  secretName?: string
}

function mediaUploadSettings(channel: GenerationChannel, adapterId?: string) {
  const adapter = generationAdapterForConfig(channel, adapterId)
  return {
    transport: adapter?.mediaTransport ?? channel.mediaTransport,
    fieldName: adapter?.mediaUploadField || channel.mediaUploadField || MEDIA_STORAGE_DEFAULTS.fieldName,
    responsePath: adapter?.mediaUploadResponsePath || channel.mediaUploadResponsePath || MEDIA_STORAGE_DEFAULTS.responsePath,
  }
}

function mediaUploadEndpoint(channel: GenerationChannel, adapterId?: string): MediaUploadEndpoint {
  const settings = mediaUploadSettings(channel, adapterId)
  const mediaStorage = useMediaStorageStore.getState()
  const customConfigured = Boolean(mediaStorage.baseURL || channel.mediaUploadURL)
  const transport = resolveMediaTransport(settings.transport, customConfigured)
  if (transport === 'inline') throw new Error('内联素材直接进入请求体，不使用上传接口')
  const endpoint = mediaStorage.baseURL
    ? mediaStorage.getUploadEndpoint()
    : String(channel.mediaUploadURL || '').trim()
  if (!isHttpsUrl(endpoint)) throw new Error('请先在“本地存储”中配置 HTTPS 自定义上传地址')
  return {
    endpoint,
    fieldName: mediaStorage.baseURL ? mediaStorage.fieldName : settings.fieldName,
    responsePath: mediaStorage.baseURL ? mediaStorage.responsePath : settings.responsePath,
    token: mediaStorage.baseURL ? mediaStorage.getAccessToken() : channel.mediaUploadApiKey,
    secretName: mediaStorage.baseURL ? mediaStorage.secretName : channel.mediaUploadSecretName || generationMediaUploadSecretName(channel.id),
  }
}

function mediaUploadHeaders(endpoint: MediaUploadEndpoint): Record<string, string> {
  return endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}
}

function mediaUploadSecretRefs(endpoint: MediaUploadEndpoint) {
  if (!endpoint.secretName || typeof window === 'undefined' || !window.cnoteDesktop) return undefined
  return { Authorization: endpoint.secretName }
}

async function assertMediaUploadSecretReady(endpoint: MediaUploadEndpoint) {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  if (!desktop?.secrets || !endpoint.secretName) return
  if (endpoint.token) {
    await syncDesktopSecret(endpoint.secretName, endpoint.token)
    return
  }
  if (!(await ensureDesktopSecret(endpoint.secretName))) {
    throw new Error('自定义上传服务令牌尚未保存到桌面安全存储，请到“本地存储”中重新保存。')
  }
}

async function uploadReference(channel: GenerationChannel, reference: GenerationReference, signal?: AbortSignal, adapterId?: string) {
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  await assertMediaUploadSecretReady(endpoint)
  const { blob, fileName } = await referenceBlob(reference)
  const form = new FormData()
  form.append(endpoint.fieldName, blob, fileName)
  form.append('purpose', 'generation')
  if (reference.resourceId?.startsWith('sha256-')) form.append('checksum', reference.resourceId.slice('sha256-'.length))
  const response = await desktopFetch(endpoint.endpoint, {
    method: 'POST',
    headers: mediaUploadHeaders(endpoint),
    body: form,
    signal,
  }, { secretRefs: mediaUploadSecretRefs(endpoint) })
  const payload = await parseResponse(response)
  const url = uploadedReferenceUrl(payload, endpoint.responsePath)
  if (!url || !isHttpsUrl(url)) throw new Error(`上传参考文件“${reference.label || reference.id}”后没有得到公网 HTTPS 地址`)
  assertMediaLifetime(signedMediaExpiry(url))
  return url
}

/** Performs a small multipart upload without submitting a generation task. */
export async function testGenerationMediaUpload(channel: GenerationChannel, adapterId?: string, signal?: AbortSignal): Promise<{ url?: string; message?: string }> {
  const settings = mediaUploadSettings(channel, adapterId)
  const transport = resolveMediaTransport(settings.transport, Boolean(useMediaStorageStore.getState().baseURL || channel.mediaUploadURL))
  if (transport === 'inline') return { message: '已选择 Data URL；无需上传接口。此检查不代表供应商已接受生成请求。' }
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  await assertMediaUploadSecretReady(endpoint)
  const form = new FormData()
  const testBlob = new Blob(['cnote upload test'], { type: 'application/octet-stream' })
  form.append(endpoint.fieldName, testBlob, 'cnote-upload-test.bin')
  form.append('purpose', 'generation-test')
  const response = await desktopFetch(endpoint.endpoint, {
    method: 'POST',
    headers: mediaUploadHeaders(endpoint),
    body: form,
    signal,
  }, { secretRefs: mediaUploadSecretRefs(endpoint) })
  const payload = await parseResponse(response)
  const url = uploadedReferenceUrl(payload, endpoint.responsePath)
  if (!url || !isHttpsUrl(url)) throw new Error('上传接口响应中没有可匿名访问的公网 HTTPS 地址')
  return { url }
}

async function prepareReferenceConfig(context: GenerationRequestContext, signal?: AbortSignal) {
  const { channel, config, variant } = context
  const adapter = generationAdapterForModel(channel, context.model.id, config.adapterId)
  const references = normalizeGenerationReferences(config.references || [])
  const orderedConfig = { ...config, references }
  // Image protocols receive local files directly in their request body. They
  // must never be routed through a video-style public URL conversion step.
  if (variant === 'image') return orderedConfig
  references.forEach((reference) => assertMediaLifetime(reference.expiresAt ?? signedMediaExpiry(referenceURL(reference))))
  const needsRemote = references.some((reference) => !isHttpsUrl(referenceURL(reference)))
  if (!needsRemote) return orderedConfig
  const transport = resolveMediaTransport(adapter?.mediaTransport ?? channel.mediaTransport, Boolean(useMediaStorageStore.getState().baseURL || channel.mediaUploadURL))
  if (transport === 'inline') {
    let inlineBytes = 0
    const prepared = await Promise.all(references.map(async (reference) => {
      if (isHttpsUrl(referenceURL(reference))) return reference
      const { blob } = await referenceBlob(reference)
      inlineBytes += 4 * Math.ceil(blob.size / 3)
      if (inlineBytes > MAX_INLINE_REQUEST_BYTES) throw new Error('素材 Base64 编码后超过 128 MiB，请减少素材或改用公网 HTTPS 地址')
      const url = await blobToDataURL(blob)
      return { ...reference, url, previewUrl: reference.previewUrl || url, status: 'ready' as const }
    }))
    return { ...orderedConfig, references: normalizeGenerationReferences(prepared) }
  }

  const uploadAdapterId = config.adapterId || adapter?.id
  const uploads = new Map<string, Promise<string>>()
  const prepared = await Promise.all(references.map(async (reference) => {
    if (isHttpsUrl(referenceURL(reference))) return reference
    const uploadKey = reference.resourceId || referenceURL(reference) || reference.id
    let upload = uploads.get(uploadKey)
    if (!upload) {
      upload = uploadReference(channel, reference, signal, uploadAdapterId)
      uploads.set(uploadKey, upload)
    }
    const url = await upload
    return { ...reference, source: 'uploaded' as const, expiresAt: signedMediaExpiry(url), url, previewUrl: reference.previewUrl || url, status: 'ready' as const }
  }))
  return { ...orderedConfig, references: normalizeGenerationReferences(prepared) }
}

async function inlineImagePart(reference: GenerationReference) {
  const { blob } = await referenceBlob(reference)
  const data = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  data.forEach((byte) => { binary += String.fromCharCode(byte) })
  return { inlineData: { mimeType: blob.type || 'image/png', data: btoa(binary) } }
}

function extensionForMime(mimeType: string, variant: 'image' | 'video') {
  const known: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
  return known[mimeType.split(';', 1)[0].toLowerCase()] || (variant === 'image' ? 'png' : 'mp4')
}

function generationFileName(variant: 'image' | 'video', index: number, mimeType: string) {
  return `cnote-generation-${Date.now()}-${index + 1}.${extensionForMime(mimeType, variant)}`
}

async function materializeInlineResults(body: any, variant: 'image' | 'video') {
  const values: Array<{ data: string; mimeType?: string }> = []
  const seen = new Set<string>()
  const collect = (value: any) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.b64_json === 'string' && !seen.has(value.b64_json)) {
      seen.add(value.b64_json)
      values.push({ data: value.b64_json, mimeType: value.mimeType || value.mime_type })
    }
    const inline = value.inlineData || value.inline_data
    if (inline && typeof inline.data === 'string' && !seen.has(inline.data)) {
      seen.add(inline.data)
      values.push({ data: inline.data, mimeType: inline.mimeType || inline.mime_type })
    }
    if (Array.isArray(value)) value.forEach(collect)
    else Object.values(value).forEach(collect)
  }
  collect(body)
  const results: { url: string; resourceId: string; mimeType: string; fileName: string }[] = []
  for (const value of values) {
    const mimeType = value.mimeType || 'image/png'
    const binary = atob(value.data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const fileName = generationFileName(variant, results.length, mimeType)
    const stored = await storeLocalResource(new Blob([bytes], { type: mimeType }), fileName, true)
    results.push({ url: stored.url, resourceId: stored.resourceId, mimeType, fileName })
  }
  return results
}

async function inspectImage(blob: Blob) {
  if (typeof createImageBitmap !== 'function' || !blob.type.startsWith('image/')) return {}
  const bitmap = await createImageBitmap(blob)
  const metadata = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return metadata
}

async function materializeRemoteResults(urls: string[], variant: 'image' | 'video', signal?: AbortSignal, channel?: GenerationChannel, adapterId?: string) {
  const results: { url: string; resourceId: string; mimeType: string; fileName: string; size: number; width?: number; height?: number }[] = []
  let lastError: unknown
  for (const url of urls) {
    try {
      const response = await desktopFetch(url, { headers: channel ? authHeaders(channel, adapterId) : undefined, signal }, channel ? { secretRefs: authSecretRefs(channel, adapterId) } : undefined)
      if (!response.ok) {
        lastError = new Error(`无法下载生成结果（HTTP ${response.status}）`)
        continue
      }
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || (variant === 'image' ? 'image/png' : 'video/mp4')
    const fileName = generationFileName(variant, results.length, mimeType)
    const blob = await response.blob()
    const dimensions = variant === 'image' ? await inspectImage(blob) : {}
    const stored = await storeLocalResource(blob, fileName, true)
      results.push({ url: stored.url, resourceId: stored.resourceId, mimeType, fileName, size: blob.size, ...dimensions })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      lastError = error
    }
  }
  if (!results.length && lastError) throw lastError
  return results
}

async function parseResponse(response: Response) {
  const text = await response.text()
  let body: any = undefined
  try { body = text ? JSON.parse(text) : undefined } catch { body = text }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`
    throw new Error(String(message))
  }
  return body
}

function diagnosticResponse(value: unknown, status: GenerationTaskState['status']) {
  if (status === 'completed') {
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    return { status: record.status || record.state, requestId: record.requestId || record.request_id, resultCount: Array.isArray(record.data) ? record.data.length : undefined }
  }
  try {
    const text = JSON.stringify(value)
    return text.length > 16000 ? `${text.slice(0, 16000)}…` : value
  } catch {
    return String(value).slice(0, 16000)
  }
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function taskIdFrom(body: any) {
  return firstString(body?.task_id, body?.taskId, body?.id, body?.data?.task_id, body?.data?.taskId, body?.data?.id)
}

function statusFrom(body: any): GenerationTaskState['status'] {
  const status = String(body?.status || body?.state || body?.data?.status || '').toLowerCase()
  if (status === 'completed' || status === 'success' || status === 'succeeded' || status === 'done' || status.startsWith('succeeded')) return 'completed'
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status.startsWith('failed')) return 'failed'
  if (status === 'queued' || status === 'in_progress' || status === 'processing' || status === 'running' || status === 'generating') return 'in_progress'
  return 'unknown'
}

function resultURLsFrom(body: any) {
  const values: unknown[] = [
    body?.url,
    body?.result_url,
    body?.video_url,
    body?.image_url,
    body?.data?.url,
    body?.data?.result_url,
    body?.data?.video_url,
    body?.data?.image_url,
    body?.data?.[0]?.url,
    body?.data?.[0]?.image_url,
    body?.output?.[0]?.url,
    body?.output?.[0]?.image_url,
    body?.result?.url,
    body?.result?.result_url,
    body?.object,
    body?.outputs?.[0]?.content_url,
    body?.outputs?.[0]?.download_url,
    body?.data?.[0]?.content_url,
    body?.data?.[0]?.download_url,
    body?.video_urls?.[0],
    body?.data?.video_urls?.[0],
    body?.metadata?.url,
    body?.metadata?.result_url,
    ...(Array.isArray(body?.urls) ? body.urls : []),
    ...(Array.isArray(body?.data?.urls) ? body.data.urls : []),
  ]
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && /^(?:https?:\/\/|data:)/i.test(value)))]
}

function progressFrom(body: any) {
  const raw = body?.progress ?? body?.data?.progress
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const value = Number.parseFloat(raw.replace('%', ''))
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function errorFrom(body: any) {
  const status = typeof body?.status === 'string' && body.status.toLowerCase().startsWith('failed') ? body.status.slice(body.status.indexOf(':') + 1).trim() : undefined
  return String(body?.error?.message || body?.error_message || body?.error || body?.message || status || '生成服务返回失败')
}

function contractPath(path: string | undefined, taskId: string, fallback: string) {
  return (path || fallback).replace('{id}', encodeURIComponent(taskId))
}

function pollPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && protocol === 'openai-images') return `/images/tasks/${encodeURIComponent(taskId)}?response_format=url`
  if (variant === 'video') return contractPath(generationVideoRequestContractForModel(channel, context.model, context.config.adapterId)?.pollPath, taskId, '/v1/videos/{id}')
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}`
}

function contentPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && (protocol === 'openai-images' || protocol === 'google-images')) return undefined
  if (variant === 'video') {
    const path = generationVideoRequestContractForModel(channel, context.model, context.config.adapterId)?.contentPath
    return path ? contractPath(path, taskId, '/v1/videos/{id}/content') : '/v1/videos/' + encodeURIComponent(taskId) + '/content'
  }
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}/content`
}

function ensureProviderReadableReferences(references: GenerationReference[], requiresPublicHttps = false) {
  const invalid = references.find((reference) => {
    const value = referenceURL(reference)
    return requiresPublicHttps ? !/^https:\/\//i.test(value) : !/^https:\/\//i.test(value) && !/^data:/i.test(value)
  })
  if (invalid) {
    throw new Error(requiresPublicHttps
      ? `参考文件“${invalid.label || invalid.fileName || invalid.id}”必须是公网 HTTPS 地址`
      : `参考文件“${invalid.label || invalid.fileName || invalid.id}”尚未转换为公网 HTTPS 地址或内联 Data URL`)
  }
}

export async function submitGenerationTask(context: GenerationRequestContext, signal?: AbortSignal): Promise<GenerationTaskResponse> {
  const { model, variant } = context
  const initialConfig = variant === 'video' ? normalizeVideoModeConfig(context.config, model) : context.config
  let videoResolution: string | undefined
  if (variant === 'video') {
    try { videoResolution = validateVideoConfig(model, initialConfig) } catch (error) { throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error) }
  }
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, initialConfig.adapterId, model.id) }
  const videoContract = variant === 'video' ? generationVideoRequestContractForModel(channel, model, initialConfig.adapterId) : undefined
  await assertDesktopSecretReady(channel, initialConfig.adapterId)
  const baseURL = normalizeBaseURL(channel.baseURL)
  if (!baseURL || baseURL.startsWith('local://')) throw new Error('当前生成渠道没有可用的公网接口地址')
  let config: GenerationVariantConfig
  try { config = await prepareReferenceConfig({ ...context, config: initialConfig, channel }, signal) } catch (error) {
    throw new GenerationStageError('preparation', error instanceof Error ? error.message : String(error), error)
  }
  const protocol = protocolFor(channel)
  if (variant === 'video') { try { ensureProviderReadableReferences(config.references, videoContract?.requiresPublicHttps) } catch (error) { throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error) } }

  let body: Record<string, unknown> | undefined
  let requestURL = ''
  let requestBody: BodyInit = JSON.stringify({})
  const headers: Record<string, string> = authHeaders(channel, initialConfig.adapterId)

  if (variant === 'image') {
    try { validateImageConfig(model, config) } catch (error) { throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error) }
  }
  if (variant === 'image' && protocol === 'openai-images') {
    const imageReferences = config.references.filter((reference) => reference.type === 'image')
    const operation = imageReferences.length ? 'edits' : 'generations'
    body = {
      model: model.id,
      prompt: config.prompt,
      size: imageSizeForConfig(config, model),
      quality: config.quality === 'standard' ? 'medium' : config.quality || model.defaultQuality || 'medium',
      background: config.background || 'auto',
      output_format: config.outputFormat || 'png',
      ...(config.outputCompression !== undefined ? { output_compression: config.outputCompression } : {}),
      ...(config.moderation ? { moderation: config.moderation } : {}),
      n: Math.max(1, Math.min(10, Math.trunc(config.outputCount || 1))),
    }
    requestURL = openAIImagesEndpoint(baseURL, operation)
    if (!imageReferences.length) {
      requestBody = JSON.stringify(body)
    } else {
      const form = new FormData()
      Object.entries(body).forEach(([key, value]) => form.append(key, String(value)))
      for (const reference of imageReferences) {
        const file = await referenceBlob(reference)
        form.append('image[]', file.blob, file.fileName)
      }
      requestBody = form
      delete headers['Content-Type']
    }
  } else if (variant === 'image' && protocol === 'google-images') {
    const parts: Array<Record<string, unknown>> = []
    if (config.prompt.trim()) parts.push({ text: config.prompt })
    for (const reference of config.references.filter((item) => item.type === 'image')) parts.push(await inlineImagePart(reference))
    body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: config.aspectRatio || '1:1',
          imageSize: config.resolution === '512px' ? '512' : config.resolution || '2K',
        },
        ...(config.thinkingLevel ? { thinkingConfig: { thinkingLevel: config.thinkingLevel.toUpperCase() } } : {}),
      },
    }
    requestURL = geminiGenerateContentEndpoint(baseURL, model.id)
    requestBody = JSON.stringify(body)
  } else if (variant === 'video' && isVideoGenerationProtocol(protocol)) {
    const firstFrame = config.references.find((reference) => reference.role === 'first_frame')
    const lastFrame = config.references.find((reference) => reference.role === 'last_frame')
    const images = config.references.filter((reference) => reference.type === 'image' && !['first_frame', 'last_frame'].includes(reference.role || '')).map(referenceURL)
    const videos = config.references.filter((reference) => reference.type === 'video').map(referenceURL)
    const audios = config.references.filter((reference) => reference.type === 'audio').map(referenceURL)
    body = {
      model: model.id,
      [videoContract?.durationField || 'seconds']: config.seconds || model.defaultDuration || 5,
      [videoContract?.resolutionField || 'resolution']: videoResolution || normalizeVideoResolution(config.resolution),
      [videoContract?.aspectRatioField || 'aspect_ratio']: config.aspectRatio || '16:9',
      prompt: config.prompt,
      ...(firstFrame && videoContract?.firstFrameField ? { [videoContract.firstFrameField]: referenceURL(firstFrame) } : {}),
      ...(lastFrame && videoContract?.lastFrameField ? { [videoContract.lastFrameField]: referenceURL(lastFrame) } : {}),
      ...(images.length && videoContract?.imageReferencesField ? { [videoContract.imageReferencesField]: images } : {}),
      ...(videos.length && videoContract?.videoReferencesField ? { [videoContract.videoReferencesField]: videos } : {}),
      ...(audios.length && videoContract?.audioReferencesField ? { [videoContract.audioReferencesField]: audios } : {}),
      ...(model.capabilities.includes('generate-audio') && videoContract?.generateAudioField ? { [videoContract.generateAudioField]: Boolean(config.generateAudio) } : {}),
    }
    requestURL = joinVersionedEndpoint(baseURL, videoContract?.createPath || '/v1/videos')
    requestBody = JSON.stringify(body)
    try { assertInlineRequestSize(requestBody) } catch (error) {
      throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error)
    }
  } else {
    throw new Error('当前生成渠道未配置受支持的图片或视频协议')
  }
  const response = await desktopFetch(requestURL, {
    method: 'POST',
    headers,
    body: requestBody,
    signal,
  }, { secretRefs: authSecretRefs(channel, config.adapterId) })
  let parsed: any
  try { parsed = await parseResponse(response) } catch (error) { throw new GenerationStageError('creation', error instanceof Error ? error.message : String(error), error) }
  const inlineResults = await materializeInlineResults(parsed, variant)
  const remoteResults = await materializeRemoteResults(resultURLsFrom(parsed), variant, signal, channel, config.adapterId)
  const immediateResults = [...remoteResults, ...inlineResults]
  const immediateResultUrls = immediateResults.map((result) => result.url)
  const taskId = taskIdFrom(parsed)
  if (!taskId && immediateResultUrls.length) return { taskId: `completed-${crypto.randomUUID()}`, resultUrls: immediateResultUrls, resultResourceIds: immediateResults.map((result) => result.resourceId), resultMimeTypes: immediateResults.map((result) => result.mimeType), resultFileNames: immediateResults.map((result) => result.fileName), preparedConfig: config, raw: parsed }
  if (!taskId) throw new Error('生成服务没有返回 task_id')
  return { taskId, resultUrls: immediateResultUrls, resultResourceIds: immediateResults.map((result) => result.resourceId), resultMimeTypes: immediateResults.map((result) => result.mimeType), resultFileNames: immediateResults.map((result) => result.fileName), preparedConfig: config, raw: parsed }
}

export async function pollGenerationTask(context: GenerationRequestContext, taskId: string, signal?: AbortSignal): Promise<GenerationPollResponse> {
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, context.config.adapterId, context.model.id) }
  await assertDesktopSecretReady(channel, context.config.adapterId)
  const baseURL = normalizeBaseURL(channel.baseURL)
  const response = await desktopFetch(joinVersionedEndpoint(baseURL, pollPath(context, taskId)), {
    method: 'GET',
    headers: authHeaders(channel, context.config.adapterId),
    signal,
  }, { secretRefs: authSecretRefs(channel, context.config.adapterId) })
  let parsed: any
  try { parsed = await parseResponse(response) } catch (error) { throw new GenerationStageError('polling', error instanceof Error ? error.message : String(error), error) }
  const status = statusFrom(parsed)
  const inlineResults = await materializeInlineResults(parsed, context.variant)
  const remoteResults = status === 'completed' ? await materializeRemoteResults(resultURLsFrom(parsed), context.variant, signal, channel, context.config.adapterId) : []
  const materializedResults = [...remoteResults, ...inlineResults]
  const resultUrls = materializedResults.map((result) => result.url)
  const task: GenerationTaskState = {
    taskId,
    provider: channel.providerId,
    channelId: channel.id,
    model: context.model.id,
    status,
    rawStatus: String(parsed?.status || parsed?.state || parsed?.data?.status || ''),
    rawResponse: diagnosticResponse(parsed, statusFrom(parsed)),
    resultUrls,
    resultResourceIds: inlineResults.length ? inlineResults.map((result) => result.resourceId) : undefined,
    resultMimeTypes: inlineResults.length ? inlineResults.map((result) => result.mimeType) : undefined,
    progress: progressFrom(parsed),
    error: status === 'failed' ? errorFrom(parsed) : undefined,
    lastPolledAt: Date.now(),
  }
  const resultPath = contentPath(context, taskId)
  if (status === 'completed' && !resultUrls.length && resultPath) {
    try {
      const contentResponse = await desktopFetch(joinVersionedEndpoint(baseURL, resultPath), {
        method: 'GET',
        headers: authHeaders(channel, context.config.adapterId),
        signal,
      }, { secretRefs: authSecretRefs(channel, context.config.adapterId) })
      if (contentResponse.ok && contentResponse.headers.get('content-type')?.includes('application/json')) {
        const contentBody = await contentResponse.json()
        const contentInlineResults = await materializeInlineResults(contentBody, context.variant)
        const contentRemoteResults = await materializeRemoteResults(resultURLsFrom(contentBody), context.variant, signal, channel, context.config.adapterId)
        const contentResults = [...contentRemoteResults, ...contentInlineResults]
        task.resultUrls = contentResults.map((result) => result.url)
        task.resultResourceIds = contentResults.length ? contentResults.map((result) => result.resourceId) : undefined
        task.resultMimeTypes = contentResults.length ? contentResults.map((result) => result.mimeType) : undefined
        task.resultFileNames = contentResults.length ? contentResults.map((result) => result.fileName) : undefined
      } else if (contentResponse.ok) {
        const declaredType = contentResponse.headers.get('content-type')?.split(';', 1)[0]?.trim()
        const contentType = declaredType && declaredType !== 'application/octet-stream'
          ? declaredType
          : context.variant === 'image' ? 'image/png' : 'video/mp4'
        const blob = await contentResponse.blob()
        if (blob.size > 0) {
          const stored = await storeLocalResource(new Blob([blob], { type: contentType }), generationFileName(context.variant, 0, contentType), true)
          task.resultUrls = [stored.url]
          task.resultResourceIds = [stored.resourceId]
          task.resultMimeTypes = [contentType]
        }
      }
    } catch {
      // Some providers expose the content endpoint only as an authenticated
      // binary stream. Keep the task ID and let the next persistence pass save it.
    }
  }
  return { task, raw: parsed }
}

/** Best-effort remote cancellation. Providers without a cancel contract are still stopped locally. */
export async function cancelGenerationTask(context: GenerationRequestContext, taskId: string, signal?: AbortSignal) {
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, context.config.adapterId, context.model.id) }
  const baseURL = normalizeBaseURL(channel.baseURL)
  const endpoint = joinVersionedEndpoint(baseURL, pollPath(context, taskId))
  try {
    await assertDesktopSecretReady(channel, context.config.adapterId)
    const response = await desktopFetch(endpoint, {
      method: 'DELETE',
      headers: authHeaders(channel, context.config.adapterId),
      signal,
    }, { secretRefs: authSecretRefs(channel, context.config.adapterId) })
    return response.ok || response.status === 404 || response.status === 405
  } catch {
    return false
  }
}

export function pollIntervalForModel(model: GenerationModel) {
  return Math.max(5000, model.pollIntervalMs || 10000)
}

function waitForPoll(intervalMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('执行已停止', 'AbortError'))
      return
    }
    const timer = globalThis.setTimeout(resolve, intervalMs)
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      reject(new DOMException('执行已停止', 'AbortError'))
    }, { once: true })
  })
}

export async function runGenerationTask(
  context: GenerationRequestContext,
  options: GenerationRunOptions,
): Promise<GenerationTaskState> {
  const submittedAt = options.submittedAt || Date.now()
  const timeoutAt = submittedAt + options.timeoutMs
  let taskId = options.taskId

  if (!taskId) {
    options.onTaskUpdate?.({
      status: 'validating',
      provider: context.channel.providerId,
      channelId: context.channel.id,
      model: context.model.id,
      submittedAt,
      timeoutAt,
      elapsedMs: 0,
    })
    const submitted = await submitGenerationTask(context, options.signal)
    options.onConfigPrepared?.(submitted.preparedConfig || context.config)
    taskId = submitted.taskId
    if (submitted.resultUrls?.length) {
      const completed: GenerationTaskState = {
        taskId,
        provider: context.channel.providerId,
        channelId: context.channel.id,
        model: context.model.id,
        status: 'completed',
        submittedAt,
        completedAt: Date.now(),
        elapsedMs: Date.now() - submittedAt,
        timeoutAt,
        resultUrls: submitted.resultUrls,
        resultResourceIds: submitted.resultResourceIds,
        resultMimeTypes: submitted.resultMimeTypes,
        resultFileNames: submitted.resultFileNames,
      }
      options.onTaskUpdate?.(completed)
      return completed
    }
    options.onTaskUpdate?.({
      taskId,
      provider: context.channel.providerId,
      channelId: context.channel.id,
      model: context.model.id,
      status: 'queued',
      submittedAt,
      timeoutAt,
      elapsedMs: 0,
    })
  }

  const interval = pollIntervalForModel(context.model)
  try {
    while (taskId) {
    const elapsedMs = Date.now() - submittedAt
    if (Date.now() >= timeoutAt) {
      const timeout: GenerationTaskState = { taskId, provider: context.channel.providerId, channelId: context.channel.id, model: context.model.id, status: 'timeout', submittedAt, elapsedMs, timeoutAt }
      options.onTaskUpdate?.(timeout)
      return timeout
    }
    const polled = await pollGenerationTask(context, taskId, options.signal)
    const next: GenerationTaskState = { ...polled.task, taskId, submittedAt, elapsedMs: Date.now() - submittedAt, timeoutAt }
    options.onTaskUpdate?.(next)
    if (next.status === 'completed' || next.status === 'failed' || next.status === 'unknown') return next
      await waitForPoll(interval, options.signal)
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError' && taskId) {
      await options.onCancel?.(taskId)
    }
    throw error
  }

  throw new Error('生成任务没有有效 task_id')
}






