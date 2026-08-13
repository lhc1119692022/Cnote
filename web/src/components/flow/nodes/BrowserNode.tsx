import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
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
  const addressConfirmationRef = useRef<HTMLDivElement>(null)
  const addressConfirmationTriggerRef = useRef<HTMLButtonElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadedUrlRef = useRef('')
  const loadIntentRef = useRef(false)
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : ''
  const syncStatus = data.syncStatus || 'synced'

  useEffect(() => {
    setAddress(data.url || data.confirmedUrl || DEFAULT_BROWSER_URL)
  }, [data.url, data.confirmedUrl])

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

  const persist = (updates: Partial<BrowserNodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, { data: { ...current.data, ...updates } })
  }

  const navigate = (value: string) => {
    const nextUrl = normalizeUrl(value)
    if (!nextUrl) return
    setAddress(nextUrl)
    setHistory((items) => items.slice(0, historyIndex + 1).concat(nextUrl))
    setHistoryIndex(historyIndex + 1)
    loadIntentRef.current = true
    loadedUrlRef.current = ''
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
  }

  const submitAddress = (event: FormEvent) => {
    event.preventDefault()
    navigate(address)
  }

  const moveHistory = (nextIndex: number) => {
    const nextUrl = history[nextIndex]
    if (!nextUrl) return
    setHistoryIndex(nextIndex)
    setAddress(nextUrl)
    loadIntentRef.current = true
    loadedUrlRef.current = ''
    persist({ url: nextUrl, confirmedUrl: nextUrl, status: 'loading', syncStatus: 'synced', snapshot: undefined, observedUrl: undefined })
  }

  const refreshFrame = () => {
    if (!currentUrl) return
    loadIntentRef.current = true
    persist({ url: currentUrl, confirmedUrl: currentUrl, status: 'loading', syncStatus: 'synced' })
    setFrameKey((key) => key + 1)
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
    navigate(confirmedAddressDraft)
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
          <button type="button" className="nodrag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={!currentUrl} onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')} aria-label="在新窗口打开"><ExternalLink className="h-4 w-4" /></button>
        </form>

        <div className="relative min-h-0 flex-1 bg-background">
          {currentUrl ? (
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
