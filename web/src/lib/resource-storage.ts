import { nanoid } from 'nanoid'
import localforage from '@/lib/localforage-storage'

const RESOURCE_PREFIX = 'resource:'
const managedObjectUrls = new Set<string>()

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

export async function storeLocalResource(file: Blob) {
  const resourceId = nanoid()
  await localforage.setItem(`${RESOURCE_PREFIX}${resourceId}`, file)
  return { resourceId, url: createManagedObjectUrl(file) }
}

export async function cloneLocalResource(resourceId?: string) {
  if (!resourceId) return undefined
  const resource = await localforage.getItem<Blob>(`${RESOURCE_PREFIX}${resourceId}`)
  if (!resource) return undefined
  const clonedResourceId = nanoid()
  await localforage.setItem(`${RESOURCE_PREFIX}${clonedResourceId}`, resource)
  return clonedResourceId
}

export async function loadLocalResourceUrl(resourceId: string) {
  const resource = await localforage.getItem<Blob>(`${RESOURCE_PREFIX}${resourceId}`)
  return resource ? createManagedObjectUrl(resource) : null
}

export async function deleteLocalResource(resourceId?: string) {
  if (resourceId) await localforage.removeItem(`${RESOURCE_PREFIX}${resourceId}`)
}
