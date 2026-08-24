import { app, BrowserWindow, session, WebContentsView, type View } from 'electron'
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
  view: WebContentsView
  parentView: View | null
  parentKind: ViewParentKind
  popupWindow?: BrowserWindow
  lastBounds?: BrowserViewBounds
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:'])

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

function getWebContents(view: WebContentsView | undefined) {
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

function summary(record: BrowserSessionRecord): BrowserSessionSummary {
  const webContents = getWebContents(record.view)
  const destroyed = isDestroyed(webContents)
  let visible = false
  if (!destroyed) {
    try {
      visible = record.view.getVisible()
    } catch {
      visible = false
    }
  }
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

  onSessionUpdated(listener: (session: BrowserSessionSummary) => void) {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  setHostWindow(window: BrowserWindow) {
    if (this.hostWindow === window) return
    this.clearHostWindow()
    this.hostWindow = window
  }

  clearHostWindow() {
    for (const record of this.sessions.values()) {
      if (record.parentKind !== 'embedded') continue
      this.detachRecord(record)
      record.view.setVisible(false)
      record.parentKind = 'hidden'
      this.emitUpdated(record)
    }
    this.hostWindow = null
  }

  private emitUpdated(record: BrowserSessionRecord) {
    const value = summary(record)
    for (const listener of this.updateListeners) listener(value)
  }

  private detachRecord(record: BrowserSessionRecord) {
    if (record.parentView) {
      try {
        record.parentView.removeChildView(record.view)
      } catch {
        // The parent view may already be tearing down with the browser session.
      }
    }
    record.parentView = null
  }

  private attachToHost(record: BrowserSessionRecord, bounds: BrowserViewBounds) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      throw new Error('Desktop host window is not ready')
    }

    if (record.popupWindow) {
      const popup = record.popupWindow
      record.popupWindow = undefined
      if (!popup.isDestroyed()) {
        popup.contentView.removeChildView(record.view)
        popup.close()
      }
    }

    if (record.parentView !== this.hostWindow.contentView) {
      this.detachRecord(record)
      this.hostWindow.contentView.addChildView(record.view)
      record.parentView = this.hostWindow.contentView
    }

    record.parentKind = 'embedded'
    record.lastBounds = bounds
    record.view.setBounds(bounds)
    record.view.setVisible(bounds.width > 0 && bounds.height > 0)
    this.emitUpdated(record)
  }

  async createSession(options: { id?: string; name?: string; persistent?: boolean; url?: string } = {}) {
    const id = options.id?.trim() || randomUUID()
    if (this.sessions.has(id)) throw new Error(`Browser session already exists: ${id}`)

    const persistent = options.persistent ?? true
    const partition = persistent ? `persist:cnote-workspace-${id}` : `cnote-memory-${id}`
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

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: true,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)

    const record: BrowserSessionRecord = {
      id,
      name: options.name?.trim() || `Browser ${this.sessions.size + 1}`,
      partition,
      persistent,
      createdAt: new Date().toISOString(),
      view,
      parentView: null,
      parentKind: 'hidden',
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
    view.webContents.on('did-finish-load', () => this.emitUpdated(record))
    view.webContents.on('destroyed', () => {
      record.parentView = null
      record.parentKind = 'hidden'
      if (this.sessions.get(record.id) === record) this.emitUpdated(record)
    })

    await view.webContents.loadURL(assertNavigableUrl(options.url ?? 'about:blank'))
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
    record.view.setVisible(false)
    this.emitUpdated(record)
  }

  setSessionBounds(id: string, inputBounds: BrowserViewBounds) {
    const record = this.require(id)
    const bounds = normalizeBounds(inputBounds)
    record.lastBounds = bounds
    if (record.parentKind !== 'embedded') return
    record.view.setBounds(bounds)
    record.view.setVisible(bounds.width > 0 && bounds.height > 0)
  }

  showSession(id: string) {
    const record = this.require(id)
    if (record.parentKind === 'embedded' && this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.hostWindow.show()
      this.hostWindow.focus()
      record.view.setVisible(true)
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
    popup.contentView.addChildView(record.view)
    record.parentView = popup.contentView
    record.parentKind = 'popup'
    record.popupWindow = popup
    const resize = () => {
      if (popup.isDestroyed() || record.parentKind !== 'popup') return
      const [width, height] = popup.getContentSize()
      record.view.setBounds({ x: 0, y: 0, width, height })
    }
    popup.on('resize', resize)
    popup.on('closed', () => {
      if (record.popupWindow !== popup) return
      record.popupWindow = undefined
      if (this.hostWindow && !this.hostWindow.isDestroyed() && record.lastBounds) {
        this.attachToHost(record, record.lastBounds)
      } else {
        if (record.parentView === popup.contentView) record.parentView = null
        record.parentKind = 'hidden'
        record.view.setVisible(false)
        this.emitUpdated(record)
      }
    })
    resize()
    record.view.setVisible(true)
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
    try {
      record.view.setVisible(false)
    } catch {
      // A destroyed view is already hidden from the host window.
    }
    this.sessions.delete(id)

    // Do not synchronously close a WebContentsView while handling the renderer's
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
