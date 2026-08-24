import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserCapture, BrowserSessionSummary, BrowserViewBounds, ContentParseInput, FileDialogFilter, JobRecord, JobUpdate, NativeJobRequest, ParsedPageContent, RuntimeInfo } from './runtime/types'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  getRuntimeInfo: () => invoke<RuntimeInfo>('runtime:get-info'),
  window: {
    minimize: () => invoke<void>('window:minimize'),
    toggleMaximize: () => invoke<boolean>('window:toggle-maximize'),
    close: () => invoke<void>('window:close'),
    isMaximized: () => invoke<boolean>('window:is-maximized'),
    onStateChanged: (listener: (state: { maximized: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) => listener(state)
      ipcRenderer.on('window:state-changed', handler)
      return () => ipcRenderer.removeListener('window:state-changed', handler)
    },
  },
  browser: {
    createSession: (options?: { id?: string; name?: string; persistent?: boolean; url?: string }) =>
      invoke<BrowserSessionSummary>('browser:create-session', options),
    listSessions: () => invoke<BrowserSessionSummary[]>('browser:list-sessions'),
    onSessionUpdated: (listener: (session: BrowserSessionSummary) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: BrowserSessionSummary) => listener(session)
      ipcRenderer.on('browser:session-updated', handler)
      return () => ipcRenderer.removeListener('browser:session-updated', handler)
    },
    mountSession: (id: string, bounds: BrowserViewBounds) => invoke<void>('browser:mount-session', id, bounds),
    unmountSession: (id: string) => invoke<void>('browser:unmount-session', id),
    setBounds: (id: string, bounds: BrowserViewBounds) => invoke<void>('browser:set-bounds', id, bounds),
    showSession: (id: string) => invoke<void>('browser:show-session', id),
    popoutSession: (id: string) => invoke<void>('browser:popout-session', id),
    navigate: (id: string, url: string) => invoke<BrowserSessionSummary>('browser:navigate', id, url),
    reload: (id: string) => invoke<BrowserSessionSummary>('browser:reload', id),
    capture: (id: string) => invoke<BrowserCapture>('browser:capture', id),
    closeSession: (id: string) => invoke<void>('browser:close-session', id),
  },
  content: {
    parseHtml: (input: ContentParseInput) => invoke<ParsedPageContent>('content:parse-html', input),
  },
  system: {
    openFile: (request?: { title?: string; filters?: FileDialogFilter[] }) =>
      invoke<{ name: string; data: Uint8Array } | null>('system:open-file', request),
    saveFile: (request: { title?: string; suggestedName: string; filters?: FileDialogFilter[]; data: Uint8Array }) =>
      invoke<boolean>('system:save-file', request),
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
