import type { Node } from 'reactflow'
import type { ContentNodeData } from '@/types/flow'
import { getNodeMediaItems } from '@/lib/content-media'
import { resolveSourceBlob } from '@/lib/content-import'
import { getContentServiceClient } from '@/lib/content-service'
import type { AIContextEntry, AIImageInput } from './ai-prompt'

function textForNode(node: Node) {
  const data = node.data as ContentNodeData | undefined
  if (node.type !== 'content' || !data) return String((node.data as any)?.label || '')
  const payload = data.payload
  if (payload?.kind === 'text') return payload.value
  if (payload?.kind === 'document') return payload.plainText || payload.rawText || ''
  if (payload?.kind === 'social') {
    return [payload.title, payload.bodyText, payload.topics?.map((topic) => `#${topic}`).join(' ') || '']
      .filter(Boolean)
      .join('\n\n')
  }
  if (payload?.kind === 'video') return [payload.title, payload.transcript].filter(Boolean).join('\n\n')
  if (payload?.kind === 'image') return [payload.alt, data.preview?.title, data.preview?.description].filter(Boolean).join('\n')
  return [data.preview?.title, data.preview?.description].filter(Boolean).join('\n')
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      const comma = value.indexOf(',')
      resolve(comma >= 0 ? value.slice(comma + 1) : value)
    }
    reader.onerror = () => reject(reader.error || new Error('无法读取图片'))
    reader.readAsDataURL(blob)
  })
}

async function imageInputForNode(node: Node, url: string): Promise<AIImageInput | undefined> {
  const data = node.data as ContentNodeData | undefined
  const source = data?.source
  if (source?.kind === 'file' || source?.kind === 'clipboard-image') {
    const blob = await resolveSourceBlob(source)
    if (blob) return { kind: 'base64', mediaType: blob.type || source.mimeType || 'image/png', data: await blobToBase64(blob) }
  }
  if (!url) return undefined
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s)
    if (match) return { kind: 'base64', mediaType: match[1], data: match[2] }
  }
  try {
    const hostname = new URL(url).hostname
    if (/(?:^|\.)xhscdn\.(?:com|net)$/i.test(hostname)) {
      const blob = await getContentServiceClient('social').fetchXiaohongshuMedia(url)
      return { kind: 'base64', mediaType: blob.type || 'image/jpeg', data: await blobToBase64(blob) }
    }
  } catch {
    // Fall through to a normal remote URL when the media proxy is unavailable.
  }
  return { kind: 'url', url }
}

/** Builds AI context entries and resolves local images into model-ready data. */
export async function buildAIContextEntries(nodes: Node[], sourceIds: string[]) {
  const entries: AIContextEntry[] = []
  for (const sourceId of [...new Set(sourceIds)]) {
    const source = nodes.find((node) => node.id === sourceId)
    if (!source) continue
    const data = source.data as ContentNodeData | undefined
    const images: AIImageInput[] = []
    if (source.type === 'content' && data?.category !== 'video') {
      const mediaItems = getNodeMediaItems(source, 'image')
      const localImageFallback = mediaItems.length === 0 && data?.category === 'image' && (data?.source?.kind === 'file' || data?.source?.kind === 'clipboard-image')
        ? [await imageInputForNode(source, '')]
        : []
      const resolvedImages = await Promise.all([
        ...mediaItems.map((item) => imageInputForNode(source, item.resource.url)),
        ...localImageFallback,
      ])
      resolvedImages.forEach((input) => { if (input) images.push(input) })
    }
    const text = textForNode(source).trim()
    if (text || images.length) entries.push({ nodeId: source.id, label: String(source.data?.label || '上游节点'), text, images })
  }
  return entries
}
