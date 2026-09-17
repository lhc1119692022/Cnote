import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserCapture, BrowserFrame, BrowserInputEvent, BrowserSessionSummary, BrowserViewportRequest, ContentParseInput, DirectoryDialogRequest, FileDialogFilter, JobRecord, JobUpdate, NativeJobRequest, NetworkRequest, NetworkResponse, ParsedPageContent, RuntimeInfo } from './runtime/types'
import type { StorageLocationInfo } from './runtime/storage-location'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  getRuntimeInfo: () => invoke<RuntimeInfo>('runtime:get-info'),
  window: {
    minimize: () => invoke<void>('window:minimize'),
    toggleMaximize: () => invoke<boolean>('window:toggle-maximize'),
    close: () => invoke<void>('window:close'),
    reload: () => invoke<void>('window:reload'),
    isMaximized: () => invoke<boolean>('window:is-maximized'),
    onStateChanged: (listener: (state: { maximized: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) => listener(state)
      ipcRenderer.on('window:state-changed', handler)
      return () => ipcRenderer.removeListener('window:state-changed', handler)
    },
  },
  session: {
    onFlushRequest: (listener: () => void | Promise<void>) => {
      const handler = () => {
        void Promise.resolve(listener()).catch(() => undefined)
      }
      ipcRenderer.on('session:flush', handler)
      return () => ipcRenderer.removeListener('session:flush', handler)
    },
    notifyFlushed: () => ipcRenderer.send('session:flushed'),
  },
  browser: {
    setPresentation: (guestId: number, viewport: BrowserViewportRequest) => invoke<void>('browser:set-presentation', guestId, viewport),
    createSession: (options?: { id?: string; name?: string; persistent?: boolean; url?: string }) =>
      invoke<BrowserSessionSummary>('browser:create-session', options),
    listSessions: () => invoke<BrowserSessionSummary[]>('browser:list-sessions'),
    onSessionUpdated: (listener: (session: BrowserSessionSummary) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: BrowserSessionSummary) => listener(session)
      ipcRenderer.on('browser:session-updated', handler)
      return () => ipcRenderer.removeListener('browser:session-updated', handler)
    },
    onFrame: (listener: (frame: BrowserFrame & { data: Uint8Array }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, frame: BrowserFrame & { data: Uint8Array }) => listener(frame)
      ipcRenderer.on('browser:frame', handler)
      return () => ipcRenderer.removeListener('browser:frame', handler)
    },
    onCursorChanged: (listener: (change: { sessionId: string; cursor: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, change: { sessionId: string; cursor: string }) => listener(change)
      ipcRenderer.on('browser:cursor', handler)
      return () => ipcRenderer.removeListener('browser:cursor', handler)
    },
    setViewport: (id: string, viewport: BrowserViewportRequest) => invoke<void>('browser:set-viewport', id, viewport),
    sendInput: (id: string, event: BrowserInputEvent) => invoke<void>('browser:input', id, event),
    popout: (url: string, title?: string) => invoke<void>('browser:popout', url, title),
    showSession: (id: string) => invoke<void>('browser:show-session', id),
    popoutSession: (id: string) => invoke<void>('browser:popout-session', id),
    navigate: (id: string, url: string) => invoke<BrowserSessionSummary>('browser:navigate', id, url),
    reload: (id: string) => invoke<BrowserSessionSummary>('browser:reload', id),
    goBack: (id: string) => invoke<BrowserSessionSummary>('browser:go-back', id),
    goForward: (id: string) => invoke<BrowserSessionSummary>('browser:go-forward', id),
    capture: (id: string) => invoke<BrowserCapture>('browser:capture', id),
    closeSession: (id: string) => invoke<void>('browser:close-session', id),
  },
  content: {
    parseHtml: (input: ContentParseInput) => invoke<ParsedPageContent>('content:parse-html', input),
  },
  network: {
    request: (input: NetworkRequest & { secretRefs?: Record<string, string> }) => invoke<NetworkResponse>('network:request', input),
    abort: (requestId: string) => invoke<boolean>('network:abort', requestId),
  },
  system: {
    openFile: (request?: { title?: string; filters?: FileDialogFilter[] }) =>
      invoke<{ name: string; data: Uint8Array } | null>('system:open-file', request),
    saveFile: (request: { title?: string; suggestedName: string; filters?: FileDialogFilter[]; data: Uint8Array }) =>
      invoke<boolean>('system:save-file', request),
    saveResource: (request: { resourceId: string; fileName: string; data: Uint8Array }) =>
      invoke<string>('system:save-resource', request),
    selectDirectory: (request?: DirectoryDialogRequest) => invoke<string | null>('system:select-directory', request),
    getStorageLocation: () => invoke<StorageLocationInfo>('system:get-storage-location'),
    setStorageLocation: (value: string) => invoke<StorageLocationInfo>('system:set-storage-location', value),
    resetStorageLocation: () => invoke<StorageLocationInfo>('system:reset-storage-location'),
    restart: () => invoke<void>('system:restart'),
  },
  storage: {
    read: (key: string) => invoke<Uint8Array | null>('storage:read', key),
    write: (key: string, data: Uint8Array) => invoke<void>('storage:write', key, data),
    remove: (key: string) => invoke<void>('storage:remove', key),
  },
  jobs: {
    list: () => invoke<JobRecord[]>('jobs:list'),
    create: (kind: string, checkpoint?: unknown) => invoke<JobRecord>('jobs:create', kind, checkpoint),
    enqueueNative: (request: NativeJobRequest) => invoke<JobRecord>('jobs:enqueue-native', request),
    update: (id: string, update: JobUpdate) => invoke<JobRecord>('jobs:update', id, update),
    onUpdated: (listener: (job: JobRecord) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, job: JobRecord) => listener(job)
      ipcRenderer.on('jobs:updated', handler)
      return () => ipcRenderer.removeListener('jobs:updated', handler)
    },
    cancel: (id: string) => invoke<JobRecord>('jobs:cancel', id),
  },
  secrets: {
    has: (name: string) => invoke<boolean>('secret:has', name),
    set: (name: string, value: string) => invoke<void>('secret:set', name, value),
    delete: (name: string) => invoke<void>('secret:delete', name),
  },
} as const

contextBridge.exposeInMainWorld('cnoteDesktop', api)

export type CnoteDesktopApi = typeof api
