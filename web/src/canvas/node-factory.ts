import { nanoid } from 'nanoid'
import { screenToWorld } from '@/canvas'
import type {
  ContentNodeSpec,
  GenerationConfig,
  NodeKind,
  NodeSpec,
  Point,
  Size,
  Viewport,
} from '@/domain'
import {
  AI_NODE_DEFAULT_SIZE,
  BROWSER_NODE_DEFAULT_SIZE,
  CONTENT_NODE_DEFAULT_SIZE,
  REQUEST_NODE_DEFAULT_SIZE,
  STICKY_NODE_DEFAULT_SIZE,
} from '@/lib/flow/node-dimensions'
import type { ContentNodeData, Source } from '@/types/flow'
import { useGraphStore } from '@/stores/graph-store'

export type AddableKind = Exclude<NodeKind, 'group'>

const DEFAULT_BROWSER_URL = 'https://www.google.com/'

export function defaultSizeFor(kind: AddableKind): Size {
  switch (kind) {
    case 'sticky':
      return { width: STICKY_NODE_DEFAULT_SIZE.width, height: STICKY_NODE_DEFAULT_SIZE.height }
    case 'browser':
      return { width: BROWSER_NODE_DEFAULT_SIZE.width, height: BROWSER_NODE_DEFAULT_SIZE.height }
    case 'ai':
      return { width: AI_NODE_DEFAULT_SIZE.width, height: AI_NODE_DEFAULT_SIZE.height }
    case 'request':
      return { width: REQUEST_NODE_DEFAULT_SIZE.width, height: REQUEST_NODE_DEFAULT_SIZE.height }
    case 'content':
      return { width: CONTENT_NODE_DEFAULT_SIZE.width, height: CONTENT_NODE_DEFAULT_SIZE.height }
  }
}

export function defaultLabelFor(kind: AddableKind): string {
  switch (kind) {
    case 'sticky':
      return '贴纸'
    case 'browser':
      return '浏览器节点'
    case 'ai':
      return 'AI 节点'
    case 'request':
      return '请求体'
    case 'content':
      return '内容类型选择'
  }
}

function emptyGenerationConfig(variant: 'image' | 'video'): GenerationConfig {
  if (variant === 'image') {
    return { prompt: '', capability: 'text-to-image', resolution: 'auto', aspectRatio: '16:9' }
  }
  return {
    prompt: '',
    capability: 'reference-to-video',
    seconds: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    generateAudio: true,
  }
}

export function viewportCenterPosition(container: Size, view: Viewport, nodeSize: Size, inset = { left: 0, right: 0 }): Point {
  const width = container.width > 0 ? container.width : window.innerWidth
  const height = container.height > 0 ? container.height : window.innerHeight
  const world = screenToWorld({
    x: inset.left + (width - inset.left - inset.right) / 2,
    y: height / 2,
  }, view)
  return {
    x: world.x - nodeSize.width / 2,
    y: world.y - nodeSize.height / 2,
  }
}

export function createAddableNode(kind: AddableKind, position: Point): NodeSpec {
  const size = defaultSizeFor(kind)
  const label = defaultLabelFor(kind)
  const id = nanoid()
  switch (kind) {
    case 'sticky':
      return { id, kind, position, size, label, content: '', color: 'yellow', background: 'solid' }
    case 'browser':
      return { id, kind, position, size, label, url: DEFAULT_BROWSER_URL }
    case 'ai':
      return { id, kind, position, size, label, systemPrompt: 'Generate content based on the inputs.', prompt: '', webSearch: 'auto', reasoningLevel: 'medium' }
    case 'request':
      return {
        id,
        kind,
        position,
        size,
        label,
        variant: 'body',
        image: emptyGenerationConfig('image'),
        video: emptyGenerationConfig('video'),
      }
    case 'content':
      return { id, kind, position, size, label, category: null, subtype: null, source: null, state: 'empty' }
  }
}

export function addNodeAtViewportCenter(kind: AddableKind, container: Size, inset = { left: 0, right: 0 }): NodeSpec {
  const view = useGraphStore.getState().view
  const size = defaultSizeFor(kind)
  const node = createAddableNode(kind, viewportCenterPosition(container, view, size, inset))
  useGraphStore.getState().addNode(node)
  return node
}

export function addNodeAtClient(kind: AddableKind, clientX: number, clientY: number, container: HTMLElement | null): NodeSpec {
  const view = useGraphStore.getState().view
  const size = defaultSizeFor(kind)
  const rect = container?.getBoundingClientRect()
  const world = screenToWorld({
    x: clientX - (rect?.left ?? 0),
    y: clientY - (rect?.top ?? 0),
  }, view)
  const node = createAddableNode(kind, {
    x: world.x - size.width / 2,
    y: world.y - size.height / 2,
  })
  useGraphStore.getState().addNode(node)
  return node
}

export function contentDataToSpec(
  data: ContentNodeData,
  position: Point,
  size: Size = defaultSizeFor('content'),
  id = nanoid(),
): ContentNodeSpec {
  const source = data.source
  let sourceRef: ContentNodeSpec['source'] = null
  let assetId: string | undefined
  let content: string | undefined
  if (source?.kind === 'text') {
    sourceRef = { kind: 'text', mimeType: source.mimeType }
    content = source.text
  } else if (source?.kind === 'url') {
    sourceRef = { kind: 'url', url: source.normalizedUrl, provider: source.provider }
  } else if (source?.kind === 'file') {
    sourceRef = { kind: 'file', assetId: source.resourceId, mimeType: source.mimeType, fileName: source.fileName }
    assetId = source.resourceId
  } else if (source?.kind === 'clipboard-image') {
    sourceRef = { kind: 'clipboard-image', assetId: source.resourceId, mimeType: source.mimeType }
    assetId = source.resourceId
  }
  if (data.payload?.kind === 'text') content = data.payload.value
  return {
    id,
    kind: 'content',
    position,
    size,
    label: data.label || '内容',
    category: data.category,
    subtype: data.subtype,
    source: sourceRef,
    sourceId: data.sourceId,
    ...(assetId ? { assetId } : {}),
    ...(content !== undefined ? { content } : {}),
    payload: data.payload,
    preview: data.preview,
    state: data.state,
    parse: data.parse,
    disabled: data.disabled,
  }
}

export function addLibrarySource(item: Source, container: Size, inset = { left: 0, right: 0 }): ContentNodeSpec {
  const view = useGraphStore.getState().view
  const size = defaultSizeFor('content')
  const node = contentDataToSpec(
    { ...item.nodeData, label: item.title, sourceId: undefined },
    viewportCenterPosition(container, view, size, inset),
    size,
  )
  useGraphStore.getState().addNode(node)
  return node
}

export function arrangeDocumentNodes(): void {
  const { currentDocument: doc, isLocked } = useGraphStore.getState()
  if (!doc || isLocked || doc.nodes.length === 0) return
  const groupIds = new Set(doc.nodes.filter((node) => node.kind === 'group').map((node) => node.id))
  const roots = doc.nodes.filter((node) => !node.parentGroupId || !groupIds.has(node.parentGroupId))
  const offsets = new Map<string, Point>()
  const gap = 48
  const cols = Math.max(1, Math.ceil(Math.sqrt(roots.length)))
  let x = 80
  let y = 80
  let col = 0
  let rowHeight = 0
  roots.forEach((node) => {
    const pinned = (node.kind === 'sticky' && node.pinned) || doc.nodes.some((member) => member.parentGroupId === node.id && member.kind === 'sticky' && member.pinned)
    if (!pinned) offsets.set(node.id, { x: x - node.position.x, y: y - node.position.y })
    col += 1
    rowHeight = Math.max(rowHeight, node.size.height)
    if (col >= cols) {
      col = 0
      x = 80
      y += rowHeight + gap
      rowHeight = 0
    } else {
      x += node.size.width + gap
    }
  })
  const nodes = doc.nodes.map((node) => {
    const offset = offsets.get(node.parentGroupId ?? '') ?? offsets.get(node.id)
    return offset ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } : node
  })
  useGraphStore.setState({
    currentDocument: { ...doc, nodes, updatedAt: Date.now() },
  })
  useGraphStore.getState().commitHistory()
}
