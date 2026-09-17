import localforage, { ensureResourcePolicy } from '@/lib/localforage-storage'
import { isResourceDeleted, currentResourcePolicy, identityAliases, RESOURCE_POLICY_KEY } from '@/storage/resource-policy'

const RESOURCE_PREFIX = 'resource:'
const RESOURCE_META_PREFIX = 'resource-meta:'
const managedObjectUrls = new Set<string>()
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const MAX_BROWSER_STORAGE_BYTES = 10 * 1024 ** 3

interface ResourceMeta {
  id: string
  checksum: string
  mimeType: string
  size: number
  refCount: number
  createdAt: number
  fileName?: string
}

let resourceMutationQueue: Promise<unknown> = Promise.resolve()

function enqueueResourceMutation<T>(operation: () => Promise<T>) {
  const next = resourceMutationQueue.then(operation, operation)
  resourceMutationQueue = next.catch(() => undefined)
  return next
}

function hasDesktopByteStorage() {
  return typeof window !== 'undefined' && Boolean(window.cnoteDesktop?.storage)
}

function getDesktopByteStorage() {
  const storage = typeof window !== 'undefined' ? window.cnoteDesktop?.storage : undefined
  if (!storage) throw new Error('Desktop storage is unavailable')
  return storage
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('Desktop storage returned invalid data')
}

function resourceBytesKey(resourceId: string) {
  return `${RESOURCE_PREFIX}${resourceId}`
}

function resourceMetaKey(resourceId: string) {
  return `${RESOURCE_META_PREFIX}${resourceId}`
}

async function readDesktopBytes(key: string): Promise<Uint8Array | null> {
  const value = await getDesktopByteStorage().read(key)
  if (value == null) return null
  return toBytes(value)
}

async function writeDesktopBytes(key: string, data: Uint8Array) {
  await getDesktopByteStorage().write(key, data)
}

async function removeDesktopKey(key: string) {
  await getDesktopByteStorage().remove(key)
}

export function createManagedObjectUrl(blob: Blob) {
  const url = URL.createObjectURL(blob)
  managedObjectUrls.add(url)
  return url
}

export function revokeManagedObjectUrl(url?: string) {
  if (!url?.startsWith('blob:')) return
  URL.revokeObjectURL(url)
  managedObjectUrls.delete(url)
}

export function revokeAllManagedObjectUrls() {
  managedObjectUrls.forEach((url) => URL.revokeObjectURL(url))
  managedObjectUrls.clear()
}

export async function checksumBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function checksumText(text: string) {
  return checksumBlob(new Blob([text], { type: 'text/plain' }))
}

async function getMeta(resourceId: string): Promise<ResourceMeta | null> {
  if (hasDesktopByteStorage()) {
    const bytes = await readDesktopBytes(resourceMetaKey(resourceId))
    if (bytes == null) return null
    const parsed: unknown = JSON.parse(textDecoder.decode(bytes))
    if (!parsed || typeof parsed !== 'object') throw new Error('Resource metadata is invalid')
    return parsed as ResourceMeta
  }
  return localforage.getItem<ResourceMeta>(resourceMetaKey(resourceId))
}

async function saveMeta(meta: ResourceMeta) {
  if (hasDesktopByteStorage()) {
    await writeDesktopBytes(resourceMetaKey(meta.id), textEncoder.encode(JSON.stringify(meta)))
    return
  }
  await localforage.setItem(resourceMetaKey(meta.id), meta)
}

async function saveResourcePayload(resourceId: string, file: Blob) {
  if (hasDesktopByteStorage()) {
    await writeDesktopBytes(resourceBytesKey(resourceId), new Uint8Array(await file.arrayBuffer()))
    return
  }
  await localforage.setItem(resourceBytesKey(resourceId), file)
}

async function removeResourceRecord(resourceId: string) {
  if (hasDesktopByteStorage()) {
    await removeDesktopKey(resourceMetaKey(resourceId))
    await removeDesktopKey(resourceBytesKey(resourceId))
    return
  }
  await localforage.removeItem(resourceBytesKey(resourceId))
  await localforage.removeItem(resourceMetaKey(resourceId))
}

async function assertBrowserStorageCapacity(additionalBytes: number) {
  if (additionalBytes <= 0 || typeof window === 'undefined' || window.cnoteDesktop) return
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return
  const estimate = await navigator.storage.estimate()
  const usage = estimate.usage || 0
  if (usage + additionalBytes > MAX_BROWSER_STORAGE_BYTES) {
    throw new Error('浏览器本地存储已达到 Cnote 的 10 GB 上限，请删除不再使用的本地素材后重试。')
  }
}

export async function storeLocalResource(file: Blob, fileName?: string, _persistToDisk = false) {
  return enqueueResourceMutation(async () => {
    const checksum = await checksumBlob(file)
    const resourceId = `sha256-${checksum}`
    await ensureResourcePolicy()
    if (isResourceDeleted(resourceId)) {
      const policy = currentResourcePolicy()
      if (policy.pending.includes(resourceId)) throw new Error('资源删除尚未完成，请完成清理后重新导入')
      const aliases = new Set(identityAliases(resourceId))
      await localforage.setItem(RESOURCE_POLICY_KEY, JSON.stringify({ ...policy, deleted: policy.deleted.filter(value => !aliases.has(value)) }))
    }
    const previous = await getMeta(resourceId)
    if (!previous) {
      await assertBrowserStorageCapacity(file.size)
      await saveResourcePayload(resourceId, file)
    }
    const meta: ResourceMeta = previous
      ? { ...previous, refCount: previous.refCount + 1 }
      : { id: resourceId, checksum, mimeType: file.type || 'application/octet-stream', size: file.size, refCount: 1, createdAt: Date.now(), ...(fileName ? { fileName } : {}) }
    const nextMeta = fileName && !meta.fileName ? { ...meta, fileName } : meta
    await saveMeta(nextMeta)

    return { resourceId, checksum, mimeType: nextMeta.mimeType, size: nextMeta.size, fileName: nextMeta.fileName, url: createManagedObjectUrl(file) }
  })
}

export async function retainLocalResource(resourceId?: string) {
  return enqueueResourceMutation(async () => {
    if (!resourceId) return undefined
    const meta = await getMeta(resourceId)
    if (!meta) return undefined
    await saveMeta({ ...meta, refCount: meta.refCount + 1 })
    return resourceId
  })
}

// Snapshots remain independent business objects while immutable Blob bytes are checksum-deduplicated.
export async function cloneLocalResource(resourceId?: string) {
  return retainLocalResource(resourceId)
}

export async function loadLocalResourceBlob(resourceId: string) {
  await ensureResourcePolicy()
  if (isResourceDeleted(resourceId)) return null
  if (hasDesktopByteStorage()) {
    const bytes = await readDesktopBytes(resourceBytesKey(resourceId))
    if (bytes == null) return null
    const meta = await getMeta(resourceId)
    const payload = new Uint8Array(bytes.byteLength)
    payload.set(bytes)
    return new Blob([payload], { type: meta?.mimeType || 'application/octet-stream' })
  }
  return localforage.getItem<Blob>(resourceBytesKey(resourceId))
}

export async function loadLocalResourceUrl(resourceId: string) {
  const resource = await loadLocalResourceBlob(resourceId)
  return resource ? createManagedObjectUrl(resource) : null
}

export async function deleteLocalResource(resourceId?: string) {
  return enqueueResourceMutation(async () => {
    if (!resourceId) return
    const meta = await getMeta(resourceId)
    if (!meta) return
    await saveMeta({ ...meta, refCount: Math.max(0, meta.refCount - 1) })
  })
}

export async function purgeLocalResource(resourceId: string) {
  await enqueueResourceMutation(() => removeResourceRecord(resourceId))
}

export async function getLocalResourceMeta(resourceId: string) {
  return getMeta(resourceId)
}

export async function hasLocalResource(resourceId: string) {
  return Boolean(await getMeta(resourceId)) && Boolean(await loadLocalResourceBlob(resourceId))
}
