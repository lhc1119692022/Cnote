import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Handle, Position, useReactFlow } from 'reactflow'
import { Download, FileText, Globe, Layers3, Copy, Bookmark, RefreshCw, Scissors, Sparkles, StickyNote, Plus, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useSourceStore } from '@/stores/use-source-store'
import type { ContentCategory, ContentNodeData } from '@/types/flow'
import { cloneLocalResource, deleteLocalResource, hasLocalResource, loadLocalResourceBlob } from '@/lib/resource-storage'
import { getContentCategoryVisual } from '@/lib/content-visuals'
import { canNodeOutputText, importContentIntoNode, refreshTextFromUpstream, reparseContentNode } from '@/lib/content-import-controller'
import { getContentFileAccept } from '@/lib/content-import'
import { cloneFlowValue } from '@/lib/flow/clone'
import { getNodeMediaItems } from '@/lib/content-media'
import { extensionForMimeType, saveBlobToFile } from '@/lib/file-save'

interface NodeHandleProps {
  type: 'target' | 'source'
  position: Position.Left | Position.Right
  id?: string
}

/** All node connection points use the same visual treatment and semantics. */
export function NodeHandle({ type, position, id }: NodeHandleProps) {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      className="node-connection-handle"
      aria-label={type === 'source' ? '输出连接点' : '输入连接点'}
    >
      <span className="node-connection-handle-surface">
        <Plus className="h-5 w-5 stroke-[1.6]" />
      </span>
    </Handle>
  )
}

const nodeChromeByType: Record<string, { icon: typeof FileText; iconClass: string }> = {
  ai: { icon: Sparkles, iconClass: 'text-violet-600' },
  browser: { icon: Globe, iconClass: 'text-blue-600' },
  sticky: { icon: StickyNote, iconClass: 'text-amber-600' },
  content: { icon: Layers3, iconClass: 'text-slate-600' },
}

const nodeChromeLabels: Record<string, string> = {
  ai: 'AI 节点',
  browser: '浏览器节点',
  sticky: '贴纸',
  content: '内容类型选择',
}

function getNodeMode(node: any): string {
  return node?.type === 'content' ? node.data?.category || 'content' : node?.type || 'content'
}

export function NodeResourceLostNotice() {
  return <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8 text-center text-sm font-semibold text-red-600">资源丢失，刷新节点连接资源</div>
}

/** Shared node hover actions: duplicate, save to the content library, and delete. */
export function NodeHoverToolbar({ nodeId, children }: { nodeId: string; children?: ReactNode }) {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId))
  const updateNode = useFlowStore((state) => state.updateNode)
  const edges = useFlowStore((state) => state.edges)
  const nodes = useFlowStore((state) => state.nodes)
  const duplicateNode = useFlowStore((state) => state.duplicateNode)
  const addNode = useFlowStore((state) => state.addNode)
  const deleteNode = useFlowStore((state) => state.deleteNode)
  const createSource = useSourceStore((state) => state.createSource)
  const deleteSource = useSourceStore((state) => state.deleteSource)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const refreshInputRef = useRef<HTMLInputElement>(null)

  const sourceId = node?.data?.sourceId as string | undefined
  const isSaved = useSourceStore((state) => Boolean(sourceId && state.sources.some((source) => source.id === sourceId)))

  if (!node) return null

  const mode = getNodeMode(node)
  const categoryVisual = getContentCategoryVisual(undefined, node.data?.category)
  const chrome = categoryVisual
    ? { icon: categoryVisual.icon, iconClass: categoryVisual.iconClass }
    : nodeChromeByType[mode] || nodeChromeByType.content
  const Icon = chrome.icon
  const label = node.data?.label || nodeChromeLabels[mode] || '节点'
  const resourceLost = Boolean(node.data?.resourceLost || node.data?.state === 'missing')
  const canReparseContent = node.type === 'content' && Boolean(node.data?.source || node.data?.parse?.retryText)
  const hasRefreshableUpstream = node.type === 'content' && node.data?.category === 'text' && Boolean(
    edges.some((edge) => edge.target === nodeId && canNodeOutputText(nodes.find((item) => item.id === edge.source))),
  )
  const splitKind = node.type === 'content' && (node.data?.category === 'image' || node.data?.category === 'video')
    ? node.data.category as 'image' | 'video'
    : undefined
  const splitResources = splitKind ? getNodeMediaItems(node, splitKind) : []
  const canSplitResources = splitResources.length > 1
  const canDownload = node.type === 'content' && (node.data?.category === 'text' || node.data?.category === 'image')

  const commitName = () => {
    const nextLabel = nameDraft.trim()
    if (nextLabel && nextLabel !== label) updateNode(nodeId, { data: { ...node.data, label: nextLabel } })
    else setNameDraft(label)
    setIsEditingName(false)
  }

  const toggleFavorite = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      if (isSaved && sourceId) {
        deleteSource(sourceId)
        updateNode(nodeId, { data: { ...node.data, sourceId: undefined } })
        return
      }

      if (node.type !== 'content') return
      const nodeData = node.data as ContentNodeData
      const currentResourceId = nodeData.source?.kind === 'file' || nodeData.source?.kind === 'clipboard-image' ? nodeData.source.resourceId : undefined
      const snapshotResourceId = currentResourceId
        ? await cloneLocalResource(currentResourceId)
        : undefined
      if (currentResourceId && !snapshotResourceId) return
      const clonedData = cloneFlowValue(nodeData)
      const snapshotData: ContentNodeData = snapshotResourceId && clonedData.source && (clonedData.source.kind === 'file' || clonedData.source.kind === 'clipboard-image')
        ? { ...clonedData, sourceId: undefined, source: { ...clonedData.source, resourceId: snapshotResourceId } }
        : { ...clonedData, sourceId: undefined }
      const source = createSource(label, snapshotData)
      updateNode(nodeId, { data: { ...node.data, sourceId: source.id } })
    } finally {
      setIsSaving(false)
    }
  }

  const refreshResource = async () => {
    const source = sourceId
      ? useSourceStore.getState().sources.find((item) => item.id === sourceId)
      : undefined
    if (source) {
      const nextData = cloneFlowValue(source.nodeData)
      const currentResourceId = node.data?.source?.kind === 'file' || node.data?.source?.kind === 'clipboard-image'
        ? node.data.source.resourceId as string
        : undefined
      const nextResourceId = nextData.source?.kind === 'file' || nextData.source?.kind === 'clipboard-image'
        ? nextData.source.resourceId
        : undefined
      if (nextResourceId && !(await hasLocalResource(nextResourceId))) {
        updateNode(nodeId, { data: { ...node.data, state: 'missing', resourceLost: true } })
        return
      }
      if (currentResourceId !== nextResourceId) {
        const retained = nextResourceId ? await cloneLocalResource(nextResourceId) : undefined
        if (nextResourceId && !retained) return
        await deleteLocalResource(currentResourceId)
      }
      updateNode(nodeId, { type: 'content', data: { ...nextData, label, sourceId: source.id, state: nextData.state === 'missing' ? 'ready' : nextData.state, resourceLost: false } })
      return
    }
    const input = refreshInputRef.current
    if (!input) return
    input.accept = getContentFileAccept(node.data?.category as ContentCategory | undefined)
    input.value = ''
    input.click()
  }

  const handleResourceSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await importContentIntoNode(nodeId, { kind: 'file', file }, node.data?.category as ContentCategory | undefined)
  }

  const downloadContent = async () => {
    if (!canDownload || isDownloading) return
    setIsDownloading(true)
    try {
      const data = node.data as ContentNodeData
      if (data.category === 'text') {
        const payload = data.payload?.kind === 'text' ? data.payload : undefined
        const value = payload?.value || (data.source?.kind === 'text' ? data.source.text : '')
        const extension = payload?.format === 'plain' ? 'txt' : 'md'
        const mimeType = extension === 'txt' ? 'text/plain' : 'text/markdown'
        await saveBlobToFile(new Blob([value], { type: mimeType }), `${label}.${extension}`, {
          description: 'Cnote 文本内容',
          extension: `.${extension}`,
        })
        return
      }

      const resourceId = data.source?.kind === 'file' || data.source?.kind === 'clipboard-image'
        ? data.source.resourceId
        : undefined
      const media = getNodeMediaItems(node, 'image')[0]
      const blob = resourceId
        ? await loadLocalResourceBlob(resourceId)
        : media?.resource.url
          ? await fetch(media.resource.url).then((response) => {
              if (!response.ok) throw new Error(`图片下载失败（${response.status}）`)
              return response.blob()
            })
          : undefined
      if (!blob) throw new Error('图片资源不可用')
      const extension = extensionForMimeType(blob.type) || 'bin'
      await saveBlobToFile(blob, `${label}.${extension}`, {
        description: 'Cnote 图片',
        extension: `.${extension}`,
      })
    } catch (error) {
      alert(error instanceof Error ? error.message : '下载失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  const splitMediaResources = () => {
    if (!splitKind || splitResources.length < 2) return
    const makeData = (item: typeof splitResources[number], index: number): ContentNodeData => {
      const mediaLabel = item.label || `${splitKind === 'image' ? '图片' : '视频'} ${index + 1}`
      const payload = splitKind === 'image'
        ? { kind: 'image' as const, resources: [cloneFlowValue(item)], activeResourceIndex: 0, alt: mediaLabel, width: item.resource.width, height: item.resource.height }
        : { kind: 'video' as const, provider: 'direct' as const, playback: 'video' as const, resources: [cloneFlowValue(item)], activeResourceIndex: 0, title: mediaLabel, width: item.resource.width, height: item.resource.height }
      return {
        schemaVersion: 2,
        label: mediaLabel,
        category: splitKind,
        subtype: splitKind === 'image' ? 'image' : 'remote-video',
        state: 'ready',
        source: null,
        payload,
        preview: { title: mediaLabel, badge: splitKind === 'image' ? '图片' : '视频', meta: [`资源 ${index + 1} / ${splitResources.length}`] },
      }
    }
    updateNode(nodeId, { data: makeData(splitResources[0], 0) })
    const baseX = node.position.x
    const baseY = node.position.y + Number(node.style?.height ?? node.height ?? 340) + 50
    splitResources.forEach((item, index) => {
      if (index === 0) return
      addNode({
        type: 'content',
        position: { x: baseX + ((index - 1) % 3) * 470, y: baseY + Math.floor((index - 1) / 3) * 390 },
        style: { width: 420, height: 340 },
        data: makeData(item, index),
      })
    })
  }

  return (
    <div className="node-hover-toolbar nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="node-hover-toolbar-surface flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-1" role="toolbar" aria-label={`${label}节点操作`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center ${chrome.iconClass}`} title={nodeChromeLabels[mode] || '节点类型'}><Icon className="h-4 w-4" /></span>
        {isEditingName
          ? <input autoFocus value={nameDraft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setNameDraft(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName() } else if (event.key === 'Escape') { event.preventDefault(); setNameDraft(label); setIsEditingName(false) } }} className="nodrag h-8 w-[180px] rounded-md border border-border bg-background px-2 text-sm font-semibold text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/15" aria-label="节点标题" />
          : <span className="max-w-[180px] cursor-text truncate px-1.5 text-sm font-semibold text-foreground" title="双击修改节点标题" onDoubleClick={(event) => { event.stopPropagation(); setNameDraft(label); setIsEditingName(true) }}>{label}</span>}
        <span className="mx-0.5 h-5 w-px bg-border" />
        {children}
        {hasRefreshableUpstream && <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="重新获取上游文本" title="重新获取上游文本并覆盖当前内容" onClick={(event) => { event.stopPropagation(); void refreshTextFromUpstream(nodeId) }}><RefreshCw className="h-4 w-4" /></button>}
        {canSplitResources && <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`拆分为 ${splitResources.length} 个节点`} title={`拆分为 ${splitResources.length} 个独立${splitKind === 'image' ? '图片' : '视频'}节点`} onClick={(event) => { event.stopPropagation(); splitMediaResources() }}><Scissors className="h-4 w-4" /></button>}
        {canReparseContent && node.data?.category !== 'text' && !hasRefreshableUpstream && !resourceLost && <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="重新识别内容" title="使用原始资源重新识别" onClick={(event) => { event.stopPropagation(); void reparseContentNode(nodeId) }}><RefreshCw className="h-4 w-4" /></button>}
        {canDownload && <button type="button" disabled={isDownloading} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="下载内容" title="下载到本地" onClick={(event) => { event.stopPropagation(); void downloadContent() }}><Download className="h-4 w-4" /></button>}
        {resourceLost
          ? <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-50" aria-label="刷新丢失资源" title="刷新丢失资源" onClick={(event) => { event.stopPropagation(); void refreshResource() }}><RefreshCw className="h-4 w-4" /></button>
          : <><button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="复制节点" title="复制节点" onClick={(event) => { event.stopPropagation(); duplicateNode(nodeId) }}><Copy className="h-4 w-4" /></button>
            <button type="button" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${isSaved ? 'text-amber-500' : ''}`} aria-label={isSaved ? '取消收藏' : '收藏节点'} title={isSaved ? '取消收藏' : '收藏节点'} onClick={(event) => { event.stopPropagation(); toggleFavorite() }}><Bookmark className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`} /></button></>}
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive" aria-label="关闭并删除节点" title="关闭并删除节点" onClick={(event) => { event.stopPropagation(); deleteNode(nodeId) }}><X className="h-4 w-4" /></button>
        <input ref={refreshInputRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={handleResourceSelected} />
      </div>
    </div>
  )
}

interface NodeResizeArcProps {
  nodeId: string
  minWidth?: number
  minHeight?: number
}

/** A compact bottom-right resize affordance matching the canvas visual language. */
export function NodeResizeArc({ nodeId, minWidth = 240, minHeight = 160 }: NodeResizeArcProps) {
  const { getViewport } = useReactFlow()
  const cleanupRef = useRef<(() => void) | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => () => {
    cleanupRef.current?.()
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    cleanupRef.current?.()

    const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
    if (!node) return
    const startWidth = Number(node.width || (node as any).measured?.width || (node.style as any)?.width || minWidth)
    const startHeight = Number(node.height || (node as any).measured?.height || (node.style as any)?.height || minHeight)
    const startX = event.clientX
    const startY = event.clientY
    // Pointer movement uses screen pixels, while node dimensions use canvas coordinates.
    const zoom = getViewport().zoom || 1
    const resizeTarget = event.currentTarget
    const pointerId = event.pointerId
    resizeTarget.setPointerCapture(pointerId)

    const applyPendingSize = () => {
      frameRef.current = null
      const size = pendingSizeRef.current
      pendingSizeRef.current = null
      if (!size) return
      const current = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
      if (!current) return
      useFlowStore.getState().updateNode(nodeId, {
        style: { ...(current.style || {}), width: size.width, height: size.height },
      })
    }

    const move = (moveEvent: PointerEvent) => {
      pendingSizeRef.current = {
        width: Math.max(minWidth, startWidth + (moveEvent.clientX - startX) / zoom),
        height: Math.max(minHeight, startHeight + (moveEvent.clientY - startY) / zoom),
      }
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyPendingSize)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      pendingSizeRef.current = null
      if (resizeTarget.hasPointerCapture(pointerId)) resizeTarget.releasePointerCapture(pointerId)
      cleanupRef.current = null
    }
    const stop = () => {
      const shouldCommit = Boolean(useFlowStore.getState().nodes.find((item) => item.id === nodeId))
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      applyPendingSize()
      const resizedNode = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
      if (resizedNode?.type === 'content') {
        useFlowStore.getState().updateNode(nodeId, {
          data: { ...resizedNode.data, manualSize: true },
        })
      }
      cleanup()
      setIsResizing(false)
      if (shouldCommit) {
        useFlowStore.getState().addToHistory()
        useFlowStore.getState().saveCurrentFlow()
      }
    }
    cleanupRef.current = cleanup
    setIsResizing(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div className={`node-resize-arc nodrag nowheel ${isResizing ? 'is-resizing' : ''}`} onPointerDown={startResize} aria-label="调整节点大小">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <path d="M 8 36 C 27 36, 36 27, 36 8" />
      </svg>
    </div>
  )
}
