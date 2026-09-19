import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import { desktopFetch } from '@/lib/desktop-fetch'
import { deleteDesktopSecret, syncDesktopSecret, syncDesktopSecretInBackground } from '@/lib/desktop-secrets'

export interface MediaStorageHealth {
  ok: boolean
  uploadConfigured?: boolean
  version?: string
  timestamp?: string
}

export interface MediaStorageUsage {
  objectCount: number
  totalBytes: number
  fetchedAt: number
}

export interface MediaStorageObject {
  key: string
  size: number
  uploaded?: string
  etag?: string
  originalName?: string
  checksum?: string
  url?: string
}

export interface MediaStorageSettings {
  /** Root URL of a custom upload service, without the upload path. */
  baseURL: string
  uploadPath: string
  fieldName: string
  responsePath: string
  accessToken: string
  encryptedAccessToken?: string
  secretName: string
  enabled: boolean
  lastCheckedAt?: number
  health?: MediaStorageHealth
  usage?: MediaStorageUsage
}

interface MediaStorageState extends MediaStorageSettings {
  updateSettings: (updates: Partial<Pick<MediaStorageSettings, 'baseURL' | 'uploadPath' | 'fieldName' | 'responsePath' | 'accessToken'>>) => void
  clearSettings: () => void
  getAccessToken: () => string
  getUploadEndpoint: (draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'uploadPath'>>) => string
  testConnection: (draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'uploadPath' | 'fieldName' | 'responsePath' | 'accessToken'>>) => Promise<MediaStorageHealth>
  refreshUsage: (draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'accessToken'>>) => Promise<MediaStorageUsage>
  listObjects: (options?: { limit?: number; cursor?: string; draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'accessToken'>> }) => Promise<{ objects: MediaStorageObject[]; cursor?: string }>
  deleteObject: (key: string, draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'accessToken'>>) => Promise<void>
}

const DEFAULT_UPLOAD_PATH = '/upload'
const DEFAULT_FIELD_NAME = 'file'
const DEFAULT_RESPONSE_PATH = 'url'
const MEDIA_STORAGE_SECRET = 'cnote:media-storage'

function normalizeBaseURL(value: string) {
  return value.trim().replace(/\/$/, '')
}

function normalizePath(value: string, fallback: string) {
  const path = value.trim()
  if (!path) return fallback
  return `/${path.replace(/^\/+/, '')}`
}

function joinURL(baseURL: string, path: string) {
  const base = normalizeBaseURL(baseURL)
  if (!base) return ''
  return `${base}/${path.replace(/^\/+/, '')}`
}

function normalizeAccessToken(value: string) {
  return value.trim().replace(/^Bearer\s+/i, '')
}

function tokenFor(settings: Pick<MediaStorageSettings, 'accessToken' | 'encryptedAccessToken'>) {
  const value = settings.accessToken || (settings.encryptedAccessToken ? decryptAPIKey(settings.encryptedAccessToken) : '')
  return normalizeAccessToken(value)
}

function bearerAuthorization(value: string) {
  const token = normalizeAccessToken(value)
  return token ? `Bearer ${token}` : ''
}

async function saveDesktopSecret(value: string) {
  const authorization = bearerAuthorization(value)
  if (!authorization) return false
  // Secret references represent complete header values in the main process.
  // Store the Bearer prefix here because the Worker authenticates the exact
  // `Authorization: Bearer <token>` header value.
  return syncDesktopSecret(MEDIA_STORAGE_SECRET, authorization)
}

function requestHeaders(settings: Pick<MediaStorageSettings, 'accessToken' | 'encryptedAccessToken'>, tokenOverride?: string) {
  const token = tokenOverride ?? tokenFor(settings)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = bearerAuthorization(token)
  return headers
}

function requestSecretRefs(settings: Pick<MediaStorageSettings, 'accessToken' | 'encryptedAccessToken'>, tokenOverride?: string) {
  const token = tokenOverride ?? tokenFor(settings)
  if (!token || typeof window === 'undefined' || !window.cnoteDesktop) return undefined
  return { Authorization: MEDIA_STORAGE_SECRET }
}

async function parseJSON(response: Response) {
  const text = await response.text()
  let body: any = undefined
  try { body = text ? JSON.parse(text) : undefined } catch { body = text }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`
    throw new Error(String(message))
  }
  return body
}

function settingsForRequest(current: MediaStorageState, draft?: Partial<Pick<MediaStorageSettings, 'baseURL' | 'uploadPath' | 'accessToken'>>) {
  return {
    baseURL: normalizeBaseURL(draft?.baseURL ?? current.baseURL),
    uploadPath: normalizePath(draft?.uploadPath ?? current.uploadPath, DEFAULT_UPLOAD_PATH),
    accessToken: normalizeAccessToken(draft?.accessToken ?? current.getAccessToken()),
  }
}

function healthURL(baseURL: string) {
  return joinURL(baseURL, '/health')
}

function usageURL(baseURL: string) {
  return joinURL(baseURL, '/usage')
}

function objectsURL(baseURL: string, options?: { limit?: number; cursor?: string }) {
  const url = new URL(joinURL(baseURL, '/objects'))
  if (options?.limit) url.searchParams.set('limit', String(Math.min(Math.max(Math.floor(options.limit), 1), 1000)))
  if (options?.cursor) url.searchParams.set('cursor', options.cursor)
  return url.toString()
}

function normalizeUsage(payload: any): MediaStorageUsage {
  const objectCount = Number(payload?.objectCount ?? payload?.object_count ?? payload?.count ?? payload?.usage?.objectCount ?? payload?.usage?.object_count ?? 0)
  const totalBytes = Number(payload?.totalBytes ?? payload?.total_bytes ?? payload?.bytes ?? payload?.usage?.totalBytes ?? payload?.usage?.total_bytes ?? 0)
  return {
    objectCount: Number.isFinite(objectCount) ? Math.max(0, objectCount) : 0,
    totalBytes: Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : 0,
    fetchedAt: Date.now(),
  }
}

function normalizeObject(value: any, baseURL: string): MediaStorageObject | null {
  const key = typeof value?.key === 'string' ? value.key : ''
  if (!key) return null
  const size = Number(value?.size || 0)
  return {
    key,
    size: Number.isFinite(size) ? Math.max(0, size) : 0,
    uploaded: typeof value?.uploaded === 'string' ? value.uploaded : undefined,
    etag: typeof value?.etag === 'string' ? value.etag : undefined,
    originalName: typeof value?.originalName === 'string' ? value.originalName : typeof value?.metadata?.originalName === 'string' ? value.metadata.originalName : undefined,
    checksum: typeof value?.checksum === 'string' ? value.checksum : typeof value?.metadata?.checksum === 'string' ? value.metadata.checksum : undefined,
    url: typeof value?.url === 'string' ? value.url : joinURL(baseURL, `/media/${encodeURIComponent(key)}`),
  }
}

export const useMediaStorageStore = create<MediaStorageState>()(
  persist(
    (set, get) => ({
      baseURL: '',
      uploadPath: DEFAULT_UPLOAD_PATH,
      fieldName: DEFAULT_FIELD_NAME,
      responsePath: DEFAULT_RESPONSE_PATH,
      accessToken: '',
      secretName: MEDIA_STORAGE_SECRET,
      enabled: false,
      updateSettings: (updates) => set((state) => {
        const accessToken = updates.accessToken === undefined ? state.getAccessToken() : normalizeAccessToken(updates.accessToken)
        if (accessToken) syncDesktopSecretInBackground(MEDIA_STORAGE_SECRET, bearerAuthorization(accessToken))
        return {
          ...updates,
          baseURL: updates.baseURL === undefined ? state.baseURL : normalizeBaseURL(updates.baseURL),
          uploadPath: updates.uploadPath === undefined ? state.uploadPath : normalizePath(updates.uploadPath, DEFAULT_UPLOAD_PATH),
          fieldName: updates.fieldName === undefined ? state.fieldName : updates.fieldName.trim() || DEFAULT_FIELD_NAME,
          responsePath: updates.responsePath === undefined ? state.responsePath : updates.responsePath.trim() || DEFAULT_RESPONSE_PATH,
          accessToken,
          encryptedAccessToken: accessToken ? encryptAPIKey(accessToken) : undefined,
          secretName: MEDIA_STORAGE_SECRET,
          enabled: Boolean((updates.baseURL ?? state.baseURL).trim()),
          lastCheckedAt: undefined,
          health: undefined,
          usage: undefined,
        }
      }),
      clearSettings: () => {
        void deleteDesktopSecret(MEDIA_STORAGE_SECRET).catch(() => undefined)
        set({
          baseURL: '',
          uploadPath: DEFAULT_UPLOAD_PATH,
          fieldName: DEFAULT_FIELD_NAME,
          responsePath: DEFAULT_RESPONSE_PATH,
          accessToken: '',
          encryptedAccessToken: undefined,
          secretName: MEDIA_STORAGE_SECRET,
          enabled: false,
          lastCheckedAt: undefined,
          health: undefined,
          usage: undefined,
        })
      },
      getAccessToken: () => tokenFor(get()),
      getUploadEndpoint: (draft) => {
        const current = get()
        const settings = settingsForRequest(current, draft)
        return joinURL(settings.baseURL, settings.uploadPath)
      },
      testConnection: async (draft) => {
        const current = get()
        const settings = settingsForRequest(current, draft)
        if (!settings.baseURL) throw new Error('请输入媒体上传服务地址')
        if (settings.accessToken) await saveDesktopSecret(settings.accessToken)
        const response = await desktopFetch(healthURL(settings.baseURL), {
          method: 'GET',
          headers: requestHeaders(current, settings.accessToken),
        }, { secretRefs: requestSecretRefs(current, settings.accessToken) })
        const payload = await parseJSON(response)
        const health: MediaStorageHealth = {
          ok: payload?.ok === false ? false : true,
          uploadConfigured: payload?.uploadConfigured === undefined ? undefined : Boolean(payload.uploadConfigured),
          version: typeof payload?.version === 'string' ? payload.version : undefined,
          timestamp: typeof payload?.timestamp === 'string' ? payload.timestamp : undefined,
        }
        set({
          baseURL: settings.baseURL,
          uploadPath: settings.uploadPath,
          fieldName: draft?.fieldName === undefined ? current.fieldName : draft.fieldName.trim() || DEFAULT_FIELD_NAME,
          responsePath: draft?.responsePath === undefined ? current.responsePath : draft.responsePath.trim() || DEFAULT_RESPONSE_PATH,
          accessToken: settings.accessToken,
          encryptedAccessToken: settings.accessToken ? encryptAPIKey(settings.accessToken) : undefined,
          enabled: true,
          lastCheckedAt: Date.now(),
          health,
        })
        if (settings.accessToken) await saveDesktopSecret(settings.accessToken)
        return health
      },
      refreshUsage: async (draft) => {
        const current = get()
        const settings = settingsForRequest(current, draft)
        if (!settings.baseURL) throw new Error('请输入媒体上传服务地址')
        if (settings.accessToken) await saveDesktopSecret(settings.accessToken)
        const response = await desktopFetch(usageURL(settings.baseURL), {
          method: 'GET',
          headers: requestHeaders(current, settings.accessToken),
        }, { secretRefs: requestSecretRefs(current, settings.accessToken) })
        const usage = normalizeUsage(await parseJSON(response))
        if (get().baseURL === current.baseURL && get().getAccessToken() === tokenFor(current)) set({ usage })
        return usage
      },
      listObjects: async (options) => {
        const current = get()
        const settings = settingsForRequest(current, options?.draft)
        if (!settings.baseURL) throw new Error('请输入媒体上传服务地址')
        if (settings.accessToken) await saveDesktopSecret(settings.accessToken)
        const response = await desktopFetch(objectsURL(settings.baseURL, options), {
          method: 'GET',
          headers: requestHeaders(current, settings.accessToken),
        }, { secretRefs: requestSecretRefs(current, settings.accessToken) })
        const payload = await parseJSON(response)
        const rawObjects = Array.isArray(payload?.objects) ? payload.objects : Array.isArray(payload) ? payload : []
        return {
          objects: rawObjects.map((value: any) => normalizeObject(value, settings.baseURL)).filter((value: MediaStorageObject | null): value is MediaStorageObject => Boolean(value)),
          cursor: typeof payload?.cursor === 'string' && payload.cursor ? payload.cursor : undefined,
        }
      },
      deleteObject: async (key, draft) => {
        const current = get()
        const settings = settingsForRequest(current, draft)
        if (!settings.baseURL) throw new Error('请输入媒体上传服务地址')
        if (settings.accessToken) await saveDesktopSecret(settings.accessToken)
        const response = await desktopFetch(joinURL(settings.baseURL, `/media/${encodeURIComponent(key)}`), {
          method: 'DELETE',
          headers: requestHeaders(current, settings.accessToken),
        }, { secretRefs: requestSecretRefs(current, settings.accessToken) })
        await parseJSON(response)
        notifyMediaStorageChanged()
      },
    }),
    {
      name: 'cnote-media-storage',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        baseURL: state.baseURL,
        uploadPath: state.uploadPath,
        fieldName: state.fieldName,
        responsePath: state.responsePath,
        encryptedAccessToken: state.encryptedAccessToken || (state.accessToken ? encryptAPIKey(state.accessToken) : undefined),
        secretName: state.secretName,
        enabled: state.enabled,
        lastCheckedAt: state.lastCheckedAt,
        health: state.health,
        usage: state.usage,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<MediaStorageState> | undefined
        return {
          ...current,
          ...stored,
          accessToken: stored?.accessToken || (stored?.encryptedAccessToken ? decryptAPIKey(stored.encryptedAccessToken) : ''),
          uploadPath: normalizePath(stored?.uploadPath || DEFAULT_UPLOAD_PATH, DEFAULT_UPLOAD_PATH),
          fieldName: stored?.fieldName || DEFAULT_FIELD_NAME,
          responsePath: stored?.responsePath || DEFAULT_RESPONSE_PATH,
          secretName: MEDIA_STORAGE_SECRET,
        }
      },
    },
  ),
)

export const MEDIA_STORAGE_DEFAULTS = {
  uploadPath: DEFAULT_UPLOAD_PATH,
  fieldName: DEFAULT_FIELD_NAME,
  responsePath: DEFAULT_RESPONSE_PATH,
}

export const MEDIA_STORAGE_CHANGED_EVENT = 'cnote-media-storage-changed'
let refreshTimer: ReturnType<typeof setTimeout> | undefined

export function notifyMediaStorageChanged() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    const storage = useMediaStorageStore.getState()
    if (storage.baseURL) void storage.refreshUsage().catch(() => undefined)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(MEDIA_STORAGE_CHANGED_EVENT))
  }, 300)
}
