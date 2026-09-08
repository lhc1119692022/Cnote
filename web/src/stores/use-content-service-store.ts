import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import { CONTENT_SERVICE_SECRET, ScraperClient, type ContentServiceCapabilities } from '@/lib/scraper'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import { deleteDesktopSecret, ensureDesktopSecret, syncDesktopSecretInBackground } from '@/lib/desktop-secrets'

export interface ContentServiceSettings {
  enabled: boolean
  baseURL: string
  /** Kept in memory for the current renderer session; never persisted in plaintext. */
  accessToken: string
  encryptedAccessToken?: string
  /** SafeStorage key used by the desktop runtime. */
  secretName: string
  lastCheckedAt?: number
  serviceVersion?: string
  capabilities?: ContentServiceCapabilities
}

interface ContentServiceState extends ContentServiceSettings {
  updateSettings: (updates: Partial<Pick<ContentServiceSettings, 'enabled' | 'baseURL' | 'accessToken'>>) => void
  clearSettings: () => void
  testConnection: (draft?: Partial<Pick<ContentServiceSettings, 'baseURL' | 'accessToken'>>) => Promise<ReturnType<ScraperClient['getHealth']> extends Promise<infer T> ? T : never>
}

function normalizeToken(value: string) {
  return value.trim().replace(/^Bearer\s+/i, '')
}

export const useContentServiceStore = create<ContentServiceState>()(
  persist(
    (set, get) => ({
      enabled: false,
      baseURL: '',
      accessToken: '',
      secretName: CONTENT_SERVICE_SECRET,
      updateSettings: (updates) => set((state) => {
        const accessToken = updates.accessToken === undefined ? state.accessToken : normalizeToken(updates.accessToken)
        if (accessToken) syncDesktopSecretInBackground(CONTENT_SERVICE_SECRET, `Bearer ${accessToken}`)
        else if (updates.accessToken !== undefined) void deleteDesktopSecret(CONTENT_SERVICE_SECRET).catch(() => undefined)
        return {
          ...updates,
          baseURL: updates.baseURL === undefined ? state.baseURL : updates.baseURL.trim().replace(/\/$/, ''),
          accessToken,
          encryptedAccessToken: accessToken ? encryptAPIKey(accessToken) : undefined,
          secretName: CONTENT_SERVICE_SECRET,
          serviceVersion: undefined,
          capabilities: undefined,
          lastCheckedAt: undefined,
        }
      }),
      clearSettings: () => {
        void deleteDesktopSecret(CONTENT_SERVICE_SECRET).catch(() => undefined)
        set({
          enabled: false,
          baseURL: '',
          accessToken: '',
          encryptedAccessToken: undefined,
          secretName: CONTENT_SERVICE_SECRET,
          serviceVersion: undefined,
          capabilities: undefined,
          lastCheckedAt: undefined,
        })
      },
      testConnection: async (draft) => {
        const current = get()
        const baseURL = (draft?.baseURL ?? current.baseURL).trim().replace(/\/$/, '')
        const accessToken = normalizeToken(draft?.accessToken ?? current.accessToken)
        if (!baseURL) throw new Error('请输入内容解析服务地址')
        const explicitEmptyToken = Boolean(draft && Object.prototype.hasOwnProperty.call(draft, 'accessToken') && !accessToken)
        const storedSecretAvailable = explicitEmptyToken ? false : await ensureDesktopSecret(CONTENT_SERVICE_SECRET)
        const secretName = accessToken || storedSecretAvailable ? CONTENT_SERVICE_SECRET : undefined
        if (accessToken) syncDesktopSecretInBackground(CONTENT_SERVICE_SECRET, `Bearer ${accessToken}`)
        const health = await new ScraperClient({ baseURL, accessToken, secretName }).getHealth()
        set({
          enabled: true,
          baseURL,
          accessToken,
          encryptedAccessToken: accessToken ? encryptAPIKey(accessToken) : undefined,
          secretName: CONTENT_SERVICE_SECRET,
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
        encryptedAccessToken: state.encryptedAccessToken || (state.accessToken ? encryptAPIKey(state.accessToken) : undefined),
        secretName: CONTENT_SERVICE_SECRET,
        lastCheckedAt: state.lastCheckedAt,
        serviceVersion: state.serviceVersion,
        capabilities: state.capabilities,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<ContentServiceState> | undefined
        return {
          ...current,
          ...stored,
          accessToken: stored?.accessToken || (stored?.encryptedAccessToken ? decryptAPIKey(stored.encryptedAccessToken) : ''),
          secretName: CONTENT_SERVICE_SECRET,
        }
      },
    },
  ),
)
