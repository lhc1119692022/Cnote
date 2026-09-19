import { generationAdapterForConfig, generationAdapterForModel, generationMediaUploadSecretName, generationProtocolForChannel, generationSecretName, generationVideoRequestContractForModel, isVideoGenerationProtocol, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { MEDIA_STORAGE_DEFAULTS, useMediaStorageStore, notifyMediaStorageChanged } from '@/stores/use-media-storage-store'
import { reuseMediaUpload } from './media-upload-cache'
import { inspectMediaUrl, MediaReadinessError } from './media-readiness'
import { safeGenerationError } from './safe-error'
import type { GenerationReference, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'
import { normalizeGenerationReferences } from '@/lib/generation/defaults'
import { normalizeVideoModeConfig, videoReferenceError } from './video-mode'
import { loadLocalResourceBlob, loadLocalResourceUrl, storeLocalResource } from '@/lib/resource-storage'
import { desktopFetch } from '@/lib/desktop-fetch'
import { resolveMediaTransport, assertGenerationRequestSize, assertMediaLifetime, assertAnonymousCompleteFileUrl, signedMediaExpiry } from './media-policy'
import { officialMediaProfile, officialRequestLimitError, withOfficialMediaCapabilities } from './official-media-rules'
import { validateOfficialMediaReferences } from './media-inspection'
import { ensureDesktopSecret, syncDesktopSecret } from '@/lib/desktop-secrets'
import { is808VideoChannel, resolve808WanModel, resolveKacangModel, seedance808RequestMode } from './video-catalog'
import { parseRequestDiagnostics, type GenerationRequestDiagnostics } from './request-diagnostics'

export interface GenerationRequestContext {
  channel: GenerationChannel
  model: GenerationModel
  config: GenerationVariantConfig
  variant: 'image' | 'video'
}

export interface GenerationTaskResponse {
  requestDiagnostics?: GenerationRequestDiagnostics
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
    super(`${stage}: ${safeGenerationError(message)}`)
    this.name = 'GenerationStageError'
  }
}

class GenerationHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'GenerationHttpError'
  }
}

export interface GenerationRunOptions {
  taskId?: string
  submittedAt?: number
  timeoutMs: number
  signal?: AbortSignal
  onTaskUpdate?: (task: GenerationTaskState) => void
  onRemoteTaskId?: (taskId: string) => void | Promise<void>
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
  model = withOfficialMediaCapabilities(model)
  const referenceError = videoReferenceError(model, config)
  if (referenceError) throw new Error(referenceError)
  if (config.generateAudio && !model.capabilities.includes('generate-audio')) throw new Error(`${model.name} 未配置生成音频能力`)
  const inferredVideoModel = model.capabilitySource === 'inferred' && model.capabilities.some((capability) => capability.endsWith('-to-video') || ['video-reference', 'audio-reference', 'video-edit', 'generate-audio'].includes(capability))
  const seconds = config.seconds ?? 5
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('视频时长必须是正整数秒数')
  if (!inferredVideoModel && model.allowedDurations?.length && !model.allowedDurations.includes(seconds)) throw new Error(`${model.name} 时长只能为 ${model.allowedDurations.join(' 或 ')} 秒`)
  if (!inferredVideoModel && (model.minDuration && seconds < model.minDuration || model.maxDuration && seconds > model.maxDuration)) throw new Error(`${model.name} 时长必须为 ${model.minDuration}-${model.maxDuration} 秒`)
  const resolution = videoResolutionForModel(config.resolution, model)
  const contract = model.videoRequestContract
  const maxDuration = contract?.maxDurationByResolution?.[resolution.toLowerCase()]
  if (maxDuration !== undefined && seconds > maxDuration) throw new Error(`${model.name} 在 ${resolution} 下最长 ${maxDuration} 秒`)
  const referenceImages = config.references.filter((reference) => reference.type === 'image' && reference.role !== 'first_frame' && reference.role !== 'last_frame')
  if (referenceImages.length < (contract?.minReferenceImages || 0)) throw new Error(`${model.name} 至少需要 ${contract?.minReferenceImages} 张参考图片`)
  if (referenceImages.length && contract?.referenceResolutions && !contract.referenceResolutions.includes(resolution.toLowerCase())) throw new Error(`${model.name} 参考图模式仅支持 ${contract.referenceResolutions.join('、')}，请调整分辨率`)
  if (contract?.maxPromptLength && Array.from(config.prompt).length > contract.maxPromptLength) throw new Error(`${model.name} 提示词最多 ${contract.maxPromptLength} 个字符`)
  if (!inferredVideoModel && !model.allowCustomResolution && model.resolutions?.length && !model.resolutions.some((item) => normalizeVideoResolution(item).toLowerCase() === normalizeVideoResolution(resolution).toLowerCase())) throw new Error(`${model.name} 不支持 ${resolution}`)
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
  const response = await desktopFetch(url, undefined, { timeoutMs: 120_000 })
  if (!response.ok || response.status === 206) {
    throw new Error(explainReferenceFetchError(`无法读取参考文件“${reference.label || reference.id}”（HTTP ${response.status}）`, response.status))
  }
  const blob = await response.blob()
  return { blob, fileName: reference.fileName || `${reference.id}.${blob.type.split('/')[1] || 'bin'}` }
}

function isProviderMediaUrl(value: string, channel: GenerationChannel, adapterId?: string) {
  const protocol = generationAdapterForConfig(channel, adapterId)?.protocol || channel.protocol
  return isHttpsUrl(value) || (is808VideoChannel(channel, protocol) && value.toLowerCase().startsWith('http://'))
}

function isHttpsUrl(value: string) {
  return /^https:\/\//i.test(value)
}

function isRemoteMediaURL(value: string) {
  return /^https?:\/\//i.test(value)
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
    transport: is808VideoChannel(channel, adapter?.protocol || channel.protocol)
      ? channel.mediaTransport ?? adapter?.mediaTransport
      : adapter?.mediaTransport ?? channel.mediaTransport,
    fieldName: adapter?.mediaUploadField || channel.mediaUploadField || MEDIA_STORAGE_DEFAULTS.fieldName,
    responsePath: adapter?.mediaUploadResponsePath || channel.mediaUploadResponsePath || MEDIA_STORAGE_DEFAULTS.responsePath,
  }
}

function mediaUploadEndpoint(channel: GenerationChannel, adapterId?: string): MediaUploadEndpoint {
  const settings = mediaUploadSettings(channel, adapterId)
  const mediaStorage = useMediaStorageStore.getState()
  const customConfigured = Boolean(mediaStorage.baseURL || channel.mediaUploadURL)
  resolveMediaTransport(settings.transport, customConfigured)
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
    const token = endpoint.token.trim().replace(/^Bearer\s+/i, '')
    await syncDesktopSecret(endpoint.secretName, token ? `Bearer ${token}` : '')
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
  return reuseMediaUpload(JSON.stringify(endpoint), blob, async (checksum) => {
    const form = new FormData()
    form.append(endpoint.fieldName, blob, fileName)
    form.append('purpose', 'generation')
    form.append('checksum', checksum)
    const response = await desktopFetch(endpoint.endpoint, {
      method: 'POST',
      headers: mediaUploadHeaders(endpoint),
      body: form,
      signal,
    }, { secretRefs: mediaUploadSecretRefs(endpoint) })
    const payload = await parseResponse(response)
    const url = uploadedReferenceUrl(payload, endpoint.responsePath)
    if (!url || !isProviderMediaUrl(url, channel, adapterId)) throw new Error(`上传参考文件“${reference.label || reference.id}”后没有得到可用公网媒体地址`)
    assertMediaLifetime(signedMediaExpiry(url))
    notifyMediaStorageChanged()
    return url
  }, signal)
}

/** Performs a small multipart upload without submitting a generation task. */
export async function testGenerationMediaUpload(channel: GenerationChannel, adapterId?: string, signal?: AbortSignal): Promise<{ url?: string; message?: string }> {
  const settings = mediaUploadSettings(channel, adapterId)
  resolveMediaTransport(settings.transport, Boolean(useMediaStorageStore.getState().baseURL || channel.mediaUploadURL))
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  await assertMediaUploadSecretReady(endpoint)
  const form = new FormData()
  const testBlob = new Blob(['cnote upload test'], { type: 'application/octet-stream' })
  const url = await reuseMediaUpload(JSON.stringify(endpoint), testBlob, async (checksum) => {
    form.append(endpoint.fieldName, testBlob, 'cnote-upload-test.bin')
    form.append('checksum', checksum)
    form.append('purpose', 'generation-test')
    const response = await desktopFetch(endpoint.endpoint, {
      method: 'POST',
      headers: mediaUploadHeaders(endpoint),
      body: form,
      signal,
    }, { secretRefs: mediaUploadSecretRefs(endpoint) })
    const payload = await parseResponse(response)
    const url = uploadedReferenceUrl(payload, endpoint.responsePath)
    if (!url || !isProviderMediaUrl(url, channel, adapterId)) throw new Error('上传接口响应中没有可匿名访问的公网媒体地址')
    notifyMediaStorageChanged()
    return url
  }, signal)
  return { url }
}

async function prepareManagedReference(channel: GenerationChannel, reference: GenerationReference, signal?: AbortSignal, adapterId?: string) {
  const storage = useMediaStorageStore.getState()
  if (!storage.baseURL && !channel.mediaUploadURL) return referenceURL(reference)
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  const url = new URL(referenceURL(reference))
  const service = new URL(endpoint.endpoint)
  if (url.origin !== service.origin || !url.pathname.startsWith('/media/')) return url.href
  await assertMediaUploadSecretReady(endpoint)
  const key = decodeURIComponent(url.pathname.slice('/media/'.length))
  const response = await desktopFetch(new URL('/prepare', service).href, {
    method: 'POST', headers: { ...mediaUploadHeaders(endpoint), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }), signal,
  }, { secretRefs: mediaUploadSecretRefs(endpoint), timeoutMs: 120000 })
  if (response.status === 404) {
    const body = await response.json().catch(() => ({}))
    if (body?.error === 'Media not found') throw new MediaReadinessError('远端素材已删除', true)
    throw new Error('当前媒体 Worker 不支持保留期准备，请先部署升级版 Worker')
  }
  const payload = await parseResponse(response)
  const preparedUrl = uploadedReferenceUrl(payload, endpoint.responsePath)
  if (!preparedUrl || !isProviderMediaUrl(preparedUrl, channel, adapterId) || new URL(preparedUrl).origin !== service.origin) throw new Error('媒体准备接口未返回同源公网地址')
  if (payload.renewed) notifyMediaStorageChanged()
  return preparedUrl
}

async function prepareReferenceConfig(context: GenerationRequestContext, signal?: AbortSignal) {
  const { channel, config, variant } = context
  const adapter = generationAdapterForModel(channel, context.model.id, config.adapterId)
  const references = normalizeGenerationReferences(config.references || [])
  const orderedConfig = { ...config, references }
  // Image protocols receive local files directly in their request body. They
  // must never be routed through a video-style public URL conversion step.
  if (variant === 'image') return orderedConfig
  const is808 = is808VideoChannel(channel, adapter?.protocol || channel.protocol)
  const readable = (url: string) => isHttpsUrl(url) || (is808 && url.toLowerCase().startsWith('http://'))
  const uploadAdapterId = config.adapterId || adapter?.id
  const prepared = await Promise.all(references.map(async (reference) => {
    try {
      let url = referenceURL(reference)
      if (readable(url)) {
        try {
          url = await prepareManagedReference(channel, reference, signal, uploadAdapterId)
          const inspected = await inspectMediaUrl(url, reference.type, signal)
          return { ...reference, url, expiresAt: inspected.expiresAt, status: 'ready' as const }
        } catch (error) {
          if (!(error instanceof MediaReadinessError) || !error.recoverable || !reference.resourceId) throw error
          const local = await loadLocalResourceBlob(reference.resourceId)
          if (!local) throw new Error('远端素材失效，且没有可用本地副本，请重新添加素材')
          reference = { ...reference, url: undefined, previewUrl: undefined }
        }
      }
      resolveMediaTransport(mediaUploadSettings(channel, uploadAdapterId).transport, Boolean(useMediaStorageStore.getState().baseURL || channel.mediaUploadURL))
      url = await uploadReference(channel, reference, signal, uploadAdapterId)
      const inspected = await inspectMediaUrl(url, reference.type, signal)
      return { ...reference, source: 'uploaded' as const, expiresAt: inspected.expiresAt, url, previewUrl: reference.previewUrl || url, status: 'ready' as const }
    } catch (error) {
      signal?.throwIfAborted()
      throw new Error('参考素材“' + (reference.label || reference.fileName || reference.id) + '”：' + (error instanceof Error ? error.message : String(error)))
    }
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
      if (!response.ok || response.status === 206) {
        lastError = new Error(explainReferenceFetchError(`无法下载生成结果（HTTP ${response.status}）`, response.status))
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

function explainReferenceFetchError(message: string, status?: number) {
  const partialContent = status === 206 || /(?:reference image|参考素材|Failed to fetch reference)[^\n]*(?:HTTP\s*)?206/i.test(message)
  if (!partialContent || /Kacang 要求完整的 HTTP 200 文件/.test(message)) return message
  return `${message}；Kacang 要求参考素材返回完整的 HTTP 200 文件，但当前地址在 Range 请求下返回了 HTTP 206。请使用媒体 Worker 公网源站托管，不要使用 R2 公共开发域名、S3 直链或预览/分段代理地址。`
}

async function parseResponse(response: Response) {
  const text = await response.text()
  let body: any = undefined
  try { body = text ? JSON.parse(text) : undefined } catch { body = text }
  if (!response.ok || response.status === 206) {
    const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`
    const code = body?.error?.code || body?.code
    const type = body?.error?.type
    const requestId = body?.request_id || body?.requestId || response.headers.get('x-request-id') || response.headers.get('request-id')
    const taskId = taskIdFrom(body)
    const details = ['HTTP ' + response.status, code, type, requestId, taskId].filter(value => typeof value === 'string' || typeof value === 'number').join('；')
    throw new GenerationHttpError(response.status, safeGenerationError(explainReferenceFetchError(String(message), response.status) + '（' + details + '）'))
  }
  return body
}

function diagnosticResponse(value: unknown, status: GenerationTaskState['status']) {
  if (status === 'completed') {
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    return { status: record.status || record.state, requestId: record.requestId || record.request_id, resultCount: Array.isArray(record.data) ? record.data.length : undefined }
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, any>
  const error = record.error || record.data?.error || record.task?.error || record.data?.task?.error
  return {
    status: safeGenerationError(record.status || record.state || status),
    request_id: typeof (record.request_id || record.requestId) === 'string' ? safeGenerationError(record.request_id || record.requestId) : undefined,
    error: { message: safeGenerationError(error?.message || (typeof error === 'string' ? error : '生成服务返回失败')), code: typeof error?.code === 'string' ? safeGenerationError(error.code) : undefined, type: typeof error?.type === 'string' ? safeGenerationError(error.type) : undefined },
  }
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function taskIdFrom(body: any) {
  return firstString(
    body?.task_id,
    body?.taskId,
    body?.id,
    body?.data?.task_id,
    body?.data?.taskId,
    body?.data?.id,
    body?.task?.task_id,
    body?.task?.taskId,
    body?.task?.id,
    body?.data?.task?.task_id,
    body?.data?.task?.taskId,
    body?.data?.task?.id,
  )
}

function rawStatusFrom(body: any) {
  return firstString(
    body?.status,
    body?.state,
    body?.data?.status,
    body?.data?.state,
    body?.task?.status,
    body?.task?.state,
    body?.data?.task?.status,
    body?.data?.task?.state,
  ) || ''
}

function statusFrom(body: any): GenerationTaskState['status'] {
  const status = rawStatusFrom(body).toLowerCase().replace(/[-\s]+/g, '_')
  if (status === 'completed' || status === 'success' || status === 'succeeded' || status === 'done' || status.startsWith('succeeded')) return 'completed'
  if (status === 'failed' || status === 'failure' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'expired' || status === 'rejected' || status.startsWith('failed')) return 'failed'
  if (status === 'queued' || status === 'pending' || status === 'created' || status === 'submitted' || status === 'waiting' || status === 'starting' || status === 'in_progress' || status === 'processing' || status === 'running' || status === 'generating' || status === 'rendering' || status === 'uploading') return 'in_progress'
  if (body?.error || body?.error_message || body?.data?.error || body?.data?.error_message) return 'failed'
  if (taskIdFrom(body)) return 'in_progress'
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
    body?.metadata?.video_url,
    body?.video?.url,
    body?.data?.metadata?.url,
    body?.data?.metadata?.result_url,
    body?.data?.metadata?.video_url,
    body?.data?.video?.url,
    body?.task?.url,
    body?.task?.result_url,
    body?.task?.video_url,
    body?.task?.metadata?.url,
    body?.task?.metadata?.result_url,
    body?.task?.metadata?.video_url,
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
  const status = typeof rawStatusFrom(body) === 'string' && rawStatusFrom(body).toLowerCase().startsWith('failed') ? rawStatusFrom(body).slice(rawStatusFrom(body).indexOf(':') + 1).trim() : undefined
  const message = String(body?.error?.message || body?.error_message || body?.error || body?.message || body?.data?.error?.message || body?.data?.error_message || body?.data?.error || body?.task?.error?.message || body?.task?.error || body?.data?.task?.error?.message || body?.data?.task?.error || status || '生成服务返回失败')
  const code = body?.error?.code || body?.data?.error?.code || body?.task?.error?.code || body?.data?.task?.error?.code
  const taskId = taskIdFrom(body)
  const requestId = body?.request_id || body?.requestId || body?.data?.request_id
  const details = [typeof code === 'string' ? code : undefined, taskId, requestId].filter(value => typeof value === 'string')
  return safeGenerationError(explainReferenceFetchError(message) + (details.length ? '（' + details.join('；') + '）' : ''))
}

function httpStatusFrom(error: unknown): number | undefined {
  if (error instanceof GenerationHttpError) return error.status
  if (error instanceof GenerationStageError) return httpStatusFrom(error.cause)
  if (error && typeof error === 'object') {
    const status = Number((error as { status?: unknown }).status)
    if (Number.isInteger(status) && status > 0) return status
  }
  const match = String(error instanceof Error ? error.message : error).match(/HTTP\s+(\d{3})/i)
  return match ? Number(match[1]) : undefined
}

function isRetryablePollingError(error: unknown) {
  const status = httpStatusFrom(error)
  if (status !== undefined) return [408, 425, 429, 500, 502, 503, 504].includes(status)
  return /(?:fetch failed|network request|network error|timed out|timeout|原生网络层中止)/i.test(String(error instanceof Error ? error.message : error))
}

function generateAudioFieldName(model: GenerationModel, videoContract?: { generateAudioField?: string }) {
  if (!model.capabilities.includes('generate-audio')) return undefined
  const field = videoContract?.generateAudioField
  if (!field || field === 'sound_effects') return 'generate_audio'
  return field
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

function ensureProviderReadableReferences(references: GenerationReference[], requiresPublicHttps = false, allowHttp = false) {
  const invalid = references.find((reference) => {
    const value = referenceURL(reference)
    if (!requiresPublicHttps && allowHttp && value.toLowerCase().startsWith('http://')) return false
    return !/^https:\/\//i.test(value)
  })
  if (invalid) {
    throw new Error(requiresPublicHttps
      ? `参考文件“${invalid.label || invalid.fileName || invalid.id}”必须是公网 HTTPS 地址`
      : `参考文件“${invalid.label || invalid.fileName || invalid.id}”尚未上传到自定义媒体存储`)
  }
  if (requiresPublicHttps) references.forEach((reference) => assertAnonymousCompleteFileUrl(referenceURL(reference)))
}

export async function submitGenerationTask(context: GenerationRequestContext, signal?: AbortSignal, onPrepared?: (diagnostics: GenerationRequestDiagnostics) => void): Promise<GenerationTaskResponse> {
  const selectedProtocol = protocolFor(context.channel, context.config.adapterId, context.model.id)
  const documented = context.variant === 'video' ? resolve808WanModel(context.channel, context.model.id, selectedProtocol) || resolveKacangModel(context.channel, context.model.id, selectedProtocol) : undefined
  if (documented) context = { ...context, model: documented }
  if (context.variant === 'video') context = { ...context, model: withOfficialMediaCapabilities(context.model) }
  const { model, variant } = context
  const initialConfig = variant === 'video' ? normalizeVideoModeConfig(context.config, model) : context.config
  if (documented && (!initialConfig.aspectRatio || initialConfig.aspectRatio === 'auto')) initialConfig.aspectRatio = '16:9'
  let videoResolution: string | undefined
  if (variant === 'video') {
    try {
      videoResolution = validateVideoConfig(model, initialConfig)
      const profile = officialMediaProfile(model.id)
      const promptError = profile && officialRequestLimitError(profile, initialConfig)
      if (promptError) throw new Error(promptError)
      const violations = await validateOfficialMediaReferences(model.id, initialConfig, signal)
      if (violations.length) throw new Error(violations.map((item) => item.message).join('\n'))
    } catch (error) { throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error) }
  }
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, initialConfig.adapterId, model.id) }
  const videoContract = variant === 'video' ? generationVideoRequestContractForModel(channel, model, initialConfig.adapterId) : undefined
  if (variant === 'video') {
    for (const reference of initialConfig.references) {
      const frameRole = reference.type === 'image' && (reference.role === 'first_frame' || reference.role === 'last_frame') ? reference.role : undefined
      const field = frameRole === 'first_frame' ? videoContract?.firstFrameField
        : frameRole === 'last_frame' ? videoContract?.lastFrameField
          : reference.type === 'image' ? videoContract?.imageReferencesField
            : reference.type === 'video' ? videoContract?.videoReferencesField : videoContract?.audioReferencesField
      const label = frameRole === 'first_frame' ? '首帧' : frameRole === 'last_frame' ? '尾帧' : `参考${{ image: '图片', video: '视频', audio: '音频' }[reference.type]}`
      if (!field) throw new GenerationStageError('validation', `${label}没有配置请求字段，已停止提交，未上传或丢弃素材`)
    }
  }
  await assertDesktopSecretReady(channel, initialConfig.adapterId)
  const baseURL = normalizeBaseURL(channel.baseURL)
  if (!baseURL || baseURL.startsWith('local://')) throw new Error('当前生成渠道没有可用的公网接口地址')
  let config: GenerationVariantConfig
  try { config = await prepareReferenceConfig({ ...context, config: initialConfig, channel }, signal) } catch (error) {
    throw new GenerationStageError('preparation', error instanceof Error ? error.message : String(error), error)
  }
  const protocol = protocolFor(channel)
  if (variant === 'video') { try { ensureProviderReadableReferences(config.references, videoContract?.requiresPublicHttps, is808VideoChannel(channel, protocol)) } catch (error) { throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error) } }

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
    const firstFrame = config.references.find((reference) => reference.type === 'image' && reference.role === 'first_frame')
    const lastFrame = config.references.find((reference) => reference.type === 'image' && reference.role === 'last_frame')
    const images = config.references.filter((reference) => reference.type === 'image' && !['first_frame', 'last_frame'].includes(reference.role || '')).map(referenceURL)
    const videos = config.references.filter((reference) => reference.type === 'video').map(referenceURL)
    const audios = config.references.filter((reference) => reference.type === 'audio').map(referenceURL)
    for (const [count, field, label] of [
      [images.length, videoContract?.imageReferencesField, '参考图片'],
      [videos.length, videoContract?.videoReferencesField, '参考视频'],
      [audios.length, videoContract?.audioReferencesField, '参考音频'],
      [firstFrame ? 1 : 0, videoContract?.firstFrameField, '首帧'],
      [lastFrame ? 1 : 0, videoContract?.lastFrameField, '尾帧'],
    ] as const) {
      if (count && !field) throw new GenerationStageError('validation', label + '没有配置请求字段，已停止提交，未丢弃素材')
    }
    const generateAudioField = generateAudioFieldName(model, videoContract)
    const requestMode = seedance808RequestMode(channel, model.id, config, selectedProtocol)
    body = {
      model: model.id,
      ...(requestMode ? { mode: requestMode } : {}),
      [videoContract?.durationField || 'seconds']: config.seconds || model.defaultDuration || 5,
      [videoContract?.resolutionField || 'resolution']: videoResolution || normalizeVideoResolution(config.resolution),
      [videoContract?.aspectRatioField || 'aspect_ratio']: config.aspectRatio || '16:9',
      prompt: config.prompt,
      ...(firstFrame && videoContract?.firstFrameField ? { [videoContract.firstFrameField]: referenceURL(firstFrame) } : {}),
      ...(lastFrame && videoContract?.lastFrameField ? { [videoContract.lastFrameField]: referenceURL(lastFrame) } : {}),
      ...(images.length && videoContract?.imageReferencesField ? { [videoContract.imageReferencesField]: images } : {}),
      ...(videos.length && videoContract?.videoReferencesField ? { [videoContract.videoReferencesField]: videos } : {}),
      ...(audios.length && videoContract?.audioReferencesField ? { [videoContract.audioReferencesField]: audios } : {}),
      ...(generateAudioField ? { [generateAudioField]: Boolean(config.generateAudio) } : {}),
    }
    requestURL = joinVersionedEndpoint(baseURL, videoContract?.createPath || '/v1/videos')
    requestBody = JSON.stringify(body)
    try {
      const profile = officialMediaProfile(model.id)
      const limitError = profile && officialRequestLimitError(profile, config, requestBody)
      if (limitError) throw new Error(limitError)
      if (!profile?.maxRequestBytes) assertGenerationRequestSize(requestBody)
    } catch (error) {
      throw new GenerationStageError('validation', error instanceof Error ? error.message : String(error), error)
    }
  } else {
    throw new Error('当前生成渠道未配置受支持的图片或视频协议')
  }
  const durationField = videoContract?.durationField || 'seconds'
  const requestDiagnostics = variant === 'video' && body ? parseRequestDiagnostics({
    fields: Object.keys(body),
    unknownRetentionCount: config.references.filter(reference => reference.expiresAt === undefined).length,
    durationField,
    duration: body[durationField],
    resolution: body[videoContract?.resolutionField || 'resolution'],
    aspectRatio: body[videoContract?.aspectRatioField || 'aspect_ratio'],
    references: config.references.map(reference => {
      const url = referenceURL(reference).toLowerCase()
      return { type: reference.type, transport: url.startsWith('data:') ? 'inline' : url.startsWith('https:') ? 'https' : url.startsWith('http:') ? 'http' : 'other' }
    }),
  }) : undefined
  if (requestDiagnostics) onPrepared?.(requestDiagnostics)
  let response: Response
  try {
    response = await desktopFetch(requestURL, {
    method: 'POST',
    headers,
    body: requestBody,
    signal,
  }, { secretRefs: authSecretRefs(channel, config.adapterId) })
  } catch (error) {
    signal?.throwIfAborted()
    throw new GenerationStageError('creation', '创建请求网络异常，是否受理未知；未自动重发。' + safeGenerationError(error instanceof Error ? error.message : error), error)
  }
  let parsed: any
  try { parsed = await parseResponse(response) } catch (error) { throw new GenerationStageError('creation', error instanceof Error ? error.message : String(error), error) }
  const inlineResults = await materializeInlineResults(parsed, variant)
  const remoteResults = await materializeRemoteResults(resultURLsFrom(parsed), variant, signal, channel, config.adapterId)
  const immediateResults = [...remoteResults, ...inlineResults]
  const immediateResultUrls = immediateResults.map((result) => result.url)
  const taskId = taskIdFrom(parsed)
  if (!taskId && immediateResultUrls.length) return { taskId: `completed-${crypto.randomUUID()}`, resultUrls: immediateResultUrls, resultResourceIds: immediateResults.map((result) => result.resourceId), resultMimeTypes: immediateResults.map((result) => result.mimeType), resultFileNames: immediateResults.map((result) => result.fileName), preparedConfig: config, raw: parsed }
  if (!taskId) throw new Error('生成服务没有返回 task_id')
  return { taskId, requestDiagnostics, resultUrls: immediateResultUrls, resultResourceIds: immediateResults.map((result) => result.resourceId), resultMimeTypes: immediateResults.map((result) => result.mimeType), resultFileNames: immediateResults.map((result) => result.fileName), preparedConfig: config, raw: parsed }
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
    rawStatus: rawStatusFrom(parsed),
    rawResponse: diagnosticResponse(parsed, statusFrom(parsed)),
    resultUrls,
    resultResourceIds: materializedResults.map((result) => result.resourceId),
    resultMimeTypes: materializedResults.map((result) => result.mimeType),
    resultFileNames: materializedResults.map((result) => result.fileName),
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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
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
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      cleanup()
      reject(new DOMException('执行已停止', 'AbortError'))
    }
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }, intervalMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runGenerationTask(
  context: GenerationRequestContext,
  options: GenerationRunOptions,
): Promise<GenerationTaskState> {
  const submittedAt = options.submittedAt || Date.now()
  const timeoutAt = submittedAt + options.timeoutMs
  let taskId = options.taskId
  let requestDiagnostics: GenerationRequestDiagnostics | undefined

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
    const submitted = await submitGenerationTask(context, options.signal, (diagnostics) => {
      requestDiagnostics = diagnostics
      options.onTaskUpdate?.({ status: 'validating', rawStatus: 'media_prepared', requestDiagnostics: diagnostics, model: context.model.id, channelId: context.channel.id, submittedAt, timeoutAt })
    })
    requestDiagnostics = submitted.requestDiagnostics
    options.onConfigPrepared?.(submitted.preparedConfig || context.config)
    taskId = submitted.taskId
    await options.onRemoteTaskId?.(taskId)
    if (submitted.resultUrls?.length) {
      const completed: GenerationTaskState = {
        requestDiagnostics,
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
      requestDiagnostics,
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
  let transientPollFailures = 0
  try {
    while (taskId) {
      const elapsedMs = Date.now() - submittedAt
      if (Date.now() >= timeoutAt) {
        const timeout: GenerationTaskState = { taskId, provider: context.channel.providerId, channelId: context.channel.id, model: context.model.id, status: 'timeout', submittedAt, elapsedMs, timeoutAt }
        options.onTaskUpdate?.(timeout)
        return timeout
      }
      let polled: GenerationPollResponse
      try {
        polled = await pollGenerationTask(context, taskId, options.signal)
        transientPollFailures = 0
      } catch (error) {
        if (options.signal?.aborted || !isRetryablePollingError(error)) throw error
        transientPollFailures += 1
        options.onTaskUpdate?.({
          taskId,
          provider: context.channel.providerId,
          channelId: context.channel.id,
          model: context.model.id,
          status: 'in_progress',
          rawStatus: 'poll_retry',
          error: error instanceof Error ? error.message : String(error),
          lastPolledAt: Date.now(),
        })
        await waitForPoll(Math.min(interval * Math.min(transientPollFailures, 3), 30_000), options.signal)
        continue
      }
      const next: GenerationTaskState = { ...polled.task, requestDiagnostics, taskId, submittedAt, elapsedMs: Date.now() - submittedAt, timeoutAt }
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






