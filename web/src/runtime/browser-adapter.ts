/**
 * Browser view adapter.
 *
 * Runtime never creates DOM. Stage 6 React mounts `<webview>` / `<iframe>`
 * and bridges navigation through this adapter.
 *
 * Desktop webview id convention: `data-browser-node-id="{sessionId}:{tabId}"`.
 * Use `browserViewId()` when mounting so getView / capture stay aligned.
 */

import {
  captureBrowserWebview,
  findBrowserWebview,
  type BrowserPageCapture,
  type BrowserWebviewElement,
} from '@/lib/browser-webview'

export interface BrowserView {
  url: string
  loadURL(url: string): Promise<void>
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getTitle(): string
}

export interface BrowserAdapter {
  readonly kind: 'desktop' | 'iframe'
  getView(sessionId: string, tabId: string): BrowserView | null
  capture(sessionId: string, tabId: string): Promise<BrowserPageCapture>
}

/** React 层必须把 webview 的 `data-browser-node-id` 设为此值。 */
export function browserViewId(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`
}

function wrapWebview(element: BrowserWebviewElement): BrowserView {
  return {
    get url() {
      return element.getURL()
    },
    loadURL(url) {
      return element.loadURL(url)
    },
    reload() {
      element.reload()
    },
    goBack() {
      element.goBack()
    },
    goForward() {
      element.goForward()
    },
    canGoBack() {
      return element.canGoBack()
    },
    canGoForward() {
      return element.canGoForward()
    },
    getURL() {
      return element.getURL()
    },
    getTitle() {
      return element.getTitle()
    },
  }
}

export function desktopBrowserAdapter(): BrowserAdapter {
  return {
    kind: 'desktop',
    getView(sessionId, tabId) {
      const element = findBrowserWebview(browserViewId(sessionId, tabId))
      return element ? wrapWebview(element) : null
    },
    capture(sessionId, tabId) {
      return captureBrowserWebview(browserViewId(sessionId, tabId))
    },
  }
}

/**
 * iframe 分支的导航由 React 通过 `tab.url` 直接控制，本适配器只保留 desktop 语义。
 * Stage 6 挂载 iframe，不走 loadURL / 页面捕获。
 */
export function iframeBrowserAdapter(): BrowserAdapter {
  return {
    kind: 'iframe',
    getView(_sessionId, _tabId) {
      return null
    },
    async capture(_sessionId, _tabId): Promise<BrowserPageCapture> {
      throw new Error('iframe 适配器不支持页面捕获')
    },
  }
}
