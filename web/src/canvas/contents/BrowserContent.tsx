/**
 * 浏览器内容：webview / iframe 只在内容抬升层挂载，绝不进 world 层 transform。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * Session：mount 时若声明没有 sessionId / tab，则创建并写回节点（不记历史）。
 * Webview：内容区尺寸稳定（>0 且 120ms 内不变）后再挂载；事件监听在 ref 回调里注册/清理。
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import type { BrowserNodeSpec, BrowserSession, NodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import {
  BrowserSessionManager,
  browserViewId,
  desktopBrowserAdapter,
  desktopContentParser,
  iframeBrowserAdapter,
  materializeBrowserCapture,
  passthroughContentParser,
} from '@/runtime'
import type { BrowserWebviewElement } from '@/lib/browser-webview'
import { browserChromeStyle } from '../browser-presentation'
import { browserErrorMessage } from '../browser-error'

const DEFAULT_BROWSER_URL = 'https://www.google.com/'
const WEBVIEW_PARTITION = 'persist:cnote-browser'
const MOUNT_STABLE_MS = 120

interface WebviewNavigationEvent extends Event {
  isMainFrame?: boolean
  isInPlace?: boolean
  url?: string
  errorCode?: number
  errorDescription?: string
}

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.cnoteDesktop)
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^(https?|about):/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function eventUrl(event: Event, webview: BrowserWebviewElement): string {
  const value = (event as WebviewNavigationEvent).url
  return normalizeUrl(typeof value === 'string' && value ? value : webview.getURL())
}

function patchBrowser(id: string, patch: Partial<BrowserNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

type BrowserSessionFields = Pick<BrowserNodeSpec, 'id' | 'sessionId' | 'activeTarget' | 'url'>

function readBrowserSpec(fields: BrowserSessionFields): BrowserSessionFields {
  const stored = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === fields.id)
  return stored && stored.kind === 'browser'
    ? {
        id: stored.id,
        sessionId: stored.sessionId,
        activeTarget: stored.activeTarget,
        url: stored.url,
      }
    : fields
}

/**
 * 幂等：优先读 graph store（避免 Strict Mode 双 mount 重复建 session）。
 * activeTarget 可能是 tabId 或 URL。
 */
function ensureSessionAndTab(fields: BrowserSessionFields): { sessionId: string; tabId: string } {
  const spec = readBrowserSpec(fields)
  const runtime = useRuntimeStore.getState()

  const existingId = spec.sessionId
  let session: BrowserSession | undefined = existingId ? runtime.sessions[existingId] : undefined
  if (!session) {
    session = runtime.createSession()
  }
  const sessionId = session.id

  const latest = useRuntimeStore.getState().sessions[sessionId] ?? session
  const target = spec.activeTarget
  let tab = target
    ? latest.tabs.find((item) => item.id === target) ?? latest.tabs.find((item) => item.url === target)
    : undefined

  if (!tab) {
    const url = normalizeUrl(target && !latest.tabs.some((item) => item.id === target) ? target : spec.url) || DEFAULT_BROWSER_URL
    tab = useRuntimeStore.getState().addTab(sessionId, url)
  } else {
    useRuntimeStore.getState().setSessionActiveTab(sessionId, tab.id)
  }

  if (spec.sessionId !== sessionId || spec.activeTarget !== tab.id) {
    patchBrowser(fields.id, { sessionId, activeTarget: tab.id })
  }

  return { sessionId, tabId: tab.id }
}

function errorMessage(error: unknown, fallback: string): string {
  return browserErrorMessage(error, fallback)
}

export const BrowserContent = memo(function BrowserContent({ node }: { node: BrowserNodeSpec }) {
  const isDesktop = isDesktopRuntime()
  const canvasZoom = useGraphStore((state) => state.view.zoom)

  const sessionId = node.sessionId
  const tabId = node.activeTarget
  const session = useRuntimeStore((state) => (sessionId ? state.sessions[sessionId] : undefined))
  const tab = session && tabId ? session.tabs.find((item) => item.id === tabId) : undefined
  const liveUrl = tab?.url || node.url || DEFAULT_BROWSER_URL

  const adapter = useMemo(
    () => (isDesktop ? desktopBrowserAdapter() : iframeBrowserAdapter()),
    [isDesktop],
  )
  const sessionManager = useMemo(
    () =>
      new BrowserSessionManager({
        adapter,
        contentParser: isDesktop ? desktopContentParser() : passthroughContentParser(),
      }),
    [adapter, isDesktop],
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<BrowserWebviewElement | null>(null)
  const listenersRef = useRef<(() => void) | null>(null)
  const initialSrcRef = useRef(normalizeUrl(liveUrl) || DEFAULT_BROWSER_URL)
  const addressFocusedRef = useRef(false)

  const [address, setAddress] = useState(liveUrl)
  const [frameSrc, setFrameSrc] = useState(() => normalizeUrl(liveUrl) || DEFAULT_BROWSER_URL)
  const [frameKey, setFrameKey] = useState(0)
  const [webviewMounted, setWebviewMounted] = useState(false)
  const [webviewReady, setWebviewReady] = useState(false)
  const [nativeNav, setNativeNav] = useState({ canGoBack: false, canGoForward: false })
  const [nativeError, setNativeError] = useState('')
  const [capturing, setCapturing] = useState(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const guest = webviewRef.current
    const browser = window.cnoteDesktop?.browser
    if (!isDesktop || !webviewReady || !viewport || !guest || !browser) return
    if (typeof browser.setPresentation !== 'function') {
      setNativeError('请重启桌面端以启用网页缩放')
      return
    }
    let active = true
    const update = () => {
      if (!viewport.clientWidth || !viewport.clientHeight) return
      void browser.setPresentation(guest.getWebContentsId(), {
        width: viewport.clientWidth / canvasZoom,
        height: viewport.clientHeight / canvasZoom,
        scale: canvasZoom,
      }).catch(error => {
        if (active) setNativeError(errorMessage(error, '网页缩放失败'))
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    guest.addEventListener('dom-ready', update)
    update()
    return () => {
      active = false
      observer.disconnect()
      guest.removeEventListener('dom-ready', update)
    }
  }, [isDesktop, webviewReady, canvasZoom, sessionId, tabId])

  useEffect(() => {
    ensureSessionAndTab({
      id: node.id,
      sessionId: node.sessionId,
      activeTarget: node.activeTarget,
      url: node.url,
    })
  }, [node.id, node.sessionId, node.activeTarget, node.url])

  useEffect(() => {
    if (addressFocusedRef.current) return
    setAddress(liveUrl)
  }, [liveUrl])

  // 尺寸稳定 120ms 后再挂 webview，避免 0 尺寸 guest 导致 Electron 白屏。
  useLayoutEffect(() => {
    if (!isDesktop || !sessionId || !tabId) return
    const viewportEl = viewportRef.current
    if (!viewportEl) return
    let mountTimer: ReturnType<typeof setTimeout> | null = null
    let pending: { width: number; height: number } | null = null

    const update = () => {
      const width = Math.round(viewportEl.offsetWidth)
      const height = Math.round(viewportEl.offsetHeight)
      if (width <= 0 || height <= 0) return
      pending = { width, height }
      if (webviewMounted) return
      if (mountTimer) clearTimeout(mountTimer)
      mountTimer = setTimeout(() => {
        mountTimer = null
        const currentWidth = Math.round(viewportEl.offsetWidth)
        const currentHeight = Math.round(viewportEl.offsetHeight)
        if (pending && pending.width === currentWidth && pending.height === currentHeight) {
          setWebviewMounted(true)
        }
      }, MOUNT_STABLE_MS)
    }

    const observer = new ResizeObserver(update)
    observer.observe(viewportEl)
    update()
    return () => {
      observer.disconnect()
      if (mountTimer) clearTimeout(mountTimer)
    }
  }, [isDesktop, sessionId, tabId, webviewMounted])

  const syncNativeNav = useCallback((webview: BrowserWebviewElement) => {
    try {
      setNativeNav({ canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() })
    } catch {
      setNativeNav({ canGoBack: false, canGoForward: false })
    }
  }, [])

  const attachWebview = useCallback(
    (element: HTMLElement | null) => {
      listenersRef.current?.()
      listenersRef.current = null
      webviewRef.current = null
      if (!element || !sessionId || !tabId) return

      const webview = element as unknown as BrowserWebviewElement
      webviewRef.current = webview

      const src = initialSrcRef.current || DEFAULT_BROWSER_URL
      // partition 必须在导航前存在；JSX 也会写一遍，这里再保证 data-id / 尺寸。
      if (!webview.getAttribute('src')) webview.setAttribute('src', src)
      webview.setAttribute('partition', WEBVIEW_PARTITION)
      webview.setAttribute('data-browser-node-id', browserViewId(sessionId, tabId))
      webview.className = 'h-full w-full border-0 bg-white'
      webview.style.width = '100%'
      webview.style.height = '100%'

      const runtime = () => useRuntimeStore.getState()
      let navigationFailed = false
      const onDomReady = () => {
        setWebviewReady(true)
        if (navigationFailed) return
        setNativeError('')
        syncNativeNav(webview)
        runtime().updateTab(sessionId, tabId, { status: 'ready', title: webview.getTitle() })
      }
      const onNavigate = (event: Event) => {
        if ((event as WebviewNavigationEvent).isMainFrame === false) return
        const nextUrl = eventUrl(event, webview)
        if (!nextUrl) return
        setAddress(nextUrl)
        setNativeError('')
        syncNativeNav(webview)
        runtime().updateTab(sessionId, tabId, { url: nextUrl, status: 'ready', title: webview.getTitle() })
      }
      const onStartLoading = (event: Event) => {
        const detail = event as WebviewNavigationEvent
        if (detail.isMainFrame === false || detail.isInPlace) return
        navigationFailed = false
        setNativeError('')
        runtime().updateTab(sessionId, tabId, { status: 'loading' })
      }
      const onFailLoad = (event: Event) => {
        const detail = event as WebviewNavigationEvent
        if (detail.errorCode === -3 || detail.isMainFrame === false) return
        navigationFailed = true
        setNativeError(errorMessage(detail.errorDescription, '桌面浏览器加载失败'))
        runtime().updateTab(sessionId, tabId, { status: 'error' })
      }

      webview.addEventListener('dom-ready', onDomReady)
      webview.addEventListener('did-navigate', onNavigate)
      webview.addEventListener('did-navigate-in-page', onNavigate)
      webview.addEventListener('did-start-navigation', onStartLoading)
      webview.addEventListener('did-fail-load', onFailLoad)
      webview.addEventListener('did-stop-loading', onDomReady)
      listenersRef.current = () => {
        webview.removeEventListener('dom-ready', onDomReady)
        webview.removeEventListener('did-navigate', onNavigate)
        webview.removeEventListener('did-navigate-in-page', onNavigate)
        webview.removeEventListener('did-start-navigation', onStartLoading)
        webview.removeEventListener('did-fail-load', onFailLoad)
        webview.removeEventListener('did-stop-loading', onDomReady)
      }
    },
    [sessionId, tabId, syncNativeNav],
  )

  useEffect(() => {
    return () => {
      listenersRef.current?.()
      listenersRef.current = null
      webviewRef.current = null
    }
  }, [])

  const submitAddress = async (value: string) => {
    const nextUrl = normalizeUrl(value)
    if (!nextUrl || !sessionId || !tabId) return
    setAddress(nextUrl)
    setNativeError('')
    if (isDesktop) {
      try {
        await sessionManager.navigate(sessionId, tabId, nextUrl)
      } catch (error) {
        setNativeError(errorMessage(error, '页面导航失败'))
      }
      return
    }
    setFrameSrc(nextUrl)
    useRuntimeStore.getState().updateTab(sessionId, tabId, { url: nextUrl, status: 'loading' })
  }

  const onSubmitAddress = (event: FormEvent) => {
    event.preventDefault()
    void submitAddress(address)
  }

  const goBack = () => {
    if (!isDesktop || !sessionId || !tabId) return
    try {
      const view = adapter.getView(sessionId, tabId)
      if (view?.canGoBack()) view.goBack()
    } catch {
      setNativeError('桌面浏览器后退失败')
    }
  }

  const goForward = () => {
    if (!isDesktop || !sessionId || !tabId) return
    try {
      const view = adapter.getView(sessionId, tabId)
      if (view?.canGoForward()) view.goForward()
    } catch {
      setNativeError('桌面浏览器前进失败')
    }
  }

  const refreshPage = () => {
    const current = normalizeUrl(address) || liveUrl
    if (!current) return
    setNativeError('')
    if (isDesktop && sessionId && tabId) {
      useRuntimeStore.getState().updateTab(sessionId, tabId, { status: 'loading' })
      try {
        adapter.getView(sessionId, tabId)?.reload()
      } catch (error) {
        setNativeError(errorMessage(error, '刷新失败'))
      }
      return
    }
    if (sessionId && tabId) {
      useRuntimeStore.getState().updateTab(sessionId, tabId, { status: 'loading' })
    }
    setFrameKey((value) => value + 1)
  }

  const openExternal = () => {
    const url = normalizeUrl(address) || liveUrl
    if (!url) return
    if (typeof window !== 'undefined' && window.cnoteDesktop) {
      void window.cnoteDesktop.browser.popout(url, node.label || 'Cnote 浏览器').catch((error) => {
        setNativeError(errorMessage(error, '无法打开独立窗口'))
      })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const capturePage = async () => {
    if (!isDesktop || !sessionId || !tabId) return
    setCapturing(true)
    setNativeError('')
    try {
      const capture = await sessionManager.captureTab(sessionId, tabId)
      materializeBrowserCapture(node.id, capture)
    } catch (error) {
      setNativeError(errorMessage(error, '页面捕获失败'))
    } finally {
      setCapturing(false)
    }
  }

  const onIframeLoad = () => {
    if (!sessionId || !tabId) return
    useRuntimeStore.getState().updateTab(sessionId, tabId, { status: 'ready' })
  }

  const loading = !nativeError && tab?.status !== 'error' && (isDesktop ? !webviewMounted || !webviewReady || tab?.status === 'loading' : tab?.status === 'loading')
  const webviewSrc = initialSrcRef.current

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <form
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-muted/25 px-3"
        style={browserChromeStyle(canvasZoom)}
        onSubmit={onSubmitAddress}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isDesktop && (
          <>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              disabled={!nativeNav.canGoBack}
              onClick={goBack}
              aria-label="后退"
              title="后退"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              disabled={!nativeNav.canGoForward}
              onClick={goForward}
              aria-label="前进"
              title="前进"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          disabled={!liveUrl}
          onClick={refreshPage}
          aria-label="刷新"
          title="刷新"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-background px-3 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => {
              addressFocusedRef.current = true
            }}
            onBlur={() => {
              addressFocusedRef.current = false
            }}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
            placeholder="输入网址，例如 https://example.com"
            aria-label="网址"
          />
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          disabled={!liveUrl}
          onClick={openExternal}
          aria-label="在独立窗口打开"
          title="在独立窗口打开"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        {isDesktop && (
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            disabled={!webviewReady || capturing || loading || tab?.status === 'error'}
            onClick={() => void capturePage()}
            aria-label="提取当前页面内容"
            title="提取当前页面内容"
          >
            {capturing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
        )}
      </form>

      <div className="relative min-h-0 flex-1 bg-background">
        {isDesktop ? (
          <div ref={viewportRef} className="absolute inset-0 overflow-hidden bg-background">
            {webviewMounted && sessionId && tabId && (
              <webview
                ref={attachWebview}
                src={webviewSrc}
                partition={WEBVIEW_PARTITION}
                allowpopups={false}
                data-browser-node-id={browserViewId(sessionId, tabId)}
                title={node.label || '内置浏览器'}
                className="absolute inset-0 h-full w-full border-0 bg-white"
                style={{ width: '100%', height: '100%' }}
              />
            )}
            {loading && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/15 text-xs text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在打开页面…
              </div>
            )}
            {nativeError && (
              <div className="absolute inset-x-3 top-3 z-20 rounded-lg border border-destructive/25 bg-card/95 px-3 py-2 text-xs text-destructive shadow-sm">
                {nativeError}
              </div>
            )}
          </div>
        ) : frameSrc ? (
          <>
            <iframe
              key={`${frameSrc}-${frameKey}`}
              src={frameSrc}
              title={node.label || '内置浏览器'}
              className="absolute inset-0 h-full w-full border-0 bg-white"
              sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={onIframeLoad}
            />
            {nativeError && (
              <div className="absolute inset-x-3 top-3 z-20 rounded-lg border border-destructive/25 bg-card/95 px-3 py-2 text-xs text-destructive shadow-sm">
                {nativeError}
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            在地址栏输入网址开始浏览
          </div>
        )}
      </div>
    </div>
  )
})
