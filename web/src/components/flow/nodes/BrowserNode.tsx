import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'
import { BROWSER_NODE_DEFAULT_SIZE, BROWSER_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { refreshDownstreamTextNodes } from '@/lib/content-import-controller'
import type { BrowserNodeData } from '@/types/flow'
import { NodeHandle, NodeResizeArc } from './NodeChrome'

const DEFAULT_BROWSER_URL = 'https://www.google.com/'

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'https://' + trimmed
}

export const BrowserNode = memo(({ id, data, selected }: NodeProps<BrowserNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const initialUrl = normalizeUrl(data.confirmedUrl || data.url || DEFAULT_BROWSER_URL)
  const [address, setAddress] = useState(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL)
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : [])
  const [historyIndex, setHistoryIndex] = useState(initialUrl ? 0 : -1)
  const [frameKey, setFrameKey] = useState(0)
  const [nativeSessionId, setNativeSessionId] = useState(data.desktopSessionId)
  const [nativeError, setNativeError] = useState('')
  const [isCapturingNative, setIsCapturingNative] = useState(false)
  const nativeViewportRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedUrlRef = useRef('')
  const loadIntentRef = useRef(false)
  const openingNativeRef = useRef(false)
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : ''
  const syncStatus = data.syncStatus || 'synced'
  const desktopApi = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  const isDesktopRuntime = Boolean(desktopApi)
  const currentUrlRef = useRef(currentUrl)
  const labelRef = useRef(data.label)
  const nativeErrorRef = useRef(nativeError)

  useEffect(() => {
    currentUrlRef.current = currentUrl
    labelRef.current = data.label
    nativeErrorRef.current = nativeError
  }, [currentUrl, data.label, nativeError])

  const persist = useCallback((updates: Partial<BrowserNodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, { data: { ...current.data, ...updates } })
  }, [id, updateNode])

  const ensureNativeSession = useCallback(async () => {
    if (!desktopApi || nativeSessionId || openingNativeRef.current) return
    openingNativeRef.current = true
    try {
      const session = await desktopApi.browser.createSession({
        id: data.desktopSessionId,
        name: data.label || 'Cnote 浏览器会话',
        persistent: true,
        url: currentUrlRef.current || DEFAULT_BROWSER_URL,
      })
      setNativeSessionId(session.id)
      setNativeError('')
      persist({
        desktopSessionId: session.id,
        browserRuntime: 'desktop-native',
        status: 'loading',
        url: session.url || currentUrlRef.current || DEFAULT_BROWSER_URL,
        confirmedUrl: session.url || currentUrlRef.current || DEFAULT_BROWSER_URL,
      })
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : '无法打开桌面浏览器视图')
    } finally {
      openingNativeRef.current = false
    }
  }, [data.desktopSessionId, data.label, desktopApi, nativeSessionId, persist])

  useEffect(() => {
    if (!desktopApi || nativeSessionId) return
    void ensureNativeSession()
  }, [desktopApi, ensureNativeSession, nativeSessionId])

  useEffect(() => {
    if (!desktopApi || !nativeSessionId || !nativeViewportRef.current) return
    let cancelled = false
    let frame = 0
    let isMounted = false
    let syncOperation: Promise<void> | null = null
    let desiredRevision = 0
    let completedRevision = 0
    let desiredVisible = false
    let desiredBounds = { x: 0, y: 0, width: 0, height: 0 }
    let lastDesiredKey = ''

    const setNativeSessionVisible = async (visible: boolean) => {
      if (!isMounted) return
      try {
        await desktopApi.browser.setVisible(nativeSessionId, visible)
      } catch {
        // A destroyed session will be recreated by the next sync pass.
        isMounted = false
      }
    }

    const releaseNativeSession = async () => {
      if (!nativeSessionId) return
      try {
        // Remove the native view itself when the node leaves the tree. The
        // persistent Chromium partition keeps cookies/cache for the next
        // browser node, while closing the WebContentsView prevents it from
        // lingering above the Dashboard after a Flow is deleted.
        await desktopApi.browser.closeSession(nativeSessionId)
      } catch {
        // The desktop window may already be closing.
      } finally {
        isMounted = false
      }
    }

    const syncNativeSession = async () => {
      while (!cancelled) {
        const revision = desiredRevision
        const visible = desiredVisible
        const bounds = desiredBounds

        if (!visible) {
          await setNativeSessionVisible(false)
        } else {
          if (!isMounted) {
            const sessions = await desktopApi.browser.listSessions()
            if (!sessions.some((session) => session.id === nativeSessionId)) {
              await desktopApi.browser.createSession({
                id: nativeSessionId,
                name: labelRef.current || 'Cnote 浏览器会话',
                persistent: true,
                url: currentUrlRef.current || DEFAULT_BROWSER_URL,
              })
            }
            if (cancelled || !desiredVisible) continue
            await desktopApi.browser.mountSession(nativeSessionId, bounds)
            isMounted = true
          } else {
            await desktopApi.browser.setBounds(nativeSessionId, bounds)
          }
          await setNativeSessionVisible(true)

          // A bounds update can arrive while IPC is in flight. Apply the most
          // recent rectangle before allowing the native view to remain visible.
          if (cancelled || !desiredVisible) {
            await setNativeSessionVisible(false)
          } else if (revision !== desiredRevision) {
            await desktopApi.browser.setBounds(nativeSessionId, desiredBounds)
          }
        }

        completedRevision = revision
        if (revision === desiredRevision) return
      }
    }

    const requestSync = () => {
      if (cancelled || syncOperation) return
      syncOperation = syncNativeSession().catch((error) => {
        if (cancelled) return
        setNativeError(error instanceof Error ? error.message : '桌面浏览器视图挂载失败')
      }).finally(() => {
        syncOperation = null
        if (!cancelled && completedRevision !== desiredRevision) requestSync()
      })
    }

    const stopListening = desktopApi.browser.onSessionUpdated((session) => {
      if (session.id !== nativeSessionId || cancelled) return
      // A renderer reload, window restore, or native view teardown can leave
      // the session record alive while its view is no longer mounted. Treat
      // that state as recoverable instead of waiting for the next canvas zoom
      // to change the rectangle and accidentally remount it.
      if (session.presentation !== 'embedded') {
        isMounted = false
        if (desiredVisible) {
          desiredRevision += 1
          requestSync()
        }
      }
    })

    const updateNativeBounds = () => {
      if (cancelled) return
      const element = nativeViewportRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const contentRect = element.closest<HTMLElement>('.cnote-window-content')?.getBoundingClientRect()
      // Keep the native view at the node's real size. The desktop runtime
      // hides it while it is not fully inside the content area, so panning to
      // an edge never shrinks the page or lets it cover the title bar.
      desiredBounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(Math.max(0, rect.width)),
        height: Math.round(Math.max(0, rect.height)),
      }
      const visibleIn = !contentRect || (rect.right > contentRect.left && rect.left < contentRect.right && rect.bottom > contentRect.top && rect.top < contentRect.bottom)
      const canvasMoving = Boolean(element.closest<HTMLElement>('.canvas-viewport-moving'))
      const nodeMoving = Boolean(element.closest<HTMLElement>('.react-flow__node.dragging'))
      const rendererOverlayActive = Array.from(document.querySelectorAll<HTMLElement>(
        '.cnote-menu-surface, [data-canvas-context-menu], [data-connection-menu], [data-canvas-add-menu], [data-toolbar-add-menu], [role="dialog"]',
      )).some((overlay) => {
        if (overlay === element || element.contains(overlay)) return false
        const style = window.getComputedStyle(overlay)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
        const overlayRect = overlay.getBoundingClientRect()
        return overlayRect.right > rect.left && overlayRect.left < rect.right && overlayRect.bottom > rect.top && overlayRect.top < rect.bottom
      })
      // WebContentsView is above the renderer. Hide it while the canvas is
      // panning, dragging, or opening a renderer menu so those interactions
      // remain usable despite Electron's native layer being composited above
      // the renderer DOM.
      desiredVisible = !nativeErrorRef.current && !canvasMoving && !nodeMoving && !rendererOverlayActive && visibleIn && desiredBounds.width >= 12 && desiredBounds.height >= 12
      const boundsKey = desiredVisible
        ? [desiredBounds.x, desiredBounds.y, desiredBounds.width, desiredBounds.height].join(':')
        : 'hidden'
      if (boundsKey !== lastDesiredKey) {
        lastDesiredKey = boundsKey
        desiredRevision += 1
        requestSync()
      }
      frame = window.requestAnimationFrame(updateNativeBounds)
    }

    updateNativeBounds()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      stopListening()
      void releaseNativeSession()
    }
  }, [desktopApi, nativeSessionId])

  useEffect(() => {
    setAddress(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL)
  }, [data.url, data.confirmedUrl])

  useEffect(() => {
    setNativeSessionId(data.desktopSessionId)
  }, [data.desktopSessionId])

  useEffect(() => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current || current.type !== 'browser') return

    const style = current.style || {}
    const hasWidth = style.width !== undefined
    const hasHeight = style.height !== undefined
    if (hasWidth && hasHeight) return

    updateNode(id, {
      style: {
        ...style,
        ...(hasWidth ? {} : { width: BROWSER_NODE_DEFAULT_SIZE.width }),
        ...(hasHeight ? {} : { height: BROWSER_NODE_DEFAULT_SIZE.height }),
      },
    })
  }, [id, updateNode])

  useEffect(() => {
    if (!desktopApi || !nativeSessionId) return
    return desktopApi.browser.onSessionUpdated((session) => {
      if (session.id !== nativeSessionId) return
      const nextUrl = normalizeUrl(session.url)
      if (!nextUrl) return
      setAddress(nextUrl)
      setHistory((items) => {
        const nextItems = items.includes(nextUrl) ? items : items.concat(nextUrl)
        setHistoryIndex(nextItems.indexOf(nextUrl))
        return nextItems
      })
      setNativeError('')
      persist({ url: nextUrl, confirmedUrl: nextUrl, observedUrl: nextUrl, browserRuntime: 'desktop-native', status: 'ready', syncStatus: 'synced' })
    })
  }, [desktopApi, nativeSessionId, persist])

  const navigate = async (value: string) => {
    const nextUrl = normalizeUrl(value)
    if (!nextUrl) return
    setAddress(nextUrl)
    setHistory((items) => items.slice(0, historyIndex + 1).concat(nextUrl))
    setHistoryIndex(historyIndex + 1)
    loadIntentRef.current = true
    loadedUrlRef.current = ''
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
    if (desktopApi && nativeSessionId) {
      try {
        await desktopApi.browser.navigate(nativeSessionId, nextUrl)
        persist({ status: 'ready', observedUrl: nextUrl, browserRuntime: 'desktop-native' })
      } catch (error) {
        setNativeError(error instanceof Error ? error.message : '桌面浏览器导航失败')
        persist({ status: 'error', browserRuntime: 'desktop-native' })
      }
    }
  }

  const submitAddress = (event: FormEvent) => {
    event.preventDefault()
    void navigate(address)
  }

  const moveHistory = (nextIndex: number) => {
    const nextUrl = history[nextIndex]
    if (!nextUrl) return
    setHistoryIndex(nextIndex)
    setAddress(nextUrl)
    loadIntentRef.current = true
    loadedUrlRef.current = ''
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
    if (desktopApi && nativeSessionId) {
      void desktopApi.browser.navigate(nativeSessionId, nextUrl).then(
        () => persist({ status: 'ready', observedUrl: nextUrl, browserRuntime: 'desktop-native' }),
        (error) => {
          setNativeError(error instanceof Error ? error.message : '桌面浏览器导航失败')
          persist({ status: 'error', browserRuntime: 'desktop-native' })
        },
      )
    }
  }

  const refreshFrame = () => {
    if (!currentUrl) return
    loadIntentRef.current = true
    persist({ url: currentUrl, confirmedUrl: currentUrl, status: 'loading', syncStatus: 'synced' })
    if (desktopApi && nativeSessionId) {
      void desktopApi.browser.reload(nativeSessionId).then(
        () => persist({ status: 'ready', browserRuntime: 'desktop-native' }),
        (error) => {
          setNativeError(error instanceof Error ? error.message : '桌面浏览器刷新失败')
          persist({ status: 'error', browserRuntime: 'desktop-native' })
        },
      )
      return
    }
    setFrameKey((key) => key + 1)
  }

  const captureNativePage = async () => {
    if (!desktopApi || !nativeSessionId) return
    setIsCapturingNative(true)
    setNativeError('')
    try {
      const capture = await desktopApi.browser.capture(nativeSessionId)
      const parsed = await runDesktopNativeJob<Awaited<ReturnType<typeof desktopApi.content.parseHtml>>>({ kind: 'native:content-parse', input: { html: capture.html, url: capture.url, title: capture.title } })
      const title = parsed.title || capture.title
      const text = parsed.text || capture.text
      persist({
        url: capture.url,
        confirmedUrl: capture.url,
        observedUrl: capture.url,
        browserRuntime: 'desktop-native',
        status: 'ready',
        snapshot: {
          url: capture.url,
          title,
          text,
          fetchedAt: Date.now(),
          headings: parsed.headings,
          links: parsed.links,
          parserId: parsed.parserId,
          parserVersion: parsed.parserVersion,
        },
      })
      useFlowStore.getState().saveCurrentFlow()
      void refreshDownstreamTextNodes(id)
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : '页面捕获失败')
    } finally {
      setIsCapturingNative(false)
    }
  }

  const handleFrameLoad = () => {
    const isFirstLoadForUrl = loadedUrlRef.current !== currentUrl
    loadedUrlRef.current = currentUrl
    let observedUrl: string | undefined
    try {
      const value = iframeRef.current?.contentWindow?.location.href
      observedUrl = value ? normalizeUrl(value) : undefined
    } catch {
      // A cross-origin iframe deliberately cannot reveal its current URL.
    }
    const observedChange = Boolean(observedUrl && observedUrl !== currentUrl)
    if (loadIntentRef.current || isFirstLoadForUrl) {
      loadIntentRef.current = false
      persist({
        url: currentUrl,
        confirmedUrl: currentUrl,
        status: 'ready',
        syncStatus: observedChange ? 'possibly_changed' : 'synced',
        observedUrl,
      })
      return
    }
    persist({ status: 'ready', syncStatus: 'possibly_changed', observedUrl })
  }

  const cardClass = 'node-card node-panel-shadow group relative h-full w-full overflow-visible rounded-[22px] border bg-card ' + (syncStatus === 'possibly_changed' ? 'border-amber-400 shadow-amber-100' : selected ? 'node-selected' : 'border-border')

  return (
    <div className={`browser-node-card ${cardClass}`} style={{ minWidth: BROWSER_NODE_MIN_SIZE.width, minHeight: BROWSER_NODE_MIN_SIZE.height }}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeResizeArc nodeId={id} minWidth={BROWSER_NODE_MIN_SIZE.width} minHeight={BROWSER_NODE_MIN_SIZE.height} />

      <div className="flex h-full flex-col overflow-hidden rounded-[21px]" style={{ minHeight: BROWSER_NODE_MIN_SIZE.height }}>
        <form className="flex h-12 shrink-0 cursor-grab items-center gap-1.5 border-b border-border bg-muted/25 px-3 active:cursor-grabbing" onSubmit={submitAddress}>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={historyIndex <= 0} onClick={() => moveHistory(historyIndex - 1)} aria-label="后退"><ArrowLeft className="h-4 w-4" /></button>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={historyIndex < 0 || historyIndex >= history.length - 1} onClick={() => moveHistory(historyIndex + 1)} aria-label="前进"><ArrowRight className="h-4 w-4" /></button>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!currentUrl} onClick={refreshFrame} aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
          <div className="nodrag flex min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-background px-3 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={address} onChange={(event) => setAddress(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" placeholder="输入网址，例如 https://example.com" aria-label="网址" />
          </div>
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!currentUrl} onClick={() => {
            if (desktopApi && nativeSessionId) void desktopApi.browser.popoutSession(nativeSessionId)
            else window.open(currentUrl, '_blank', 'noopener,noreferrer')
          }} aria-label="在独立窗口打开" title="在独立窗口打开"><ExternalLink className="h-4 w-4" /></button>
          {isDesktopRuntime && <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!nativeSessionId || isCapturingNative} onClick={() => void captureNativePage()} aria-label="提取当前页面内容" title="提取当前页面内容"><Camera className="h-4 w-4" /></button>}
        </form>

        <div className="relative min-h-0 flex-1 bg-background">
          {isDesktopRuntime ? (
            <div ref={nativeViewportRef} className="absolute inset-0 bg-background">
              {!nativeSessionId && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/15 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在打开 Google</div>}
              {nativeError && <div className="absolute inset-x-3 top-3 z-10 rounded-lg border border-destructive/25 bg-card/95 px-3 py-2 text-xs text-destructive shadow-sm">{nativeError}</div>}
            </div>
          ) : currentUrl ? (
            <iframe
              key={currentUrl + '-' + frameKey}
              ref={iframeRef}
              src={currentUrl}
              title={data.label || '内置浏览器'}
              className="nodrag nowheel absolute inset-0 h-full w-full border-0 bg-white"
              tabIndex={0}
              sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={handleFrameLoad}
            />
          ) : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">在地址栏输入网址开始浏览</div>}
        </div>

      </div>
    </div>
  )
})

BrowserNode.displayName = 'BrowserNode'
