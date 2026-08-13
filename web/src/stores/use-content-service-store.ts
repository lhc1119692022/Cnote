import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import { ScraperClient, type ContentServiceCapabilities } from '@/lib/scraper'

export interface ContentServiceSettings {
  enabled: boolean
  baseURL: string
  accessToken: string
  lastCheckedAt?: number
  serviceVersion?: string
  capabilities?: ContentServiceCapabilities
}

interface ContentServiceState extends ContentServiceSettings {
  updateSettings: (updates: Partial<Pick<ContentServiceSettings, 'enabled' | 'baseURL' | 'accessToken'>>) => void
  clearSettings: () => void
  testConnection: (draft?: Partial<Pick<ContentServiceSettings, 'baseURL' | 'accessToken'>>) => Promise<ReturnType<ScraperClient['getHealth']> extends Promise<infer T> ? T : never>
}

export const useContentServiceStore = create<ContentServiceState>()(
  persist(
    (set, get) => ({
      enabled: false,
      baseURL: '',
      accessToken: '',
      updateSettings: (updates) => set((state) => ({
        ...updates,
        baseURL: updates.baseURL === undefined ? state.baseURL : updates.baseURL.trim().replace(/\/$/, ''),
        serviceVersion: undefined,
        capabilities: undefined,
        lastCheckedAt: undefined,
      })),
      clearSettings: () => set({
        enabled: false,
        baseURL: '',
        accessToken: '',
        serviceVersion: undefined,
        capabilities: undefined,
        lastCheckedAt: undefined,
      }),
      testConnection: async (draft) => {
        const current = get()
        const baseURL = (draft?.baseURL ?? current.baseURL).trim().replace(/\/$/, '')
        const accessToken = draft?.accessToken ?? current.accessToken
        if (!baseURL) throw new Error('请输入内容解析服务地址')
        const health = await new ScraperClient({ baseURL, accessToken }).getHealth()
        set({
          enabled: true,
          baseURL,
          accessToken,
          lastCheckedAt: Date.now(),
          serviceVersion: health.version,
          capabilities: health.capabilities,
        })
        return health
      },
    }),
    {
      name: 'cnote-content-service',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        baseURL: state.baseURL,
        accessToken: state.accessToken,
        lastCheckedAt: state.lastCheckedAt,
        serviceVersion: state.serviceVersion,
        capabilities: state.capabilities,
      }),
    },
  ),
)
