import { generationAdapterForConfig, generationAdapterForModel, generationMediaUploadSecretName, generationProtocolForChannel, generationSecretName, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { MEDIA_STORAGE_DEFAULTS, useMediaStorageStore } from '@/stores/use-media-storage-store'
import type { GenerationReference, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'
import { normalizeGenerationReferences } from '@/lib/generation/defaults'
import { loadLocalResourceBlob, loadLocalResourceUrl, storeLocalResource } from '@/lib/resource-storage'
import { desktopFetch } from '@/lib/desktop-fetch'
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
  /** Config after local video references have been converted to public URLs. */
  preparedConfig?: GenerationVariantConfig
  raw?: unknown
}

export interface GenerationPollResponse {
  task: GenerationTaskState
  raw?: unknown
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

function requestHeaders(channel: GenerationChannel, extra: Record<string, string> = {}, adapterId?: string) {
  return { ...authHeaders(channel, adapterId), ...extra }
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

function validateVideoConfig(model: GenerationModel, config: GenerationVariantConfig) {
  const seconds = config.seconds || 5
  if (model.minDuration && seconds < model.minDuration || model.maxDuration && seconds > model.maxDuration) throw new Error(`${model.name} 时长必须为 ${model.minDuration}-${model.maxDuration} 秒`)
  if (model.resolutions?.length && config.resolution && !model.resolutions.includes(config.resolution)) throw new Error(`${model.name} 不支持 ${config.resolution}`)
  if (model.aspectRatios?.length && config.aspectRatio && !model.aspectRatios.includes(config.aspectRatio)) throw new Error(`${model.name} 不支持 ${config.aspectRatio} 画幅`)
  for (const [type, max] of [['image', model.maxImages], ['video', model.maxVideos], ['audio', model.maxAudios] ] as const) {
    const count = config.references.filter((reference) => reference.type === type).length
    if (max && count > max) throw new Error(`${model.name} 最多支持 ${max} 个${type}参考素材`)
  }
  if (model.id === 'gemini-omni-1.1' && config.references.some((reference) => reference.type === 'audio')) throw new Error('Gemini Omni 1.1 不支持参考音频')
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
  mode: 'provider' | 'custom'
  kind: 'multipart' | 'presign'
  endpoint: string
  fieldName: string
  responsePath: string
  token?: string
  secretName?: string
}

function mediaUploadSettings(channel: GenerationChannel, adapterId?: string) {
  const adapter = generationAdapterForConfig(channel, adapterId)
  const protocol = protocolFor(channel, adapterId)
  const providerPath = adapter?.mediaUploadPath || channel.mediaUploadPath || (protocol === 'video-api' ? '/v1/media/uploads/presign' : undefined)
  return {
    transport: adapter?.mediaTransport || channel.mediaTransport || 'auto',
    providerPath,
    fieldName: adapter?.mediaUploadField || channel.mediaUploadField || MEDIA_STORAGE_DEFAULTS.fieldName,
    responsePath: adapter?.mediaUploadResponsePath || channel.mediaUploadResponsePath || MEDIA_STORAGE_DEFAULTS.responsePath,
    protocol,
  }
}

function mediaUploadEndpoint(channel: GenerationChannel, adapterId?: string): MediaUploadEndpoint {
  const settings = mediaUploadSettings(channel, adapterId)
  if (settings.transport === 'public-url') {
    throw new Error('当前渠道仅接受公网 HTTPS 地址，请改用“自动”“multipart”或“自定义”')
  }
  const mediaStorage = useMediaStorageStore.getState()
  const customConfigured = Boolean(mediaStorage.baseURL || channel.mediaUploadURL)
  if (settings.transport === 'custom' || (settings.transport === 'auto' && !settings.providerPath && customConfigured)) {
    const endpoint = mediaStorage.baseURL
      ? mediaStorage.getUploadEndpoint()
      : String(channel.mediaUploadURL || '').trim()
    if (!isHttpsUrl(endpoint)) throw new Error('请先在“本地存储”中配置 HTTPS 自定义上传地址')
    return {
      mode: 'custom',
      kind: 'multipart',
      endpoint,
      fieldName: mediaStorage.baseURL ? mediaStorage.fieldName : settings.fieldName,
      responsePath: mediaStorage.baseURL ? mediaStorage.responsePath : settings.responsePath,
      token: mediaStorage.baseURL ? mediaStorage.getAccessToken() : channel.mediaUploadApiKey,
      secretName: mediaStorage.baseURL ? mediaStorage.secretName : channel.mediaUploadSecretName || generationMediaUploadSecretName(channel.id),
    }
  }
  const path = String(settings.providerPath || '').trim()
  if (!path) throw new Error('当前视频渠道没有配置供应商上传路径，请填写路径或在“本地存储”中配置自定义服务')
  return {
    mode: 'provider',
    kind: settings.protocol === 'video-api' ? 'presign' : 'multipart',
    endpoint: joinVersionedEndpoint(channel.baseURL, path),
    fieldName: settings.fieldName,
    responsePath: settings.responsePath,
  }
}

function mediaUploadHeaders(channel: GenerationChannel, endpoint: MediaUploadEndpoint, adapterId?: string) {
  if (endpoint.mode === 'provider') {
    return Object.fromEntries(Object.entries(authHeaders(channel, adapterId)).filter(([name]) => name.toLowerCase() !== 'content-type'))
  }
  return endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}
}

function mediaUploadSecretRefs(channel: GenerationChannel, endpoint: MediaUploadEndpoint, adapterId?: string) {
  if (endpoint.mode === 'provider') return authSecretRefs(channel, adapterId)
  if (!endpoint.secretName || typeof window === 'undefined' || !window.cnoteDesktop) return undefined
  return { Authorization: endpoint.secretName }
}

async function assertMediaUploadSecretReady(endpoint: MediaUploadEndpoint) {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  if (endpoint.mode !== 'custom' || !desktop?.secrets || !endpoint.secretName) return
  if (endpoint.token) {
    await syncDesktopSecret(endpoint.secretName, endpoint.token)
    return
  }
  if (!(await ensureDesktopSecret(endpoint.secretName))) {
    throw new Error('自定义上传服务令牌尚未保存到桌面安全存储，请到“本地存储”中重新保存。')
  }
}

function presignedUploadValue(payload: any, key: 'upload' | 'public') {
  const candidates = key === 'upload'
    ? [payload?.upload_url, payload?.uploadUrl, payload?.presigned_url, payload?.presignedUrl, payload?.data?.upload_url, payload?.data?.uploadUrl, payload?.data?.presigned_url, payload?.data?.presignedUrl]
    : [payload?.public_url, payload?.publicUrl, payload?.data?.public_url, payload?.data?.publicUrl]
  return firstString(...candidates)
}

async function uploadWithPresign(channel: GenerationChannel, endpoint: MediaUploadEndpoint, blob: Blob, fileName: string, signal?: AbortSignal, adapterId?: string) {
  const response = await desktopFetch(endpoint.endpoint, {
    method: 'POST',
    headers: { ...requestHeaders(channel, { 'Content-Type': 'application/json' }, adapterId) },
    body: JSON.stringify({ filename: fileName, content_type: blob.type || 'application/octet-stream', size: blob.size }),
    signal,
  }, { secretRefs: authSecretRefs(channel, adapterId) })
  const payload = await parseResponse(response)
  const uploadURL = presignedUploadValue(payload, 'upload')
  const publicURL = presignedUploadValue(payload, 'public')
  if (!uploadURL || !isHttpsUrl(uploadURL)) throw new Error('供应商预签名接口没有返回 HTTPS upload_url')
  if (!publicURL || !isHttpsUrl(publicURL)) throw new Error('供应商预签名接口没有返回可公开读取的 HTTPS public_url')
  const uploadHeaders = payload?.upload_headers && typeof payload.upload_headers === 'object' ? payload.upload_headers : payload?.uploadHeaders && typeof payload.uploadHeaders === 'object' ? payload.uploadHeaders : {}
  const uploadResponse = await desktopFetch(uploadURL, {
    method: 'PUT',
    headers: Object.fromEntries(Object.entries(uploadHeaders).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')) as Record<string, string>,
    body: blob,
    signal,
  })
  if (!uploadResponse.ok) throw new Error(`上传参考文件失败：HTTP ${uploadResponse.status}`)
  return publicURL
}

async function uploadReference(channel: GenerationChannel, reference: GenerationReference, signal?: AbortSignal, adapterId?: string) {
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  await assertMediaUploadSecretReady(endpoint)
  const { blob, fileName } = await referenceBlob(reference)
  if (endpoint.kind === 'presign') return uploadWithPresign(channel, endpoint, blob, fileName, signal, adapterId)
  const form = new FormData()
  form.append(endpoint.fieldName, blob, fileName)
  form.append('purpose', 'generation')
  if (reference.resourceId?.startsWith('sha256-')) form.append('checksum', reference.resourceId.slice('sha256-'.length))
  const response = await desktopFetch(endpoint.endpoint, {
    method: 'POST',
    headers: mediaUploadHeaders(channel, endpoint, adapterId),
    body: form,
    signal,
  }, { secretRefs: mediaUploadSecretRefs(channel, endpoint, adapterId) })
  const payload = await parseResponse(response)
  const url = uploadedReferenceUrl(payload, endpoint.responsePath)
  if (!url || !isHttpsUrl(url)) throw new Error(`上传参考文件“${reference.label || reference.id}”后没有得到公网 HTTPS 地址`)
  return url
}

/** Performs a small multipart upload without submitting a generation task. */
export async function testGenerationMediaUpload(channel: GenerationChannel, adapterId?: string, signal?: AbortSignal) {
  const endpoint = mediaUploadEndpoint(channel, adapterId)
  await assertMediaUploadSecretReady(endpoint)
  if (endpoint.kind === 'presign') {
    const testBlob = new Blob(['cnote upload test'], { type: 'application/octet-stream' })
    const url = await uploadWithPresign(channel, endpoint, testBlob, 'cnote-upload-test.bin', signal, adapterId)
    return { url }
  }
  const form = new FormData()
  const testBlob = new Blob(['cnote upload test'], { type: 'application/octet-stream' })
  form.append(endpoint.fieldName, testBlob, 'cnote-upload-test.bin')
  form.append('purpose', 'generation-test')
  const response = await desktopFetch(endpoint.endpoint, {
    method: 'POST',
    headers: mediaUploadHeaders(channel, endpoint, adapterId),
    body: form,
    signal,
  }, { secretRefs: mediaUploadSecretRefs(channel, endpoint, adapterId) })
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
  const needsRemote = references.some((reference) => !isHttpsUrl(referenceURL(reference)))
  if (!needsRemote) return orderedConfig
  const transport = adapter?.mediaTransport || channel.mediaTransport || 'auto'
  if (transport === 'public-url') {
    ensurePublicReferenceURLs(references)
    return orderedConfig
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
    return { ...reference, source: 'uploaded' as const, url, previewUrl: reference.previewUrl || url, status: 'ready' as const }
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

async function materializeInlineResults(body: any) {
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
  const results: { url: string; resourceId: string; mimeType: string }[] = []
  for (const value of values) {
    const mimeType = value.mimeType || 'image/png'
    const binary = atob(value.data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const stored = await storeLocalResource(new Blob([bytes], { type: mimeType }))
    results.push({ url: stored.url, resourceId: stored.resourceId, mimeType })
  }
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
  if (status === 'in_progress' || status === 'processing' || status === 'running' || status === 'generating') return 'in_progress'
  return 'queued'
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

function pollPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && protocol === 'openai-images') return `/images/tasks/${encodeURIComponent(taskId)}?response_format=url`
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}`
}

function contentPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && (protocol === 'openai-images' || protocol === 'google-images')) return undefined
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}/content`
}

function ensurePublicReferenceURLs(references: GenerationReference[]) {
  const invalid = references.find((reference) => !/^https:\/\//i.test(referenceURL(reference)))
  if (invalid) {
    throw new Error(`参考文件“${invalid.label || invalid.fileName || invalid.id}”尚未转换为公网 HTTPS 地址`)
  }
}

export async function submitGenerationTask(context: GenerationRequestContext, signal?: AbortSignal): Promise<GenerationTaskResponse> {
  const { model, variant } = context
  const initialConfig = context.config
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, initialConfig.adapterId, model.id) }
  await assertDesktopSecretReady(channel, initialConfig.adapterId)
  const baseURL = normalizeBaseURL(channel.baseURL)
  if (!baseURL || baseURL.startsWith('local://')) throw new Error('当前生成渠道没有可用的公网接口地址')
  const config = await prepareReferenceConfig({ ...context, channel }, signal)
  const protocol = protocolFor(channel)
  if (variant === 'video') { ensurePublicReferenceURLs(config.references); validateVideoConfig(model, config) }

  let body: Record<string, unknown> | undefined
  let requestURL = ''
  let requestBody: BodyInit = JSON.stringify({})
  const headers: Record<string, string> = authHeaders(channel, initialConfig.adapterId)

  if (variant === 'image' && protocol === 'openai-images') {
    const imageReferences = config.references.filter((reference) => reference.type === 'image')
    const operation = imageReferences.length ? 'edits' : 'generations'
    body = {
      model: model.id,
      prompt: config.prompt,
      size: imageSizeForConfig(config, model),
      quality: config.quality === 'standard' ? 'medium' : config.quality || 'medium',
      background: config.background || 'auto',
      output_format: config.outputFormat || 'png',
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
  } else if (variant === 'video' && protocol === 'video-api') {
    const firstFrame = config.references.find((reference) => reference.role === 'first_frame')
    const lastFrame = config.references.find((reference) => reference.role === 'last_frame')
    const images = config.references.filter((reference) => reference.type === 'image' && !['first_frame', 'last_frame'].includes(reference.role || '')).map(referenceURL)
    const videos = config.references.filter((reference) => reference.type === 'video').map(referenceURL)
    const audios = config.references.filter((reference) => reference.type === 'audio').map(referenceURL)
    body = {
      model: model.id,
      seconds: config.seconds || 5,
      resolution: config.resolution || '720p',
      aspect_ratio: config.aspectRatio || '16:9',
      prompt: config.prompt,
      ...(firstFrame ? { input_reference: referenceURL(firstFrame) } : {}),
      ...(lastFrame ? { image_end: referenceURL(lastFrame) } : {}),
      ...(images.length ? { reference_images: images } : {}),
      ...(videos.length ? { reference_videos: videos } : {}),
      ...(audios.length ? { reference_audios: audios } : {}),
      sound_effects: Boolean(config.generateAudio),
    }
    requestURL = joinVersionedEndpoint(baseURL, '/v1/videos')
    requestBody = JSON.stringify(body)
  } else {
    throw new Error('当前生成渠道未配置受支持的图片或视频协议')
  }
  const response = await desktopFetch(requestURL, {
    method: 'POST',
    headers,
    body: requestBody,
    signal,
  }, { secretRefs: authSecretRefs(channel, config.adapterId) })
  const parsed = await parseResponse(response)
  const inlineResults = await materializeInlineResults(parsed)
  const immediateResultUrls = [...resultURLsFrom(parsed), ...inlineResults.map((result) => result.url)]
  const taskId = taskIdFrom(parsed)
  if (!taskId && immediateResultUrls.length) return { taskId: `completed-${crypto.randomUUID()}`, resultUrls: immediateResultUrls, resultResourceIds: inlineResults.map((result) => result.resourceId), resultMimeTypes: inlineResults.map((result) => result.mimeType), preparedConfig: config, raw: parsed }
  if (!taskId) throw new Error('生成服务没有返回 task_id')
  return { taskId, resultUrls: immediateResultUrls, preparedConfig: config, raw: parsed }
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
  const parsed = await parseResponse(response)
  const status = statusFrom(parsed)
  const inlineResults = await materializeInlineResults(parsed)
  const resultUrls = [...resultURLsFrom(parsed), ...inlineResults.map((result) => result.url)]
  const task: GenerationTaskState = {
    taskId,
    provider: channel.providerId,
    channelId: channel.id,
    model: context.model.id,
    status,
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
        const contentInlineResults = await materializeInlineResults(contentBody)
        task.resultUrls = [...resultURLsFrom(contentBody), ...contentInlineResults.map((result) => result.url)]
        task.resultResourceIds = contentInlineResults.length ? contentInlineResults.map((result) => result.resourceId) : undefined
        task.resultMimeTypes = contentInlineResults.length ? contentInlineResults.map((result) => result.mimeType) : undefined
      } else if (contentResponse.ok) {
        const declaredType = contentResponse.headers.get('content-type')?.split(';', 1)[0]?.trim()
        const contentType = declaredType && declaredType !== 'application/octet-stream'
          ? declaredType
          : context.variant === 'image' ? 'image/png' : 'video/mp4'
        const blob = await contentResponse.blob()
        if (blob.size > 0) {
          const stored = await storeLocalResource(new Blob([blob], { type: contentType }))
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
    if (next.status === 'completed' || next.status === 'failed') return next
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
