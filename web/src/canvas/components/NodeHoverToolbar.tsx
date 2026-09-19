import { STICKY_PALETTE, STICKY_COLOR_ORDER } from '@/canvas/sticky-palette'
import { memo, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ClipboardCopy, Copy, Download, Globe, Layers3, Link2Off, Pin, RefreshCw, Scissors, Settings2, Sparkles, Star, StickyNote, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ContentNodeSpec, NodeSpec } from '@/domain'
import { contentNodeText } from '@/domain/content-text'
import { extensionForMimeType, safeFileName, saveBlobToFile } from '@/lib/file-save'
import { assetIdForResource, loadAssetUrl } from '@/storage/asset-store'
import { desktopFetch } from '@/lib/desktop-fetch'
import { useGraphStore } from '@/stores/graph-store'
import { useSourceStore } from '@/stores/use-source-store'
import { documentToLegacyFlow } from '@/canvas/document-legacy'
import { importContentIntoNode } from '@/canvas/content-import-adapter'
import { useCanvasInteraction } from './CanvasProvider'
import { useCanvasViewportStore } from '@/stores/canvas-viewport-store'
import { nodeToolbarHorizontalPlacement, nodeToolbarPlacement, nodeToolbarScaleStyle, selectionToolbarTop } from '@/canvas/toolbar-placement'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { useUiStore } from '@/stores/ui-store'
import type { ContentMediaItem, ContentNodeData } from '@/types/flow'

const KIND_META: Record<NodeSpec['kind'], { icon: LucideIcon; iconClass: string; label: string }> = {
  ai: { icon: Sparkles, iconClass: 'text-violet-600', label: 'AI 节点' },
  request: { icon: Sparkles, iconClass: 'text-primary', label: '请求体' },
  browser: { icon: Globe, iconClass: 'text-cyan-600', label: '浏览器节点' },
  sticky: { icon: StickyNote, iconClass: 'text-amber-600', label: '贴纸' },
  content: { icon: Layers3, iconClass: 'text-blue-600', label: '内容节点' },
  group: { icon: Layers3, iconClass: 'text-muted-foreground', label: '分组' },
}

const FEEDBACK_MS = 1800

function canRestoreContent(node: NodeSpec): boolean {
  return node.kind === 'content' && (node.state === 'missing' || node.state === 'error' || Boolean(node.assetId && !node.payload))
}

function restoredContentFields(data: ContentNodeData): Pick<ContentNodeSpec, 'assetId' | 'content'> {
  const source = data.source
  const assetId = source?.kind === 'file' || source?.kind === 'clipboard-image' ? source.resourceId : undefined
  const content = data.payload?.kind === 'text' ? data.payload.value : source?.kind === 'text' ? source.text : undefined
  return { assetId: content === undefined ? assetId : undefined, content }
}

function stopPointer(event: PointerEvent<HTMLDivElement>): void {
  event.stopPropagation()
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the document command for older or restricted desktop shells.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard-unavailable')
}

function contentAssetId(node: ContentNodeSpec): string | undefined {
  const media = mediaItems(node)[0]
  if (media) return media.resource.resourceId ? assetIdForResource(media.resource.resourceId) : undefined
  if (node.assetId) return node.assetId
  if (node.source?.kind === 'file' || node.source?.kind === 'clipboard-image') return node.source.assetId
  return undefined
}

function contentRemoteUrl(node: ContentNodeSpec): string | undefined {
  const media = mediaItems(node)[0]
  if (media) return media.resource.url || undefined
  if (node.source?.kind === 'url' && node.source.url) return node.source.url
  return undefined
}

function contentMimeType(node: ContentNodeSpec): string | undefined {
  const media = mediaItems(node)[0]
  if (media) return media.resource.mimeType
  if (!node.source) return undefined
  if (node.source.kind === 'file' || node.source.kind === 'clipboard-image' || node.source.kind === 'text') {
    return node.source.mimeType
  }
  return undefined
}

function isMediaContent(node: ContentNodeSpec): boolean {
  if (node.category === 'image' || node.category === 'video') return true
  const mime = contentMimeType(node)
  return Boolean(mime?.startsWith('image/') || mime?.startsWith('video/') || mime?.startsWith('audio/'))
}

function canCopyContentText(node: NodeSpec): node is ContentNodeSpec {
  return node.kind === 'content' && (
    node.category === 'text'
    || node.source?.kind === 'text'
    || typeof node.content === 'string'
    || Boolean(textFromNode(node))
  )
}

function canDownloadContentMedia(node: NodeSpec): node is ContentNodeSpec {
  if (node.kind !== 'content') return false
  if (node.category === 'text') return true
  if (contentAssetId(node)) return true
  return Boolean(contentRemoteUrl(node) && isMediaContent(node))
}

function mediaItems(node: ContentNodeSpec): ContentMediaItem[] {
  const payload = node.payload
  if (!payload || (payload.kind !== 'image' && payload.kind !== 'video')) return []
  return payload.resources || []
}

function textFromNode(node: NodeSpec | undefined): string | undefined {
  if (!node) return undefined
  if (node.kind === 'sticky') return node.content.trim() || undefined
  if (node.kind !== 'content') return undefined
  return contentNodeText(node)
}

function contentImportInput(node: ContentNodeSpec): { kind: 'text'; text: string } | null {
  const source = node.source
  if (!source) return null
  if (source.kind === 'url') return { kind: 'text', text: source.url }
  if (source.kind === 'text') {
    const text = textFromNode(node)
    if (text) return { kind: 'text', text }
  }
  return null
}

function mediaFileName(node: ContentNodeSpec): string {
  const media = mediaItems(node)[0]
  const declaredName = media ? media.resource.fileName : node.source?.kind === 'file' ? node.source.fileName : undefined
  if (declaredName?.trim()) return safeFileName(declaredName)
  const extension = extensionForMimeType(contentMimeType(node))
  const base = safeFileName(node.label || 'media')
  if (!extension || base.toLowerCase().endsWith(`.${extension}`)) return base
  return `${base}.${extension}`
}

function fileExtension(fileName: string): string | undefined {
  const match = fileName.match(/\.([a-z0-9]+)$/i)
  return match?.[1]
}

async function downloadContentMedia(node: ContentNodeSpec): Promise<void> {
  if (node.category === 'text') {
    const payload = node.payload?.kind === 'text' ? node.payload : undefined
    const value = node.content ?? payload?.value ?? ''
    const extension = payload?.format === 'plain' ? 'txt' : 'md'
    const mimeType = extension === 'txt' ? 'text/plain' : 'text/markdown'
    const label = safeFileName(node.label || '内容')
    await saveBlobToFile(new Blob([value], { type: mimeType }), `${label}.${extension}`, {
      description: 'Cnote 文本内容',
      extension: `.${extension}`,
    })
    return
  }
  const assetId = contentAssetId(node)
  const remoteUrl = contentRemoteUrl(node)
  let url: string | null | undefined
  if (assetId) {
    url = await loadAssetUrl(assetId)
  }
  url ||= remoteUrl
  if (!url) throw new Error('media-unavailable')
  const response = await desktopFetch(url)
  if (!response.ok) throw new Error('media-unavailable')
  const blob = await response.blob()
  let fileName = mediaFileName(node)
  const extension = fileExtension(fileName) || extensionForMimeType(blob.type)
  if (!fileExtension(fileName) && extension) fileName = `${fileName}.${extension}`
  await saveBlobToFile(blob, fileName, {
    description: '媒体文件',
    extension: extension ? `.${extension}` : undefined,
  })
}

const HIDDEN_VIEWPORT = { x: 0, y: 0, zoom: 1 }
const EMPTY_NODES: NodeSpec[] = []

export const NodeHoverToolbar = memo(function NodeHoverToolbar({ node, selected }: { node: NodeSpec; selected: boolean }) {
  const { containerSize, hoveredNodeId, setHoveredNode, resizing, draggingNodeIds, worldToScreen, selection } = useCanvasInteraction()
  const [editing, setEditing] = useState(false)
  const visible = node.kind === 'group' ? selected : (selected || hoveredNodeId === node.id)
  const viewport = useCanvasViewportStore(state => visible || editing ? state.view : HIDDEN_VIEWPORT)
  const nodes = useGraphStore(state => visible || editing ? state.currentDocument?.nodes ?? EMPTY_NODES : EMPTY_NODES)
  const updateNode = useGraphStore((state) => state.updateNode)
  const duplicateNode = useGraphStore((state) => state.duplicateNode)
  const deleteNode = useGraphStore((state) => state.deleteNode)
  const isLocked = useGraphStore((state) => state.isLocked)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const overlayInsets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth })
  const dragging = resizing?.nodeId === node.id || draggingNodeIds.includes(node.id)
  const nodeScreenStart = worldToScreen(node.position)
  const nodeScreenEnd = worldToScreen({
    x: node.position.x + node.size.width,
    y: node.position.y + node.size.height,
  })
  const settingsOpen = useUiStore((state) => state.nodeChrome[node.id]?.settings === true)
  const [draft, setDraft] = useState(node.label)
  const [feedback, setFeedback] = useState<{ message: string; tone: 'info' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toolbarWidth, setToolbarWidth] = useState(0)
  const [toolbarHeight, setToolbarHeight] = useState(48)
  const feedbackTimer = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const showCopyText = canCopyContentText(node)
  const showDownloadMedia = canDownloadContentMedia(node)

  useLayoutEffect(() => {
    const element = toolbarRef.current
    if (!element) return
    const update = () => {
      setToolbarWidth(element.offsetWidth)
      setToolbarHeight(element.offsetHeight)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [editing, feedback, showCopyText, showDownloadMedia, node.kind, viewport.zoom])

  const measuredWidth = toolbarWidth > 0 ? toolbarWidth : 288
  const selectionMembers = nodes.filter((candidate) => selection.includes(candidate.id) && candidate.kind !== 'group')
  const selectionTop = selectionMembers.length > 1
    ? Math.min(...selectionMembers.map((candidate) => worldToScreen(candidate.position).y))
    : null
  const safeTop = selected && node.kind !== 'group' && selectionTop !== null
    ? selectionToolbarTop(selectionTop, containerSize.height) + 48
    : 72
  const toolbarLayout = nodeToolbarPlacement(nodeScreenStart.y, nodeScreenEnd.y, toolbarHeight, containerSize.height, safeTop)
  const toolbarPlacement = toolbarLayout.placement
  const toolbarHorizontal = nodeToolbarHorizontalPlacement(
    nodeScreenStart.x, nodeScreenEnd.x, measuredWidth, containerSize.width, overlayInsets,
  )

  const meta = KIND_META[node.kind]
  const Icon = meta.icon
  const label = node.kind === 'request' && node.variant !== 'body' && (!node.label || node.label === '请求体') ? (node.variant === 'image' ? '图片生成' : '视频生成') : node.label || meta.label
  const favorited = Boolean(node.favorite || (node.kind === 'content' && node.sourceId))

  useEffect(() => {
    if (!editing) setDraft(node.label)
  }, [node.label, editing])

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), [])

  const showFeedback = (message: string, tone: 'info' | 'error' = 'info') => {
    window.clearTimeout(feedbackTimer.current)
    setFeedback({ message, tone })
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), tone === 'error' ? 6000 : FEEDBACK_MS)
  }

  const commitLabel = () => {
    const nextLabel = draft.trim()
    if (nextLabel && nextLabel !== node.label) {
      updateNode(node.id, { label: nextLabel })
      useGraphStore.getState().commitHistory()
    } else {
      setDraft(label)
    }
    setEditing(false)
  }

  const cancelLabel = () => {
    setDraft(label)
    setEditing(false)
  }

  const onLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitLabel()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelLabel()
    }
  }

  const toggleFavorite = () => {
    if (node.kind === 'content') {
      const createSource = useSourceStore.getState().createSource
      const deleteSource = useSourceStore.getState().deleteSource
      if (node.sourceId) {
        deleteSource(node.sourceId)
        updateNode(node.id, { sourceId: undefined, favorite: false })
        useGraphStore.getState().commitHistory()
        return
      }
      const legacy = documentToLegacyFlow({
        id: 'library-snapshot',
        name: node.label,
        title: node.label,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [node],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const data = (legacy.nodes[0]?.data || {}) as ContentNodeData
      const source = createSource(label, { ...data, sourceId: undefined })
      updateNode(node.id, { sourceId: source.id, favorite: true })
      useGraphStore.getState().commitHistory()
      return
    }
    updateNode(node.id, { favorite: !favorited })
    useGraphStore.getState().commitHistory()
  }

  const copyContentText = async () => {
    if (busy || !canCopyContentText(node)) return
    const text = textFromNode(node) ?? ''
    if (!text.trim()) {
      showFeedback('没有可复制的文本')
      return
    }
    setBusy(true)
    try {
      await copyText(text)
    } catch {
      showFeedback('复制失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloadMedia = async () => {
    if (busy || !canDownloadContentMedia(node)) return
    setBusy(true)
    try {
      await downloadContentMedia(node)
    } catch (error) {
      if (!isAbortError(error)) showFeedback('下载失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const refreshFromUpstream = async () => {
    if (busy || node.kind !== 'content') return
    const document = useGraphStore.getState().currentDocument
    const upstream = document?.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => document.nodes.find((candidate) => candidate.id === edge.source))
      .map(textFromNode)
      .find(Boolean)
    if (!upstream) {
      showFeedback('上游没有可用文本')
      return
    }
    setBusy(true)
    try {
      await importContentIntoNode(node.id, { kind: 'text', text: upstream })
      showFeedback('已重新获取上游文本')
    } catch {
      showFeedback('重新获取失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const reparseContent = async () => {
    if (busy || node.kind !== 'content') return
    const input = contentImportInput(node)
    setBusy(true)
    try {
      if (input) {
        const parsed = await importContentIntoNode(node.id, input, node.category, { preserveOnFailure: true })
        showFeedback(parsed.partial ? '已更新可识别内容，部分信息未获取' : '已重新识别内容')
      } else if (node.source?.kind === 'file' || node.source?.kind === 'clipboard-image') {
        const url = await loadAssetUrl(node.source.assetId)
        if (!url) throw new Error('resource-unavailable')
        const response = await fetch(url)
        if (!response.ok) throw new Error('resource-unavailable')
        const blob = await response.blob()
        const parsed = await importContentIntoNode(node.id, {
          kind: 'file',
          file: blob,
          fileName: node.source.kind === 'file' ? node.source.fileName : 'clipboard-image',
          clipboardImage: node.source.kind === 'clipboard-image',
        }, node.category, { preserveOnFailure: true })
        showFeedback(parsed.partial ? '已更新可识别内容，部分信息未获取' : '已重新识别内容')
      } else {
        throw new Error('source-unavailable')
      }
    } catch {
      showFeedback('重新识别失败，已保留原内容', 'error')
    } finally {
      setBusy(false)
    }
  }

  const restoreMissingResource = () => {
    if (node.kind !== 'content') return
    if (node.sourceId) {
      const source = useSourceStore.getState().getSource(node.sourceId)
      if (source) {
        const sourceData = source.nodeData
        updateNode(node.id, {
          category: sourceData.category,
          subtype: sourceData.subtype,
          source: sourceData.source?.kind === 'url'
            ? { kind: 'url', url: sourceData.source.normalizedUrl, provider: sourceData.source.provider }
            : sourceData.source?.kind === 'text'
              ? { kind: 'text', mimeType: sourceData.source.mimeType }
              : sourceData.source?.kind === 'file'
                ? { kind: 'file', assetId: sourceData.source.resourceId, mimeType: sourceData.source.mimeType, fileName: sourceData.source.fileName }
                : sourceData.source?.kind === 'clipboard-image'
                  ? { kind: 'clipboard-image', assetId: sourceData.source.resourceId, mimeType: sourceData.source.mimeType }
                  : null,
          ...restoredContentFields(sourceData),
          payload: sourceData.payload,
          preview: sourceData.preview,
          state: sourceData.state,
          parse: sourceData.parse,
        } as Partial<NodeSpec>)
        useGraphStore.getState().commitHistory()
        showFeedback('已从资料库恢复')
        return
      }
    }
    fileInputRef.current?.click()
  }

  const handleRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || node.kind !== 'content') return
    setBusy(true)
    try {
      await importContentIntoNode(node.id, { kind: 'file', file, fileName: file.name }, node.category, { preserveOnFailure: true })
      showFeedback('资源已恢复')
    } catch {
      showFeedback('恢复资源失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const splitMedia = () => {
    if (useGraphStore.getState().splitMediaNode(node.id)) showFeedback('已拆分媒体资源')
  }

  const document = useGraphStore.getState().currentDocument
  const showRefreshUpstream = node.kind === 'content' && Boolean(document?.edges.some((edge) => edge.target === node.id && textFromNode(document.nodes.find((candidate) => candidate.id === edge.source))))
  const showSplitMedia = node.kind === 'content' && !node.generationBatch && mediaItems(node).length > 1
  const showReparse = node.kind === 'content' && !node.generationBatch && Boolean(node.source)
  const showRestore = canRestoreContent(node)

  return (
    <div
      data-canvas-chrome="true"
      ref={toolbarRef}
      className={[
        'node-hover-toolbar absolute z-50',
        (visible || editing) && !dragging ? 'is-visible' : '',
      ].join(' ')}
      data-placement={toolbarPlacement}
      style={{
        top: (toolbarLayout.anchor - nodeScreenStart.y) / viewport.zoom,
        left: (toolbarHorizontal.left - nodeScreenStart.x) / viewport.zoom,
        width: 'max-content',
        maxWidth: toolbarHorizontal.maxWidth,
        ...nodeToolbarScaleStyle(viewport.zoom, toolbarPlacement),
      }}
      data-horizontal="left"
      onPointerDown={stopPointer}
      onPointerEnter={() => setHoveredNode(node.id)}
      onPointerLeave={(event) => {
        const related = event.relatedTarget
        if (related instanceof Element && (related.closest(`[data-node-id="${node.id}"]`) || related.closest(`[data-content-node="${node.id}"]`))) return
        setHoveredNode(null)
      }}
      role="toolbar"
      aria-label={`${label}节点操作`}
    >
      <div className="cnote-toolbar-surface node-hover-toolbar-surface flex min-h-10 max-w-full flex-wrap items-center gap-0.5 overflow-visible px-1.5 py-1">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center ${meta.iconClass}`} title={meta.label}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            aria-label="节点标题"
            className="nodrag h-8 w-40 rounded-md border border-border bg-background px-2 text-sm font-semibold text-foreground outline-none focus:ring-1 focus:ring-ring"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitLabel}
            onKeyDown={onLabelKeyDown}
          />
        ) : (
          <button
            type="button"
            className="nodrag max-w-40 truncate rounded-md px-1.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
            title="双击修改节点标题"
            onDoubleClick={(event) => {
              event.stopPropagation()
              setDraft(label)
              setEditing(true)
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {label}
          </button>
        )}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        {node.kind === 'ai' && <div data-ai-toolbar={node.id} className="flex min-w-0 items-center" />}
        {node.kind === 'content' && node.category === 'text' && (
          <ToolbarButton label="文本格式设置" pressed={settingsOpen} onClick={() => useUiStore.getState().setNodeChrome(node.id, { settings: !settingsOpen })}>
            <Settings2 className="h-4 w-4" />
          </ToolbarButton>
        )}
        {node.kind === 'sticky' && (
          <div className="flex items-center" role="group" aria-label="便签颜色">
            {STICKY_COLOR_ORDER.map(color => (
              <ToolbarButton key={color} label={'切换为' + STICKY_PALETTE[color].label + '便签'} pressed={node.color === color} disabled={isLocked} onClick={() => {
                if (node.color === color) return
                updateNode(node.id, { color } as Partial<NodeSpec>)
                useGraphStore.getState().commitHistory()
              }}>
                <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: STICKY_PALETTE[color].fill, boxShadow: node.color === color ? '0 0 0 2px ' + STICKY_PALETTE[color].border : undefined }} />
              </ToolbarButton>
            ))}
          </div>
        )}
        {node.kind === 'group' ? (
          <ToolbarButton label="解绑" disabled={isLocked} onClick={() => useGraphStore.getState().ungroup(node.id)}>
            <Link2Off className="h-4 w-4" />
          </ToolbarButton>
        ) : (
          <>
            <ToolbarButton
              label={favorited ? '取消收藏' : '收藏'}
              pressed={favorited}
              onClick={toggleFavorite}
            >
              <Star className={`h-4 w-4 ${favorited ? 'text-amber-500' : ''}`} fill={favorited ? 'currentColor' : 'none'} />
            </ToolbarButton>
            {showCopyText ? (
              <ToolbarButton label="复制文本" disabled={busy} onClick={() => void copyContentText()}>
                <ClipboardCopy className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
            {showDownloadMedia ? (
              <ToolbarButton label={node.kind === 'content' && node.category === 'text' ? '下载内容' : '下载媒体'} disabled={busy} onClick={() => void downloadMedia()}>
                <Download className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
            {showRefreshUpstream ? (
              <ToolbarButton label="重新获取上游文本" disabled={busy} onClick={() => void refreshFromUpstream()}>
                <RefreshCw className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
            {showSplitMedia ? (
              <ToolbarButton label="拆分媒体资源" disabled={busy || isLocked} onClick={splitMedia}>
                <Scissors className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
            {showReparse ? (
              <ToolbarButton label="重新识别内容" disabled={busy} onClick={() => void reparseContent()}>
                <RefreshCw className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
            {showRestore ? (
              <ToolbarButton label="刷新丢失资源" disabled={busy} onClick={restoreMissingResource}>
                <RefreshCw className="h-4 w-4 text-destructive" />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="复制节点" disabled={isLocked} onClick={() => duplicateNode(node.id)}>
              <Copy className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton label="关闭并删除节点" disabled={isLocked} destructive onClick={() => deleteNode(node.id)}>
              <Trash2 className="h-4 w-4" />
            </ToolbarButton>
            {node.kind === 'sticky' ? (
              <ToolbarButton
                label={node.pinned ? '取消钉住贴纸' : '钉住贴纸'}
                pressed={Boolean(node.pinned)}
                onClick={() => {
                  updateNode(node.id, { pinned: !node.pinned } as Partial<NodeSpec>)
                  useGraphStore.getState().commitHistory()
                }}
              >
                <Pin className="h-4 w-4" fill={node.pinned ? 'currentColor' : 'none'} />
              </ToolbarButton>
            ) : null}
            {feedback ? (
              <span
                className={`max-w-32 truncate px-1.5 text-xs ${feedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                title={feedback.message}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {feedback.message}
              </span>
            ) : null}
            <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleRestoreFile(event)} />
          </>
        )}
      </div>
    </div>
  )
})

function ToolbarButton({
  label,
  onClick,
  destructive = false,
  pressed = false,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed || undefined}
      disabled={disabled}
      className={[
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        destructive ? 'hover:text-destructive' : '',
        pressed ? 'text-foreground' : '',
      ].join(' ')}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}
