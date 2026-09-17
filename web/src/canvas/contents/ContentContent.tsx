/**
 * 内容节点：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 */

import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FileUp,
  Image as ImageIcon,
  Maximize2,
  Presentation,
  Share2,
  Table2,
  Video,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { chooseContentCategory, importContentIntoNode } from '@/canvas/content-import-adapter'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useCanvas } from '@/canvas/components/CanvasProvider'
import type { ContentCategory, ContentNodeSpec, ContentSourceRef, NodeSpec } from '@/domain'
import { CONTENT_FILE_ACCEPT, CONTENT_FILE_ACCEPT_BY_CATEGORY, getContentFileAccept } from '@/lib/content-import'
import { CONTENT_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { showMessage } from '@/lib/app-dialog'
import { AssetManager } from '@/runtime'
import { assetIdForResource } from '@/storage/asset-store'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useUiStore } from '@/stores/ui-store'
import type {
  ContentMediaItem,
  DataPayload,
  DocumentPayload,
  MindmapPayload,
  MindmapTreeNode,
  PresentationPayload,
  SocialPayload,
  VideoPayload,
} from '@/types/flow'

const assetManager = new AssetManager()

interface CategoryOption {
  id: ContentCategory
  label: string
  icon: LucideIcon
  iconClass: string
}

const contentCategoryOptions: CategoryOption[] = [
  { id: 'text', label: '文本', icon: AlignLeft, iconClass: 'text-slate-500' },
  { id: 'video', label: '视频', icon: Video, iconClass: 'text-red-500' },
  { id: 'social', label: '社媒', icon: Share2, iconClass: 'text-pink-500' },
  { id: 'image', label: '图片', icon: ImageIcon, iconClass: 'text-cyan-500' },
  { id: 'document', label: '文档', icon: FileText, iconClass: 'text-blue-500' },
  { id: 'mindmap', label: '思维导图', icon: Workflow, iconClass: 'text-violet-500' },
  { id: 'presentation', label: '演示文稿', icon: Presentation, iconClass: 'text-orange-500' },
  { id: 'data', label: '数据', icon: Table2, iconClass: 'text-emerald-500' },
]

export interface ContentContentProps {
  node: ContentNodeSpec
}

function stopNodeGesture(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function patchContent(id: string, patch: Partial<ContentNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

function openContentEditor(nodeId: string): void {
  const graph = useGraphStore.getState()
  const node = graph.currentDocument?.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.kind !== 'content' || (node.category !== 'text' && node.category !== 'mindmap')) return
  graph.setSelection([nodeId])
  const ui = useUiStore.getState()
  ui.setSelectedEdgeId(null)
  ui.setShowExtensionPanel(true)
}

function sourceUrl(source: ContentSourceRef | null): string | undefined {
  if (source?.kind === 'url' && source.url) return source.url
  return undefined
}

function sourceAssetId(source: ContentSourceRef | null): string | undefined {
  if (source?.kind === 'file' || source?.kind === 'clipboard-image') return source.assetId
  return undefined
}

const MEDIA_RESOURCE_TYPE = 'application/x-cnote-media-resource'

function selectMediaResource(nodeId: string, index: number): void {
  const graph = useGraphStore.getState()
  const node = graph.currentDocument?.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.kind !== 'content' || !Number.isInteger(index)) return
  const payload = node.payload
  if (!payload || (payload.kind !== 'image' && payload.kind !== 'video') || !payload.resources?.[index]) return
  if (payload.activeResourceIndex === index) return
  graph.updateNode(nodeId, { payload: { ...payload, activeResourceIndex: index } })
  graph.commitHistory()
}

function droppedMediaIndex(value: string, node: ContentNodeSpec): number | null {
  try {
    const dropped = JSON.parse(value) as { nodeId?: string; kind?: string; index?: number } | null
    const payload = node.payload
    if (!dropped || dropped.nodeId !== node.id || dropped.kind !== node.category || !Number.isInteger(dropped.index)) return null
    if (!payload || (payload.kind !== 'image' && payload.kind !== 'video') || !payload.resources?.[dropped.index!]) return null
    return dropped.index!
  } catch {
    return null
  }
}

function mediaSourceFor(node: ContentNodeSpec): { assetId?: string; remoteUrl: string | null } {
  const payload = node.payload
  if (payload && (payload.kind === 'image' || payload.kind === 'video') && payload.resources?.length) {
    const index = Number.isInteger(payload.activeResourceIndex)
      ? Math.max(0, Math.min(payload.resources.length - 1, payload.activeResourceIndex!))
      : 0
    const resource = payload.resources[index].resource
    return {
      assetId: resource.resourceId ? assetIdForResource(resource.resourceId) : undefined,
      remoteUrl: resource.url || null,
    }
  }
  return {
    assetId: node.assetId ?? sourceAssetId(node.source),
    remoteUrl: payload?.kind === 'video'
      ? payload.url || sourceUrl(node.source) || null
      : sourceUrl(node.source) ?? node.preview?.thumbnailUrl ?? null,
  }
}

function useResolvedMediaSrc(node: ContentNodeSpec): { src: string | null; loading: boolean } {
  const { assetId, remoteUrl } = mediaSourceFor(node)
  const assetHash = useRuntimeStore((state) => (assetId ? state.assets[assetId]?.hash : undefined))
  const sourceKey = JSON.stringify([assetId, remoteUrl, assetHash])
  const [resolved, setResolved] = useState<{ key: string; src: string | null; loading: boolean }>({ key: sourceKey, src: remoteUrl, loading: Boolean(assetId) })

  useEffect(() => {
    let cancelled = false
    if (!assetId) {
      setResolved({ key: sourceKey, src: remoteUrl, loading: false })
      return () => { cancelled = true }
    }
    setResolved({ key: sourceKey, src: remoteUrl, loading: true })
    void (async () => {
      try {
        await assetManager.getAsset(assetId)
        const resolved = await assetManager.resolveAssetUrl(assetId)
        if (!cancelled) setResolved({ key: sourceKey, src: resolved ?? remoteUrl, loading: false })
      } catch {
        if (!cancelled) setResolved({ key: sourceKey, src: remoteUrl, loading: false })
      }
    })()
    return () => { cancelled = true }
  }, [assetId, sourceKey, remoteUrl])

  return resolved.key === sourceKey ? resolved : { src: remoteUrl, loading: Boolean(assetId) }
}

function MediaEmpty({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-3">
      <p className="text-xs text-muted-foreground" title={label}>{label}</p>
    </div>
  )
}

function ImportEmpty({ node, description }: { node: ContentNodeSpec; description: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const accept = getContentFileAccept(node.category)

  const runImport = async (input: { kind: 'file'; file: File } | { kind: 'text'; text: string }) => {
    setBusy(true)
    try {
      await importContentIntoNode(node.id, input, node.category)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '导入失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-6 text-center" onPointerDown={stopNodeGesture}>
      <p className="text-sm text-muted-foreground">{description}</p>
      <button
        type="button"
        disabled={busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
        onClick={() => {
          if (!inputRef.current) return
          inputRef.current.accept = accept || CONTENT_FILE_ACCEPT
          inputRef.current.value = ''
          inputRef.current.click()
        }}
      >
        <FileUp className="h-3.5 w-3.5" />
        选择文件
      </button>
      <textarea
        value={draft}
        disabled={busy}
        rows={3}
        placeholder="粘贴链接或文本后回车导入"
        className="w-full max-w-md resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-foreground/30"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && draft.trim()) {
            event.preventDefault()
            void runImport({ kind: 'text', text: draft })
          }
        }}
      />
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void runImport({ kind: 'file', file })
        }}
      />
    </div>
  )
}

function TextBody({ node }: { node: ContentNodeSpec }) {
  const showFormatting = useUiStore((state) => state.nodeChrome[node.id]?.settings === true)
  const textPayload = node.payload?.kind === 'text' ? node.payload : undefined
  const [content, setContent] = useState(textPayload?.value ?? node.content ?? '')

  useEffect(() => {
    setContent(textPayload?.value ?? node.content ?? '')
  }, [node.content, textPayload?.value])

  return (
    <>
      <div className="flex shrink-0 items-center px-3 py-1.5">
        <span className="min-w-0 truncate text-xs font-medium text-foreground" title={node.label}>{node.label || '文本'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3" onPointerDown={stopNodeGesture}>
        <RichTextEditor
          key={node.id}
          value={content}
          toolbar={showFormatting}
          markdownSource
          onChange={(value) => {
            setContent(value)
            patchContent(node.id, { content: value, payload: { kind: 'text', value, format: 'markdown' } })
          }}
          onCommit={() => useGraphStore.getState().commitHistory()}
          placeholder="添加内容..."
          className="h-full"
        />
      </div>
    </>
  )
}

function ImageBody({ node }: { node: ContentNodeSpec }) {
  const { src, loading } = useResolvedMediaSrc(node)
  if (loading && !src) return <MediaEmpty label="图片加载中" />
  if (!src) return <ImportEmpty node={node} description="导入图片，或粘贴图片链接" />
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-muted/20" onPointerDown={stopNodeGesture}>
      <img src={src} alt={node.label || '图片'} className="h-full w-full object-contain" draggable={false} />
    </div>
  )
}

function youtubeId(url?: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const host = parsed.hostname.toLowerCase()
    const segments = parsed.pathname.split('/').filter(Boolean)
    const isYoutube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
    const id = host === 'youtu.be'
      ? segments[0]
      : isYoutube
        ? (['shorts', 'embed', 'live', 'v'].includes(segments[0]) ? segments[1] : parsed.searchParams.get('v'))
        : null
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

function VideoBody({ node }: { node: ContentNodeSpec }) {
  const video = node.payload?.kind === 'video' ? node.payload as VideoPayload : undefined
  const { src, loading } = useResolvedMediaSrc(node)
  const hasMediaResources = Boolean(video?.resources?.length)
  const playbackUrl = hasMediaResources ? src : src || video?.url || sourceUrl(node.source)
  const embedId = !hasMediaResources && video?.provider === 'youtube' ? youtubeId(video.url || sourceUrl(node.source)) : null
  if (embedId) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden bg-black" onPointerDown={stopNodeGesture}>
        <iframe
          title={video?.title || node.label || 'YouTube'}
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(embedId)}?playsinline=1`}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  if (loading && !playbackUrl) return <MediaEmpty label="视频加载中" />
  if (!playbackUrl) return <ImportEmpty node={node} description="导入视频文件，或粘贴视频链接" />
  if (!hasMediaResources && video?.playback === 'audio' && src) {
    return (
      <div className="flex min-h-0 flex-1 items-center px-3" onPointerDown={stopNodeGesture} onWheel={stopNodeGesture}>
        <audio src={src} controls preload="metadata" className="w-full" aria-label={video.title || node.label || '音频'} />
      </div>
    )
  }
  if ((!hasMediaResources && video?.playback === 'preview') || !src) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" onPointerDown={stopNodeGesture}>
        {node.preview?.thumbnailUrl && <img src={node.preview.thumbnailUrl} alt="" className="h-40 w-full rounded-lg object-cover" />}
        <div className="text-sm font-medium text-foreground">{video?.title || node.preview?.title || node.label}</div>
        {node.preview?.description && <p className="text-xs leading-5 text-muted-foreground">{node.preview.description}</p>}
        <a href={playbackUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />打开视频
        </a>
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-black" onPointerDown={stopNodeGesture}>
      <video src={playbackUrl} className="h-full w-full object-contain" controls playsInline preload="metadata" />
    </div>
  )
}

function DocumentBody({ node }: { node: ContentNodeSpec }) {
  const documentPayload = node.payload?.kind === 'document' ? node.payload as DocumentPayload : undefined
  const text = documentPayload?.plainText || documentPayload?.rawText || node.content
  if (!text) return <ImportEmpty node={node} description="导入 PDF、Word 或 Markdown 文档" />
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" onPointerDown={stopNodeGesture}>
      <div className="mb-3 text-sm font-medium text-foreground">{node.preview?.title || node.label || '文档'}</div>
      {documentPayload?.headings?.length ? (
        <div className="mb-3 space-y-1 text-xs text-muted-foreground">
          {documentPayload.headings.slice(0, 8).map((heading, index) => (
            <div key={`${heading.text}-${index}`} style={{ paddingLeft: (heading.level - 1) * 8 }}>{heading.text}</div>
          ))}
        </div>
      ) : null}
      <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">{text}</pre>
    </div>
  )
}

function DataBody({ node }: { node: ContentNodeSpec }) {
  const data = node.payload?.kind === 'data' ? node.payload as DataPayload : undefined
  const sheet = data?.sheets[0]
  if (!sheet || (!sheet.columns.length && !sheet.rows.length)) {
    return <ImportEmpty node={node} description="导入 CSV 或 XLSX 表格" />
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" onPointerDown={stopNodeGesture}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {sheet.name} · {sheet.totalRows} 行{sheet.truncated ? '（已截断）' : ''}
      </div>
      <table className="w-max min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {sheet.columns.map((column) => (
              <th key={column} className="border border-border bg-muted/50 px-2 py-1 text-left font-semibold text-foreground">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.slice(0, 80).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {sheet.columns.map((column, columnIndex) => (
                <td key={`${rowIndex}-${column}`} className="border border-border px-2 py-1 text-foreground">{String(row[columnIndex] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PresentationBody({ node }: { node: ContentNodeSpec }) {
  const presentation = node.payload?.kind === 'presentation' ? node.payload as PresentationPayload : undefined
  if (!presentation || !(presentation.slides?.length || presentation.outline?.length)) {
    return <ImportEmpty node={node} description="导入 PPTX 演示文稿" />
  }
  const slides = presentation.slides || presentation.outline?.map((title, index) => ({ index: index + 1, title, text: '' })) || []
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" onPointerDown={stopNodeGesture}>
      <div className="mb-3 text-sm font-medium text-foreground">{presentation.title || node.label || '演示文稿'}</div>
      <ol className="space-y-3">
        {slides.map((slide) => (
          <li key={slide.index} className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="text-xs font-semibold text-muted-foreground">第 {slide.index} 页</div>
            <div className="mt-1 text-sm font-medium text-foreground">{slide.title || `第 ${slide.index} 页`}</div>
            {slide.text && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{slide.text}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function limitMindmapTree(root: MindmapTreeNode, maxNodes = 60, maxDepth = 5): MindmapTreeNode {
  let remaining = maxNodes
  const visit = (node: MindmapTreeNode, depth: number): MindmapTreeNode | null => {
    if (remaining <= 0) return null
    remaining -= 1
    const children = depth >= maxDepth
      ? []
      : node.children.slice(0, 8).flatMap((child) => {
          const next = visit(child, depth + 1)
          return next ? [next] : []
        })
    return { ...node, children }
  }
  return visit(root, 0) || { ...root, children: [] }
}

function countMindmapNodes(node: MindmapTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + countMindmapNodes(child), 0)
}

function MindmapNodeCard({ node, depth, root = false }: { node: MindmapTreeNode; depth: number; root?: boolean }) {
  const levelLabel = depth === 1 ? '主分支' : depth === 2 ? '子项' : `${Math.max(depth - 1, 1)} 级子项`
  return (
    <div className={`mindmap-node-card ${root ? 'mindmap-node-card-root' : `mindmap-node-card-depth-${Math.min(depth, 4)}`}`}>
      <div className="mindmap-node-kicker">{root ? <><Workflow className="h-3.5 w-3.5" />中心主题</> : levelLabel}</div>
      <div className="mindmap-node-text">{node.text || '未命名主题'}</div>
      {node.children.length > 0 && <div className="mindmap-node-count">{node.children.length} 个下级主题</div>}
    </div>
  )
}

function MindmapBranchList({ nodes, depth, side }: { nodes: MindmapTreeNode[]; depth: number; side: 'left' | 'right' }) {
  return (
    <div className={`mindmap-branch-list mindmap-branch-list-${side} mindmap-branch-list-depth-${Math.min(depth, 4)}`}>
      {nodes.map((item) => (
        <div key={item.id} className={`mindmap-branch mindmap-branch-${side} ${item.children.length > 0 ? 'mindmap-branch-has-children' : ''}`}>
          <MindmapNodeCard node={item} depth={depth} />
          {item.children.length > 0 && <MindmapBranchList nodes={item.children} depth={depth + 1} side={side} />}
        </div>
      ))}
    </div>
  )
}

function MindmapBody({ node }: { node: ContentNodeSpec }) {
  const mindmap = node.payload?.kind === 'mindmap' ? node.payload as MindmapPayload : undefined
  const limited = useMemo(() => (mindmap ? limitMindmapTree(mindmap.root) : null), [mindmap])
  if (!limited) return <ImportEmpty node={node} description="导入 Markdown 思维导图，或粘贴大纲文本" />
  const totalNodes = countMindmapNodes(limited)
  const leftCount = Math.floor(limited.children.length / 2)
  const leftNodes = limited.children.slice(0, leftCount).reverse()
  const rightNodes = limited.children.slice(leftCount)
  return (
    <div className="mindmap-scroll-area" onPointerDown={stopNodeGesture}>
      <div className="mindmap-map">
        <div className="mindmap-map-header">
          <span className="mindmap-map-label">结构地图</span>
          <span>{totalNodes} 个主题 · {limited.children.length} 个主分支</span>
        </div>
        <div className="mindmap-map-layout">
          <div className={`mindmap-map-side mindmap-map-side-left ${leftNodes.length ? 'mindmap-map-side-has-branches' : ''}`}>
            {leftNodes.length > 0 && <MindmapBranchList nodes={leftNodes} depth={1} side="left" />}
          </div>
          <div className="mindmap-root-wrap"><MindmapNodeCard node={limited} depth={0} root /></div>
          <div className={`mindmap-map-side mindmap-map-side-right ${rightNodes.length ? 'mindmap-map-side-has-branches' : ''}`}>
            {rightNodes.length > 0 && <MindmapBranchList nodes={rightNodes} depth={1} side="right" />}
          </div>
        </div>
        {limited.children.length === 0 && <div className="mindmap-map-empty">在大纲中添加主分支，即可展开结构</div>}
      </div>
    </div>
  )
}

type SocialMediaEntry = { type: 'image' | 'video'; item: ContentMediaItem }

function socialMediaItemsOf(social: SocialPayload): SocialMediaEntry[] {
  return social.contentBlocks.flatMap<SocialMediaEntry>((block) => {
    if (block.type === 'image') return [{ type: 'image', item: { resource: block.resource, label: block.caption } }]
    if (block.type === 'video') return [{ type: 'video', item: { resource: block.resource, poster: block.poster } }]
    return []
  })
}

function maxMediaAspectRatio(items: SocialMediaEntry[]): number {
  let max = 1
  for (const entry of items) {
    const width = entry.item.resource.width
    const height = entry.item.resource.height
    if (width && height) max = Math.max(max, height / width)
  }
  return max
}

function SocialMediaCarousel({
  items,
  activeIndex,
  onActiveIndexChange,
}: {
  items: SocialMediaEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  if (!items.length) return null
  const index = Math.min(Math.max(activeIndex, 0), items.length - 1)
  const active = items[index]
  if (!active) return null
  const previous = () => onActiveIndexChange((index - 1 + items.length) % items.length)
  const next = () => onActiveIndexChange((index + 1) % items.length)
  const aspect = Math.min(Math.max(maxMediaAspectRatio(items), 0.75), 1.65)
  return (
    <section className="select-none" onPointerDown={stopNodeGesture} onWheel={(event) => event.stopPropagation()}>
      <div
        className="group/media relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/30"
        style={{ aspectRatio: `1 / ${aspect}` }}
      >
        {active.type === 'video' ? (
          <video
            src={active.item.resource.url}
            poster={active.item.poster?.url}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
            onPointerDown={stopNodeGesture}
          />
        ) : (
          <img src={active.item.resource.url} alt={active.item.label || ''} className="h-full w-full object-contain" draggable={false} />
        )}
        {items.length > 1 && (
          <>
            <button
              type="button"
              className="pointer-events-none absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover/media:pointer-events-auto group-hover/media:opacity-100"
              onClick={previous}
              aria-label="上一张媒体"
              title="上一张媒体"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="pointer-events-none absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover/media:pointer-events-auto group-hover/media:opacity-100"
              onClick={next}
              aria-label="下一张媒体"
              title="下一张媒体"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
              {index + 1} / {items.length}
            </span>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {items.map((entry, itemIndex) => (
            <button
              key={`${entry.item.resource.url}-${itemIndex}`}
              type="button"
              className={`h-1.5 w-1.5 rounded-full ${itemIndex === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground'}`}
              aria-label={`显示第 ${itemIndex + 1} 个媒体`}
              onClick={() => onActiveIndexChange(itemIndex)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SocialBody({ node }: { node: ContentNodeSpec }) {
  const social = node.payload?.kind === 'social' ? node.payload as SocialPayload : undefined
  const surfaceRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [mediaIndex, setMediaIndex] = useState(0)
  const items = useMemo(() => (social ? socialMediaItemsOf(social) : []), [social])

  useEffect(() => {
    setMediaIndex((current) => Math.min(current, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    if (!social || node.manualSize) return
    const surface = surfaceRef.current
    const content = contentRef.current
    if (!surface || !content) return
    let frame: number | null = null
    const fit = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const current = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === node.id)
        if (!current || current.kind !== 'content' || current.manualSize) return
        const style = window.getComputedStyle(surface)
        const paddingY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
        const targetHeight = Math.max(CONTENT_NODE_MIN_SIZE.height, Math.ceil(content.scrollHeight + paddingY + 2))
        if (Math.abs(current.size.height - targetHeight) <= 1) return
        useGraphStore.getState().updateNode(node.id, { size: { ...current.size, height: targetHeight } })
      })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(content)
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [items.length, node.id, node.manualSize, social])

  if (!social || (!social.title && !social.bodyText && !social.canonicalUrl && items.length === 0)) {
    return <ImportEmpty node={node} description="粘贴社媒链接以识别内容" />
  }

  const extraText = social.contentBlocks.filter((block) => (
    block.type === 'text' && block.text.trim() && block.text.trim() !== social.bodyText.trim()
  ))
  const links = social.contentBlocks.filter((block) => block.type === 'mention' || block.type === 'link')

  return (
    <div ref={surfaceRef} className="min-h-0 flex-1 overflow-auto p-4" onPointerDown={stopNodeGesture}>
      <div ref={contentRef} className="space-y-3">
        {items.length > 0 ? (
          <SocialMediaCarousel items={items} activeIndex={mediaIndex} onActiveIndexChange={setMediaIndex} />
        ) : node.preview?.thumbnailUrl ? (
          <img src={node.preview.thumbnailUrl} alt="" className="h-36 w-full rounded-lg object-cover" />
        ) : null}
        <div className="text-lg font-medium leading-7 text-foreground">{social.title || node.label}</div>
        {social.author?.name && <div className="text-xs text-muted-foreground">{social.author.name}</div>}
        {social.bodyText && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{social.bodyText}</p>}
        {extraText.map((block, index) => block.type === 'text' ? (
          <p key={`text-${index}`} className="whitespace-pre-wrap text-sm leading-6 text-foreground">{block.text}</p>
        ) : null)}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {links.map((block, index) => {
              if (block.type === 'mention') {
                return <span key={`mention-${index}`} className="text-muted-foreground">@{block.name}</span>
              }
              if (block.type === 'link') {
                return (
                  <a key={`link-${index}`} href={block.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground hover:underline">
                    {block.title || block.url}
                  </a>
                )
              }
              return null
            })}
          </div>
        )}
        {social.canonicalUrl && (
          <a href={social.canonicalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />打开原文
          </a>
        )}
      </div>
    </div>
  )
}

function CategoryPicker({ node }: { node: ContentNodeSpec }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingCategory = useRef<ContentCategory | null>(null)

  const choose = (category: ContentCategory) => {
    if (category === 'presentation' || category === 'data' || category === 'image') {
      pendingCategory.current = category
      if (inputRef.current) {
        inputRef.current.accept = CONTENT_FILE_ACCEPT_BY_CATEGORY[category]
        inputRef.current.value = ''
        inputRef.current.click()
      }
      if (category !== 'image') return
    }
    chooseContentCategory(node.id, category)
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-12 py-7" onPointerDown={stopNodeGesture}>
      <div className="w-full">
        <h3 className="mb-4 text-center text-lg font-semibold text-foreground">选择内容类型</h3>
        <div className="grid grid-cols-3 gap-3">
          {contentCategoryOptions.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => choose(option.id)}
                className="flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
              >
                <Icon className={`h-7 w-7 stroke-[1.8] ${option.iconClass}`} />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const category = pendingCategory.current
          event.target.value = ''
          pendingCategory.current = null
          if (!file) return
          if (category === 'presentation' || category === 'data') chooseContentCategory(node.id, category)
          void importContentIntoNode(node.id, { kind: 'file', file }, category).catch((error) => {
            showMessage(error instanceof Error ? error.message : '导入失败，请稍后重试。')
          })
        }}
      />
    </div>
  )
}

function LeafBody({ node }: { node: ContentNodeSpec }) {
  switch (node.category) {
    case 'text':
      return <TextBody node={node} />
    case 'image':
      return <ImageBody node={node} />
    case 'video':
      return <VideoBody node={node} />
    case 'document':
      return <DocumentBody node={node} />
    case 'data':
      return <DataBody node={node} />
    case 'presentation':
      return <PresentationBody node={node} />
    case 'mindmap':
      return <MindmapBody node={node} />
    case 'social':
      return <SocialBody node={node} />
    default:
      return <ImportEmpty node={node} description="导入或粘贴内容" />
  }
}

export const ContentContent = memo(function ContentContent({ node }: ContentContentProps) {
  const { hoveredNodeId, selection } = useCanvas()
  const editorVisible = hoveredNodeId === node.id || selection.includes(node.id)
  const media = node.payload?.kind === 'image' || node.payload?.kind === 'video' ? node.payload : undefined
  const resources = media?.resources || []
  const activeIndex = Number.isInteger(media?.activeResourceIndex) ? Math.max(0, Math.min(resources.length - 1, media!.activeResourceIndex!)) : 0
  return (
    <div
      className="node-card node-panel-shadow relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-visible rounded-[24px] border border-border bg-card"
      onPointerDown={stopNodeGesture}
      onDragOver={(event) => {
        if (!media || !event.dataTransfer.types.includes(MEDIA_RESOURCE_TYPE)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        const value = event.dataTransfer.getData(MEDIA_RESOURCE_TYPE)
        if (!value) return
        event.preventDefault()
        event.stopPropagation()
        const index = droppedMediaIndex(value, node)
        if (index !== null) selectMediaResource(node.id, index)
      }}
    >
      {(node.category === 'text' || node.category === 'mindmap') && (
        <button
          type="button"
          className={`nodrag absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-card/80 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 ${editorVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
          title="展开编辑器"
          aria-label="展开编辑器"
          onPointerDown={stopNodeGesture}
          onClick={() => openContentEditor(node.id)}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      {resources.length > 1 && (node.category === 'image' || node.category === 'video') ? (
        <div className="media-resource-rail nodrag nowheel" role="toolbar" aria-label="媒体资源" onPointerDown={stopNodeGesture} onWheel={stopNodeGesture}>
          {resources.map((item, index) => {
            const label = item.label || `${node.category === 'image' ? '图片' : '视频'} ${index + 1}`
            return (
              <button
                key={`${item.resource.resourceId || item.resource.url}-${index}`}
                type="button"
                draggable
                className={`media-resource-capsule ${index === activeIndex ? 'is-active' : ''}`}
                title={`拖入预览区或点击显示${label}`}
                aria-label={`显示${label}`}
                aria-pressed={index === activeIndex}
                onClick={() => selectMediaResource(node.id, index)}
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(MEDIA_RESOURCE_TYPE, JSON.stringify({ nodeId: node.id, kind: node.category, index }))
                }}
              >
                <span>{index + 1}</span><span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
        {node.category ? <LeafBody node={node} /> : <CategoryPicker node={node} />}
      </div>
    </div>
  )
})
