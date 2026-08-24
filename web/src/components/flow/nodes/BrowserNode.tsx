import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, MonitorUp, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'
import { BROWSER_NODE_DEFAULT_SIZE, BROWSER_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { refreshDownstreamTextNodes } from '@/lib/content-import-controller'
import type { BrowserNodeData, WebPageOutputMode } from '@/types/flow'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

const DEFAULT_BROWSER_URL = 'https://www.baidu.com/'

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'https://' + trimmed
}

function getOutputMode(outputMode?: WebPageOutputMode, extractedContent?: string): WebPageOutputMode {
  if (outputMode) return outputMode
  return extractedContent ? 'text' : 'url'
}

const outputModeLabels: Record<WebPageOutputMode, string> = {
  url: 'URL',
  text: '文本',
  both: 'ALL',
}

function getNextOutputMode(outputMode: WebPageOutputMode): WebPageOutputMode {
  if (outputMode === 'url') return 'text'
  if (outputMode === 'text') return 'both'
  return 'url'
}

export const BrowserNode = memo(({ id, data, selected }: NodeProps<BrowserNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const outputMode = useFlowStore((state) => {
    const node = state.nodes.find((item) => item.id === id)
    return getOutputMode(node?.data?.outputMode as WebPageOutputMode | undefined, node?.data?.extractedContent as string | undefined)
  })
  const initialUrl = normalizeUrl(data.confirmedUrl || data.url || DEFAULT_BROWSER_URL)
  const [address, setAddress] = useState(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL)
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : [])
  const [historyIndex, setHistoryIndex] = useState(initialUrl ? 0 : -1)
  const [frameKey, setFrameKey] = useState(0)
  const [isConfirmingAddress, setIsConfirmingAddress] = useState(false)
  const [confirmedAddressDraft, setConfirmedAddressDraft] = useState('')
  const [nativeSessionId, setNativeSessionId] = useState(data.desktopSessionId)
  const [nativeCapture, setNativeCapture] = useState<{ url: string; title: string; text: string }>()
  const [nativeError, setNativeError] = useState('')
  const [isOpeningNative, setIsOpeningNative] = useState(false)
  const [nativeSessionRevision, setNativeSessionRevision] = useState(0)
  const addressConfirmationRef = useRef<HTMLDivElement>(null)
  const addressConfirmationTriggerRef = useRef<HTMLButtonElement>(null)
  const nativeViewportRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedUrlRef = useRef('')
  const loadIntentRef = useRef(false)
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : ''
  const syncStatus = data.syncStatus || 'synced'
  const desktopApi = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  const isDesktopRuntime = Boolean(desktopApi)
  const currentUrlRef = useRef(currentUrl)
  const labelRef = useRef(data.label)

  useEffect(() => {
    currentUrlRef.current = currentUrl
    labelRef.current = data.label
  }, [currentUrl, data.label])

  useEffect(() => {
    if (!desktopApi || !nativeSessionId || !nativeViewportRef.current) return
    let cancelled = false
    let frame = 0
    let lastBoundsKey = ''
    let isMounted = false
    let pendingMount: Promise<void> | null = null

    const mountOrRestoreSession = async (bounds: { x: number; y: number; width: number; height: number }) => {
      if (cancelled) return
      if (isMounted) {
        await desktopApi.browser.setBounds(nativeSessionId, bounds)
        return
      }
      try {
        await desktopApi.browser.mountSession(nativeSessionId, bounds)
      } catch (error) {
        if (cancelled) return
        const sessions = await desktopApi.browser.listSessions()
        if (sessions.some((session) => session.id === nativeSessionId)) throw error
        await desktopApi.browser.createSession({
          id: nativeSessionId,
          name: labelRef.current || 'Cnote 浏览器会话',
          persistent: true,
          url: currentUrlRef.current || DEFAULT_BROWSER_URL,
        })
        await desktopApi.browser.mountSession(nativeSessionId, bounds)
      }
      isMounted = true
    }

    const updateNativeBounds = () => {
      if (cancelled) return
      const element = nativeViewportRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const left = Math.max(0, rect.left)
      const top = Math.max(0, rect.top)
      const right = Math.min(window.innerWidth, rect.right)
      const bottom = Math.min(window.innerHeight, rect.bottom)
      const bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      }
      const boundsKey = [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(value)).join(':')
      if (boundsKey !== lastBoundsKey && !pendingMount) {
        lastBoundsKey = boundsKey
        pendingMount = mountOrRestoreSession(bounds).catch((error) => {
          if (cancelled) return
          lastBoundsKey = ''
          setNativeError(error instanceof Error ? error.message : '桌面浏览器视图挂载失败')
        }).finally(() => {
          pendingMount = null
        })
      }
      frame = window.requestAnimationFrame(updateNativeBounds)
    }

    updateNativeBounds()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      pendingMount = null
      void desktopApi.browser.unmountSession(nativeSessionId).catch(() => undefined)
    }
  }, [desktopApi, nativeSessionId, nativeSessionRevision])

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
    const markPossibleNavigation = () => {
      if (document.activeElement !== iframeRef.current) return
      setIsConfirmingAddress(false)
      const current = useFlowStore.getState().nodes.find((node) => node.id === id)
      if (!current || current.data?.syncStatus === 'possibly_changed') return
      updateNode(id, { data: { ...current.data, syncStatus: 'possibly_changed' } })
    }
    window.addEventListener('blur', markPossibleNavigation)
    return () => window.removeEventListener('blur', markPossibleNavigation)
  }, [id, updateNode])

  useEffect(() => {
    if (!isConfirmingAddress) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (addressConfirmationRef.current?.contains(target)) return
      if (addressConfirmationTriggerRef.current?.contains(target)) return
      setIsConfirmingAddress(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [isConfirmingAddress])

  const persist = useCallback((updates: Partial<BrowserNodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, { data: { ...current.data, ...updates } })
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
      persist({ url: nextUrl, observedUrl: nextUrl, browserRuntime: 'desktop-native', status: 'ready', syncStatus: 'possibly_changed' })
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

  const openNativeSession = async () => {
    if (!desktopApi || isOpeningNative) return
    setIsOpeningNative(true)
    setNativeError('')
    try {
      const existing = nativeSessionId
        ? (await desktopApi.browser.listSessions()).find((session) => session.id === nativeSessionId)
        : undefined
      const session = existing || await desktopApi.browser.createSession({
        id: nativeSessionId,
        name: data.label || 'Cnote 浏览器会话',
        persistent: true,
        url: currentUrl || DEFAULT_BROWSER_URL,
      })
      setNativeSessionId(session.id)
      setNativeSessionRevision((revision) => revision + 1)
      await desktopApi.browser.showSession(session.id)
      persist({ desktopSessionId: session.id, browserRuntime: 'desktop-native', status: 'ready', confirmedUrl: session.url || currentUrl })
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : '无法打开桌面浏览器会话')
    } finally {
      setIsOpeningNative(false)
    }
  }

  const captureNativePage = async () => {
    if (!desktopApi || !nativeSessionId) return
    setNativeError('')
    try {
      const capture = await desktopApi.browser.capture(nativeSessionId)
      const parsed = await runDesktopNativeJob<Awaited<ReturnType<typeof desktopApi.content.parseHtml>>>({ kind: 'native:content-parse', input: { html: capture.html, url: capture.url, title: capture.title } })
      const title = parsed.title || capture.title
      const text = parsed.text || capture.text
      setNativeCapture({ url: capture.url, title, text })
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

  const setMode = (nextMode: WebPageOutputMode) => {
    persist({ outputMode: nextMode })
    useFlowStore.getState().addToHistory()
    useFlowStore.getState().saveCurrentFlow()
    void refreshDownstreamTextNodes(id)
  }

  const openAddressConfirmation = () => {
    if (isConfirmingAddress) {
      setIsConfirmingAddress(false)
      return
    }
    setConfirmedAddressDraft(data.observedUrl || address || data.confirmedUrl || currentUrl)
    setIsConfirmingAddress(true)
  }

  const confirmCurrentUrl = () => {
    void navigate(confirmedAddressDraft)
    setIsConfirmingAddress(false)
  }

  const cardClass = 'node-card node-panel-shadow group relative h-full w-full overflow-visible rounded-[22px] border bg-card ' + (syncStatus === 'possibly_changed' ? 'border-amber-400 shadow-amber-100' : selected ? 'node-selected' : 'border-border')
  const emptyInputSelector = ".react-flow__node[data-id='" + id + "'] input[aria-label='网址']"

  return (
    <div className={cardClass} style={{ minWidth: BROWSER_NODE_MIN_SIZE.width, minHeight: BROWSER_NODE_MIN_SIZE.height }} onMouseLeave={() => setIsConfirmingAddress(false)}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id}>
        <Button
          ref={addressConfirmationTriggerRef}
          type="button"
          variant={isConfirmingAddress ? 'secondary' : 'ghost'}
          size="sm"
          className={`nodrag nopan nowheel h-8 shrink-0 rounded-full px-3 ${syncStatus === 'possibly_changed' ? 'text-amber-700' : 'text-muted-foreground hover:text-foreground'}`}
          aria-label="更新信息传递地址"
          title="更新信息传递地址"
          aria-expanded={isConfirmingAddress}
          onClick={(event) => { event.stopPropagation(); openAddressConfirmation() }}
        >
          更新
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="nodrag nopan nowheel h-8 min-w-12 shrink-0 rounded-full px-3 text-foreground"
          aria-label={`信息传递模式：${outputModeLabels[outputMode]}，点击切换`}
          title={`当前传递 ${outputModeLabels[outputMode]}，点击切换`}
          onClick={(event) => { event.stopPropagation(); setMode(getNextOutputMode(outputMode)) }}
        >
          {outputModeLabels[outputMode]}
        </Button>
      </NodeHoverToolbar>
      <NodeResizeArc nodeId={id} minWidth={BROWSER_NODE_MIN_SIZE.width} minHeight={BROWSER_NODE_MIN_SIZE.height} />

      {isConfirmingAddress && <div ref={addressConfirmationRef} className="nodrag nopan nowheel absolute right-3 top-3 z-40 flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
        <input autoFocus value={confirmedAddressDraft} onChange={(event) => setConfirmedAddressDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirmCurrentUrl(); if (event.key === 'Escape') setIsConfirmingAddress(false) }} className="h-8 w-[360px] rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-foreground/30" aria-label="信息传递地址" />
        <Button type="button" variant="secondary" size="sm" onClick={() => setIsConfirmingAddress(false)}>取消</Button>
        <Button type="button" size="sm" onClick={confirmCurrentUrl}>确认</Button>
      </div>}

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
          }} aria-label="弹出浏览器窗口" title="弹出浏览器窗口"><ExternalLink className="h-4 w-4" /></button>
          {isDesktopRuntime && <button type="button" className={`nodrag flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted hover:text-foreground ${nativeSessionId ? 'text-primary' : 'text-muted-foreground'}`} onClick={() => void openNativeSession()} disabled={isOpeningNative} aria-label="打开桌面浏览器会话" title={nativeSessionId ? '显示桌面浏览器会话' : '打开桌面浏览器会话'}><MonitorUp className="h-4 w-4" /></button>}
        </form>

        <div className="relative min-h-0 flex-1 bg-background">
          {isDesktopRuntime ? (
            <div ref={nativeViewportRef} className="absolute inset-0 bg-background">
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center">
              <MonitorUp className="h-12 w-12 stroke-[1.25] text-primary/60" />
              <div>
                <p className="text-sm font-medium text-foreground">桌面原生浏览器视图</p>
                <p className="mt-1 max-w-[320px] text-xs leading-5 text-muted-foreground">页面会直接嵌入当前节点，不受 iframe 和 CORS 限制。</p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" className="nodrag nopan nowheel rounded-full" onClick={() => void openNativeSession()} disabled={isOpeningNative}>
                  <MonitorUp className="mr-1.5 h-3.5 w-3.5" />
                  {nativeSessionId ? '显示浏览器' : '打开浏览器'}
                </Button>
                {nativeSessionId && <Button type="button" variant="secondary" size="sm" className="nodrag nopan nowheel rounded-full" onClick={() => void captureNativePage()}>
                  <Camera className="mr-1.5 h-3.5 w-3.5" />捕获页面
                </Button>}
              </div>
              {nativeError && <p className="max-w-[360px] text-xs text-destructive">{nativeError}</p>}
              {nativeCapture && <div className="max-h-32 w-full max-w-[420px] overflow-auto rounded-xl border border-border bg-card p-3 text-left text-xs text-muted-foreground"><p className="mb-1 font-medium text-foreground">{nativeCapture.title || nativeCapture.url}</p><p className="whitespace-pre-wrap">{nativeCapture.text || '当前页面没有可提取的正文。'}</p></div>}
              </div>
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
          ) : (
            <button type="button" className="nodrag absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground" onClick={() => document.querySelector<HTMLInputElement>(emptyInputSelector)?.focus()}>
              <Globe2 className="h-12 w-12 stroke-[1.25] opacity-30" />
              <span className="text-sm">在地址栏输入网址开始浏览</span>
            </button>
          )}
        </div>

      </div>
    </div>
  )
})

BrowserNode.displayName = 'BrowserNode'
