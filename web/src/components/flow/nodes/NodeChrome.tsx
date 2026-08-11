import { useRef, useState, type ChangeEvent } from 'react'
import { Handle, Position } from 'reactflow'
import { FileText, Globe, Layers3, Copy, Bookmark, RefreshCw, Sparkles, StickyNote, Plus, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useSourceStore } from '@/stores/use-source-store'
import type { ContentMode } from '@/types/flow'
import { cloneLocalResource, storeLocalResource } from '@/lib/resource-storage'
import { getContentCategoryVisual } from '@/lib/content-visuals'

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

const contentModes = new Set<ContentMode>(['text', 'youtube', 'pdf', 'image', 'video', 'table'])

const nodeChromeByType: Record<string, { icon: typeof FileText; iconClass: string }> = {
  ai: { icon: Sparkles, iconClass: 'text-violet-600 bg-violet-100' },
  browser: { icon: Globe, iconClass: 'text-blue-600 bg-blue-100' },
  sticky: { icon: StickyNote, iconClass: 'text-amber-600 bg-amber-100' },
  content: { icon: Layers3, iconClass: 'text-slate-600 bg-slate-100' },
}

const nodeChromeLabels: Record<string, string> = {
  ai: 'AI 节点',
  browser: '浏览器节点',
  sticky: '贴纸',
  content: '内容类型选择',
  text: '文本节点',
  youtube: 'YouTube 节点',
  pdf: 'PDF 节点',
  image: '图片节点',
  video: '视频节点',
  table: '表格节点',
}

function getNodeMode(node: any): string {
  return node?.type === 'content' ? node.data?.mode || 'content' : node?.type || 'content'
}

function resourceAccept(mode: string) {
  if (mode === 'pdf') return '.pdf,application/pdf'
  if (mode === 'image') return 'image/*'
  if (mode === 'video') return 'video/*'
  if (mode === 'table') return '.csv,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return '*/*'
}

export function NodeResourceLostNotice() {
  return <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8 text-center text-sm font-semibold text-red-600">资源丢失，刷新节点连接资源</div>
}

function getFavoriteData(node: any, snapshotResourceId?: string): { type: ContentMode; content: string; metadata: Record<string, any> } {
  const mode = getNodeMode(node)
  if (contentModes.has(mode as ContentMode)) {
    const hasLocalResource = Boolean(node?.data?.resourceId)
    const nodeData = {
      ...node?.data,
      sourceId: undefined,
      resourceId: hasLocalResource ? snapshotResourceId : node?.data?.resourceId,
      content: hasLocalResource ? '' : node?.data?.content,
    }
    return {
      type: mode as ContentMode,
      content: hasLocalResource ? '' : String(node?.data?.content || ''),
      metadata: {
        snapshotVersion: 1,
        originNodeId: node?.id,
        resourceOwnership: hasLocalResource ? 'snapshot' : undefined,
        nodeType: node?.type,
        nodeData,
      },
    }
  }

  const content = mode === 'browser'
    ? node?.data?.extractedContent || node?.data?.url || ''
    : mode === 'sticky'
      ? node?.data?.content || node?.data?.text || ''
      : node?.data?.output || node?.data?.prompt || node?.data?.content || ''
  return {
    type: 'text',
    content: String(content),
    metadata: {
      snapshotVersion: 1,
      originNodeId: node?.id,
      nodeType: node?.type,
      nodeData: { ...node?.data, sourceId: undefined },
    },
  }
}

/** Shared node hover actions: duplicate, save to the content library, and delete. */
export function NodeHoverToolbar({ nodeId }: { nodeId: string }) {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId))
  const updateNode = useFlowStore((state) => state.updateNode)
  const duplicateNode = useFlowStore((state) => state.duplicateNode)
  const deleteNode = useFlowStore((state) => state.deleteNode)
  const createSource = useSourceStore((state) => state.createSource)
  const deleteSource = useSourceStore((state) => state.deleteSource)
  const [isSaving, setIsSaving] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const refreshInputRef = useRef<HTMLInputElement>(null)

  const sourceId = node?.data?.sourceId as string | undefined
  const isSaved = useSourceStore((state) => Boolean(sourceId && state.sources.some((source) => source.id === sourceId)))

  if (!node) return null

  const mode = getNodeMode(node)
  const categoryVisual = getContentCategoryVisual(mode, node.data?.contentCategory)
  const chrome = categoryVisual
    ? { icon: categoryVisual.icon, iconClass: `${categoryVisual.iconClass} ${categoryVisual.iconSurfaceClass}` }
    : nodeChromeByType[mode] || nodeChromeByType.content
  const Icon = chrome.icon
  const label = node.data?.label || nodeChromeLabels[mode] || '节点'
  const resourceLost = Boolean(node.data?.resourceLost)

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

      const snapshotResourceId = node.data?.resourceId
        ? await cloneLocalResource(node.data.resourceId)
        : undefined
      if (node.data?.resourceId && !snapshotResourceId) return
      const favorite = getFavoriteData(node, snapshotResourceId)
      const source = createSource(label, favorite.content, favorite.type, favorite.metadata)
      updateNode(nodeId, { data: { ...node.data, sourceId: source.id } })
    } finally {
      setIsSaving(false)
    }
  }

  const repairResource = (content: string, fileName?: string, resourceId?: string) => {
    const current = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
    if (!current) return
    updateNode(nodeId, { data: { ...current.data, content, resourceId: resourceId || current.data?.resourceId, fileName: fileName || current.data?.fileName, resourceLost: false, disabled: false, enabled: true } })
  }

  const refreshResource = () => {
    const source = sourceId
      ? useSourceStore.getState().sources.find((item) => item.id === sourceId)
      : undefined
    if (source && (source.content || source.metadata?.nodeData?.resourceId)) {
      repairResource(source.content, source.metadata?.nodeData?.fileName, source.metadata?.nodeData?.resourceId)
      return
    }
    const input = refreshInputRef.current
    if (!input) return
    input.accept = resourceAccept(mode)
    input.value = ''
    input.click()
  }

  const handleResourceSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (mode === 'table' && (file.type.startsWith('text/') || /\.(csv|tsv)$/i.test(file.name))) {
      const reader = new FileReader()
      reader.onload = () => repairResource(String(reader.result || ''), file.name)
      reader.readAsText(file)
      return
    }
    const resource = await storeLocalResource(file)
    repairResource(resource.url, file.name, resource.resourceId)
  }

  return (
    <div className="node-hover-toolbar nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="node-hover-toolbar-surface flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5" role="toolbar" aria-label={`${label}节点操作`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${chrome.iconClass}`} title={nodeChromeLabels[mode] || '节点类型'}><Icon className="h-5 w-5" /></span>
        {isEditingName
          ? <input autoFocus value={nameDraft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setNameDraft(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName() } else if (event.key === 'Escape') { event.preventDefault(); setNameDraft(label); setIsEditingName(false) } }} className="nodrag h-8 w-[180px] rounded-md border border-border bg-background px-2 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring" aria-label="节点标题" />
          : <span className="max-w-[180px] cursor-text truncate px-2 text-sm font-semibold text-foreground" title="双击修改节点标题" onDoubleClick={(event) => { event.stopPropagation(); setNameDraft(label); setIsEditingName(true) }}>{label}</span>}
        <span className="mx-1 h-6 w-px bg-border" />
        {resourceLost
          ? <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-50" aria-label="刷新丢失资源" title="刷新丢失资源" onClick={(event) => { event.stopPropagation(); refreshResource() }}><RefreshCw className="h-4 w-4" /></button>
          : <><button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="复制节点" title="复制节点" onClick={(event) => { event.stopPropagation(); duplicateNode(nodeId) }}><Copy className="h-4 w-4" /></button>
            <button type="button" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${isSaved ? 'text-amber-500' : ''}`} aria-label={isSaved ? '取消收藏' : '收藏节点'} title={isSaved ? '取消收藏' : '收藏节点'} onClick={(event) => { event.stopPropagation(); toggleFavorite() }}><Bookmark className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`} /></button></>}
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive" aria-label="关闭并删除节点" title="关闭并删除节点" onClick={(event) => { event.stopPropagation(); deleteNode(nodeId) }}><X className="h-4 w-4" /></button>
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
  const cleanupRef = useRef<(() => void) | null>(null)
  const [isResizing, setIsResizing] = useState(false)

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

    const move = (moveEvent: PointerEvent) => {
      const current = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
      if (!current) return
      const width = Math.max(minWidth, startWidth + moveEvent.clientX - startX)
      const height = Math.max(minHeight, startHeight + moveEvent.clientY - startY)
      useFlowStore.getState().updateNode(nodeId, {
        style: { ...(current.style || {}), width, height },
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      cleanupRef.current = null
      setIsResizing(false)
    }
    cleanupRef.current = stop
    setIsResizing(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div className={`node-resize-arc nodrag nowheel ${isResizing ? 'is-resizing' : ''}`} onPointerDown={startResize} aria-label="调整节点大小">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <path d="M 8 36 C 27 36, 36 27, 36 8" />
      </svg>
    </div>
  )
}
