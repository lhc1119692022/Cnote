import { app, BrowserWindow, Notification, session } from 'electron'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { BrowserCapture, BrowserFrame, BrowserInputEvent, BrowserPort, BrowserSessionSummary, BrowserViewportRequest } from './types'

// 离屏渲染架构：每个会话是一个隐藏的 offscreen BrowserWindow，页面画面以
// JPEG 帧流送给渲染层，由浏览器节点画进画布 DOM。页面因此参与画布的
// 层级、圆角裁切与缩放，不再有悬浮原生层的遮挡与避让问题。

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:'])
const FRAME_INTERVAL_MS = 40
const MAX_VIEWPORT_EDGE = 4096

interface BrowserSessionRecord {
  id: string
  name: string
  partition: string
  persistent: boolean
  createdAt: string
  window: BrowserWindow
  popupWindow?: BrowserWindow
  viewport: { width: number; height: number; scale: number }
  pendingFrame: Electron.NativeImage | null
  frameTimer: NodeJS.Timeout | null
}

function assertNavigableUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Invalid browser URL')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Navigation protocol is not allowed: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function getWebContents(record: BrowserSessionRecord) {
  try {
    if (record.window.isDestroyed()) return null
    const webContents = record.window.webContents
    return webContents.isDestroyed() ? null : webContents
  } catch {
    return null
  }
}

type NavigationHistoryLike = { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void }

function navigationHistoryOf(webContents: Electron.WebContents | null): NavigationHistoryLike | null {
  if (!webContents) return null
  const candidate = (webContents as Electron.WebContents & { navigationHistory?: NavigationHistoryLike }).navigationHistory
  if (candidate && typeof candidate.canGoBack === 'function') return candidate
  // Older Electron exposes the same operations directly on WebContents.
  const legacy = webContents as unknown as NavigationHistoryLike
  return typeof legacy.canGoBack === 'function' ? legacy : null
}

function summary(record: BrowserSessionRecord): BrowserSessionSummary {
  const webContents = getWebContents(record)
  let canGoBack = false
  let canGoForward = false
  try {
    const history = navigationHistoryOf(webContents)
    if (history) {
      canGoBack = history.canGoBack()
      canGoForward = history.canGoForward()
    }
  } catch {
    // A tearing-down page reports no history.
  }
  return {
    id: record.id,
    name: record.name,
    partition: record.partition,
    persistent: record.persistent,
    url: webContents?.getURL() || '',
    title: webContents?.getTitle() || '',
    visible: Boolean(webContents),
    presentation: record.popupWindow && !record.popupWindow.isDestroyed() ? 'popup' : 'embedded',
    createdAt: record.createdAt,
    canGoBack,
    canGoForward,
  }
}

export class BrowserSessionManager implements BrowserPort {
  private readonly sessions = new Map<string, BrowserSessionRecord>()
  private readonly updateListeners = new Set<(session: BrowserSessionSummary) => void>()
  private readonly frameListeners = new Set<(frame: BrowserFrame) => void>()
  private readonly cursorListeners = new Set<(change: { sessionId: string; cursor: string }) => void>()
  private readonly configuredPartitions = new Set<string>()
  private hostWindow: BrowserWindow | null = null

  onSessionUpdated(listener: (session: BrowserSessionSummary) => void) {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  onFrame(listener: (frame: BrowserFrame) => void) {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onCursorChanged(listener: (change: { sessionId: string; cursor: string }) => void) {
    this.cursorListeners.add(listener)
    return () => this.cursorListeners.delete(listener)
  }

  setHostWindow(window: BrowserWindow) {
    this.hostWindow = window
  }

  clearHostWindow() {
    this.hostWindow = null
  }

  private emitUpdated(record: BrowserSessionRecord) {
    const value = summary(record)
    for (const listener of this.updateListeners) listener(value)
  }

  private pushFrame(record: BrowserSessionRecord, image: Electron.NativeImage) {
    record.pendingFrame = image
    if (record.frameTimer) return
    record.frameTimer = setTimeout(() => {
      record.frameTimer = null
      const pending = record.pendingFrame
      record.pendingFrame = null
      if (!pending || this.sessions.get(record.id) !== record) return
      const size = pending.getSize()
      if (size.width < 1 || size.height < 1) return
      const frame: BrowserFrame = {
        sessionId: record.id,
        width: size.width,
        height: size.height,
        data: pending.toJPEG(82),
      }
      for (const listener of this.frameListeners) listener(frame)
    }, FRAME_INTERVAL_MS)
  }

  private configurePartition(partition: string, browserSession: Electron.Session) {
    if (this.configuredPartitions.has(partition)) return
    this.configuredPartitions.add(partition)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      // Remote pages do not receive OS-level permissions implicitly. A future
      // session settings panel can turn individual permissions on explicitly.
      callback(false)
    })
    const downloadsDirectory = path.join(app.getPath('downloads'), 'Cnote')
    browserSession.on('will-download', (_event, item) => {
      const fileName = path.basename(item.getFilename()) || `download-${Date.now()}`
      mkdirSync(downloadsDirectory, { recursive: true })
      const savePath = path.join(downloadsDirectory, fileName)
      item.setSavePath(savePath)
      if (Notification.isSupported()) new Notification({ title: 'Cnote 下载', body: `开始下载：${fileName}` }).show()
      item.once('done', (_doneEvent, state) => {
        if (!Notification.isSupported()) return
        new Notification({
          title: 'Cnote 下载',
          body: state === 'completed' ? `${fileName} 已保存到 ${savePath}` : `${fileName} 下载${state === 'cancelled' ? '已取消' : '失败'}`,
        }).show()
      })
    })
  }

  async createSession(options: { id?: string; name?: string; persistent?: boolean; url?: string } = {}) {
    const id = options.id?.trim() || randomUUID()
    if (this.sessions.has(id)) throw new Error(`Browser session already exists: ${id}`)

    const persistent = options.persistent ?? true
    // Login state is intentionally global across browser nodes. Removing a
    // node only releases its offscreen window; the persistent Chromium
    // partition keeps cookies, cache and sessions for the next node.
    const partition = persistent ? 'persist:cnote-browser' : `cnote-memory-${id}`
    const browserSession = session.fromPartition(partition)
    this.configurePartition(partition, browserSession)

    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 640,
      webPreferences: {
        offscreen: true,
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    window.setMenuBarVisibility(false)

    const record: BrowserSessionRecord = {
      id,
      name: options.name?.trim() || `Browser ${this.sessions.size + 1}`,
      partition,
      persistent,
      createdAt: new Date().toISOString(),
      window,
      viewport: { width: 1024, height: 640, scale: 1 },
      pendingFrame: null,
      frameTimer: null,
    }
    this.sessions.set(id, record)

    const webContents = window.webContents
    webContents.setFrameRate(30)
    webContents.on('paint', (_event, _dirty, image) => this.pushFrame(record, image))
    webContents.on('cursor-changed', (_event, type) => {
      for (const listener of this.cursorListeners) listener({ sessionId: id, cursor: type })
    })
    webContents.setWindowOpenHandler(({ url }) => {
      // Keep target=_blank links inside the embedded node instead of spawning
      // unmanaged windows.
      try {
        void webContents.loadURL(assertNavigableUrl(url))
      } catch {
        // Non-navigable protocols are dropped.
      }
      return { action: 'deny' }
    })
    webContents.on('will-navigate', (event, url) => {
      try {
        assertNavigableUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    webContents.on('did-navigate', () => this.emitUpdated(record))
    webContents.on('did-navigate-in-page', () => this.emitUpdated(record))
    webContents.on('page-title-updated', () => this.emitUpdated(record))
    webContents.on('did-finish-load', () => this.emitUpdated(record))
    webContents.on('destroyed', () => {
      if (this.sessions.get(record.id) === record) this.emitUpdated(record)
    })

    await webContents.loadURL(assertNavigableUrl(options.url ?? 'about:blank'))
    this.emitUpdated(record)
    return summary(record)
  }

  listSessions() {
    return [...this.sessions.values()].map(summary)
  }

  setSessionViewport(id: string, viewport: BrowserViewportRequest) {
    const record = this.require(id)
    const scale = Math.min(3, Math.max(0.5, viewport.scale || 1))
    const width = Math.min(MAX_VIEWPORT_EDGE, Math.max(1, Math.round(viewport.width * scale)))
    const height = Math.min(MAX_VIEWPORT_EDGE, Math.max(1, Math.round(viewport.height * scale)))
    const current = record.viewport
    if (current.width === width && current.height === height && current.scale === scale) return
    record.viewport = { width, height, scale }
    const webContents = getWebContents(record)
    if (!webContents) return
    try {
      record.window.setContentSize(width, height)
      // zoomFactor = scale 让页面布局尺寸保持逻辑尺寸，同时以更高物理
      // 分辨率绘制，画布放大时仍然清晰。
      webContents.setZoomFactor(scale)
      webContents.invalidate()
    } catch {
      // The offscreen window may be tearing down.
    }
  }

  sendInput(id: string, event: BrowserInputEvent) {
    const record = this.require(id)
    const webContents = getWebContents(record)
    if (!webContents) return
    try {
      if (event.type === 'mouseDown') webContents.focus()
      webContents.sendInputEvent(event as unknown as Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent)
    } catch {
      // Input against a closing page is dropped.
    }
  }

  showSession(id: string) {
    const record = this.require(id)
    if (record.popupWindow && !record.popupWindow.isDestroyed()) {
      record.popupWindow.show()
      record.popupWindow.focus()
      return
    }
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.hostWindow.show()
      this.hostWindow.focus()
    }
  }

  popout(url: string, title = 'Cnote 浏览器') {
    const popup = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 480,
      title,
      webPreferences: {
        partition: 'persist:cnote-browser',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    popup.setMenuBarVisibility(false)
    popup.once('ready-to-show', () => popup.show())
    void popup.webContents.loadURL(assertNavigableUrl(url)).catch(() => popup.close())
  }

  popoutSession(id: string) {
    const record = this.require(id)
    if (record.popupWindow && !record.popupWindow.isDestroyed()) {
      record.popupWindow.show()
      record.popupWindow.focus()
      return
    }
    const webContents = getWebContents(record)
    const currentUrl = webContents?.getURL() || 'about:blank'
    // 独立窗口是同一持久分区的真实窗口；离屏会话继续留在画布上。
    const popup = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 480,
      title: record.name,
      webPreferences: {
        partition: record.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    popup.setMenuBarVisibility(false)
    record.popupWindow = popup
    popup.on('closed', () => {
      if (record.popupWindow === popup) record.popupWindow = undefined
      if (this.sessions.get(record.id) === record) this.emitUpdated(record)
    })
    void popup.webContents.loadURL(assertNavigableUrl(currentUrl))
    this.emitUpdated(record)
  }

  async navigate(id: string, url: string) {
    const record = this.require(id)
    const webContents = getWebContents(record)
    if (!webContents) throw new Error('Browser session is not available')
    await webContents.loadURL(assertNavigableUrl(url))
    return summary(record)
  }

  async reload(id: string) {
    const record = this.require(id)
    getWebContents(record)?.reload()
    return summary(record)
  }

  async goBack(id: string) {
    const record = this.require(id)
    const history = navigationHistoryOf(getWebContents(record))
    if (history?.canGoBack()) history.goBack()
    return summary(record)
  }

  async goForward(id: string) {
    const record = this.require(id)
    const history = navigationHistoryOf(getWebContents(record))
    if (history?.canGoForward()) history.goForward()
    return summary(record)
  }

  async capture(id: string): Promise<BrowserCapture> {
    const record = this.require(id)
    const webContents = getWebContents(record)
    if (!webContents) throw new Error('Browser session is not available')
    const result = await webContents.executeJavaScript(`
      (() => ({
        url: location.href,
        title: document.title,
        text: document.body?.innerText || '',
        html: document.documentElement?.outerHTML || ''
      }))()
    `, true) as { url?: string; title?: string; text?: string; html?: string }

    return {
      sessionId: id,
      capturedAt: new Date().toISOString(),
      url: String(result.url || webContents.getURL()),
      title: String(result.title || webContents.getTitle()),
      text: String(result.text || ''),
      html: String(result.html || ''),
    }
  }

  async closeSession(id: string) {
    const record = this.require(id)
    this.sessions.delete(id)
    if (record.frameTimer) clearTimeout(record.frameTimer)
    if (record.popupWindow && !record.popupWindow.isDestroyed()) record.popupWindow.close()
    // Destroying a window synchronously inside the renderer's own IPC call can
    // deadlock on renderer teardown; defer past the current turn instead.
    setTimeout(() => {
      try {
        if (!record.window.isDestroyed()) record.window.destroy()
      } catch {
        // The window may already be gone during app shutdown.
      }
    }, 250)
  }

  private require(id: string) {
    const record = this.sessions.get(id)
    if (!record || record.window.isDestroyed()) throw new Error(`Browser session not found: ${id}`)
    return record
  }
}
