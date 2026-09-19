import { localForageStorage } from '@/lib/localforage-storage'
import { inspectMediaUrl, MediaReadinessError } from './media-readiness'

const pending = new Map<string, Promise<string>>()

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function reuseMediaUpload(
  scope: string,
  blob: Blob,
  upload: (checksum: string) => Promise<string>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const checksum = await sha256(await blob.arrayBuffer())
  const scopeHash = await sha256(new TextEncoder().encode(scope + '\n' + blob.type).buffer)
  const cacheKey = 'media-upload:' + scopeHash + ':' + checksum
  const previous = pending.get(cacheKey)
  const operation = (async () => {
    await previous?.catch(() => undefined)
    signal?.throwIfAborted()
    const cached = await Promise.resolve(localForageStorage.getItem(cacheKey)).catch(() => null)
    if (cached) {
      let url: string | undefined
      try {
        const record = JSON.parse(cached)
        if (typeof record.url === 'string' && /^https:\/\//i.test(record.url)) {
          url = record.url
        }
      } catch { url = undefined }
      if (url) {
        try {
          await inspectMediaUrl(url, undefined, signal)
          return url
        } catch (error) {
          if (!(error instanceof MediaReadinessError) || !error.recoverable) throw error
        }
      }
      await Promise.resolve(localForageStorage.removeItem(cacheKey)).catch(() => undefined)
    }
    signal?.throwIfAborted()
    const url = await upload(checksum)
    await inspectMediaUrl(url, undefined, signal)
    await Promise.resolve(localForageStorage.setItem(cacheKey, JSON.stringify({ url }))).catch(() => undefined)
    return url
  })()
  pending.set(cacheKey, operation)
  try {
    return await operation
  } finally {
    if (pending.get(cacheKey) === operation) pending.delete(cacheKey)
  }
}
