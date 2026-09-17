interface CnoteDesktopBrowserSession {
  id: string
  name: string
  partition: string
  persistent: boolean
  url: string
  title: string
  visible: boolean
  presentation: 'embedded' | 'popup' | 'hidden'
  createdAt: string
  canGoBack: boolean
  canGoForward: boolean
}

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
    focus?: () => Promise<void>
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    reload: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void
  }
  session: {
    onFlushRequest: (listener: () => void | Promise<void>) => () => void
    notifyFlushed: () => void
  }
  browser: {
    setPresentation: (guestId: number, viewport: { width: number; height: number; scale: number }) => Promise<void>
    createSession: (options?: { id?: string; name?: string; persistent?: boolean; url?: string }) => Promise<CnoteDesktopBrowserSession>
    listSessions: () => Promise<CnoteDesktopBrowserSession[]>
    onSessionUpdated: (listener: (session: CnoteDesktopBrowserSession) => void) => () => void
    onFrame: (listener: (frame: { sessionId: string; width: number; height: number; data: Uint8Array<ArrayBuffer> }) => void) => () => void
    onCursorChanged: (listener: (change: { sessionId: string; cursor: string }) => void) => () => void
    setViewport: (id: string, viewport: { width: number; height: number; scale: number }) => Promise<void>
    sendInput: (
      id: string,
      event:
        | { type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseEnter' | 'mouseLeave'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: number; modifiers?: string[] }
        | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: string[] }
        | { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers?: string[] },
    ) => Promise<void>
    popout: (url: string, title?: string) => Promise<void>
    popoutSession: (id: string) => Promise<void>
    showSession: (id: string) => Promise<void>
    navigate: (id: string, url: string) => Promise<CnoteDesktopBrowserSession>
    reload: (id: string) => Promise<CnoteDesktopBrowserSession>
    goBack: (id: string) => Promise<CnoteDesktopBrowserSession>
    goForward: (id: string) => Promise<CnoteDesktopBrowserSession>
    capture: (id: string) => Promise<{
      sessionId: string
      capturedAt: string
      url: string
      title: string
      text: string
      html: string
    }>
    closeSession: (id: string) => Promise<void>
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
    openStream?: (input: { url: string; requestId: string; method?: string; headers?: Record<string, string>; secretRefs?: Record<string, string>; body?: string | Uint8Array; timeoutMs?: number }) => Promise<{ status: number; statusText: string; headers: Record<string, string>; url: string }>
    readStream?: (requestId: string) => Promise<Uint8Array | null>
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
    getStorageUsage: () => Promise<{ resources: number; data: number; cache: number; total: number }>
    clearCache: () => Promise<{ resources: number; data: number; cache: number; total: number }>
    removeManagedResource: (identity: string) => Promise<void>
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
  storage: {
    keys: () => Promise<string[]>
    read: (key: string) => Promise<Uint8Array | null>
    write: (key: string, data: Uint8Array) => Promise<void>
    remove: (key: string) => Promise<void>
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
        src?: string
      }, HTMLElement>
    }
  }

  interface Window {
    /** Optional desktop bridge. It is absent when Cnote runs as the Web Preview. */
    cnoteDesktop?: CnoteDesktopApi
  }
}

export {}
