import { desktopFetch } from '@/lib/desktop-fetch'
import { checksumBlob, loadLocalResourceBlob } from '@/lib/resource-storage'
import type { GenerationReference, GenerationVariantConfig } from '@/types/flow'
import { mediaRuleFor, officialMediaProfile, validateMediaCollection, validateMediaFile, type MediaMetadata, type MediaViolation } from './official-media-rules'
import type { MediaWorkerRequest } from './media-inspection.worker'

let processingQueue: Promise<unknown> = Promise.resolve()
const metadataCache = new Map<string, MediaMetadata>()

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('素材检查已取消', 'AbortError')
}

function runMediaWorker(request: MediaWorkerRequest, signal?: AbortSignal): Promise<{ blob?: Blob; metadata: MediaMetadata }> {
  const execute = () => new Promise<{ blob?: Blob; metadata: MediaMetadata }>((resolve, reject) => {
    try { throwIfAborted(signal) } catch (error) { reject(error); return }
    const worker = new Worker(new URL('./media-inspection.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { cleanup(); reject(new DOMException('素材检查已取消', 'AbortError')) }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('本地素材检查或处理超时，未继续尝试')) }, 120_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event) => {
      cleanup()
      if (event.data.ok) resolve(event.data)
      else reject(new Error(event.data.error || '无法完成素材检查'))
    }
    worker.onerror = () => { cleanup(); reject(new Error('本地素材检查线程失败')) }
    worker.postMessage(request)
  })
  const result = processingQueue.then(execute, execute)
  processingQueue = result.catch(() => undefined)
  return result
}

export async function loadReferenceForInspection(reference: GenerationReference, signal?: AbortSignal): Promise<Blob> {
  throwIfAborted(signal)
  if (reference.resourceId) {
    const blob = await loadLocalResourceBlob(reference.resourceId)
    throwIfAborted(signal)
    if (blob) return blob
  }
  const url = reference.url || reference.previewUrl
  if (!url) throw new Error('素材没有可读取的文件或地址')
  const response = await desktopFetch(url, { signal }, { timeoutMs: 120_000 })
  if (!response.ok || response.status === 206) throw new Error(`无法读取完整素材（HTTP ${response.status}）`)
  const blob = await response.blob()
  throwIfAborted(signal)
  return blob
}

export async function inspectMediaBlob(blob: Blob, type: GenerationReference['type'], signal?: AbortSignal): Promise<MediaMetadata> {
  throwIfAborted(signal)
  const key = `${type}:${await checksumBlob(blob)}`
  throwIfAborted(signal)
  const cached = metadataCache.get(key)
  if (cached) return cached
  const { metadata } = await runMediaWorker({ operation: 'inspect', blob, type }, signal)
  if (metadataCache.size >= 128) metadataCache.delete(metadataCache.keys().next().value!)
  metadataCache.set(key, metadata)
  return metadata
}

export async function prepareOfficialMediaInput(options: {
  modelId: string
  reference: GenerationReference
  capability?: GenerationVariantConfig['capability']
  adaptImages: boolean
  blob?: Blob
  signal?: AbortSignal
}): Promise<{ blob?: Blob; metadata?: MediaMetadata; violations: MediaViolation[]; adapted: boolean; configured: boolean }> {
  const { reference, signal } = options
  const profile = officialMediaProfile(options.modelId)
  if (!profile) return { violations: [], adapted: false, configured: false }
  try {
    const blob = options.blob || await loadReferenceForInspection(reference, signal)
    const metadata = await inspectMediaBlob(blob, reference.type, signal)
    const result = validateMediaFile(profile, reference, metadata, options.capability)
    if (result.status === 'valid') return { blob, metadata, violations: [], adapted: false, configured: true }
    const rule = mediaRuleFor(profile, reference, options.capability)
    const exceedsSide = Math.max(metadata.width || 0, metadata.height || 0) > (rule.maxSide || Infinity)
    const shouldAdapt = reference.type === 'image' && options.adaptImages && rule.formats.includes('webp') && (result.violations.some((item) => item.code === 'bytes') || exceedsSide)
    if (!shouldAdapt || result.violations.some((item) => !['bytes', 'dimensions', 'format'].includes(item.code)) || Math.min(metadata.width || Infinity, metadata.height || Infinity) < (rule.minSide || 0)) {
      return { metadata, violations: result.violations, adapted: false, configured: true }
    }
    const converted = await runMediaWorker({ operation: 'adapt', type: 'image', blob, maxBytes: rule.maxBytes, exclusiveBytes: rule.exclusiveBytes, maxSide: rule.maxSide }, signal)
    const final = validateMediaFile(profile, reference, converted.metadata, options.capability)
    return { blob: converted.blob, metadata: converted.metadata, violations: final.violations.map((item) => ({ ...item, message: `副本仍不合规：${item.message}；未降低编码质量` })), adapted: true, configured: true }
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    const label = reference.fileName || reference.label || reference.id
    const actual = error instanceof Error ? error.message : String(error)
    return { violations: [{ referenceId: reference.id, label, code: 'unverifiable', actual, expected: '能够读取并验证素材', message: `${label}：无法完成检查；${actual}` }], adapted: false, configured: true }
  }
}

export async function validateOfficialMediaReferences(modelId: string, config: GenerationVariantConfig, signal?: AbortSignal): Promise<MediaViolation[]> {
  const profile = officialMediaProfile(modelId)
  if (!profile) return []
  const metadata = new Map<string, MediaMetadata>()
  const violations: MediaViolation[] = []
  for (const reference of config.references) {
    const result = await prepareOfficialMediaInput({ modelId, reference, capability: config.capability, adaptImages: false, signal })
    if (result.metadata) metadata.set(reference.id, result.metadata)
    violations.push(...result.violations)
  }
  return [...violations, ...validateMediaCollection(profile, config.references, metadata)]
}
