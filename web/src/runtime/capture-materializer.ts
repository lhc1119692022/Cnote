/**
 * Materialize a browser Capture onto the live graph as a text/markdown ContentNode.
 *
 * Empty-capture policy: if title, url, and text are all blank, do not create a
 * content node (no empty shell). Title/url without body still create or update
 * a node so provenance is kept. Graph writes are one setState + one commitHistory.
 */

import { nanoid } from 'nanoid'
import type {
  BrowserNodeSpec,
  Capture,
  CaptureMedia,
  ContentCategory,
  ContentNodeSpec,
  ContentSourceRef,
  ContentSubtype,
  EdgeSpec,
  FlowDocument,
  NodeSpec,
} from '@/domain'
import { CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { useGraphStore } from '@/stores/graph-store'

const DOWNSTREAM_OFFSET_X = 88
const MEDIA_STACK_GAP = 24
const inFlight = new Set<string>()

export type CaptureMaterializeResult =
  | { status: 'skipped'; reason: 'in-flight' | 'missing-document' | 'missing-browser' }
  | { status: 'applied'; contentNodeId?: string; created: boolean }

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}

function canCreateContentNode(capture: Capture): boolean {
  return Boolean(trimmed(capture.text) || trimmed(capture.title) || trimmed(capture.url))
}

function captureLabel(capture: Capture): string {
  const title = trimmed(capture.title)
  if (title) return title
  const url = trimmed(capture.url)
  if (url) {
    try {
      return new URL(url).hostname || url
    } catch {
      return url
    }
  }
  return '页面捕获'
}

function captureSource(capture: Capture): ContentSourceRef {
  const url = trimmed(capture.url)
  if (url) return { kind: 'url', url, provider: 'generic' }
  return { kind: 'text', mimeType: 'text/markdown' }
}

function contentPatch(capture: Capture): Pick<ContentNodeSpec, 'label' | 'category' | 'subtype' | 'source' | 'captureId' | 'content'> {
  return {
    label: captureLabel(capture),
    category: 'text',
    subtype: 'markdown',
    source: captureSource(capture),
    captureId: capture.id,
    content: capture.text ?? '',
  }
}

function isContentNode(node: NodeSpec | undefined): node is ContentNodeSpec {
  return node?.kind === 'content'
}

function captureMediaKind(item: CaptureMedia): 'image' | 'video' | null {
  const mime = item.mimeType || ''
  const url = item.kind === 'url' ? item.url : ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)) return 'image'
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video'
  return null
}

function mediaSource(item: CaptureMedia): ContentSourceRef | null {
  if (item.kind === 'asset') {
    return { kind: 'file', assetId: item.assetId, mimeType: item.mimeType || 'application/octet-stream' }
  }
  const url = trimmed(item.url)
  if (!url) return null
  return { kind: 'url', url, provider: 'generic' }
}

function mediaPatch(capture: Capture, item: CaptureMedia): Pick<ContentNodeSpec, 'label' | 'category' | 'subtype' | 'source' | 'captureId' | 'content'> | null {
  const kind = captureMediaKind(item)
  const source = mediaSource(item)
  if (!kind || !source) return null
  const category: ContentCategory = kind
  const subtype: ContentSubtype = kind === 'video' ? 'remote-video' : 'image'
  const label = kind === 'video' ? `${captureLabel(capture)} 视频` : `${captureLabel(capture)} 图片`
  return {
    label,
    category,
    subtype,
    source,
    captureId: capture.id,
    content: '',
  }
}

function sameMediaSource(left: ContentSourceRef | null, right: ContentSourceRef | null): boolean {
  if (left?.kind === 'url' && right?.kind === 'url') return left.url === right.url
  if (left?.kind === 'file' && right?.kind === 'file') return left.assetId === right.assetId
  return false
}

function findReusableMediaNode(
  doc: FlowDocument,
  browserId: string,
  item: CaptureMedia,
): ContentNodeSpec | undefined {
  const source = mediaSource(item)
  if (!source) return undefined
  return doc.nodes.find((node): node is ContentNodeSpec => (
    node.kind === 'content'
    && (node.category === 'image' || node.category === 'video')
    && sameMediaSource(node.source, source)
    && doc.edges.some((edge) => edge.source === browserId && edge.target === node.id)
  ))
}

function findReusableContentNode(doc: FlowDocument, browser: BrowserNodeSpec, capture: Capture): ContentNodeSpec | undefined {
  const linked = browser.linkedContentNodeId
    ? doc.nodes.find((node) => node.id === browser.linkedContentNodeId)
    : undefined
  if (isContentNode(linked)) return linked

  const byCapture = doc.nodes.find((node): node is ContentNodeSpec => (
    node.kind === 'content'
    && node.captureId === capture.id
    && doc.edges.some((edge) => edge.source === browser.id && edge.target === node.id)
  ))
  return byCapture
}

function sameSource(left: ContentSourceRef | null, right: ContentSourceRef | null): boolean {
  if (left?.kind === 'url' && right?.kind === 'url') {
    return left.url === right.url && left.provider === right.provider
  }
  if (left?.kind === 'text' && right?.kind === 'text') {
    return left.mimeType === right.mimeType
  }
  return left === right
}

function sameContentPatch(node: ContentNodeSpec, patch: ReturnType<typeof contentPatch>): boolean {
  return (
    node.label === patch.label
    && node.category === patch.category
    && node.subtype === patch.subtype
    && node.captureId === patch.captureId
    && (node.content ?? '') === (patch.content ?? '')
    && sameSource(node.source, patch.source)
  )
}

function materializeOnce(browserNodeId: string, capture: Capture): CaptureMaterializeResult {
  const doc = useGraphStore.getState().currentDocument
  if (!doc) return { status: 'skipped', reason: 'missing-document' }

  const browser = doc.nodes.find((node): node is BrowserNodeSpec => (
    node.id === browserNodeId && node.kind === 'browser'
  ))
  if (!browser) return { status: 'skipped', reason: 'missing-browser' }

  const createContent = canCreateContentNode(capture)
  const existing = createContent ? findReusableContentNode(doc, browser, capture) : undefined
  const patch = createContent ? contentPatch(capture) : null
  const nextNodes = [...doc.nodes]
  const nextEdges = [...doc.edges]
  let contentNodeId = existing?.id
  let created = false
  let changed = false

  if (createContent && patch) {
    if (existing) {
      if (!sameContentPatch(existing, patch)) {
        const index = nextNodes.findIndex((node) => node.id === existing.id)
        if (index >= 0) {
          nextNodes[index] = { ...existing, ...patch }
          changed = true
        }
      }
    } else {
      contentNodeId = nanoid()
      const createdNode: ContentNodeSpec = {
        id: contentNodeId,
        kind: 'content',
        position: {
          x: browser.position.x + browser.size.width + DOWNSTREAM_OFFSET_X,
          y: browser.position.y,
        },
        size: { width: CONTENT_NODE_DEFAULT_SIZE.width, height: CONTENT_NODE_DEFAULT_SIZE.height },
        ...patch,
      }
      nextNodes.push(createdNode)
      created = true
      changed = true
    }
  }

  if (contentNodeId && !nextEdges.some((edge) => edge.source === browser.id && edge.target === contentNodeId)) {
    const edge: EdgeSpec = {
      id: nanoid(),
      source: browser.id,
      target: contentNodeId,
      sourceHandle: 'out',
      targetHandle: 'in',
    }
    nextEdges.push(edge)
    changed = true
  }

  const mediaItems = capture.media || []
  const textNode = contentNodeId
    ? nextNodes.find((node): node is ContentNodeSpec => node.id === contentNodeId && node.kind === 'content')
    : undefined
  let mediaY = textNode
    ? textNode.position.y + textNode.size.height + MEDIA_STACK_GAP
    : browser.position.y
  const mediaX = textNode
    ? textNode.position.x
    : browser.position.x + browser.size.width + DOWNSTREAM_OFFSET_X

  for (const item of mediaItems) {
    const patch = mediaPatch(capture, item)
    if (!patch) continue
    const existingMedia = nextNodes.find((node): node is ContentNodeSpec => (
      node.kind === 'content'
      && (node.category === 'image' || node.category === 'video')
      && sameMediaSource(node.source, patch.source)
      && nextEdges.some((edge) => edge.source === browser.id && edge.target === node.id)
    )) || findReusableMediaNode(doc, browser.id, item)
    if (existingMedia) {
      const index = nextNodes.findIndex((node) => node.id === existingMedia.id)
      if (index >= 0 && !sameContentPatch(existingMedia, patch)) {
        nextNodes[index] = { ...existingMedia, ...patch }
        changed = true
      }
      if (!nextEdges.some((edge) => edge.source === browser.id && edge.target === existingMedia.id)) {
        nextEdges.push({
          id: nanoid(),
          source: browser.id,
          target: existingMedia.id,
          sourceHandle: 'out',
          targetHandle: 'in',
        })
        changed = true
      }
      mediaY = Math.max(mediaY, existingMedia.position.y + existingMedia.size.height + MEDIA_STACK_GAP)
      continue
    }
    const mediaId = nanoid()
    const mediaNode: ContentNodeSpec = {
      id: mediaId,
      kind: 'content',
      position: { x: mediaX, y: mediaY },
      size: { width: CONTENT_NODE_DEFAULT_SIZE.width, height: CONTENT_NODE_DEFAULT_SIZE.height },
      ...patch,
    }
    nextNodes.push(mediaNode)
    nextEdges.push({
      id: nanoid(),
      source: browser.id,
      target: mediaId,
      sourceHandle: 'out',
      targetHandle: 'in',
    })
    mediaY += CONTENT_NODE_DEFAULT_SIZE.height + MEDIA_STACK_GAP
    created = true
    changed = true
  }

  const browserIndex = nextNodes.findIndex((node) => node.id === browser.id)
  if (browserIndex >= 0) {
    const current = nextNodes[browserIndex]
    if (current?.kind === 'browser') {
      const nextLinked = contentNodeId ?? current.linkedContentNodeId
      if (current.latestCaptureId !== capture.id || current.linkedContentNodeId !== nextLinked) {
        nextNodes[browserIndex] = {
          ...current,
          latestCaptureId: capture.id,
          ...(nextLinked ? { linkedContentNodeId: nextLinked } : {}),
        }
        changed = true
      }
    }
  }

  if (!changed) {
    return { status: 'applied', contentNodeId, created: false }
  }

  useGraphStore.setState({
    currentDocument: {
      ...doc,
      nodes: nextNodes,
      edges: nextEdges,
      updatedAt: Date.now(),
    },
  })
  useGraphStore.getState().commitHistory()
  return { status: 'applied', contentNodeId, created }
}

export function materializeBrowserCapture(browserNodeId: string, capture: Capture): CaptureMaterializeResult {
  const token = `${browserNodeId}:${capture.id}`
  if (inFlight.has(token)) return { status: 'skipped', reason: 'in-flight' }
  inFlight.add(token)
  try {
    return materializeOnce(browserNodeId, capture)
  } finally {
    inFlight.delete(token)
  }
}
