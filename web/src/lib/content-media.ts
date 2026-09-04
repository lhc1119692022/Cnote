import type { Node } from 'reactflow'
import type { ContentMediaItem, ContentNodeData, RemoteMediaRef } from '@/types/flow'

export type ContentMediaKind = 'image' | 'video'

function uniqueMediaItems(items: ContentMediaItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.resource.url || item.resource.resourceId
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function singleItem(resource?: RemoteMediaRef, label?: string): ContentMediaItem[] {
  return resource && (resource.url || resource.resourceId) ? [{ resource, label }] : []
}

function isLikelyDirectImageURL(value: string) {
  try {
    return /\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|\/)/i.test(new URL(value).pathname)
  } catch {
    return false
  }
}

function sourceMediaItem(data: ContentNodeData, kind: ContentMediaKind, label?: string): ContentMediaItem[] {
  const source = data.source
  if (!source) return []

  if (source.kind === 'file' || source.kind === 'clipboard-image') {
    const mimeType = source.mimeType.toLowerCase()
    const matchesKind = kind === 'image' ? mimeType.startsWith('image/') : mimeType.startsWith('video/')
    return matchesKind
      ? singleItem({ url: '', resourceId: source.resourceId, mimeType }, label)
      : []
  }

  if (source.kind === 'url') {
    // Keep a preview URL for the canvas while retaining the original URL for
    // generation inputs. A page thumbnail is not necessarily the provider's source.
    const directImage = kind === 'image' && isLikelyDirectImageURL(source.normalizedUrl)
    const previewUrl = data.preview?.thumbnailUrl
    return singleItem({
      url: previewUrl || source.normalizedUrl,
      sourceUrl: directImage || !previewUrl ? source.normalizedUrl : undefined,
    }, label)
  }

  return []
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
    const label = payload.alt || data.preview?.title
    const fallback = sourceMediaItem(data, kind, label)
    return uniqueMediaItems(payload.resources?.length ? payload.resources : fallback.length ? fallback : singleItem(
      data.preview?.thumbnailUrl ? { url: data.preview.thumbnailUrl, width: payload.width, height: payload.height } : undefined,
      label,
    ))
  }

  if (kind === 'video' && payload?.kind === 'video') {
    // Provider page URLs (YouTube embeds, preview pages, podcasts) are not
    // directly playable <video> resources. Treat only explicit media
    // resources or direct-video payloads as items for the native player.
    if (payload.provider === 'youtube' || payload.playback === 'embed' || payload.playback === 'preview' || payload.playback === 'audio') return []
    const label = payload.title || data.preview?.title
    const fallback = payload.playback === 'video' && payload.url
      ? singleItem({ url: payload.url, width: payload.width, height: payload.height }, label)
      : sourceMediaItem(data, kind, label)
    return uniqueMediaItems(payload.resources?.length ? payload.resources : fallback)
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
