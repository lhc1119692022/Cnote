import localforage from 'localforage'
import { RESOURCE_POLICY_KEY, currentResourcePolicy, installResourcePolicy, guardStoredValue } from '@/storage/resource-policy'
import { GALLERY_PREFIX, indexGalleryDocument } from '@/storage/gallery-index'
import type { StateStorage } from 'zustand/middleware'

let policyReady: Promise<void> | undefined
export function ensureResourcePolicy(): Promise<void> {
  if (!policyReady) policyReady = (async () => {
    const value = hasDesktopByteStorage() ? await readDesktopBytes(RESOURCE_POLICY_KEY).then(bytes => bytes ? new TextDecoder().decode(bytes) : null) : await localforage.getItem<string>(RESOURCE_POLICY_KEY)
    if (value) installResourcePolicy(typeof value === 'string' ? JSON.parse(value) : value)
  })()
  return policyReady
}
async function guarded(key: string, value: string) {
  await ensureResourcePolicy()
  if (key.startsWith('doc:flow:') && currentResourcePolicy().deletedFlows.includes(key.slice('doc:flow:'.length))) throw new Error('画布已删除，拒绝过期保存')
  return guardStoredValue(key, value)
}
async function markIndexDirty(key: string) {
  if (!key.startsWith('doc:flow:')) return
  const dirty = 'gallery-dirty:' + key.slice(9)
  if (hasDesktopByteStorage()) await writeDesktopBytes(dirty, new TextEncoder().encode('true'))
  else await localforage.setItem(dirty, true)
}
async function updateIndex(key: string, value: unknown) {
  if (!key.startsWith('doc:flow:')) return
  const record = typeof value === 'string' ? JSON.parse(value) : value
  const indexKey = GALLERY_PREFIX + key.slice('doc:flow:'.length)
  const index = JSON.stringify(indexGalleryDocument(record.payload))
  const previous = hasDesktopByteStorage() ? await readDesktopBytes(indexKey).then(value => value ? textDecoder.decode(value) : null) : await localforage.getItem<string>(indexKey)
  if (previous === index) {
    if (hasDesktopByteStorage()) await removeDesktopKey('gallery-dirty:' + key.slice(9))
    else await localforage.removeItem('gallery-dirty:' + key.slice(9))
    return
  }
  if (hasDesktopByteStorage()) await writeDesktopBytes(indexKey, textEncoder.encode(index))
  else await localforage.setItem(indexKey, index)
  if (hasDesktopByteStorage()) await removeDesktopKey('gallery-dirty:' + key.slice(9))
  else await localforage.removeItem('gallery-dirty:' + key.slice(9))
  window.dispatchEvent(new Event('cnote-gallery-updated'))
}
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

localforage.config({
  name: 'cnote',
  storeName: 'app_state',
  description: 'Cnote application state storage',
})

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

async function readDesktopBytes(key: string): Promise<Uint8Array | null> {
  const value = await getDesktopByteStorage().read(key)
  if (value == null) return null
  return toBytes(value)
}

async function writeDesktopBytes(key: string, data: Uint8Array): Promise<void> {
  await getDesktopByteStorage().write(key, data)
}

async function removeDesktopKey(key: string): Promise<void> {
  await getDesktopByteStorage().remove(key)
}

async function readDesktopString(key: string): Promise<string | null> {
  await ensureResourcePolicy()
  if (key.startsWith('doc:flow:') && currentResourcePolicy().deletedFlows.includes(key.slice(9))) return null
  const bytes = await readDesktopBytes(key)
  return bytes == null ? null : guarded(key, textDecoder.decode(bytes))
}

async function writeDesktopString(key: string, value: string): Promise<void> {
  const safe = await guarded(key, value)
  await markIndexDirty(key)
  await writeDesktopBytes(key, textEncoder.encode(safe))
  if (key === RESOURCE_POLICY_KEY) installResourcePolicy(JSON.parse(safe))
  await updateIndex(key, safe)
}

async function encodeDesktopValue(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') return textEncoder.encode(value)
  if (value instanceof Uint8Array) return value
  if (typeof Blob !== 'undefined' && value instanceof Blob) return new Uint8Array(await value.arrayBuffer())
  return textEncoder.encode(JSON.stringify(value))
}

/**
 * Zustand 持久化存储适配器
 * Desktop 优先走受控 IPC；Web Preview 才使用 LocalForage / localStorage。
 */
export const localForageStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null
    if (hasDesktopByteStorage()) return readDesktopString(name)

    try {
      const storedValue = await localforage.getItem<string>(name)
      if (storedValue) return guarded(name, storedValue)

      // Flow 数据早期版本写在同步 localStorage 中。首次读取时迁移到
      // IndexedDB，避免升级后丢失用户已有画板。
      const legacyValue = window.localStorage.getItem(name)
      if (!legacyValue) return null
      await localforage.setItem(name, legacyValue)
      window.localStorage.removeItem(name)
      return guarded(name, legacyValue)
    } catch (error) {
      console.warn(`Failed to get item from LocalForage: ${name}`, error)
      const fallback = window.localStorage.getItem(name)
      return fallback ? guarded(name, fallback) : null
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return
    if (hasDesktopByteStorage()) {
      await writeDesktopString(name, value)
      return
    }

    value = await guarded(name, value)
    try {
      await markIndexDirty(name)
      await localforage.setItem(name, value)
      if (name === RESOURCE_POLICY_KEY) installResourcePolicy(JSON.parse(value))
      await updateIndex(name, value)
    } catch (error) {
      console.warn(`Failed to set item in LocalForage: ${name}`, error)
      window.localStorage.setItem(name, value)
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return
    if (hasDesktopByteStorage()) {
      await removeDesktopKey(name)
      return
    }

    try {
      await localforage.removeItem(name)
    } catch (error) {
      console.warn(`Failed to remove item from LocalForage: ${name}`, error)
      window.localStorage.removeItem(name)
    }
  },
}

const desktopAwareStorage = {
  async getItem<T>(key: string): Promise<T | null> {
    await ensureResourcePolicy()
    if (key.startsWith('doc:flow:') && currentResourcePolicy().deletedFlows.includes(key.slice(9))) return null
    if (hasDesktopByteStorage()) {
      return (await readDesktopString(key)) as T | null
    }
    const value = await localforage.getItem<T>(key)
    return typeof value === 'string' ? await guarded(key, value) as T : value
  },

  async setItem<T>(key: string, value: T): Promise<T> {
    if (typeof value === 'string') value = await guarded(key, value) as T
    await markIndexDirty(key)
    if (hasDesktopByteStorage()) await writeDesktopBytes(key, await encodeDesktopValue(value))
    else await localforage.setItem(key, value)
    if (key === RESOURCE_POLICY_KEY) installResourcePolicy(typeof value === 'string' ? JSON.parse(value) : value as never)
    await updateIndex(key, value)
    return value
  },

  async removeItem(key: string): Promise<void> {
    if (hasDesktopByteStorage()) {
      await removeDesktopKey(key)
      return
    }
    await localforage.removeItem(key)
  },

  async keys(): Promise<string[]> {
    if (hasDesktopByteStorage()) {
      return getDesktopByteStorage().keys()
    }
    return localforage.keys()
  },

  async clear(): Promise<void> {
    if (hasDesktopByteStorage()) {
      throw new Error('Desktop storage does not support bulk clear')
    }
    await localforage.clear()
  },
}

export async function saveFlow(flowId: string, data: any): Promise<void> {
  await desktopAwareStorage.setItem(`flow:${flowId}`, JSON.stringify(data))
}

export async function loadFlow(flowId: string): Promise<any | null> {
  const data = await desktopAwareStorage.getItem<string>(`flow:${flowId}`)
  return data ? JSON.parse(data) : null
}

export async function deleteFlow(flowId: string): Promise<void> {
  await desktopAwareStorage.removeItem(`flow:${flowId}`)
}

export async function getAllFlowIds(): Promise<string[]> {
  if (hasDesktopByteStorage()) return []
  const keys = await localforage.keys()
  return keys.filter((key) => key.startsWith('flow:')).map((key) => key.replace('flow:', ''))
}

export async function clearAllData(): Promise<void> {
  await desktopAwareStorage.clear()
}

export async function getStorageSize(): Promise<number> {
  if (hasDesktopByteStorage()) {
    throw new Error('Desktop storage does not support size listing')
  }
  const keys = await localforage.keys()
  let totalSize = 0

  for (const key of keys) {
    const value = await localforage.getItem<string>(key)
    if (value) {
      totalSize += new Blob([value]).size
    }
  }

  return totalSize
}

export default desktopAwareStorage as typeof localforage
