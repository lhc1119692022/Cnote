import type { Node } from 'reactflow'
import type { ContentMediaItem, ContentNodeData, RemoteMediaRef } from '@/types/flow'

export type ContentMediaKind = 'image' | 'video'

function uniqueMediaItems(items: ContentMediaItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.resource.url || seen.has(item.resource.url)) return false
    seen.add(item.resource.url)
    return true
  })
}

function singleItem(resource?: RemoteMediaRef, label?: string): ContentMediaItem[] {
  return resource?.url ? [{ resource, label }] : []
}

/** Returns a normalized media collection from social, image, or video content. */
export function getNodeMediaItems(node: Pick<Node, 'type' | 'data'> | undefined, kind: ContentMediaKind): ContentMediaItem[] {
  if (!node || node.type !== 'content') return []
  const data = node.data as ContentNodeData
  const payload = data.payload

  if (payload?.kind === 'social') {
    const items = payload.contentBlocks.flatMap((block, index) => {
      if (kind === 'image' && block.type === 'image') return [{ resource: block.resource, label: block.caption || `图片 ${index + 1}` }]
      if (kind === 'image' && block.type === 'live-photo') return [{ resource: block.image, label: `实况图片 ${index + 1}` }]
      if (kind === 'video' && block.type === 'video') return [{ resource: block.resource, poster: block.poster, label: `视频 ${index + 1}` }]
      if (kind === 'video' && block.type === 'live-photo' && block.motionVideo) return [{ resource: block.motionVideo, poster: block.image, label: `实况视频 ${index + 1}` }]
      return []
    })
    return uniqueMediaItems(items)
  }

  if (kind === 'image' && payload?.kind === 'image') {
    return uniqueMediaItems(payload.resources?.length ? payload.resources : singleItem(
      data.preview?.thumbnailUrl ? { url: data.preview.thumbnailUrl, width: payload.width, height: payload.height } : undefined,
      payload.alt || data.preview?.title,
    ))
  }

  if (kind === 'video' && payload?.kind === 'video') {
    // Provider page URLs (YouTube embeds, preview pages, podcasts) are not
    // directly playable <video> resources. Treat only explicit media
    // resources or direct-video payloads as items for the native player.
    if (payload.provider === 'youtube' || payload.playback === 'embed' || payload.playback === 'preview' || payload.playback === 'audio') return []
    return uniqueMediaItems(payload.resources?.length ? payload.resources : singleItem(
      payload.playback === 'video' && payload.url
        ? { url: payload.url, width: payload.width, height: payload.height }
        : undefined,
      payload.title || data.preview?.title,
    ))
  }

  return []
}

export function getActiveMediaIndex(items: ContentMediaItem[], index?: number) {
  return Math.min(Math.max(0, Number.isInteger(index) ? Number(index) : 0), Math.max(0, items.length - 1))
}

export function getActiveMediaItem(items: ContentMediaItem[], index?: number) {
  return items[getActiveMediaIndex(items, index)]
}

/** Returns the tallest known media ratio (height / width) in a collection. */
export function getMaxMediaAspectRatio(items: ContentMediaItem[], fallback = 4 / 3) {
  const ratios = items
    .map((item) => {
      const width = Number(item.resource.width)
      const height = Number(item.resource.height)
      return width > 0 && height > 0 ? height / width : 0
    })
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
  return ratios.length ? Math.max(...ratios) : fallback
}
