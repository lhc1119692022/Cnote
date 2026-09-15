/**
 * 内容节点：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * 文本走声明里的 markdown `content`；图片/视频走 `assetId` 或 `source.url`。
 * 社媒/文档/数据/演示/思维导图后续接入旧内容管线或新解析管线，当前只占位。
 */

import { memo, useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { FileText, Layers3, Presentation, Share2, Table2, Workflow } from 'lucide-react'
import { useCanvas } from '@/canvas/components'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import type { ContentCategory, ContentNodeSpec, ContentSourceRef, NodeSpec } from '@/domain'
import { AssetManager } from '@/runtime'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'

/** 与 NodeShell header `h-9` 对齐（世界像素） */
const SHELL_HEADER_WORLD_PX = 36

const assetManager = new AssetManager()

type ContentViewKind = 'text' | 'image' | 'video' | 'placeholder'
type PlaceholderCategory = Exclude<ContentCategory, 'text' | 'image' | 'video'> | 'unknown'

const PLACEHOLDER_META: Record<PlaceholderCategory, { label: string; icon: LucideIcon; iconClass: string }> = {
  social: { label: '社媒', icon: Share2, iconClass: 'text-pink-500' },
  document: { label: '文档', icon: FileText, iconClass: 'text-blue-500' },
  data: { label: '数据', icon: Table2, iconClass: 'text-emerald-500' },
  presentation: { label: '演示文稿', icon: Presentation, iconClass: 'text-orange-500' },
  mindmap: { label: '思维导图', icon: Workflow, iconClass: 'text-violet-500' },
  unknown: { label: '内容', icon: Layers3, iconClass: 'text-blue-500' },
}

export interface ContentContentProps {
  node: ContentNodeSpec
}

function stopNodeGesture(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function patchContent(id: string, patch: Partial<ContentNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

function sourceMimeType(source: ContentSourceRef | null): string | undefined {
  if (!source) return undefined
  if (source.kind === 'file' || source.kind === 'clipboard-image' || source.kind === 'text') {
    return source.mimeType
  }
  return undefined
}

function sourceUrl(source: ContentSourceRef | null): string | undefined {
  if (source?.kind === 'url' && source.url) return source.url
  return undefined
}

function sourceAssetId(source: ContentSourceRef | null): string | undefined {
  if (source?.kind === 'file' || source?.kind === 'clipboard-image') return source.assetId
  return undefined
}

function resolveViewKind(node: ContentNodeSpec, assetMimeType?: string): ContentViewKind {
  const mime = sourceMimeType(node.source) ?? assetMimeType
  if (node.category === 'text' || node.source?.kind === 'text') return 'text'
  if (node.category === 'image' || mime?.startsWith('image/')) return 'image'
  if (node.category === 'video' || mime?.startsWith('video/')) return 'video'
  return 'placeholder'
}

function placeholderMeta(category: ContentCategory | null) {
  if (category === 'social' || category === 'document' || category === 'data' || category === 'presentation' || category === 'mindmap') {
    return PLACEHOLDER_META[category]
  }
  return PLACEHOLDER_META.unknown
}

/**
 * assetId → blob URL；url source 直接用远程地址。
 * blob URL 由 resource-storage 的 revokeAllManagedObjectUrls 统一回收，组件卸载时不要 URL.revokeObjectURL。
 */
function useResolvedMediaSrc(node: ContentNodeSpec): { src: string | null; loading: boolean } {
  const assetId = node.assetId ?? sourceAssetId(node.source)
  const remoteUrl = sourceUrl(node.source)
  const assetHash = useRuntimeStore((state) => (assetId ? state.assets[assetId]?.hash : undefined))
  const [src, setSrc] = useState<string | null>(remoteUrl ?? null)
  const [loading, setLoading] = useState(Boolean(assetId))

  useEffect(() => {
    let cancelled = false

    if (!assetId) {
      setSrc(remoteUrl ?? null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    void (async () => {
      try {
        await assetManager.getAsset(assetId)
        const resolved = await assetManager.resolveAssetUrl(assetId)
        if (cancelled) return
        setSrc(resolved ?? remoteUrl ?? null)
      } catch {
        if (cancelled) return
        setSrc(remoteUrl ?? null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assetId, assetHash, remoteUrl])

  return { src, loading }
}

function MediaEmpty({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-3">
      <p className="text-xs text-muted-foreground" title={label}>
        {label}
      </p>
    </div>
  )
}

function TextBody({ node }: { node: ContentNodeSpec }) {
  const [content, setContent] = useState(node.content ?? '')

  useEffect(() => {
    setContent(node.content ?? '')
  }, [node.content])

  return (
    <>
      <div className="flex shrink-0 items-center px-3 py-1.5">
        <span className="min-w-0 truncate text-xs font-medium text-foreground" title={node.label}>
          {node.label || '文本'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3" onPointerDown={stopNodeGesture}>
        <RichTextEditor
          key={node.id}
          value={content}
          markdownSource
          onChange={(value) => {
            setContent(value)
            patchContent(node.id, { content: value })
          }}
          onCommit={() => {
            useGraphStore.getState().commitHistory()
          }}
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
  if (!src) return <MediaEmpty label="暂无图片" />
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-muted/20" onPointerDown={stopNodeGesture}>
      <img src={src} alt={node.label || '图片'} className="h-full w-full object-contain" draggable={false} />
    </div>
  )
}

function VideoBody({ node }: { node: ContentNodeSpec }) {
  const { src, loading } = useResolvedMediaSrc(node)
  if (loading && !src) return <MediaEmpty label="视频加载中" />
  if (!src) return <MediaEmpty label="暂无视频" />
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-black" onPointerDown={stopNodeGesture}>
      <video src={src} className="h-full w-full object-contain" controls playsInline preload="metadata" />
    </div>
  )
}

function PlaceholderBody({ node }: { node: ContentNodeSpec }) {
  const meta = placeholderMeta(node.category)
  const Icon = meta.icon
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <span title={meta.label}>
        <Icon className={`h-6 w-6 ${meta.iconClass}`} aria-hidden />
      </span>
      <div className="min-w-0 max-w-full truncate text-sm font-medium text-foreground" title={node.label}>
        {node.label || meta.label}
      </div>
      <p className="text-xs text-muted-foreground">{meta.label} · 该内容类型正在迁移中</p>
    </div>
  )
}

export const ContentContent = memo(function ContentContent({ node }: ContentContentProps) {
  const { viewport } = useCanvas()
  const headerOffset = SHELL_HEADER_WORLD_PX * viewport.zoom
  const assetId = node.assetId ?? sourceAssetId(node.source)
  const assetMimeType = useRuntimeStore((state) => (assetId ? state.assets[assetId]?.mimeType : undefined))
  const viewKind = resolveViewKind(node, assetMimeType)

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
      style={{ paddingTop: headerOffset }}
      onPointerDown={stopNodeGesture}
    >
      {viewKind === 'text' ? (
        <TextBody node={node} />
      ) : viewKind === 'image' ? (
        <ImageBody node={node} />
      ) : viewKind === 'video' ? (
        <VideoBody node={node} />
      ) : (
        <PlaceholderBody node={node} />
      )}
    </div>
  )
})
