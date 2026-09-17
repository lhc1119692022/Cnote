import localforage from 'localforage'
import type { StateStorage } from 'zustand/middleware'

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
  const bytes = await readDesktopBytes(key)
  return bytes == null ? null : textDecoder.decode(bytes)
}

async function writeDesktopString(key: string, value: string): Promise<void> {
  await writeDesktopBytes(key, textEncoder.encode(value))
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
      if (storedValue) return storedValue

      // Flow 数据早期版本写在同步 localStorage 中。首次读取时迁移到
      // IndexedDB，避免升级后丢失用户已有画板。
      const legacyValue = window.localStorage.getItem(name)
      if (!legacyValue) return null
      await localforage.setItem(name, legacyValue)
      window.localStorage.removeItem(name)
      return legacyValue
    } catch (error) {
      console.warn(`Failed to get item from LocalForage: ${name}`, error)
      return window.localStorage.getItem(name)
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return
    if (hasDesktopByteStorage()) {
      await writeDesktopString(name, value)
      return
    }

    try {
      await localforage.setItem(name, value)
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
    if (hasDesktopByteStorage()) {
      return (await readDesktopString(key)) as T | null
    }
    return localforage.getItem<T>(key)
  },

  async setItem<T>(key: string, value: T): Promise<T> {
    if (hasDesktopByteStorage()) {
      await writeDesktopBytes(key, await encodeDesktopValue(value))
      return value
    }
    return localforage.setItem(key, value)
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
      throw new Error('Desktop storage does not support key listing')
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
