import type { Node } from 'reactflow'
import type { ContentNodeData } from '@/types/flow'
import { getNodeMediaItems } from '@/lib/content-media'
import { resolveSourceBlob } from '@/lib/content-import'
import { getContentServiceClient } from '@/lib/content-service'
import type { AIContextEntry, AIImageInput } from './ai-prompt'

function uniqueText(parts: Array<string | undefined>) {
  return Array.from(new Set(parts.map((part) => part?.trim() || '').filter(Boolean))).join('\n\n')
}

function parsedContentText(data: ContentNodeData) {
  const payload = data.payload
  if (payload?.kind === 'text') return payload.value
  if (payload?.kind === 'document') return payload.plainText || payload.rawText || ''
  if (payload?.kind === 'social') {
    const blockText = payload.contentBlocks.flatMap((block) => {
      if (block.type === 'text') return block.text.trim() ? [block.text.trim()] : []
      if (block.type === 'mention') return [`@${block.name}`]
      if (block.type === 'link') return [block.title || block.url]
      return []
    })
    return uniqueText([
      payload.title,
      payload.bodyText,
      ...blockText,
      payload.topics?.length ? payload.topics.map((topic) => `#${topic}`).join(' ') : '',
      [payload.author?.name, payload.publishedAt].filter(Boolean).join(' · '),
    ])
  }
  if (payload?.kind === 'video') return uniqueText([payload.title, payload.transcript, data.preview?.description])
  if (payload?.kind === 'image') return uniqueText([payload.alt, data.preview?.title, data.preview?.description])
  if (payload?.kind === 'presentation') return uniqueText([
    payload.title,
    payload.slides?.map((slide) => [slide.title, slide.text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n'),
    payload.outline?.join('\n'),
  ])
  if (payload?.kind === 'mindmap') {
    const lines: string[] = []
    const visit = (item: typeof payload.root, depth: number) => {
      lines.push(`${'  '.repeat(depth)}${item.text}`)
      item.children.forEach((child) => visit(child, depth + 1))
    }
    visit(payload.root, 0)
    return lines.join('\n')
  }
  if (payload?.kind === 'data') {
    return payload.sheets.flatMap((sheet) => [sheet.columns.join('\t'), ...sheet.rows.map((row) => row.join('\t'))]).join('\n')
  }
  if (data.source?.kind === 'text') return data.source.text
  return uniqueText([data.preview?.title, data.preview?.description])
}

/** Text sent from a connected node to an AI node. URL-backed content keeps both the address and parsed body. */
export function textForAIContextNode(node: Node) {
  const data = node.data as ContentNodeData | undefined
  if (node.type === 'content' && data) {
    const sourceUrl = data.source?.kind === 'url'
      ? data.source.normalizedUrl
      : data.payload?.kind === 'social'
        ? data.payload.canonicalUrl
        : data.payload?.kind === 'video'
          ? data.payload.url
          : undefined
    return uniqueText([sourceUrl, parsedContentText(data)])
  }
  if (node.type === 'ai') return String((node.data as any)?.output || [...((node.data as any)?.messages || [])].reverse().find((message: { role?: string }) => message.role === 'assistant')?.content || '')
  if (node.type === 'browser') {
    const browserData = node.data as any
    const url = String(browserData.confirmedUrl || browserData.url || '').trim()
    const text = String(browserData.snapshot?.text || browserData.extractedContent || '').trim()
    const outputMode = browserData.outputMode || (browserData.extractedContent ? 'text' : 'url')
    if (outputMode === 'url') return url
    if (outputMode === 'text') return text
    return uniqueText([url, text])
  }
  if (node.type === 'sticky') return String((node.data as any)?.content || '')
  return String((node.data as any)?.text || (node.data as any)?.label || '')
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
    const text = textForAIContextNode(source).trim()
    if (text || images.length) entries.push({ nodeId: source.id, label: String(source.data?.label || '上游节点'), text, images })
  }
  return entries
}
