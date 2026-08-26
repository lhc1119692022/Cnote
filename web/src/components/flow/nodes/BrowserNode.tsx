import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { captureBrowserWebview, type BrowserWebviewElement, type DesktopParsedPage } from '@/lib/browser-webview'
import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'
import { BROWSER_NODE_DEFAULT_SIZE, BROWSER_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { refreshDownstreamTextNodes } from '@/lib/content-import-controller'
import type { BrowserNodeData } from '@/types/flow'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

const DEFAULT_BROWSER_URL = 'https://www.google.com/'

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^(https?|about):/i.test(trimmed) ? trimmed : 'https://' + trimmed
}

function eventUrl(event: Event, webview: BrowserWebviewElement) {
  const value = (event as Event & { url?: unknown }).url
  return normalizeUrl(typeof value === 'string' && value ? value : webview.getURL())
}

export const BrowserNode = memo(({ id, data, selected }: NodeProps<BrowserNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const initialUrl = normalizeUrl(data.confirmedUrl || data.url || DEFAULT_BROWSER_URL)
  const initialDesktopUrl = useRef(initialUrl)
  const webviewRef = useRef<BrowserWebviewElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedUrlRef = useRef('')
  const loadIntentRef = useRef(false)
  const desktopApi = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  const isDesktopRuntime = Boolean(desktopApi)
  const [address, setAddress] = useState(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL)
  const [desktopUrl, setDesktopUrl] = useState(initialUrl)
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : [])
  const [historyIndex, setHistoryIndex] = useState(initialUrl ? 0 : -1)
  const [frameKey, setFrameKey] = useState(0)
  const [nativeNav, setNativeNav] = useState({ canGoBack: false, canGoForward: false })
  const [nativeError, setNativeError] = useState('')
  const [webviewReady, setWebviewReady] = useState(false)
  const [webviewMounted, setWebviewMounted] = useState(false)
  const [webviewSize, setWebviewSize] = useState<{ width: number; height: number } | null>(null)
  const [shielded, setShielded] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const syncStatus = data.syncStatus || 'synced'
  const currentUrl = isDesktopRuntime ? desktopUrl : historyIndex >= 0 ? history[historyIndex] : ''

  const persist = useCallback((updates: Partial<BrowserNodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (current) updateNode(id, { data: { ...current.data, ...updates } })
  }, [id, updateNode])

  const syncNativeNav = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return
    try {
      setNativeNav({ canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() })
    } catch {
      setNativeNav({ canGoBack: false, canGoForward: false })
    }
  }, [])

  useEffect(() => {
    if (!isDesktopRuntime) return
    const webview = webviewRef.current
    if (!webview) return
    const domReady = () => {
      setWebviewReady(true)
      setNativeError('')
      syncNativeNav()
    }
    const navigate = (event: Event) => {
      const nextUrl = eventUrl(event, webview)
      if (!nextUrl) return
      setAddress(nextUrl)
      setDesktopUrl(nextUrl)
      setNativeError('')
      syncNativeNav()
      persist({ url: nextUrl, confirmedUrl: nextUrl, observedUrl: nextUrl, browserRuntime: 'desktop-native', status: 'ready', syncStatus: 'synced' })
    }
    const startLoading = () => persist({ status: 'loading', browserRuntime: 'desktop-native' })
    const failLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: unknown; errorDescription?: unknown }
      if (detail.errorCode === -3) return
      setNativeError(typeof detail.errorDescription === 'string' ? detail.errorDescription : '桌面浏览器加载失败')
      persist({ status: 'error', browserRuntime: 'desktop-native' })
    }
    webview.addEventListener('dom-ready', domReady)
    webview.addEventListener('did-navigate', navigate)
    webview.addEventListener('did-navigate-in-page', navigate)
    webview.addEventListener('did-start-loading', startLoading)
    webview.addEventListener('page-title-updated', () => setNativeError(''))
    webview.addEventListener('did-fail-load', failLoad)
    return () => {
      webview.removeEventListener('dom-ready', domReady)
      webview.removeEventListener('did-navigate', navigate)
      webview.removeEventListener('did-navigate-in-page', navigate)
      webview.removeEventListener('did-start-loading', startLoading)
      webview.removeEventListener('did-fail-load', failLoad)
    }
  }, [isDesktopRuntime, persist, syncNativeNav, webviewMounted])

  useEffect(() => {
    if (!isDesktopRuntime || !webviewReady) return
    const desired = normalizeUrl(data.confirmedUrl || data.url || DEFAULT_BROWSER_URL)
    const webview = webviewRef.current
    if (!webview || !desired) return
    try {
      const actual = normalizeUrl(webview.getURL())
      if (!actual || actual === 'about:blank' || actual !== desired) {
        void webview.loadURL(desired).catch((error) => setNativeError(error instanceof Error ? error.message : '桌面浏览器导航失败'))
      }
    } catch {
      // URL is unavailable until the guest is ready.
    }
  }, [data.confirmedUrl, data.url, isDesktopRuntime, webviewReady])

  useEffect(() => {
    if (!isDesktopRuntime) return
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => {
      const node = viewport.closest<HTMLElement>('.react-flow__node')
      setShielded(Boolean(viewport.closest<HTMLElement>('.canvas-viewport-moving') || node?.classList.contains('dragging')))
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
    update()
    return () => observer.disconnect()
  }, [isDesktopRuntime])

  useLayoutEffect(() => {
    if (!isDesktopRuntime) return
    const viewport = viewportRef.current
    if (!viewport) return
    let mountTimer: ReturnType<typeof setTimeout> | null = null
    let pendingSize: { width: number; height: number } | null = null
    const update = () => {
      const width = Math.round(viewport.offsetWidth)
      const height = Math.round(viewport.offsetHeight)
      if (width <= 0 || height <= 0) return
      const nextSize = { width, height }
      pendingSize = nextSize
      setWebviewSize((current) => current?.width === width && current.height === height ? current : nextSize)
      if (webviewMounted) return
      if (mountTimer) clearTimeout(mountTimer)
      mountTimer = setTimeout(() => {
        mountTimer = null
        const currentWidth = Math.round(viewport.offsetWidth)
        const currentHeight = Math.round(viewport.offsetHeight)
        if (pendingSize?.width === currentWidth && pendingSize.height === currentHeight) setWebviewMounted(true)
      }, 120)
    }
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    update()
    return () => {
      observer.disconnect()
      if (mountTimer) clearTimeout(mountTimer)
    }
  }, [isDesktopRuntime, webviewMounted])

  useEffect(() => setAddress(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL), [data.confirmedUrl, data.url])
  useEffect(() => setDesktopUrl(normalizeUrl(data.confirmedUrl || data.url || DEFAULT_BROWSER_URL)), [data.confirmedUrl, data.url])
  useEffect(() => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current || current.type !== 'browser') return
    const style = current.style || {}
    if (style.width !== undefined && style.height !== undefined) return
    updateNode(id, { style: { ...style, ...(style.width === undefined ? { width: BROWSER_NODE_DEFAULT_SIZE.width } : {}), ...(style.height === undefined ? { height: BROWSER_NODE_DEFAULT_SIZE.height } : {}) } })
  }, [id, updateNode])

  const navigateTo = async (value: string) => {
    const nextUrl = normalizeUrl(value)
    if (!nextUrl) return
    setAddress(nextUrl)
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
    if (isDesktopRuntime) {
      setDesktopUrl(nextUrl)
      try {
        await webviewRef.current?.loadURL(nextUrl)
      } catch (error) {
        setNativeError(error instanceof Error ? error.message : '桌面浏览器导航失败')
        persist({ status: 'error', browserRuntime: 'desktop-native' })
      }
      return
    }
    setHistory((items) => items.slice(0, historyIndex + 1).concat(nextUrl))
    setHistoryIndex(historyIndex + 1)
  }

  const submitAddress = (event: FormEvent) => {
    event.preventDefault()
    void navigateTo(address)
  }

  const moveHistory = (index: number) => {
    const nextUrl = history[index]
    if (!nextUrl) return
    setHistoryIndex(index)
    setAddress(nextUrl)
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
  }

  const goBack = () => {
    if (isDesktopRuntime) {
      try {
        if (webviewRef.current?.canGoBack()) webviewRef.current.goBack()
      } catch {
        setNativeError('桌面浏览器后退失败')
      }
    } else moveHistory(historyIndex - 1)
  }

  const goForward = () => {
    if (isDesktopRuntime) {
      try {
        if (webviewRef.current?.canGoForward()) webviewRef.current.goForward()
      } catch {
        setNativeError('桌面浏览器前进失败')
      }
    } else moveHistory(historyIndex + 1)
  }

  const refreshPage = () => {
    if (!currentUrl) return
    persist({ url: currentUrl, confirmedUrl: currentUrl, status: 'loading', syncStatus: 'synced' })
    if (isDesktopRuntime) webviewRef.current?.reload()
    else setFrameKey((value) => value + 1)
  }

  const captureNativePage = async () => {
    if (!isDesktopRuntime) return
    setCapturing(true)
    setNativeError('')
    try {
      const capture = await captureBrowserWebview(id)
      const parsed = await runDesktopNativeJob<DesktopParsedPage>({ kind: 'native:content-parse', input: { html: capture.html, url: capture.url, title: capture.title } })
      persist({
        url: capture.url,
        confirmedUrl: capture.url,
        observedUrl: capture.url,
        browserRuntime: 'desktop-native',
        status: 'ready',
        snapshot: { url: capture.url, title: parsed.title || capture.title, text: parsed.text || capture.text, fetchedAt: Date.now(), headings: parsed.headings, links: parsed.links, parserId: parsed.parserId, parserVersion: parsed.parserVersion },
      })
      useFlowStore.getState().saveCurrentFlow()
      void refreshDownstreamTextNodes(id)
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : '页面捕获失败')
    } finally {
      setCapturing(false)
    }
  }

  const handleFrameLoad = () => {
    const firstLoad = loadedUrlRef.current !== currentUrl
    loadedUrlRef.current = currentUrl
    let observedUrl: string | undefined
    try {
      const value = iframeRef.current?.contentWindow?.location.href
      observedUrl = value ? normalizeUrl(value) : undefined
    } catch {
      // Cross-origin iframe URL is intentionally unreadable.
    }
    const changed = Boolean(observedUrl && observedUrl !== currentUrl)
    if (loadIntentRef.current || firstLoad) {
      loadIntentRef.current = false
      persist({ url: currentUrl, confirmedUrl: currentUrl, status: 'ready', syncStatus: changed ? 'possibly_changed' : 'synced', observedUrl })
    } else persist({ status: 'ready', syncStatus: 'possibly_changed', observedUrl })
  }

  const cardClass = 'node-card node-panel-shadow group relative h-full w-full overflow-visible rounded-[22px] border bg-card ' + (syncStatus === 'possibly_changed' ? 'border-amber-400 shadow-amber-100' : selected ? 'node-selected' : 'border-border')

  return (
    <div className={'browser-node-card ' + cardClass} style={{ minWidth: BROWSER_NODE_MIN_SIZE.width, minHeight: BROWSER_NODE_MIN_SIZE.height }}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={BROWSER_NODE_MIN_SIZE.width} minHeight={BROWSER_NODE_MIN_SIZE.height} />
      <div className="flex h-full flex-col overflow-hidden rounded-[21px]" style={{ minHeight: BROWSER_NODE_MIN_SIZE.height }}>
        <form className="flex h-12 shrink-0 cursor-grab items-center gap-1.5 border-b border-border bg-muted/25 px-3 active:cursor-grabbing" onSubmit={submitAddress}>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={isDesktopRuntime ? !nativeNav.canGoBack : historyIndex <= 0} onClick={goBack} aria-label="后退" title="后退"><ArrowLeft className="h-4 w-4" /></button>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={isDesktopRuntime ? !nativeNav.canGoForward : historyIndex < 0 || historyIndex >= history.length - 1} onClick={goForward} aria-label="前进" title="前进"><ArrowRight className="h-4 w-4" /></button>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!currentUrl} onClick={refreshPage} aria-label="刷新" title="刷新"><RefreshCw className="h-4 w-4" /></button>
          <div className="nodrag flex min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-background px-3 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={address} onChange={(event) => setAddress(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" placeholder="输入网址，例如 https://example.com" aria-label="网址" />
          </div>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!currentUrl} onClick={() => desktopApi ? void desktopApi.browser.popout(currentUrl, data.label || 'Cnote 浏览器') : window.open(currentUrl, '_blank', 'noopener,noreferrer')} aria-label="在独立窗口打开" title="在独立窗口打开"><ExternalLink className="h-4 w-4" /></button>
          {isDesktopRuntime && <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!webviewReady || capturing} onClick={() => void captureNativePage()} aria-label="提取当前页面内容" title="提取当前页面内容"><Camera className="h-4 w-4" /></button>}
        </form>
        <div className="relative min-h-0 flex-1 bg-background">
          {isDesktopRuntime ? (
            <div ref={viewportRef} className="absolute inset-0 overflow-hidden rounded-[inherit] bg-background" data-browser-webview-container={id}>
              {webviewMounted && <webview ref={webviewRef} src={initialDesktopUrl.current} partition="persist:cnote-browser" allowpopups={false} data-browser-node-id={id} title={data.label || '内置浏览器'} className="nodrag nowheel absolute inset-0 h-full w-full border-0 bg-white" style={{ display: 'inline-flex', width: webviewSize ? `${webviewSize.width}px` : '100%', height: webviewSize ? `${webviewSize.height}px` : '100%', minWidth: 0, minHeight: 0, borderRadius: 'inherit' }} />}
              <div className={'absolute inset-0 z-20 bg-transparent ' + (shielded ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden="true" />
              {(!webviewMounted || !webviewReady) && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/15 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在打开页面…</div>}
              {nativeError && <div className="absolute inset-x-3 top-3 z-30 rounded-lg border border-destructive/25 bg-card/95 px-3 py-2 text-xs text-destructive shadow-sm">{nativeError}</div>}
            </div>
          ) : currentUrl ? (
            <iframe key={currentUrl + '-' + frameKey} ref={iframeRef} src={currentUrl} title={data.label || '内置浏览器'} className="nodrag nowheel absolute inset-0 h-full w-full border-0 bg-white" tabIndex={0} sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" referrerPolicy="no-referrer" onLoad={handleFrameLoad} />
          ) : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">在地址栏输入网址开始浏览</div>}
        </div>
      </div>
    </div>
  )
})

BrowserNode.displayName = 'BrowserNode'
