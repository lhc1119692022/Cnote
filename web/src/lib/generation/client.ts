import { generationAdapterForConfig, generationAdapterForModel, generationProtocolForChannel, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import type { GenerationReference, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'
import { loadLocalResourceUrl, storeLocalResource } from '@/lib/resource-storage'
import { desktopFetch } from '@/lib/desktop-fetch'

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
  onCancel?: (taskId: string) => Promise<void> | void
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/$/, '')
}

function authHeaders(channel: GenerationChannel, adapterId?: string) {
  const useDesktopSecret = Boolean(typeof window !== 'undefined' && window.cnoteDesktop && channel.secretName)
  if (protocolFor(channel, adapterId) === 'gemini-generate-content') {
    return {
      'Content-Type': 'application/json',
      ...(!useDesktopSecret && channel.apiKey ? { 'x-goog-api-key': channel.apiKey } : {}),
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(!useDesktopSecret && channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {}),
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
  if (!channel.secretName || typeof window === 'undefined' || !window.cnoteDesktop) return undefined
  return { [protocolFor(channel, adapterId) === 'gemini-generate-content' ? 'x-goog-api-key' : 'Authorization']: channel.secretName }
}

async function assertDesktopSecretReady(channel: GenerationChannel, adapterId?: string) {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  if (!desktop?.secrets) return
  if (channel.apiKey && !channel.secretName) throw new Error('当前渠道仍使用旧的 API Key 配置，请在“渠道”中重新保存 API Key。')
  const refs = authSecretRefs(channel, adapterId)
  if (!refs) return
  const missing = (await Promise.all(Object.values(refs).map(async (name) => ({ name, present: await desktop.secrets.has(name) })))).find((item) => !item.present)
  if (missing) throw new Error('当前渠道的 API Key 尚未保存到桌面安全存储，请在“渠道”中重新保存 API Key。')
}

function is808VideoChannel(channel: GenerationChannel, variant: 'image' | 'video', protocol: ReturnType<typeof protocolFor>) {
  return variant === 'video' && (
    protocol === '808-video' ||
    protocol === 'openai-images-808' ||
    (protocol === 'generic-video' && channel.providerId === '808')
  )
}

function isMEAICCVideoChannel(channel: GenerationChannel, variant: 'image' | 'video', protocol: ReturnType<typeof protocolFor>) {
  return variant === 'video' && (
    protocol === 'meaicc-video' ||
    (protocol === 'generic-video' && channel.providerId === 'meaicc')
  )
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

function zenmuxPredictEndpoint(baseURL: string, model: string) {
  const [publisher, modelId] = model.split('/', 2)
  if (!publisher || !modelId) throw new Error('Vertex / ZenMux 模型 ID 必须使用 provider/model 格式')
  const base = normalizeBaseURL(baseURL).replace(/\/v1$/, '')
  return `${base}/v1/publishers/${encodeURIComponent(publisher)}/models/${encodeURIComponent(modelId)}:predict`
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
  const url = referenceURL(reference) || (reference.resourceId ? await loadLocalResourceUrl(reference.resourceId) : '')
  if (!url) throw new Error(`参考文件“${reference.label || reference.id}”没有可读取的地址`)
  const response = await desktopFetch(url)
  if (!response.ok) throw new Error(`无法读取参考文件“${reference.label || reference.id}”`)
  const blob = await response.blob()
  return { blob, fileName: reference.fileName || `${reference.id}.${blob.type.split('/')[1] || 'bin'}` }
}

function isHttpsUrl(value: string) {
  return /^https:\/\//i.test(value)
}

function uploadedReferenceUrl(payload: any) {
  return firstString(
    payload?.url,
    payload?.file_url,
    payload?.download_url,
    payload?.data?.url,
    payload?.data?.file_url,
    payload?.data?.download_url,
  )
}

async function uploadReference(channel: GenerationChannel, reference: GenerationReference, uploadPath: string, signal?: AbortSignal, adapterId?: string) {
  const { blob, fileName } = await referenceBlob(reference)
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('purpose', 'generation')
  const headers = Object.fromEntries(Object.entries(authHeaders(channel, adapterId)).filter(([name]) => name.toLowerCase() !== 'content-type'))
  const response = await desktopFetch(joinVersionedEndpoint(channel.baseURL, uploadPath), {
    method: 'POST',
    headers,
    body: form,
    signal,
  }, { secretRefs: authSecretRefs(channel, adapterId) })
  const payload = await parseResponse(response)
  const url = uploadedReferenceUrl(payload)
  if (!url || !isHttpsUrl(url)) throw new Error(`上传参考文件“${reference.label || reference.id}”后没有得到公网 HTTPS 地址`)
  return url
}

async function prepareReferenceConfig(context: GenerationRequestContext, signal?: AbortSignal) {
  const { channel, config, variant } = context
  const protocol = protocolFor(channel, config.adapterId, context.model.id)
  const adapter = generationAdapterForModel(channel, context.model.id, config.adapterId)
  const transport = adapter?.mediaTransport || channel.mediaTransport || 'auto'
  const inlineProtocol = variant === 'image' && ['openai-images', 'openai-images-808', 'gemini-generate-content', 'zenmux-vertex'].includes(protocol)
  const references = config.references || []
  const needsRemote = references.some((reference) => !isHttpsUrl(referenceURL(reference)))
  if (!needsRemote || inlineProtocol || (variant === 'image' && protocol === 'openai-images')) return config
  if (transport === 'public-url') {
    ensurePublicReferenceURLs(references)
    return config
  }

  const uploadPath = adapter?.mediaUploadPath || channel.mediaUploadPath || '/v1/files'
  const prepared = await Promise.all(references.map(async (reference) => {
    if (isHttpsUrl(referenceURL(reference))) return reference
    const url = await uploadReference(channel, reference, uploadPath, signal, config.adapterId)
    return { ...reference, source: 'uploaded' as const, url, previewUrl: reference.previewUrl || url, status: 'ready' as const }
  }))
  return { ...config, references: prepared }
}

async function inlineImagePart(reference: GenerationReference) {
  const { blob } = await referenceBlob(reference)
  const data = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  data.forEach((byte) => { binary += String.fromCharCode(byte) })
  return { inlineData: { mimeType: blob.type || 'image/png', data: btoa(binary) } }
}

async function vertexImageObject(reference: GenerationReference) {
  const { blob } = await referenceBlob(reference)
  const data = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  data.forEach((byte) => { binary += String.fromCharCode(byte) })
  return { bytesBase64Encoded: btoa(binary), mimeType: blob.type || 'image/png' }
}

async function materializeInlineResults(body: any) {
  const values: Array<{ data: string; mimeType?: string }> = []
  const collect = (value: any) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.b64_json === 'string') values.push({ data: value.b64_json, mimeType: value.mimeType || value.mime_type })
    const inline = value.inlineData || value.inline_data
    if (inline && typeof inline.data === 'string') values.push({ data: inline.data, mimeType: inline.mimeType || inline.mime_type })
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

function providerMediaRole(reference: GenerationReference) {
  if (reference.role === 'first_frame') return 'first_frame'
  if (reference.role === 'last_frame') return 'last_frame'
  if (reference.role === 'reference_voice' || reference.role === 'reference_audio') return 'audio_reference'
  if (reference.role === 'reference_video') return 'source_video'
  return 'reference'
}

function meaiccMediaRole(reference: GenerationReference) {
  if (reference.role === 'first_frame') return 'first_frame'
  if (reference.role === 'last_frame') return 'last_frame'
  if (reference.type === 'video') return 'reference_video'
  if (reference.type === 'audio') return 'reference_voice'
  return 'reference_image'
}

function mediaInputs(references: GenerationReference[], format: 'generic' | 'newapi' | 'meaicc' = 'generic') {
  return references.map((reference) => ({
    ...(format === 'newapi'
      ? { kind: reference.type, role: providerMediaRole(reference) }
      : { type: format === 'meaicc' ? meaiccMediaRole(reference) : reference.type, role: reference.role }),
    url: referenceURL(reference),
    ...(format === 'generic' ? { name: reference.label || reference.fileName } : {}),
  }))
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

function operationFor(context: GenerationRequestContext) {
  if (context.variant === 'image') return undefined
  if (context.config.capability === 'video-edit') return 'video_to_video'
  if (context.config.references.length || context.config.capability === 'image-to-video' || context.config.capability === 'reference-to-video') return 'image_to_video'
  return 'text_to_video'
}

function pollPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && protocol === 'newapi') return `/v1/tasks/${encodeURIComponent(taskId)}`
  if (variant === 'image' && protocol === 'openai-images-808') return `/images/tasks/${encodeURIComponent(taskId)}?response_format=url`
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}`
}

function contentPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  const protocol = protocolFor(channel, context.config.adapterId, context.model.id)
  if (variant === 'image' && (protocol === 'newapi' || protocol === 'openai-images-808' || protocol === 'openai-images')) return undefined
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
  const config = await prepareReferenceConfig(context, signal)
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, initialConfig.adapterId, model.id) }
  await assertDesktopSecretReady(channel, initialConfig.adapterId)
  const protocol = protocolFor(channel)
  if (variant === 'video' || (variant === 'image' && !['openai-images', 'openai-images-808', 'gemini-generate-content', 'zenmux-vertex'].includes(protocol))) ensurePublicReferenceURLs(config.references)
  const baseURL = normalizeBaseURL(channel.baseURL)
  if (!baseURL || baseURL.startsWith('local://')) throw new Error('当前生成渠道没有可用的公网接口地址')

  let body: Record<string, unknown> | undefined
  let requestURL = ''
  let requestBody: BodyInit = JSON.stringify({})
  let headers: Record<string, string> = authHeaders(channel)

  if (variant === 'image' && (protocol === 'openai-images' || protocol === 'openai-images-808')) {
    const operation = config.references.length ? 'edits' : 'generations'
    body = {
      model: model.id,
      prompt: config.prompt,
      size: imageSizeForConfig(config, model),
      quality: config.quality === 'standard' ? 'medium' : config.quality || 'medium',
      background: config.background || 'auto',
      output_format: config.outputFormat || 'png',
      ...(protocol === 'openai-images-808' ? { response_format: 'url' } : {}),
    }
    requestURL = openAIImagesEndpoint(baseURL, operation)
    if (protocol === 'openai-images-808') requestURL += `${requestURL.includes('?') ? '&' : '?'}async=true`
    if (config.references.length) {
      const form = new FormData()
      Object.entries(body).forEach(([key, value]) => form.append(key, String(value)))
      for (const reference of config.references.filter((item) => item.type === 'image')) {
        const file = await referenceBlob(reference)
        form.append('image', file.blob, file.fileName)
      }
      requestBody = form
      headers = { ...authHeaders(channel) }
      delete headers['Content-Type']
    } else {
      requestBody = JSON.stringify(body)
      headers = authHeaders(channel)
    }
    if (protocol === 'openai-images-808') headers['Idempotency-Key'] = globalThis.crypto?.randomUUID?.() || `cnote-${Date.now()}-${Math.random().toString(36).slice(2)}`
  } else if (variant === 'image' && protocol === 'gemini-generate-content') {
    const parts: Array<Record<string, unknown>> = [{ text: config.prompt }]
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
    headers = authHeaders(channel)
  } else if (variant === 'image' && protocol === 'zenmux-vertex') {
    const references = config.references.filter((item) => item.type === 'image')
    const images = await Promise.all(references.map((reference) => vertexImageObject(reference)))
    const instance: Record<string, unknown> = { prompt: config.prompt }
    if (images.length === 1) instance.image = images[0]
    if (images.length > 1) instance.referenceImages = images.map((image, index) => ({ referenceId: index + 1, referenceImage: image }))
    body = {
      instances: [instance],
      parameters: {
        sampleCount: 1,
        aspectRatio: config.aspectRatio || '1:1',
        sampleImageSize: config.resolution || '2K',
        outputOptions: { mimeType: config.outputFormat === 'jpeg' ? 'image/jpeg' : config.outputFormat === 'webp' ? 'image/webp' : 'image/png' },
      },
    }
    requestURL = zenmuxPredictEndpoint(baseURL, model.id)
    requestBody = JSON.stringify(body)
    headers = authHeaders(channel)
  } else if (is808VideoChannel(channel, variant, protocol)) {
    body = {
      model: model.id || 'sd2-5-720p',
      seconds: config.seconds || 30,
      resolution: config.resolution || '720p',
      aspect_ratio: config.aspectRatio || '16:9',
      mode: 'reference-to-video',
      prompt: config.prompt,
      image_urls: config.references.filter((reference) => reference.type === 'image').map(referenceURL),
      video_urls: config.references.filter((reference) => reference.type === 'video').map(referenceURL),
      audio_urls: config.references.filter((reference) => reference.type === 'audio').map(referenceURL),
      generate_audio: config.generateAudio,
    }
  } else if (isMEAICCVideoChannel(channel, variant, protocol)) {
    body = {
      model: model.id || 'sd-2-c1',
      input: {
        prompt: config.prompt,
        media: mediaInputs(config.references, 'meaicc'),
      },
      parameters: {
        resolution: config.resolution || '720p',
        ratio: config.aspectRatio || '16:9',
        duration: config.seconds || 15,
      },
    }
  } else if ((protocol === 'newapi' || channel.providerId === 'newapi') && variant === 'video') {
    body = {
      version: 'video.v1',
      model: model.id,
      operation: operationFor(context),
      prompt: config.prompt,
      duration_seconds: config.seconds,
      resolution: config.resolution,
      aspect_ratio: config.aspectRatio,
      media_inputs: mediaInputs(config.references, 'newapi'),
    }
  } else if (variant === 'image') {
    body = {
      model: model.id,
      prompt: config.prompt,
      resolution: config.resolution,
      size: 'auto',
      aspect_ratio: config.aspectRatio,
      n: 1,
      ...(config.references.length ? { image_urls: config.references.filter((reference) => reference.type === 'image').map(referenceURL) } : {}),
    }
  } else {
    body = {
      model: model.id,
      prompt: config.prompt,
      media_inputs: mediaInputs(config.references),
      seconds: config.seconds,
      resolution: config.resolution,
      aspect_ratio: config.aspectRatio,
      generate_audio: config.generateAudio,
    }
  }

  if (!requestURL) {
    if (variant === 'image') {
      requestURL = protocol === 'newapi' || channel.providerId === 'newapi'
        ? joinVersionedEndpoint(baseURL, '/v1/images/generations')
        : joinVersionedEndpoint(baseURL, '/v1/images')
      requestBody = JSON.stringify(body || {})
      headers = protocol === 'newapi' || channel.providerId === 'newapi'
        ? requestHeaders(channel, {
            Prefer: 'respond-async',
            'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `cnote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          })
        : authHeaders(channel)
    } else {
      requestURL = joinVersionedEndpoint(baseURL, '/v1/videos')
      requestBody = JSON.stringify(body || {})
      headers = authHeaders(channel)
    }
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
  if (!taskId && immediateResultUrls.length) return { taskId: `completed-${Date.now()}`, resultUrls: immediateResultUrls, resultResourceIds: inlineResults.map((result) => result.resourceId), resultMimeTypes: inlineResults.map((result) => result.mimeType), raw: parsed }
  if (!taskId) throw new Error('生成服务没有返回 task_id')
  return { taskId, resultUrls: immediateResultUrls, raw: parsed }
}

export async function pollGenerationTask(context: GenerationRequestContext, taskId: string, signal?: AbortSignal): Promise<GenerationPollResponse> {
  const channel: GenerationChannel = { ...context.channel, protocol: protocolFor(context.channel, context.config.adapterId, context.model.id) }
  await assertDesktopSecretReady(channel, context.config.adapterId)
  const baseURL = normalizeBaseURL(channel.baseURL)
  const response = await desktopFetch(joinVersionedEndpoint(baseURL, pollPath(context, taskId)), {
    method: 'GET',
    headers: authHeaders(channel),
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
        headers: authHeaders(channel),
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
      headers: authHeaders(channel),
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
