import { app, BrowserView, BrowserWindow, session } from 'electron'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { BrowserCapture, BrowserPort, BrowserSessionSummary, BrowserViewBounds } from './types'

type ViewParentKind = 'embedded' | 'popup' | 'hidden'

interface BrowserSessionRecord {
  id: string
  name: string
  partition: string
  persistent: boolean
  createdAt: string
  view: BrowserView
  parentWindow: BrowserWindow | null
  parentKind: ViewParentKind
  popupWindow?: BrowserWindow
  lastBounds?: BrowserViewBounds
  /** Last renderer visibility intent. Bounds updates must not resurrect a view
   * after the renderer has hidden it while a canvas/menu interaction is active. */
  visibleRequested: boolean
  renderedVisible: boolean
  loadedOnce: boolean
  initialMountReloaded: boolean
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:'])
// DesktopWindowChrome uses a 44px frameless title bar. The native browser
// layer starts below it so a browser node can never cover window controls.
const EMBEDDED_LAYER_TOP = 44

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

function normalizeBounds(input: BrowserViewBounds): BrowserViewBounds {
  const values = [input?.x, input?.y, input?.width, input?.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Invalid browser view bounds')
  }
  return {
    x: Math.max(-10_000, Math.min(10_000, Math.round(input.x))),
    y: Math.max(-10_000, Math.min(10_000, Math.round(input.y))),
    width: Math.max(0, Math.min(10_000, Math.round(input.width))),
    height: Math.max(0, Math.min(10_000, Math.round(input.height))),
  }
}

function getWebContents(view: BrowserView | undefined) {
  try {
    return view?.webContents ?? null
  } catch {
    return null
  }
}

function isDestroyed(webContents: ReturnType<typeof getWebContents>) {
  if (!webContents) return true
  try {
    return webContents.isDestroyed()
  } catch {
    return true
  }
}

function setViewVisible(record: BrowserSessionRecord, visible: boolean) {
  record.renderedVisible = visible
}

function setViewBounds(record: BrowserSessionRecord, bounds: BrowserViewBounds) {
  if (isDestroyed(getWebContents(record.view))) return
  try {
    record.view.setBounds(bounds)
  } catch {
    // A closing BrowserWindow may invalidate the view between the checks above
    // and the native call.
  }
}

function requestViewRepaint(record: BrowserSessionRecord) {
  const webContents = getWebContents(record.view)
  if (!webContents || isDestroyed(webContents)) return
  try {
    // A BrowserView that finished loading while detached can keep its first
    // compositor frame pending on Windows. Keep the native page live while it
    // is used as an embedded node and explicitly invalidate after attachment.
    webContents.setBackgroundThrottling(false)
    webContents.invalidate()
  } catch {
    // The page may be tearing down during Flow/window navigation.
  }
}

function normalizeBrowserZoom(webContents: Electron.WebContents) {
  try {
    // Embedded pages must start from the same readable baseline regardless of
    // a zoom level left behind by a persistent Chromium partition.
    webContents.setZoomFactor(1)
    // The page zoom is an explicit browser setting, not a consequence of the
    // React Flow viewport transform. Until Cnote exposes a page-zoom control,
    // keep Chromium at a fixed 100% baseline and disable pinch/ctrl-wheel
    // visual zoom from changing the persistent session behind the user's back.
    void webContents.setVisualZoomLevelLimits(0, 0)
  } catch {
    // A page can be tearing down while the view is being remounted.
  }
}

function summary(record: BrowserSessionRecord): BrowserSessionSummary {
  const webContents = getWebContents(record.view)
  const destroyed = isDestroyed(webContents)
  const visible = !destroyed && record.renderedVisible
  return {
    id: record.id,
    name: record.name,
    partition: record.partition,
    persistent: record.persistent,
    url: destroyed ? '' : webContents?.getURL() || '',
    title: destroyed ? '' : webContents?.getTitle() || '',
    visible,
    presentation: destroyed ? 'hidden' : record.parentKind,
    createdAt: record.createdAt,
  }
}

export class BrowserSessionManager implements BrowserPort {
  private readonly sessions = new Map<string, BrowserSessionRecord>()
  private readonly updateListeners = new Set<(session: BrowserSessionSummary) => void>()
  private hostWindow: BrowserWindow | null = null
  private readonly handleHostResize = () => this.updateEmbeddedViewBounds()

  onSessionUpdated(listener: (session: BrowserSessionSummary) => void) {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  setHostWindow(window: BrowserWindow) {
    if (this.hostWindow === window) return
    this.clearHostWindow()
    this.hostWindow = window
    window.on('resize', this.handleHostResize)
  }

  clearHostWindow() {
    const hostWindow = this.hostWindow
    for (const record of this.sessions.values()) {
      if (record.parentKind !== 'embedded') continue
      this.detachRecord(record)
      setViewVisible(record, false)
      record.parentKind = 'hidden'
      record.visibleRequested = false
      this.emitUpdated(record)
    }
    hostWindow?.removeListener('resize', this.handleHostResize)
    this.hostWindow = null
  }

  private updateEmbeddedViewBounds() {
    const hostWindow = this.hostWindow
    if (!hostWindow || hostWindow.isDestroyed()) return
    for (const record of this.sessions.values()) {
      if (record.parentKind !== 'embedded' || !record.lastBounds) continue
      this.setEmbeddedViewBounds(record, record.lastBounds)
    }
  }

  private emitUpdated(record: BrowserSessionRecord) {
    const value = summary(record)
    for (const listener of this.updateListeners) listener(value)
  }

  private detachRecord(record: BrowserSessionRecord) {
    if (record.parentWindow) {
      try {
        record.parentWindow.removeBrowserView(record.view)
      } catch {
        // The parent window may already be tearing down with the browser session.
      }
    }
    record.parentWindow = null
    record.renderedVisible = false
  }

  private attachToHost(record: BrowserSessionRecord, bounds: BrowserViewBounds) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      throw new Error('Desktop host window is not ready')
    }

    if (record.popupWindow) {
      const popup = record.popupWindow
      record.popupWindow = undefined
      if (!popup.isDestroyed()) {
        try {
          popup.removeBrowserView(record.view)
        } catch {
          // The popup may already be in its destruction phase.
        }
        try {
          popup.close()
        } catch {
          // Closing an already-closing popup is harmless.
        }
      }
    }

    if (record.parentWindow !== this.hostWindow) {
      this.detachRecord(record)
      this.hostWindow.addBrowserView(record.view)
      record.parentWindow = this.hostWindow
    }

    record.parentKind = 'embedded'
    record.visibleRequested = true
    record.lastBounds = bounds
    const webContents = getWebContents(record.view)
    if (webContents) normalizeBrowserZoom(webContents)
    this.setEmbeddedViewBounds(record, bounds)
    requestViewRepaint(record)
    if (record.loadedOnce && !record.initialMountReloaded && webContents && !isDestroyed(webContents)) {
      record.initialMountReloaded = true
      void webContents.reload()
    }
    this.emitUpdated(record)
  }

  private setEmbeddedViewBounds(record: BrowserSessionRecord, bounds: BrowserViewBounds) {
    const hostWindow = this.hostWindow
    if (!hostWindow || hostWindow.isDestroyed() || isDestroyed(getWebContents(record.view))) return
    const [windowWidth, windowHeight] = hostWindow.getContentSize()
    // A native BrowserView is always composited above the renderer. Keep its
    // logical size intact and only show it when the whole viewport is inside
    // the renderer content area. This prevents edge panning from shrinking the
    // page or letting it cover the frameless title bar and canvas menus.
    const fullyVisible = bounds.width >= 12
      && bounds.height >= 12
      && bounds.x >= 0
      && bounds.y >= EMBEDDED_LAYER_TOP
      && bounds.x + bounds.width <= windowWidth
      && bounds.y + bounds.height <= windowHeight
    try {
      const visible = Boolean(record.visibleRequested && fullyVisible)
      record.view.setBounds(visible ? bounds : { x: 0, y: 0, width: 0, height: 0 })
      setViewVisible(record, visible)
    } catch {
      // The window or native view may be tearing down between bounds updates.
    }
  }

  async createSession(options: { id?: string; name?: string; persistent?: boolean; url?: string } = {}) {
    const id = options.id?.trim() || randomUUID()
    if (this.sessions.has(id)) throw new Error(`Browser session already exists: ${id}`)

    const persistent = options.persistent ?? true
    // Login state is intentionally global across browser nodes. Removing a
    // node only releases its view; the persistent Chromium partition remains
    // available to the next node so cookies, cache and sessions survive.
    const partition = persistent ? 'persist:cnote-browser' : `cnote-memory-${id}`
    const browserSession = session.fromPartition(partition)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      // Remote pages do not receive OS-level permissions implicitly. A future
      // session settings panel can turn individual permissions on explicitly.
      callback(false)
    })
    const downloadsDirectory = path.join(app.getPath('downloads'), 'Cnote')
    browserSession.on('will-download', (_event, item) => {
      const fileName = path.basename(item.getFilename()) || `download-${Date.now()}`
      mkdirSync(downloadsDirectory, { recursive: true })
      item.setSavePath(path.join(downloadsDirectory, fileName))
    })

    const view = new BrowserView({
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: true,
      },
    })
    view.setBackgroundColor('#ffffff')

    const record: BrowserSessionRecord = {
      id,
      name: options.name?.trim() || `Browser ${this.sessions.size + 1}`,
      partition,
      persistent,
      createdAt: new Date().toISOString(),
      view,
      parentWindow: null,
      parentKind: 'hidden',
      visibleRequested: false,
      renderedVisible: false,
      loadedOnce: false,
      initialMountReloaded: false,
    }
    this.sessions.set(id, record)

    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        assertNavigableUrl(url)
        return { action: 'allow' }
      } catch {
        return { action: 'deny' }
      }
    })
    view.webContents.on('will-navigate', (event, url) => {
      try {
        assertNavigableUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    view.webContents.on('did-navigate', () => this.emitUpdated(record))
    view.webContents.on('did-navigate-in-page', () => this.emitUpdated(record))
    view.webContents.on('page-title-updated', () => this.emitUpdated(record))
    view.webContents.on('did-finish-load', () => {
      record.loadedOnce = true
      this.emitUpdated(record)
      if (record.parentWindow && !record.initialMountReloaded) {
        record.initialMountReloaded = true
        void view.webContents.reload()
      } else if (record.parentWindow) {
        requestViewRepaint(record)
        setTimeout(() => requestViewRepaint(record), 80)
      }
    })
    view.webContents.on('zoom-changed', () => normalizeBrowserZoom(view.webContents))
    view.webContents.on('destroyed', () => {
      this.detachRecord(record)
      record.parentKind = 'hidden'
      record.visibleRequested = false
      if (this.sessions.get(record.id) === record) this.emitUpdated(record)
    })

    await view.webContents.loadURL(assertNavigableUrl(options.url ?? 'about:blank'))
    normalizeBrowserZoom(view.webContents)
    this.emitUpdated(record)
    return summary(record)
  }

  listSessions() {
    return [...this.sessions.values()].map(summary)
  }

  mountSession(id: string, inputBounds: BrowserViewBounds) {
    const record = this.require(id)
    this.attachToHost(record, normalizeBounds(inputBounds))
  }

  unmountSession(id: string) {
    const record = this.require(id)
    if (record.parentKind !== 'embedded') return
    this.detachRecord(record)
    record.parentKind = 'hidden'
    record.visibleRequested = false
    setViewVisible(record, false)
    this.emitUpdated(record)
  }

  setSessionVisible(id: string, visible: boolean) {
    const record = this.require(id)
    record.visibleRequested = visible
    if (record.parentKind === 'hidden') return
    if (record.parentKind === 'embedded' && record.lastBounds) {
      this.setEmbeddedViewBounds(record, record.lastBounds)
    } else {
      setViewVisible(record, visible)
    }
    this.emitUpdated(record)
  }

  setSessionBounds(id: string, inputBounds: BrowserViewBounds) {
    const record = this.require(id)
    const bounds = normalizeBounds(inputBounds)
    record.lastBounds = bounds
    if (record.parentKind !== 'embedded') return
    this.setEmbeddedViewBounds(record, bounds)
  }

  showSession(id: string) {
    const record = this.require(id)
    if (record.parentKind === 'embedded' && this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.hostWindow.show()
      this.hostWindow.focus()
      record.visibleRequested = true
      if (record.lastBounds) this.setEmbeddedViewBounds(record, record.lastBounds)
      else setViewVisible(record, true)
      this.emitUpdated(record)
      return
    }

    if (record.parentKind === 'popup' && record.popupWindow && !record.popupWindow.isDestroyed()) {
      record.popupWindow.show()
      record.popupWindow.focus()
      return
    }

    if (this.hostWindow && record.lastBounds && record.lastBounds.width > 0 && record.lastBounds.height > 0) {
      this.attachToHost(record, record.lastBounds)
      this.hostWindow.show()
      this.hostWindow.focus()
      return
    }

    this.openPopup(record)
  }

  popoutSession(id: string) {
    const record = this.require(id)
    if (record.parentKind === 'popup' && record.popupWindow && !record.popupWindow.isDestroyed()) {
      record.popupWindow.show()
      record.popupWindow.focus()
      return
    }
    this.openPopup(record)
  }

  private openPopup(record: BrowserSessionRecord) {
    const popup = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: record.name,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: true,
      },
    })
    this.detachRecord(record)
    popup.addBrowserView(record.view)
    record.parentWindow = popup
    record.parentKind = 'popup'
    record.visibleRequested = true
    record.popupWindow = popup
    const resize = () => {
      if (popup.isDestroyed() || record.parentKind !== 'popup') return
      const [width, height] = popup.getContentSize()
      setViewBounds(record, { x: 0, y: 0, width, height })
      setViewVisible(record, true)
    }
    popup.on('resize', resize)
    popup.on('closed', () => {
      if (record.popupWindow !== popup) return
      record.popupWindow = undefined
      if (this.hostWindow && !this.hostWindow.isDestroyed() && record.lastBounds) {
        try {
          this.attachToHost(record, record.lastBounds)
        } catch {
          record.parentWindow = null
          record.parentKind = 'hidden'
          record.visibleRequested = false
          setViewVisible(record, false)
          this.emitUpdated(record)
        }
      } else {
        if (record.parentWindow === popup) record.parentWindow = null
        record.parentKind = 'hidden'
        record.visibleRequested = false
        setViewVisible(record, false)
        this.emitUpdated(record)
      }
    })
    resize()
    setViewVisible(record, true)
    popup.show()
    popup.focus()
    this.emitUpdated(record)
  }

  async navigate(id: string, url: string) {
    const record = this.require(id)
    await record.view.webContents.loadURL(assertNavigableUrl(url))
    return summary(record)
  }

  async reload(id: string) {
    const record = this.require(id)
    await record.view.webContents.reload()
    return summary(record)
  }

  async capture(id: string): Promise<BrowserCapture> {
    const record = this.require(id)
    const result = await record.view.webContents.executeJavaScript(`
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
      url: String(result.url || record.view.webContents.getURL()),
      title: String(result.title || record.view.webContents.getTitle()),
      text: String(result.text || ''),
      html: String(result.html || ''),
    }
  }

  async closeSession(id: string) {
    const record = this.require(id)
    this.detachRecord(record)
    if (record.popupWindow && !record.popupWindow.isDestroyed()) record.popupWindow.close()
    setViewVisible(record, false)
    record.visibleRequested = false
    this.sessions.delete(id)

    // Do not synchronously close a BrowserView while handling the renderer's
    // IPC request. Chromium can wait for the view's renderer teardown before
    // returning from close(), which would leave the invoking renderer waiting
    // forever for its own IPC response. Remove the view from the workspace and
    // schedule teardown after the current turn has completed instead.
    const webContents = getWebContents(record.view)
    setTimeout(() => {
      if (isDestroyed(webContents)) return
      webContents?.close({ waitForBeforeUnload: false })
    }, 250)
  }

  private require(id: string) {
    const record = this.sessions.get(id)
    if (!record || isDestroyed(getWebContents(record.view))) throw new Error(`Browser session not found: ${id}`)
    return record
  }
}
