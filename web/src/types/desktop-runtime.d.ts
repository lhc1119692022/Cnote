interface CnoteDesktopApi {
  getRuntimeInfo: () => Promise<{
    platform: string
    arch: string
    appVersion: string
    desktopVersion: string
    userDataPath: string
    webRuntime: 'development-server' | 'built-web' | 'fallback'
  }>
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    reload: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void
  }
  browser: {
    popout: (url: string, title?: string) => Promise<void>
  }
  content: {
    parseHtml: (input: { html: string; url?: string; title?: string }) => Promise<{
      url: string
      title: string
      description?: string
      text: string
      headings: Array<{ level: number; text: string }>
      links: Array<{ text: string; url: string }>
      parserId: string
      parserVersion: string
      warnings: string[]
    }>
  }
  network: {
    request: (input: {
      url: string
      requestId?: string
      method?: string
      headers?: Record<string, string>
      secretRefs?: Record<string, string>
      body?: string | Uint8Array
      timeoutMs?: number
    }) => Promise<{
      status: number
      statusText: string
      headers: Record<string, string>
      body: Uint8Array
      url: string
    }>
    abort: (requestId: string) => Promise<boolean>
  }
  system: {
    openFile: (request?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ name: string; data: Uint8Array } | null>
    saveFile: (request: { title?: string; suggestedName: string; filters?: Array<{ name: string; extensions: string[] }>; data: Uint8Array }) => Promise<boolean>
    saveResource: (request: { resourceId: string; fileName: string; data: Uint8Array }) => Promise<string>
    selectDirectory: (request?: { title?: string; defaultPath?: string }) => Promise<string | null>
    getStorageLocation: () => Promise<{
      currentPath: string
      defaultPath: string
      configuredPath?: string
      restartRequired: boolean
    }>
    setStorageLocation: (value: string) => Promise<{
      currentPath: string
      defaultPath: string
      configuredPath?: string
      restartRequired: boolean
    }>
    resetStorageLocation: () => Promise<{
      currentPath: string
      defaultPath: string
      configuredPath?: string
      restartRequired: boolean
    }>
    restart: () => Promise<void>
  }
  jobs: {
    list: () => Promise<DesktopJobRecord[]>
    create: (kind: string, checkpoint?: unknown) => Promise<DesktopJobRecord>
    enqueueNative: (request: DesktopNativeJobRequest) => Promise<DesktopJobRecord>
    update: (id: string, update: DesktopJobUpdate) => Promise<DesktopJobRecord>
    onUpdated: (listener: (job: DesktopJobRecord) => void) => () => void
    cancel: (id: string) => Promise<DesktopJobRecord>
  }
  secrets: {
    has: (name: string) => Promise<boolean>
    set: (name: string, value: string) => Promise<void>
    delete: (name: string) => Promise<void>
  }
}

interface DesktopJobUpdate {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  checkpoint?: unknown
  error?: string
  retryCount?: number
  resumeRequired?: boolean
}

interface DesktopJobRecord {
  id: string
  kind: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  updatedAt: string
  retryCount: number
  checkpoint?: unknown
  error?: string
  startedAt?: string
  completedAt?: string
  resumeRequired?: boolean
}

interface DesktopNativeJobRequest {
  kind: 'native:network-request' | 'native:content-parse'
  input: {
    url?: string
    method?: string
    headers?: Record<string, string>
    secretRefs?: Record<string, string>
    body?: string | Uint8Array
    timeoutMs?: number
    html?: string
    title?: string
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        partition?: string
        allowpopups?: boolean
      }, HTMLElement>
    }
  }

  interface Window {
    /** Optional desktop bridge. It is absent when Cnote runs as the Web Preview. */
    cnoteDesktop?: CnoteDesktopApi
  }
}

export {}
