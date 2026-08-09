import localforage from 'localforage'
import type { StateStorage } from 'zustand/middleware'

// 配置 LocalForage
localforage.config({
  name: 'cnote',
  storeName: 'app_state',
  description: 'Cnote application state storage',
})

/**
 * Zustand 持久化存储适配器
 * 参考 infinite-canvas 实现
 */
export const localForageStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null

    try {
      return (await localforage.getItem<string>(name)) || null
    } catch (error) {
      console.warn(`Failed to get item from LocalForage: ${name}`, error)
      // 降级到 localStorage
      return window.localStorage.getItem(name)
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return

    try {
      await localforage.setItem(name, value)
    } catch (error) {
      console.warn(`Failed to set item in LocalForage: ${name}`, error)
      // 降级到 localStorage
      window.localStorage.setItem(name, value)
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return

    try {
      await localforage.removeItem(name)
    } catch (error) {
      console.warn(`Failed to remove item from LocalForage: ${name}`, error)
      // 降级到 localStorage
      window.localStorage.removeItem(name)
    }
  },
}

/**
 * 直接操作 LocalForage 的工具函数
 */

// 存储 Flow
export async function saveFlow(flowId: string, data: any): Promise<void> {
  await localforage.setItem(`flow:${flowId}`, JSON.stringify(data))
}

// 读取 Flow
export async function loadFlow(flowId: string): Promise<any | null> {
  const data = await localforage.getItem<string>(`flow:${flowId}`)
  return data ? JSON.parse(data) : null
}

// 删除 Flow
export async function deleteFlow(flowId: string): Promise<void> {
  await localforage.removeItem(`flow:${flowId}`)
}

// 获取所有 Flow IDs
export async function getAllFlowIds(): Promise<string[]> {
  const keys = await localforage.keys()
  return keys.filter(key => key.startsWith('flow:')).map(key => key.replace('flow:', ''))
}

// 清空所有数据（调试用）
export async function clearAllData(): Promise<void> {
  await localforage.clear()
}

// 获取存储使用情况
export async function getStorageSize(): Promise<number> {
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

export default localforage
