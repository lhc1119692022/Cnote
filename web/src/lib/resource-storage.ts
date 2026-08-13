import localforage from '@/lib/localforage-storage'

const RESOURCE_PREFIX = 'resource:'
const RESOURCE_META_PREFIX = 'resource-meta:'
const managedObjectUrls = new Set<string>()

interface ResourceMeta {
  id: string
  checksum: string
  mimeType: string
  size: number
  refCount: number
  createdAt: number
}

let resourceMutationQueue: Promise<unknown> = Promise.resolve()

function enqueueResourceMutation<T>(operation: () => Promise<T>) {
  const next = resourceMutationQueue.then(operation, operation)
  resourceMutationQueue = next.catch(() => undefined)
  return next
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

async function getMeta(resourceId: string) {
  return localforage.getItem<ResourceMeta>(`${RESOURCE_META_PREFIX}${resourceId}`)
}

export async function storeLocalResource(file: Blob) {
  return enqueueResourceMutation(async () => {
    const checksum = await checksumBlob(file)
    const resourceId = `sha256-${checksum}`
    const previous = await getMeta(resourceId)
    if (!previous) await localforage.setItem(`${RESOURCE_PREFIX}${resourceId}`, file)
    const meta: ResourceMeta = previous
      ? { ...previous, refCount: previous.refCount + 1 }
      : { id: resourceId, checksum, mimeType: file.type || 'application/octet-stream', size: file.size, refCount: 1, createdAt: Date.now() }
    await localforage.setItem(`${RESOURCE_META_PREFIX}${resourceId}`, meta)
    return { resourceId, checksum, mimeType: meta.mimeType, size: meta.size, url: createManagedObjectUrl(file) }
  })
}

export async function retainLocalResource(resourceId?: string) {
  return enqueueResourceMutation(async () => {
    if (!resourceId) return undefined
    const meta = await getMeta(resourceId)
    if (!meta) return undefined
    await localforage.setItem(`${RESOURCE_META_PREFIX}${resourceId}`, { ...meta, refCount: meta.refCount + 1 })
    return resourceId
  })
}

// Snapshots remain independent business objects while immutable Blob bytes are checksum-deduplicated.
export async function cloneLocalResource(resourceId?: string) {
  return retainLocalResource(resourceId)
}

export async function loadLocalResourceBlob(resourceId: string) {
  return localforage.getItem<Blob>(`${RESOURCE_PREFIX}${resourceId}`)
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
    if (meta.refCount > 1) {
      await localforage.setItem(`${RESOURCE_META_PREFIX}${resourceId}`, { ...meta, refCount: meta.refCount - 1 })
      return
    }
    await localforage.removeItem(`${RESOURCE_PREFIX}${resourceId}`)
    await localforage.removeItem(`${RESOURCE_META_PREFIX}${resourceId}`)
  })
}

export async function getLocalResourceMeta(resourceId: string) {
  return getMeta(resourceId)
}

export async function hasLocalResource(resourceId: string) {
  return Boolean(await getMeta(resourceId)) && Boolean(await loadLocalResourceBlob(resourceId))
}
