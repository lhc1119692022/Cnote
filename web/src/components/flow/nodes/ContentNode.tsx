import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import { AlertCircle, AlignLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, FileUp, Image as ImageIcon, LoaderCircle, Maximize2, Presentation, RectangleHorizontal, RectangleVertical, RefreshCw, Share2, Sparkles, Table2, Video, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importContentIntoNode, reparseContentNode, saveTextContentToNode } from '@/lib/content-import-controller'
import { CONTENT_FILE_ACCEPT, CONTENT_FILE_ACCEPT_BY_CATEGORY } from '@/lib/content-import'
import { useLocalResourceUrl } from '@/hooks/use-local-resource-url'
import { hasLocalResource } from '@/lib/resource-storage'
import { ScraperClient } from '@/lib/scraper'
import { getContentServiceClient } from '@/lib/content-service'
import { useFlowStore } from '@/stores/use-flow-store'
import { useContentEditorStore } from '@/stores/use-content-editor-store'
import { CONTENT_MEDIA_MAX_AUTO_HEIGHT, CONTENT_NODE_MIN_SIZE, ONLINE_VIDEO_MAX_AUTO_HEIGHT, ONLINE_VIDEO_PORTRAIT_MAX_AUTO_HEIGHT, ONLINE_VIDEO_TRANSCRIPT_MAX_HEIGHT } from '@/lib/flow/node-dimensions'
import type { ContentCategory, ContentMediaItem, ContentNodeData, MindmapTreeNode } from '@/types/flow'
import { getActiveMediaIndex, getMaxMediaAspectRatio, getNodeMediaItems } from '@/lib/content-media'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc, NodeResourceLostNotice } from './NodeChrome'
import { MarkdownPreview } from '../ContentEditorPanel'

interface CategoryOption { id: ContentCategory; label: string; icon: typeof Video; iconClass: string }
export const contentCategoryOptions: CategoryOption[] = [
  { id: 'text', label: '文本', icon: AlignLeft, iconClass: 'text-slate-500' },
  { id: 'video', label: '视频', icon: Video, iconClass: 'text-red-500' },
  { id: 'social', label: '社媒', icon: Share2, iconClass: 'text-pink-500' },
  { id: 'image', label: '图片', icon: ImageIcon, iconClass: 'text-cyan-500' },
  { id: 'document', label: '文档', icon: FileText, iconClass: 'text-blue-500' },
  { id: 'mindmap', label: '思维导图', icon: Workflow, iconClass: 'text-violet-500' },
  { id: 'presentation', label: '演示文稿', icon: Presentation, iconClass: 'text-orange-500' },
  { id: 'data', label: '数据', icon: Table2, iconClass: 'text-emerald-500' },
]

const labels: Record<ContentCategory, string> = Object.fromEntries(contentCategoryOptions.map((option) => [option.id, option.label])) as Record<ContentCategory, string>
const MEDIA_NODE_INSET = 11
const ONLINE_VIDEO_DETAILS_GAP = 12
function resourceIdOf(data: ContentNodeData) { return data.source?.kind === 'file' || data.source?.kind === 'clipboard-image' ? data.source.resourceId : undefined }
function urlOf(data: ContentNodeData) { return data.source?.kind === 'url' ? data.source.normalizedUrl : '' }
function isYouTubeShortUrl(url: string) {
  try { return /^\/shorts\//i.test(new URL(url).pathname) } catch { return false }
}

function limitMindmapTree(root: MindmapTreeNode, maxNodes = 60, maxDepth = 5) {
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

function MindmapMapBranch({ node, depth = 0 }: { node: MindmapTreeNode; depth?: number }) {
  return <div className="flex items-center gap-3"><div className={`max-w-36 shrink-0 rounded-lg border px-3 py-2 text-xs leading-4 ${depth === 0 ? 'border-violet-300 bg-violet-50 font-semibold text-violet-950 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100' : 'border-border bg-card text-foreground'}`}>{node.text}</div>{node.children.length > 0 && <div className="flex flex-col gap-2 border-l border-violet-200 pl-4 dark:border-violet-800">{node.children.map((child) => <MindmapMapBranch key={child.id} node={child} depth={depth + 1} />)}</div>}</div>
}

function RemoteLinkPreview({ title, description, thumbnailUrl, url, label }: { title: string; description?: string; thumbnailUrl?: string; url: string; label: string }) {
  return <div className="space-y-3">{thumbnailUrl && <img src={thumbnailUrl} alt="" loading="lazy" className="h-36 w-full rounded-lg object-cover" />}<div className="space-y-1"><div className="line-clamp-2 text-lg font-medium leading-7 text-foreground">{title}</div>{description && <p className="line-clamp-3 text-base leading-7 text-muted-foreground">{description}</p>}</div>{url && <a href={url} target="_blank" rel="noreferrer" className="nodrag inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onPointerDown={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5" />打开{label}</a>}</div>
}

type SocialMediaEntry = { item: ContentMediaItem; type: 'image' | 'video' }

function SocialMediaCarousel({ items, activeIndex, onActiveIndexChange, resolveMediaUrl, maxAspectRatio }: {
  items: SocialMediaEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  resolveMediaUrl: (url: string) => string
  maxAspectRatio: number
}) {
  if (!items.length) return null
  const index = Math.min(Math.max(activeIndex, 0), items.length - 1)
  const active = items[index]
  const activeUrl = active.type === 'video'
    ? resolveMediaUrl(active.item.resource.url)
    : resolveMediaUrl(active.item.resource.url)
  const previous = () => onActiveIndexChange((index - 1 + items.length) % items.length)
  const next = () => onActiveIndexChange((index + 1) % items.length)
  return <section className="nodrag nowheel select-none" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <div className="group/media relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/30" style={{ aspectRatio: `1 / ${Math.min(Math.max(maxAspectRatio, 0.75), 1.65)}` }}>
      {active.type === 'video'
        ? <video src={activeUrl} poster={active.item.poster ? resolveMediaUrl(active.item.poster.url) : undefined} controls playsInline preload="metadata" className="nodrag nopan nowheel pointer-events-auto h-full w-full object-contain" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} />
        : <img src={resolveMediaUrl(active.item.resource.url)} alt={active.item.label || ''} loading="lazy" className="h-full w-full object-contain" />}
      {items.length > 1 && <>
        <button type="button" className="nodrag pointer-events-none absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-[opacity,background-color] group-hover/media:pointer-events-auto group-hover/media:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-black/75" onClick={previous} aria-label="上一张媒体" title="上一张媒体"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className="nodrag pointer-events-none absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-[opacity,background-color] group-hover/media:pointer-events-auto group-hover/media:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-black/75" onClick={next} aria-label="下一张媒体" title="下一张媒体"><ChevronRight className="h-4 w-4" /></button>
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{index + 1} / {items.length}</span>
      </>}
    </div>
    {items.length > 1 && <div className="mt-2 flex justify-center gap-1.5">{items.map((entry, itemIndex) => <button key={`${entry.item.resource.url}-${itemIndex}`} type="button" className={`h-1.5 w-1.5 rounded-full transition-colors ${itemIndex === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground'}`} aria-label={`显示第 ${itemIndex + 1} 个媒体`} onClick={() => onActiveIndexChange(itemIndex)} />)}</div>}
  </section>
}

export const ContentNode = memo((props: NodeProps<ContentNodeData>) => {
  const { id, data, selected } = props
  const updateNode = useFlowStore((state) => state.updateNode)
  const inputRef = useRef<HTMLInputElement>(null)

  if (data.category) return <ContentLeafNode {...props} />

  const chooseCategory = (category: ContentCategory) => {
    if (category === 'image' || category === 'presentation' || category === 'data') {
      inputRef.current?.setAttribute('accept', CONTENT_FILE_ACCEPT_BY_CATEGORY[category])
      importFile()
      return
    }
    updateNode(id, { type: 'content', data: { ...data, schemaVersion: 2, category, subtype: null, state: 'empty', source: null, label: `${labels[category]}节点` } })
  }
  const importFile = () => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click() } }
  const importLocalFile = () => {
    if (inputRef.current) {
      inputRef.current.setAttribute('accept', CONTENT_FILE_ACCEPT)
      importFile()
    }
  }
  const onFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void importContentIntoNode(id, { kind: 'file', file }) }

  return <div className={`node-card node-panel-shadow group relative flex h-full min-h-[430px] w-full min-w-[540px] flex-col rounded-[24px] border bg-card ${selected ? 'node-selected' : 'border-border'}`}>
    <NodeHandle type="target" position={Position.Left} id="in" /><NodeHandle type="source" position={Position.Right} id="out" />
    <NodeHoverToolbar nodeId={id} /><NodeResizeArc nodeId={id} minWidth={540} minHeight={430} />
    <div className="flex min-h-0 flex-1 items-center justify-center px-12 py-7"><div className="w-full">
      <h3 className="mb-4 text-center text-lg font-semibold text-foreground">选择内容类型</h3>
      <div className="grid grid-cols-3 gap-3">
        {contentCategoryOptions.map((option) => { const Icon = option.icon; return <button key={option.id} type="button" onClick={() => chooseCategory(option.id)} className="nodrag flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"><Icon className={`h-7 w-7 stroke-[1.8] ${option.iconClass}`} /><span>{option.label}</span></button> })}
        <button type="button" onClick={importLocalFile} className="nodrag flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"><FileUp className="h-7 w-7 stroke-[1.8] text-blue-500" /><span>导入本地</span></button>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 shrink-0 text-orange-400" /><span>可直接粘贴 URL、文本或图片，自动识别内容类型</span></div>
      {(data.state === 'error' || data.state === 'unsupported') && data.parse?.error && <div role="alert" className="mt-3 flex items-start justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs leading-5 text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{data.parse.error.message}</span></div>}
    </div></div>
    <input ref={inputRef} type="file" className="hidden" accept={CONTENT_FILE_ACCEPT} onChange={onFile} />
  </div>
})

export const ContentLeafNode = memo(({ id, data, selected }: NodeProps<ContentNodeData>) => {
  const category = data.category!
  const updateNode = useFlowStore((state) => state.updateNode)
  const openContentEditor = useContentEditorStore((state) => state.open)
  const openInlineEditor = useContentEditorStore((state) => state.openInline)
  const activeEditorNodeId = useContentEditorStore((state) => state.nodeId)
  const editorMode = useContentEditorStore((state) => state.mode)
  const option = contentCategoryOptions.find((item) => item.id === category) || contentCategoryOptions[0]
  const Icon = option.icon
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [textEditing, setTextEditing] = useState(false)
  const textDirtyRef = useRef(false)
  const upstreamSignatureRef = useRef(data.upstreamSync?.sourceSignature || '')
  const mediaSizeRef = useRef('')
  const onlineVideoPlayerRef = useRef<HTMLDivElement>(null)
  const youtubeIframeRef = useRef<HTMLIFrameElement>(null)
  const onlineVideoDetailsRef = useRef<HTMLElement>(null)
  const socialScrollRef = useRef<HTMLDivElement>(null)
  const socialContentRef = useRef<HTMLDivElement>(null)
  const lastOnlineVideoAutoSizeRef = useRef<{ width: number; height: number } | null>(null)
  const onlineVideoWasManuallyResizedRef = useRef(false)
  const [onlineVideoPlayerHeight, setOnlineVideoPlayerHeight] = useState(0)
  const [platformLinkFeedbackKey, setPlatformLinkFeedbackKey] = useState(0)
  const [isOnlineVideoManuallySized, setIsOnlineVideoManuallySized] = useState(false)
  const resourceId = resourceIdOf(data)
  const localUrl = useLocalResourceUrl(resourceId)
  const sourceUrl = urlOf(data)
  const busy = data.state === 'importing' || data.state === 'detecting' || data.state === 'parsing'
  const error = data.parse?.error
  const documentPayload = data.payload?.kind === 'document' ? data.payload : undefined
  const textPayload = data.payload?.kind === 'text' ? data.payload : undefined
  const dataPayload = data.payload?.kind === 'data' ? data.payload : undefined
  const presentationPayload = data.payload?.kind === 'presentation' ? data.payload : undefined
  const mindmap = data.payload?.kind === 'mindmap' ? data.payload : undefined
  const social = data.payload?.kind === 'social' ? data.payload : undefined
  const image = data.payload?.kind === 'image' ? data.payload : undefined
  const [socialMediaUrls, setSocialMediaUrls] = useState<Record<string, string>>({})
  const [socialMediaIndex, setSocialMediaIndex] = useState(0)
  const video = data.payload?.kind === 'video' ? data.payload : undefined
  const imageResources = useMemo(() => getNodeMediaItems({ type: 'content', data }, 'image'), [data])
  const videoResources = useMemo(() => getNodeMediaItems({ type: 'content', data }, 'video'), [data])
  const activeImageIndex = getActiveMediaIndex(imageResources, image?.activeResourceIndex)
  const activeVideoIndex = getActiveMediaIndex(videoResources, video?.activeResourceIndex)
  const activeImage = imageResources[activeImageIndex]
  const activeVideo = videoResources[activeVideoIndex]
  const socialMediaItems = useMemo<SocialMediaEntry[]>(() => social?.contentBlocks.flatMap<SocialMediaEntry>((block, index) => {
    if (block.type === 'image') return [{ item: { resource: block.resource, label: block.caption || `图片 ${index + 1}` }, type: 'image' as const }]
    if (block.type === 'video') return [{ item: { resource: block.resource, poster: block.poster, label: `视频 ${index + 1}` }, type: 'video' as const }]
    if (block.type === 'live-photo') return [{ item: { resource: block.motionVideo || block.image, poster: block.motionVideo ? block.image : undefined, label: `实况 ${index + 1}` }, type: block.motionVideo ? 'video' as const : 'image' as const }]
    return []
  }) || [], [social])
  const displayText = useMemo(() => documentPayload?.plainText || social?.bodyText || video?.transcript || '', [documentPayload, social, video])
  const limitedMindmap = useMemo(() => mindmap ? limitMindmapTree(mindmap.root) : undefined, [mindmap])
  const videoPlayback = activeVideo ? 'video' : video?.provider === 'youtube' ? 'embed' : video?.playback || (data.subtype === 'direct-video' || data.subtype === 'local-video' ? 'video' : data.subtype === 'podcast' && data.source?.kind !== 'url' ? 'audio' : 'preview')
  const youtubeVideoId = video?.provider === 'youtube' && sourceUrl ? ScraperClient.extractVideoId(sourceUrl) : null
  const youtubeEmbedUrl = youtubeVideoId
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeVideoId)}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`
    : ''
  const isDirectRemoteImage = data.source?.kind === 'url' && data.state === 'ready'
  const rawImageUrl = localUrl || activeImage?.resource.url || data.preview?.thumbnailUrl || (isDirectRemoteImage ? sourceUrl : '')
  const rawPlaybackUrl = localUrl || activeVideo?.resource.url || (videoPlayback !== 'preview' ? sourceUrl : '')
  const editableText = textPayload?.value || (data.source?.kind === 'text' ? data.source.text : '')
  const parseWarning = data.state === 'partial' ? data.parse?.warnings?.[0] : undefined
  const resolveSocialMediaUrl = useCallback((url: string) => socialMediaUrls[url] || url, [socialMediaUrls])
  const imageUrl = resolveSocialMediaUrl(rawImageUrl)
  const playbackUrl = resolveSocialMediaUrl(rawPlaybackUrl)
  const activeSocialMedia = socialMediaItems[Math.min(Math.max(socialMediaIndex, 0), Math.max(0, socialMediaItems.length - 1))]
  const socialMediaAspectRatio = useMemo(() => getMaxMediaAspectRatio(socialMediaItems.map((entry) => entry.item)), [socialMediaItems])
  const proxyMediaUrls = useMemo(() => Array.from(new Set([
    activeSocialMedia?.item.resource.url,
    activeSocialMedia?.item.poster?.url,
    activeImage?.resource.url,
    activeVideo?.resource.url,
    activeVideo?.poster?.url,
  ].filter((url): url is string => Boolean(url)))).join('|'), [activeImage?.resource.url, activeSocialMedia?.item.poster?.url, activeSocialMedia?.item.resource.url, activeVideo?.poster?.url, activeVideo?.resource.url])

  useEffect(() => {
    if (!proxyMediaUrls) {
      setSocialMediaUrls({})
      return
    }
    const originals = proxyMediaUrls.split('|')
    const proxied = originals.filter((url) => {
      try { return /(?:^|\.)xhscdn\.(?:com|net)$/i.test(new URL(url).hostname) } catch { return false }
    })
    if (!proxied.length) {
      setSocialMediaUrls({})
      return
    }
    let active = true
    const controller = new AbortController()
    const objectUrls: string[] = []
    void (async () => {
      try {
        const client = getContentServiceClient('social')
        const entries = await Promise.all(proxied.map(async (url) => {
          try {
            const blob = await client.fetchXiaohongshuMedia(url, { signal: controller.signal })
            if (!active) return null
            const objectUrl = URL.createObjectURL(blob)
            objectUrls.push(objectUrl)
            return [url, objectUrl] as const
          } catch {
            return null
          }
        }))
        if (active) setSocialMediaUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))))
      } catch {
        if (active) setSocialMediaUrls({})
      }
    })()
    return () => {
      active = false
      controller.abort()
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
    }
  }, [proxyMediaUrls])
  useEffect(() => {
    setSocialMediaIndex((current) => Math.min(current, Math.max(0, socialMediaItems.length - 1)))
  }, [socialMediaItems.length])

  useLayoutEffect(() => {
    if (category !== 'social' || !social || busy || error || data.manualSize) return
    const surface = socialScrollRef.current
    const content = socialContentRef.current
    if (!surface || !content) return

    let frame: number | null = null
    const fitSocialNodeToContent = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const current = useFlowStore.getState().nodes.find((node) => node.id === id)
        if (!current || current.data?.manualSize) return
        const style = window.getComputedStyle(surface)
        const paddingY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
        const targetHeight = Math.max(CONTENT_NODE_MIN_SIZE.height, Math.ceil(content.scrollHeight + paddingY + 2))
        const currentHeight = Number(current.style?.height ?? current.height ?? (current as any).measured?.height ?? 0)
        if (Math.abs(currentHeight - targetHeight) <= 1) return
        updateNode(id, { style: { ...(current.style || {}), height: targetHeight } })
      })
    }

    fitSocialNodeToContent()
    const observer = new ResizeObserver(fitSocialNodeToContent)
    observer.observe(content)
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [busy, category, data.manualSize, error, id, social, socialMediaAspectRatio, updateNode])
  const isOnlinePlayableVideo =
    category === 'video' &&
    data.source?.kind === 'url' &&
    ((videoPlayback === 'video' && Boolean(playbackUrl)) ||
      (videoPlayback === 'embed' && Boolean(youtubeEmbedUrl)))
  const videoDisplayAspect = video?.displayAspect || 'auto'
  const autoPortraitVideo = isYouTubeShortUrl(sourceUrl) || Boolean(video?.width && video?.height && video.height > video.width)
  const isPortraitVideo = videoDisplayAspect === 'portrait' || (videoDisplayAspect === 'auto' && autoPortraitVideo)
  const videoAspectWidth = videoDisplayAspect === 'portrait'
    ? 9
    : videoDisplayAspect === 'landscape'
      ? 16
      : isYouTubeShortUrl(sourceUrl)
        ? 9
        : video?.width || 16
  const videoAspectHeight = videoDisplayAspect === 'portrait'
    ? 16
    : videoDisplayAspect === 'landscape'
      ? 9
      : isYouTubeShortUrl(sourceUrl)
        ? 16
        : video?.height || 9
  const onlineVideoMaxAutoHeight = isPortraitVideo ? ONLINE_VIDEO_PORTRAIT_MAX_AUTO_HEIGHT : ONLINE_VIDEO_MAX_AUTO_HEIGHT
  const videoTitle = video?.title || data.preview?.title || data.label
  const videoTranscriptNotice = video?.transcriptStatus === 'loading'
    ? '正在获取字幕…'
    : video?.transcriptStatus === 'unavailable'
      ? '暂未获取到字幕。'
      : video?.transcriptStatus === 'error'
        ? '字幕获取失败。'
        : undefined
  const onlineVideoLayoutKey = [
    videoAspectWidth,
    videoAspectHeight,
    videoTitle,
    video?.transcript || '',
    videoTranscriptNotice || '',
    parseWarning?.message || '',
  ].join('|')
  useEffect(() => {
    if (category !== 'text') return
    const upstreamSignature = data.upstreamSync?.sourceSignature || ''
    const upstreamChanged = Boolean(upstreamSignature && upstreamSignature !== upstreamSignatureRef.current)
    upstreamSignatureRef.current = upstreamSignature
    if (!upstreamChanged && textDirtyRef.current) return
    // An upstream refresh is authoritative. Clear any stale local draft flag so
    // the node immediately reflects the value that was written into the graph.
    if (upstreamChanged) textDirtyRef.current = false
    setDraft(editableText)
  }, [category, data.upstreamSync?.sourceSignature, editableText])

  useEffect(() => {
    if (!youtubeVideoId || video?.provider !== 'youtube') return
    const playerId = `cnote-youtube-${id}`
    const acceptPlayerTitle = (title: unknown) => {
      if (typeof title !== 'string' || !title.trim() || title === `YouTube ${youtubeVideoId}`) return
      const current = useFlowStore.getState().nodes.find((node) => node.id === id)
      if (!current || current.data?.payload?.kind !== 'video' || current.data.payload.provider !== 'youtube') return
      const currentTitle = current.data.payload.title
      const currentPreviewTitle = current.data.preview?.title
      const isGenerated = (value: unknown) => typeof value !== 'string' || !value.trim() || value === 'YouTube 视频' || value === `YouTube ${youtubeVideoId}`
      if (!isGenerated(currentTitle) && !isGenerated(currentPreviewTitle)) return
      updateNode(id, {
        data: {
          ...current.data,
          payload: { ...current.data.payload, title: isGenerated(currentTitle) ? title.trim() : currentTitle },
          preview: { ...current.data.preview, title: isGenerated(currentPreviewTitle) ? title.trim() : currentPreviewTitle },
        },
      })
      useFlowStore.getState().saveCurrentFlow()
    }
    const handlePlayerMessage = (event: MessageEvent) => {
      const iframe = youtubeIframeRef.current
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow || !/\.youtube(?:-nocookie)?\.com$/i.test(new URL(event.origin).hostname)) return
      let message: unknown = event.data
      if (typeof message === 'string') {
        try { message = JSON.parse(message) } catch { return }
      }
      const record = message && typeof message === 'object' ? message as Record<string, unknown> : undefined
      const info = record?.info && typeof record.info === 'object' ? record.info as Record<string, unknown> : undefined
      const videoData = info?.videoData && typeof info.videoData === 'object' ? info.videoData as Record<string, unknown> : undefined
      acceptPlayerTitle(videoData?.title)
    }
    const requestPlayerData = () => {
      const target = youtubeIframeRef.current?.contentWindow
      if (!target) return
      target.postMessage(JSON.stringify({ event: 'listening', id: playerId, channel: playerId }), '*')
      target.postMessage(JSON.stringify({ event: 'command', func: 'getVideoData', args: [], id: playerId, channel: playerId }), '*')
    }
    window.addEventListener('message', handlePlayerMessage)
    const timers = [300, 900, 1_800, 3_200].map((delay) => window.setTimeout(requestPlayerData, delay))
    return () => {
      window.removeEventListener('message', handlePlayerMessage)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [id, updateNode, video?.provider, youtubeVideoId])

  useEffect(() => {
    const flushDraft = (event: Event) => {
      if (category !== 'text' || !textDirtyRef.current) return
      const detail = (event as CustomEvent<{ tasks?: Promise<unknown>[] }>).detail
      const task = saveTextContentToNode(id, draft).finally(() => { textDirtyRef.current = false })
      detail?.tasks?.push(task)
    }
    document.addEventListener('cnote:flush-node-editors', flushDraft)
    return () => document.removeEventListener('cnote:flush-node-editors', flushDraft)
  }, [category, draft, id])

  useEffect(() => {
    if (editorMode !== 'inline' || activeEditorNodeId !== id) setTextEditing(false)
  }, [activeEditorNodeId, editorMode, id])

  const fitNodeToMedia = useCallback((width: number, height: number) => {
    if (!width || !height || (category !== 'image' && category !== 'video')) return
    const targetWidth = Math.min(760, Math.max(420, width))
    const targetHeight = Math.min(Math.min(CONTENT_MEDIA_MAX_AUTO_HEIGHT, 460), Math.round(targetWidth * height / width))
    const sizeKey = `${targetWidth}x${targetHeight}`
    if (mediaSizeRef.current === sizeKey) return
    mediaSizeRef.current = sizeKey
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, {
      style: isOnlinePlayableVideo
        ? current.style
        : { ...(current.style || {}), width: targetWidth, height: Math.max(180, targetHeight + 8) },
      data: {
        ...current.data,
        payload: current.data?.payload?.kind === 'image'
          ? { ...current.data.payload, width, height }
          : current.data?.payload?.kind === 'video'
            ? { ...current.data.payload, width, height }
            : current.data?.payload,
      },
    })
  }, [category, id, isOnlinePlayableVideo, updateNode])

  useLayoutEffect(() => {
    if (!isOnlinePlayableVideo) return
    const player = onlineVideoPlayerRef.current
    if (!player) return

    const updatePlayerHeight = () => {
      // React Flow scales getBoundingClientRect() with the viewport zoom. Node
      // styles use canvas units, so measure the unscaled layout height here.
      const nextHeight = Math.round(player.offsetHeight)
      setOnlineVideoPlayerHeight((current) => current === nextHeight ? current : nextHeight)
    }
    updatePlayerHeight()
    const observer = new ResizeObserver(updatePlayerHeight)
    observer.observe(player)
    return () => observer.disconnect()
  }, [isOnlinePlayableVideo, onlineVideoLayoutKey, videoAspectHeight, videoAspectWidth])

  useLayoutEffect(() => {
    if (!isOnlinePlayableVideo || !onlineVideoPlayerHeight) return

    const frame = window.requestAnimationFrame(() => {
      // Measure the entire detail region so the title, notice, transcript, and
      // platform link all fit inside the node rather than overflowing its edge.
      const details = onlineVideoDetailsRef.current
      const detailsHeight = Math.ceil(Math.max(
        details?.scrollHeight || 0,
        details?.offsetHeight || 0,
      ))
      if (!detailsHeight) return

      const current = useFlowStore.getState().nodes.find((node) => node.id === id)
      if (!current) return
      const width = Number(current.style?.width ?? current.width ?? (current as any).measured?.width ?? 420)
      const height = Number(current.style?.height ?? current.height ?? (current as any).measured?.height ?? 0)
      const lastAutoSize = lastOnlineVideoAutoSizeRef.current
      if (
        lastAutoSize &&
        (Math.abs(width - lastAutoSize.width) > 1 ||
          Math.abs(height - lastAutoSize.height) > 1)
      ) {
        onlineVideoWasManuallyResizedRef.current = true
        setIsOnlineVideoManuallySized(true)
      }

      const targetHeight = Math.min(
        onlineVideoMaxAutoHeight,
        Math.ceil(onlineVideoPlayerHeight + detailsHeight + MEDIA_NODE_INSET * 2 + ONLINE_VIDEO_DETAILS_GAP),
      )
      // Older builds could persist a zoom-scaled transcript measurement as a
      // multi-thousand-pixel node height. That cannot be a useful default, so
      // recover it before deciding whether the user manually resized the node.
      if (!lastAutoSize && height > onlineVideoMaxAutoHeight * 2) {
        lastOnlineVideoAutoSizeRef.current = { width, height: targetHeight }
        updateNode(id, { style: { ...(current.style || {}), height: targetHeight } })
        return
      }
      if (!lastAutoSize && height > targetHeight + 1) {
        onlineVideoWasManuallyResizedRef.current = true
        setIsOnlineVideoManuallySized(true)
        return
      }
      // Manual dimensions take precedence. Long details scroll inside the node
      // until the user chooses to make more room.
      if (onlineVideoWasManuallyResizedRef.current) return
      if (Math.abs(height - targetHeight) <= 1) {
        lastOnlineVideoAutoSizeRef.current = { width, height: targetHeight }
        return
      }
      lastOnlineVideoAutoSizeRef.current = { width, height: targetHeight }
      updateNode(id, {
        style: { ...(current.style || {}), height: targetHeight },
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [id, isOnlinePlayableVideo, onlineVideoLayoutKey, onlineVideoMaxAutoHeight, onlineVideoPlayerHeight, updateNode])

  const copyPlatformLink = async () => {
    if (!sourceUrl) return
    try { await navigator.clipboard.writeText(sourceUrl) } catch {
      const input = document.createElement('textarea')
      input.value = sourceUrl
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
    setPlatformLinkFeedbackKey((current) => current + 1)
  }

  useEffect(() => {
    if (!platformLinkFeedbackKey) return
    const timer = window.setTimeout(() => setPlatformLinkFeedbackKey(0), 1_000)
    return () => window.clearTimeout(timer)
  }, [platformLinkFeedbackKey])

  useEffect(() => {
    if (!resourceId || data.resourceLost) return
    let active = true
    void hasLocalResource(resourceId).then((exists) => {
      if (!active || exists) return
      const current = useFlowStore.getState().nodes.find((node) => node.id === id)
      if (current) updateNode(id, { data: { ...current.data, state: 'missing', resourceLost: true } })
    })
    return () => { active = false }
  }, [data.resourceLost, id, resourceId, updateNode])

  const markResourceLost = () => {
    if (data.resourceLost) return
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (current) updateNode(id, { data: { ...current.data, state: 'missing', resourceLost: true } })
  }

  const submitDraft = () => { if (draft.trim()) void importContentIntoNode(id, { kind: 'text', text: draft }, category) }
  const beginTextEditing = () => {
    openInlineEditor(id)
    setTextEditing(true)
  }
  const updateTextDraft = (value: string) => {
    textDirtyRef.current = true
    setDraft(value)
    const format = /(^|\n)#{1,6}\s+|(^|\n)\s*[-*+]\s+/m.test(value) ? 'markdown' as const : 'plain' as const
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, {
      data: {
        ...current.data,
        category: 'text',
        subtype: format === 'markdown' ? 'markdown' : 'plain-text',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload: { kind: 'text', value, format },
        preview: { title: '文本', badge: format === 'markdown' ? 'Markdown' : '文本', meta: [`${value.length} 字符`] },
        parse: undefined,
      } satisfies ContentNodeData,
    })
  }
  const setActiveMediaResource = (kind: 'image' | 'video', index: number) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current || current.data?.payload?.kind !== kind) return
    const resources = getNodeMediaItems(current, kind)
    if (!resources[index]) return
    updateNode(id, { data: { ...current.data, payload: { ...current.data.payload, activeResourceIndex: index } } })
    useFlowStore.getState().saveCurrentFlow()
  }
  const toggleVideoDisplayAspect = () => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current || current.data?.payload?.kind !== 'video') return
    const width = Number(current.style?.width ?? current.width ?? (current as any).measured?.width ?? CONTENT_NODE_MIN_SIZE.width)
    const height = Number(current.style?.height ?? current.height ?? (current as any).measured?.height ?? 0)
    lastOnlineVideoAutoSizeRef.current = height > 0 ? { width, height } : null
    onlineVideoWasManuallyResizedRef.current = false
    setIsOnlineVideoManuallySized(false)
    updateNode(id, {
      data: {
        ...current.data,
        payload: {
          ...current.data.payload,
          displayAspect: isPortraitVideo ? 'landscape' : 'portrait',
        },
      },
    })
    useFlowStore.getState().saveCurrentFlow()
  }
  const mediaResources = category === 'image' ? imageResources : category === 'video' ? videoResources : []
  const activeMediaResourceIndex = category === 'image' ? activeImageIndex : activeVideoIndex
  const chooseFile = () => { if (fileRef.current) { fileRef.current.accept = CONTENT_FILE_ACCEPT_BY_CATEGORY[category]; fileRef.current.value = ''; fileRef.current.click() } }
  const onFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void importContentIntoNode(id, { kind: 'file', file }, category) }
  const importTextFile = (file: File) => { void importContentIntoNode(id, { kind: 'file', file, fileName: file.name }, 'text') }
  const openEditorPanel = () => {
    setTextEditing(false)
    openContentEditor(id)
  }
  const emptyLinkConfig = category === 'video'
    ? { placeholder: '粘贴视频链接…', emptyButton: '选择文件', filledButton: '解析视频' }
    : category === 'social'
      ? { placeholder: '粘贴社媒链接…', emptyButton: '粘贴链接后解析', filledButton: '开始解析' }
      : { placeholder: '粘贴线上文档链接…', emptyButton: '选择文件', filledButton: '解析文档' }
  const isMediaNode = category === 'image' || (category === 'video' && ((videoPlayback === 'video' && Boolean(playbackUrl)) || (videoPlayback === 'embed' && Boolean(youtubeEmbedUrl))))
  const onlineVideoMinHeight = 240
  const minHeight = isOnlinePlayableVideo ? onlineVideoMinHeight : isMediaNode ? 180 : CONTENT_NODE_MIN_SIZE.height
  const centerContent = category !== 'text' && (busy || Boolean(error) || data.state === 'empty')

  return <div
    className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-visible rounded-[22px] border bg-card ${selected ? 'node-selected' : 'border-border'} ${data.disabled ? 'opacity-60 grayscale' : ''}`}
    style={{ minWidth: CONTENT_NODE_MIN_SIZE.width, minHeight }}
    onDragOver={(event) => {
      if ((category === 'image' || category === 'video') && event.dataTransfer.types.includes('application/x-cnote-media-resource')) {
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        return
      }
      if (category !== 'text' || !event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }}
    onDrop={(event) => {
      const mediaResource = event.dataTransfer.getData('application/x-cnote-media-resource')
      if ((category === 'image' || category === 'video') && mediaResource) {
        try {
          const dropped = JSON.parse(mediaResource) as { kind?: string; index?: number }
          if (dropped.kind === category && typeof dropped.index === 'number' && Number.isInteger(dropped.index)) {
            event.preventDefault()
            event.stopPropagation()
            setActiveMediaResource(category, dropped.index)
            return
          }
        } catch { /* Ignore unrelated drag payloads. */ }
      }
      if (category !== 'text') return
      const file = event.dataTransfer.files[0]
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      importTextFile(file)
    }}
    >
    <NodeHandle type="target" position={Position.Left} id="in" /><NodeHandle type="source" position={Position.Right} id="out" />
    {category === 'social' && <div className="social-node-drag-handle" aria-label="拖动社媒节点" title="拖动节点"><span /></div>}
    {(category === 'image' || category === 'video') && mediaResources.length > 1 && <div className="media-resource-rail nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
      {mediaResources.map((item, index) => <button key={`${item.resource.url}-${index}`} type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-cnote-media-resource', JSON.stringify({ kind: category, index })) }} onClick={() => setActiveMediaResource(category, index)} className={`media-resource-capsule ${index === activeMediaResourceIndex ? 'is-active' : ''}`} title={`拖入预览区或点击显示${item.label || `${category === 'image' ? '图片' : '视频'} ${index + 1}`}`}><span>{index + 1}</span><span className="truncate">{item.label || `${category === 'image' ? '图片' : '视频'} ${index + 1}`}</span></button>)}
    </div>}
    <NodeHoverToolbar nodeId={id} /><NodeResizeArc nodeId={id} minWidth={CONTENT_NODE_MIN_SIZE.width} minHeight={minHeight} />
    {(data.state === 'missing' || data.resourceLost) && <NodeResourceLostNotice />}
    {(category === 'text' || category === 'mindmap') && <Button variant="ghost" size="icon" className="nodrag absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-card/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100" aria-label="展开编辑器" onClick={openEditorPanel}><Maximize2 className="h-4 w-4" /></Button>}
    <div
      ref={socialScrollRef}
      className={`relative flex min-h-0 flex-1 flex-col ${isOnlinePlayableVideo ? 'overflow-hidden p-[11px]' : isMediaNode ? 'overflow-auto p-[11px]' : category === 'mindmap' ? 'overflow-auto p-0' : category === 'social' ? 'nodrag nowheel select-text overflow-y-auto overscroll-contain p-5' : 'overflow-auto p-5'} ${centerContent ? 'justify-center' : ''}`}
      onPointerDownCapture={(event) => {
        if (category === 'social') event.stopPropagation()
        if (category === 'text' && textEditing && editorMode === 'inline' && activeEditorNodeId === id && event.target instanceof HTMLTextAreaElement) {
          event.stopPropagation()
        }
      }}
      onWheelCapture={(event) => { if (category === 'social') event.stopPropagation() }}
    >
      {busy && <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="h-7 w-7 animate-spin" /><span>{data.state === 'importing' ? '正在导入文件…' : data.state === 'detecting' ? '正在识别内容类型…' : '正在解析内容…'}</span></div>}
      {!busy && (data.state === 'error' || data.state === 'unsupported') && <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><AlertCircle className="h-7 w-7 text-amber-500" /><p className="text-sm font-medium">{error?.message || '无法识别此内容'}</p>{(data.source || data.parse?.retryText) && <Button variant="secondary" size="sm" onClick={() => void reparseContentNode(id)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新识别</Button>}</div>}
      {!busy && !error && category === 'text' && <div className="flex min-h-0 flex-1 flex-col">
        {editorMode === 'inline' && activeEditorNodeId === id && textEditing
          ? <textarea autoFocus={textEditing} value={draft} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onFocus={() => setTextEditing(true)} onChange={(event) => updateTextDraft(event.target.value)} onPaste={(event) => {
              const file = event.clipboardData.files[0]
              if (file) { event.preventDefault(); importTextFile(file); return }
              event.preventDefault()
              const text = event.clipboardData.getData('text/plain')
              const target = event.currentTarget
              const next = `${draft.slice(0, target.selectionStart)}${text}${draft.slice(target.selectionEnd)}`
              updateTextDraft(next)
            }} onBlur={() => {
              setTextEditing(false)
              if (textDirtyRef.current) void saveTextContentToNode(id, draft).finally(() => { textDirtyRef.current = false })
            }} className="nodrag nowheel min-h-0 flex-1 resize-none border-0 bg-transparent p-1 text-base leading-7 outline-none" placeholder="此处粘贴或编辑" />
          : draft.trim()
            ? <button type="button" className="nodrag flex min-h-0 flex-1 w-full flex-col items-stretch justify-start p-0 text-left" onClick={beginTextEditing}><MarkdownPreview source={draft} /></button>
            : <button type="button" className="nodrag flex min-h-0 flex-1 w-full flex-col items-center justify-center gap-3 text-muted-foreground" onClick={beginTextEditing}><AlignLeft className="h-10 w-10 stroke-[1.5]" /><span className="text-sm">点击开始编辑</span></button>}
        <div className="nodrag mt-3 shrink-0 text-xs text-muted-foreground">{draft.length} 字符</div>
      </div>}
      {!busy && category === 'mindmap' && data.state === 'empty' && <button type="button" className="nodrag flex flex-1 w-full items-center justify-center" onClick={openEditorPanel}><span className="rounded-full border border-foreground/70 px-8 py-3 text-lg text-foreground">无主题</span></button>}
      {!busy && (category === 'video' || category === 'social' || category === 'document') && data.state === 'empty' && <div className="flex flex-1 flex-col items-center justify-center gap-3"><Icon className={`h-9 w-9 stroke-[1.6] ${option.iconClass}`} /><input value={draft} onChange={(event) => setDraft(event.target.value)} className="nodrag h-10 w-full rounded-xl border border-border bg-card px-4 text-center text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30" placeholder={emptyLinkConfig.placeholder} /><Button type="button" variant="secondary" className="nodrag h-9 w-full" disabled={category === 'social' && !draft.trim()} onClick={() => draft.trim() ? submitDraft() : chooseFile()}>{draft.trim() ? emptyLinkConfig.filledButton : emptyLinkConfig.emptyButton}</Button></div>}
      {!busy && category !== 'text' && data.state !== 'empty' && !error && <>
        {category !== 'video' && parseWarning && <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{parseWarning.message}</span></div>}
        {category === 'image' && (imageUrl ? <img src={imageUrl} alt={data.preview?.title || ''} loading="lazy" onLoad={(event) => fitNodeToMedia(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={resourceId ? markResourceLost : undefined} className="block h-full w-full rounded-[18px] object-contain" /> : <RemoteLinkPreview title={data.preview?.title || data.label} description={data.preview?.description} url={sourceUrl} label="图片来源" />)}
        {isOnlinePlayableVideo && <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div
            ref={onlineVideoPlayerRef}
            className="nodrag nopan nowheel relative shrink-0 overflow-hidden rounded-[18px] bg-black pointer-events-auto"
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            style={{ aspectRatio: `${videoAspectWidth} / ${videoAspectHeight}` }}
          >
            {videoPlayback === 'video' && playbackUrl && <video src={playbackUrl} muted controls preload="metadata" onLoadedMetadata={(event) => fitNodeToMedia(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} onError={resourceId ? markResourceLost : undefined} className="nodrag nopan nowheel pointer-events-auto block h-full w-full object-contain" />}
            {videoPlayback === 'embed' && youtubeEmbedUrl && <iframe ref={youtubeIframeRef} id={`cnote-youtube-${id}`} src={youtubeEmbedUrl} title={videoTitle || '线上视频'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="nodrag nopan nowheel pointer-events-auto block h-full w-full border-0" />}
          </div>
          <section
            ref={onlineVideoDetailsRef}
            className={`flex min-h-0 flex-col ${isOnlineVideoManuallySized || isPortraitVideo ? 'flex-1' : 'shrink-0'}`}
          >
            <div className="shrink-0 border-b border-border/70 py-2.5">
              <h3 className="line-clamp-2 text-lg font-semibold leading-7 text-foreground">{videoTitle}</h3>
              {(videoTranscriptNotice || parseWarning) && <div className="mt-1.5 flex items-start gap-1.5 text-xs leading-4 text-muted-foreground">
                <AlertCircle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${parseWarning ? 'text-amber-600' : ''}`} />
                <span>{parseWarning?.message || videoTranscriptNotice}</span>
              </div>}
            </div>
            {video?.transcript && <div
              className={`nodrag nopan nowheel select-text overscroll-contain min-h-0 py-2.5 text-base leading-7 text-muted-foreground ${isOnlineVideoManuallySized || isPortraitVideo ? 'flex-1 overflow-y-auto' : 'overflow-y-auto'}`}
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              style={isOnlineVideoManuallySized || isPortraitVideo ? undefined : { maxHeight: ONLINE_VIDEO_TRANSCRIPT_MAX_HEIGHT }}
            >
              <p className="whitespace-pre-wrap">{video.transcript}</p>
            </div>}
            {sourceUrl && <div className="mt-2 flex shrink-0 items-center gap-3 text-xs">
              <button
                type="button"
                className="nodrag nopan nowheel inline-flex items-center gap-1 border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground hover:underline"
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); toggleVideoDisplayAspect() }}
                aria-label={`切换为${isPortraitVideo ? '横版' : '竖版'}播放器`}
                title={`切换为${isPortraitVideo ? '横版' : '竖版'}播放器`}
              >
                {isPortraitVideo ? <RectangleHorizontal className="h-3.5 w-3.5" /> : <RectangleVertical className="h-3.5 w-3.5" />}
                <span>{isPortraitVideo ? '横版' : '竖版'}</span>
              </button>
              {video?.provider === 'youtube' && <>
              {!platformLinkFeedbackKey
                ? <button type="button" className="nodrag border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground hover:underline" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void copyPlatformLink() }} aria-label="复制视频链接">链接</button>
                : <span key={platformLinkFeedbackKey} className="youtube-link-feedback pointer-events-none text-muted-foreground">链接已复制</span>}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="nodrag inline-flex w-fit items-center text-muted-foreground transition-all duration-200 ease-out hover:text-foreground hover:underline"
                onPointerDown={(event) => event.stopPropagation()}
              >在 YouTube 上观看</a>
              </>}
              {video?.provider !== 'youtube' && <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="nodrag inline-flex w-fit items-center text-muted-foreground transition-all duration-200 ease-out hover:text-foreground hover:underline"
                onPointerDown={(event) => event.stopPropagation()}
              >打开视频来源</a>}
            </div>}
          </section>
        </div>}
        {category === 'video' && !isOnlinePlayableVideo && videoPlayback === 'audio' && playbackUrl && <audio src={playbackUrl} controls preload="metadata" onError={resourceId ? markResourceLost : undefined} className="w-full" />}
        {category === 'video' && !isOnlinePlayableVideo && videoPlayback === 'video' && playbackUrl && <video src={playbackUrl} muted controls preload="metadata" onLoadedMetadata={(event) => fitNodeToMedia(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} onError={resourceId ? markResourceLost : undefined} className="nodrag nopan nowheel pointer-events-auto block h-full w-full rounded-[18px] object-contain" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} />}
        {category === 'video' && !isOnlinePlayableVideo && videoPlayback === 'embed' && youtubeEmbedUrl && <iframe src={youtubeEmbedUrl} title={video?.title || 'YouTube 视频'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="nodrag nopan nowheel pointer-events-auto block h-full min-h-[220px] w-full rounded-[18px] border-0 bg-black" />}
        {category === 'video' && videoPlayback === 'preview' && <div className="space-y-3"><RemoteLinkPreview title={data.preview?.title || video?.title || data.label} description={data.preview?.description} thumbnailUrl={data.preview?.thumbnailUrl} url={sourceUrl} label={data.preview?.badge || '原内容'} />{video?.transcript && <p className="line-clamp-3 text-base leading-7 text-muted-foreground">{video.transcript}</p>}</div>}
        {category === 'video' && !isOnlinePlayableVideo && parseWarning && <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{parseWarning.message}</span></div>}
        {category === 'document' && (displayText ? <div className="space-y-3"><p className="line-clamp-8 whitespace-pre-wrap text-base leading-7">{displayText}</p>{documentPayload?.pageCount && <span className="text-xs text-muted-foreground">共 {documentPayload.pageCount} 页</span>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="nodrag inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onPointerDown={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5" />打开原文</a>}</div> : <RemoteLinkPreview title={data.preview?.title || data.label} description={data.preview?.description} thumbnailUrl={data.preview?.thumbnailUrl} url={sourceUrl} label="原文" />)}
        {category === 'data' && dataPayload && (dataPayload.sheets.length > 0 ? <div className="overflow-auto"><div className="mb-2 text-xs text-muted-foreground">{dataPayload.sheets[0]?.name} · {dataPayload.sheets[0]?.totalRows || 0} 行</div><table className="w-full border-collapse text-xs"><thead><tr>{dataPayload.sheets[0]?.columns.slice(0, 6).map((column) => <th key={column} className="border border-border bg-muted/50 px-2 py-1.5 text-left">{column}</th>)}</tr></thead><tbody>{dataPayload.sheets[0]?.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.slice(0, 6).map((cell, cellIndex) => <td key={cellIndex} className="max-w-28 truncate border border-border px-2 py-1.5">{String(cell ?? '')}</td>)}</tr>)}</tbody></table></div> : <RemoteLinkPreview title={data.preview?.title || data.label} description={data.preview?.description} thumbnailUrl={data.preview?.thumbnailUrl} url={sourceUrl} label="数据源" />)}
        {category === 'mindmap' && limitedMindmap && <div className="flex h-full min-h-[360px] w-full items-center justify-center overflow-auto p-6"><MindmapMapBranch node={limitedMindmap} />{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="nodrag absolute bottom-4 right-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onPointerDown={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5" />打开原导图</a>}</div>}
        {category === 'social' && social && <div ref={socialContentRef} className="space-y-4">
          {socialMediaItems.length > 0
            ? <SocialMediaCarousel items={socialMediaItems} activeIndex={socialMediaIndex} onActiveIndexChange={setSocialMediaIndex} resolveMediaUrl={resolveSocialMediaUrl} maxAspectRatio={socialMediaAspectRatio} />
            : data.preview?.thumbnailUrl
              ? <img src={data.preview.thumbnailUrl} alt="" loading="lazy" className="max-h-[260px] w-full rounded-xl object-contain" />
              : null}
          <div className="space-y-2">
            <div className="text-lg font-semibold leading-7 text-foreground">{social.title}</div>
            {social.topics?.length ? <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-pink-600 dark:text-pink-300">{social.topics.map((topic) => <span key={topic}>#{topic}</span>)}</div> : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {social.author?.name && <span>{social.author.name}</span>}
              {social.publishedAt && <span>{social.publishedAt}</span>}
              {social.metrics && <span>{[
                social.metrics.likes !== undefined ? `赞 ${social.metrics.likes}` : '',
                social.metrics.collects !== undefined ? `藏 ${social.metrics.collects}` : '',
                social.metrics.comments !== undefined ? `评 ${social.metrics.comments}` : '',
                social.metrics.shares !== undefined ? `转 ${social.metrics.shares}` : '',
              ].filter(Boolean).join(' · ')}</span>}
            </div>
          </div>
          {social.bodyText && <p className="whitespace-pre-wrap text-base leading-7 text-foreground">{social.bodyText}</p>}
          {social.contentBlocks.filter((block) => block.type === 'text' && block.text.trim() && block.text.trim() !== social.bodyText.trim()).map((block, index) => block.type === 'text' ? <p key={`text-${index}`} className="whitespace-pre-wrap text-base leading-7 text-foreground">{block.text}</p> : null)}
          {social.contentBlocks.filter((block) => block.type === 'mention' || block.type === 'link').length > 0 && <div className="flex flex-wrap gap-2 text-xs">{social.contentBlocks.map((block, index) => {
            if (block.type === 'mention') return <span key={`mention-${index}`} className="text-violet-600 dark:text-violet-300">@{block.name}</span>
            if (block.type === 'link') return <a key={`link-${index}`} href={block.url} target="_blank" rel="noreferrer" className="nodrag max-w-full truncate text-muted-foreground underline underline-offset-2" onPointerDown={(event) => event.stopPropagation()}>{block.title || block.url}</a>
            return null
          })}</div>}
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="nodrag inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onPointerDown={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5" />打开原帖</a>}
        </div>}
        {category === 'presentation' && (sourceUrl ? <RemoteLinkPreview title={data.preview?.title || '演示文稿'} description={data.preview?.description} thumbnailUrl={data.preview?.thumbnailUrl} url={sourceUrl} label="演示文稿" /> : presentationPayload?.slides?.length ? <div className="grid grid-cols-1 gap-3">{presentationPayload.slides.slice(0, 6).map((slide) => <article key={slide.index} className="min-h-32 rounded-xl border border-border bg-muted/20 p-4"><div className="mb-2 text-xs font-medium text-muted-foreground">第 {slide.index} 页</div><h4 className="line-clamp-1 text-lg font-semibold leading-7">{slide.title || `第 ${slide.index} 页`}</h4><p className="mt-1 line-clamp-4 whitespace-pre-wrap text-base leading-7 text-muted-foreground">{slide.text}</p></article>)}{presentationPayload.slideCount && presentationPayload.slideCount > 6 && <div className="text-center text-xs text-muted-foreground">共 {presentationPayload.slideCount} 页，当前显示前 6 页</div>}</div> : <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><Presentation className="h-8 w-8 text-orange-500" /><span>{data.preview?.title || '演示文稿'}</span><span className="text-xs">未提取到可展示的页面内容</span></div>)}
      </>}
    </div>
    <input ref={fileRef} type="file" className="hidden" accept={CONTENT_FILE_ACCEPT_BY_CATEGORY[category]} onChange={onFile} />
  </div>
})

ContentNode.displayName = 'ContentNode'
ContentLeafNode.displayName = 'ContentLeafNode'
