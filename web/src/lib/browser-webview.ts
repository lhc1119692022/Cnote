export interface BrowserWebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getTitle(): string
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>
}

export interface BrowserPageCapture {
  url: string
  title: string
  text: string
  html: string
}

export type DesktopParsedPage = Awaited<ReturnType<NonNullable<Window['cnoteDesktop']>['content']['parseHtml']>>

export function findBrowserWebview(nodeId: string) {
  return [...document.querySelectorAll('webview[data-browser-node-id]')]
    .map((element) => element as BrowserWebviewElement)
    .find((element) => element.getAttribute('data-browser-node-id') === nodeId) || null
}

export async function captureBrowserWebview(nodeId: string): Promise<BrowserPageCapture> {
  const webview = findBrowserWebview(nodeId)
  if (!webview) throw new Error('浏览器页面尚未挂载')
  const result = await webview.executeJavaScript<Partial<BrowserPageCapture>>(
    "(() => ({ url: location.href, title: document.title, text: document.body?.innerText || '', html: document.documentElement?.outerHTML || '' }))()",
    true,
  )
  return {
    url: String(result.url || webview.getURL() || ''),
    title: String(result.title || webview.getTitle() || ''),
    text: String(result.text || ''),
    html: String(result.html || ''),
  }
}
