import type { GenerationChannel, GenerationModel } from '@/stores/use-generation-store'
import type { GenerationReference, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'
import { storeLocalResource } from '@/lib/resource-storage'

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
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/$/, '')
}

function authHeaders(channel: GenerationChannel) {
  return {
    'Content-Type': 'application/json',
    ...(channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {}),
  }
}

function requestHeaders(channel: GenerationChannel, extra: Record<string, string> = {}) {
  return { ...authHeaders(channel), ...extra }
}

function referenceURL(reference: GenerationReference) {
  return reference.url || reference.previewUrl || ''
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
  if (variant === 'image' && channel.providerId === 'newapi') return `/v1/tasks/${encodeURIComponent(taskId)}`
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}`
}

function contentPath(context: GenerationRequestContext, taskId: string) {
  const { channel, variant } = context
  if (variant === 'image' && channel.providerId === 'newapi') return undefined
  return `/v1/${variant === 'image' ? 'images' : 'videos'}/${encodeURIComponent(taskId)}/content`
}

function ensurePublicReferenceURLs(references: GenerationReference[]) {
  const invalid = references.find((reference) => !/^https:\/\//i.test(referenceURL(reference)))
  if (invalid) {
    throw new Error(`参考文件“${invalid.label || invalid.fileName || invalid.id}”尚未转换为公网 HTTPS 地址`)
  }
}

export async function submitGenerationTask(context: GenerationRequestContext, signal?: AbortSignal): Promise<GenerationTaskResponse> {
  const { channel, model, config, variant } = context
  ensurePublicReferenceURLs(config.references)
  const baseURL = normalizeBaseURL(channel.baseURL)
  if (!baseURL || baseURL.startsWith('local://')) throw new Error('当前生成渠道没有可用的公网接口地址')

  let body: Record<string, unknown>
  if (channel.providerId === '808') {
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
  } else if (channel.providerId === 'meaicc') {
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
  } else if (channel.providerId === 'newapi' && variant === 'video') {
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

  const endpoint = variant === 'image'
    ? channel.providerId === 'newapi' || channel.providerId === 'fmage' ? 'images/generations' : 'images'
    : 'videos'
  const headers = channel.providerId === 'newapi' && variant === 'image'
    ? requestHeaders(channel, {
        Prefer: 'respond-async',
        'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `cnote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
    : authHeaders(channel)
  const response = await fetch(`${baseURL}/v1/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  const parsed = await parseResponse(response)
  const immediateResultUrls = resultURLsFrom(parsed)
  const taskId = taskIdFrom(parsed)
  if (!taskId && immediateResultUrls.length) return { taskId: `completed-${Date.now()}`, resultUrls: immediateResultUrls, raw: parsed }
  if (!taskId) throw new Error('生成服务没有返回 task_id')
  return { taskId, resultUrls: immediateResultUrls, raw: parsed }
}

export async function pollGenerationTask(context: GenerationRequestContext, taskId: string, signal?: AbortSignal): Promise<GenerationPollResponse> {
  const { channel } = context
  const baseURL = normalizeBaseURL(channel.baseURL)
  const response = await fetch(`${baseURL}${pollPath(context, taskId)}`, {
    method: 'GET',
    headers: authHeaders(channel),
    signal,
  })
  const parsed = await parseResponse(response)
  const status = statusFrom(parsed)
  const resultUrls = resultURLsFrom(parsed)
  const task: GenerationTaskState = {
    taskId,
    provider: channel.providerId,
    channelId: channel.id,
    model: context.model.id,
    status,
    resultUrls,
    progress: progressFrom(parsed),
    error: status === 'failed' ? errorFrom(parsed) : undefined,
    lastPolledAt: Date.now(),
  }
  const resultPath = contentPath(context, taskId)
  if (status === 'completed' && !resultUrls.length && resultPath) {
    try {
      const contentResponse = await fetch(`${baseURL}${resultPath}`, {
        method: 'GET',
        headers: authHeaders(channel),
        signal,
      })
      if (contentResponse.ok && contentResponse.headers.get('content-type')?.includes('application/json')) {
        const contentBody = await contentResponse.json()
        task.resultUrls = resultURLsFrom(contentBody)
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

  throw new Error('生成任务没有有效 task_id')
}
