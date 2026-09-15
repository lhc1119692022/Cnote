import { contextBridge, ipcRenderer } from 'electron'
import type { ContentParseInput, DirectoryDialogRequest, FileDialogFilter, JobRecord, JobUpdate, NativeJobRequest, NetworkRequest, NetworkResponse, ParsedPageContent, RuntimeInfo } from './runtime/types'
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
  browser: {
    popout: (url: string, title?: string) => invoke<void>('browser:popout', url, title),
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
