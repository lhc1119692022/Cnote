/**
 * 旧 Flow（reactflow Node/Edge）→ 新 FlowDocument 的只读转换器。
 * 不改旧 store，不写旧 UI；失败单项跳过，不让整体迁移中断。
 */

import { nanoid } from 'nanoid'
import type {
  AINodeSpec,
  AIReasoningLevel,
  AIWebSearchMode,
  BrowserNodeSpec,
  BrowserOutputMode,
  ContentCategory,
  ContentNodeSpec,
  ContentSubtype,
  ContentUrlProvider,
  EdgeSpec,
  FlowDocument,
  GenerationConfig,
  GroupNodeSpec,
  NodeKind,
  NodeSpec,
  RequestNodeSpec,
  RequestVariant,
  StickyColor,
  StickyNodeSpec,
  Viewport,
} from '@/domain'
import localforage from '@/lib/localforage-storage'
import { appendDocumentIndex, listDocuments, saveDocument } from '@/storage'
import type { Flow, RichTextDocument } from '@/types/flow'

/** 旧 zustand persist 的 name，与 use-flow-store 保持一致。 */
const LEGACY_FLOWS_PERSIST_KEY = 'cnote-flows'

type LegacyNode = Flow['nodes'][number]
type LegacyEdge = Flow['edges'][number]

const NODE_KINDS: readonly NodeKind[] = [
  'content',
  'ai',
  'request',
  'browser',
  'sticky',
  'group',
]

const STICKY_COLORS: readonly StickyColor[] = ['yellow', 'pink', 'green', 'blue', 'purple']
const STICKY_BACKGROUNDS = ['solid', 'none'] as const
const BROWSER_OUTPUT_MODES: readonly BrowserOutputMode[] = ['url', 'text', 'both']
const AI_WEB_SEARCH: readonly AIWebSearchMode[] = ['auto', 'on', 'off']
const AI_REASONING: readonly AIReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const REQUEST_VARIANTS: readonly RequestVariant[] = ['body', 'image', 'video', 'workflow']

const CONTENT_CATEGORIES: readonly ContentCategory[] = [
  'text',
  'video',
  'social',
  'document',
  'data',
  'presentation',
  'mindmap',
  'image',
]

const CONTENT_SUBTYPES: readonly ContentSubtype[] = [
  'plain-text',
  'markdown',
  'pdf',
  'docx',
  'csv',
  'xlsx',
  'youtube',
  'bilibili',
  'vimeo',
  'podcast',
  'remote-video',
  'xiaohongshu',
  'weibo',
  'douyin',
  'instagram',
  'social-post',
  'direct-video',
  'local-video',
  'image',
  'ppt',
  'pptx',
  'google-slides',
  'feishu-slides',
  'online-presentation',
  'feishu-doc',
  'notion',
  'blog',
  'google-sheets',
  'feishu-sheets',
  'notion-database',
  'online-data',
  'xmind',
  'processon',
  'mindnode',
  'online-mindmap',
  'markdown-mindmap',
  'mermaid-mindmap',
  'web-page',
  'unknown',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function pickEnumOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function pickEnumOrUndefined<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && (NODE_KINDS as readonly string[]).includes(value)
}

/** CSS 尺寸可能是 number / "240px"；非法或 <=0 用 fallback。 */
function readCssSize(value: unknown, fallback: number): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function readPosition(node: LegacyNode): { x: number; y: number } {
  const x = Number(node.position?.x)
  const y = Number(node.position?.y)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  }
}

function readSize(node: LegacyNode): { width: number; height: number } {
  const style = node.style
  return {
    width: readCssSize(style?.width ?? node.width ?? 240, 240),
    height: readCssSize(style?.height ?? node.height ?? 160, 160),
  }
}

function readParentGroupId(node: LegacyNode): string | undefined {
  const parent = node.parentNode
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined
}

function readZ(node: LegacyNode): number | undefined {
  const z = node.zIndex
  return typeof z === 'number' && Number.isFinite(z) ? z : undefined
}

function readViewport(raw: Flow['viewport']): Viewport {
  const x = Number(raw?.x)
  const y = Number(raw?.y)
  const zoom = Number(raw?.zoom)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  }
}

function readTimestamp(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function optionalHandle(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

type SharedBase = {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  label: string
  parentGroupId?: string
  z?: number
  disabled?: boolean
}

/** 旧 GenerationVariantConfig → 新 GenerationConfig；references 等后续阶段补齐。 */
function mapGenerationConfig(raw: unknown): GenerationConfig {
  const rec = asRecord(raw)
  const outputCount = asFiniteNumber(rec?.outputCount)
  const negativePrompt = asString(rec?.negativePrompt)
  const resolution = asString(rec?.resolution)
  const aspectRatio = asString(rec?.aspectRatio)
  const model = asString(rec?.model)
  return {
    prompt: String(rec?.prompt ?? ''),
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(outputCount !== undefined ? { outputCount } : {}),
  }
}

function mapSticky(base: SharedBase, data: Record<string, unknown>): StickyNodeSpec {
  const background = pickEnum(data.background, STICKY_BACKGROUNDS, 'solid')
  const content = String(data.content ?? data.text ?? '')
  const document = data.document as Partial<RichTextDocument> | undefined
  const validDocument = document?.version === 1 && document.format === 'tiptap-json'
    && document.plainText === content && document.json?.type === 'doc'
  return {
    ...base,
    kind: 'sticky',
    content,
    ...(validDocument ? { document: JSON.parse(JSON.stringify(document)) as RichTextDocument } : {}),
    color: pickEnum(data.color, STICKY_COLORS, 'yellow'),
    background,
    pinned: Boolean(data.pinned),
  }
}

function mapBrowser(base: SharedBase, data: Record<string, unknown>): BrowserNodeSpec {
  const linkedContentNodeId = asString(data.linkedContentNodeId)
  return {
    ...base,
    kind: 'browser',
    url: String(data.confirmedUrl ?? data.url ?? ''),
    outputMode: pickEnum(data.outputMode, BROWSER_OUTPUT_MODES, 'url'),
    ...(linkedContentNodeId ? { linkedContentNodeId } : {}),
    // navigationPolicy / capturePolicy / sessionId / activeTarget 旧数据没有，先不填
  }
}

function mapAi(base: SharedBase, data: Record<string, unknown>): AINodeSpec {
  const channelId = asString(data.channelId)
  const model = asString(data.model)
  const systemPrompt = asString(data.systemPrompt)
  const prompt = asString(data.prompt) ?? asString(data.userPrompt)
  const maxOutputTokens = asFiniteNumber(data.maxOutputTokens)
  const webSearch = pickEnumOrUndefined(data.webSearch, AI_WEB_SEARCH)
  const reasoningLevel = pickEnumOrUndefined(data.reasoningLevel, AI_REASONING)
  return {
    ...base,
    kind: 'ai',
    ...(channelId !== undefined ? { channelId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(webSearch !== undefined ? { webSearch } : {}),
    ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
  }
}

function mapRequest(base: SharedBase, data: Record<string, unknown>): RequestNodeSpec {
  return {
    ...base,
    kind: 'request',
    variant: pickEnum(data.variant, REQUEST_VARIANTS, 'body'),
    image: mapGenerationConfig(data.image),
    video: mapGenerationConfig(data.video),
  }
}

function mapContentSource(raw: unknown): ContentNodeSpec['source'] {
  const source = asRecord(raw)
  if (!source || typeof source.kind !== 'string') return null
  if (source.kind === 'text') {
    const mimeType = source.mimeType === 'text/markdown' ? 'text/markdown' : 'text/plain'
    return { kind: 'text', mimeType }
  }
  if (source.kind === 'url') {
    const url = asString(source.normalizedUrl) ?? asString(source.url) ?? asString(source.originalUrl)
    if (!url) return null
    const provider = typeof source.provider === 'string' ? source.provider as ContentUrlProvider : undefined
    return { kind: 'url', url, ...(provider ? { provider } : {}) }
  }
  if (source.kind === 'file' || source.kind === 'clipboard-image') {
    const assetId = asString(source.resourceId) ?? asString(source.assetId)
    const mimeType = asString(source.mimeType) ?? 'application/octet-stream'
    if (!assetId) return null
    if (source.kind === 'file') {
      return { kind: 'file', assetId, mimeType, ...(asString(source.fileName) ? { fileName: asString(source.fileName) } : {}) }
    }
    return { kind: 'clipboard-image', assetId, mimeType }
  }
  return null
}

function mapContent(base: SharedBase, data: Record<string, unknown>): ContentNodeSpec {
  const payload = asRecord(data.payload)
  let content: string | undefined
  if (payload?.kind === 'text') {
    content = String(payload.value ?? data.content ?? '')
  } else if (typeof data.content === 'string') {
    content = data.content
  }
  const source = mapContentSource(data.source)
  const assetId = source && (source.kind === 'file' || source.kind === 'clipboard-image') ? source.assetId : undefined
  const preview = asRecord(data.preview) as ContentNodeSpec['preview'] | undefined
  const parse = asRecord(data.parse) as ContentNodeSpec['parse'] | undefined
  const state = typeof data.state === 'string' ? data.state as ContentNodeSpec['state'] : undefined
  const sourceId = asString(data.sourceId)
  return {
    ...base,
    kind: 'content',
    category: pickEnumOrNull(data.category, CONTENT_CATEGORIES),
    subtype: pickEnumOrNull(data.subtype, CONTENT_SUBTYPES),
    source,
    ...(assetId ? { assetId } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(payload ? { payload: data.payload as ContentNodeSpec['payload'] } : {}),
    ...(preview ? { preview } : {}),
    ...(state ? { state } : {}),
    ...(parse ? { parse } : {}),
    ...(sourceId ? { sourceId } : {}),
  }
}

function mapGroup(base: SharedBase, data: Record<string, unknown>): GroupNodeSpec {
  const memberCount = asFiniteNumber(data.memberCount) ?? 0
  const padding = asFiniteNumber(data.padding)
  return {
    ...base,
    kind: 'group',
    memberCount: memberCount >= 0 ? memberCount : 0,
    ...(padding !== undefined ? { padding } : {}),
  }
}

function mapLegacyNode(node: LegacyNode): NodeSpec | null {
  if (!node || typeof node.id !== 'string' || node.id.length === 0) return null
  if (!isNodeKind(node.type)) return null
  const data = asRecord(node.data) ?? {}
  const base: SharedBase = {
    id: node.id,
    position: readPosition(node),
    size: readSize(node),
    label: String(data.label || ''),
    parentGroupId: readParentGroupId(node),
    z: readZ(node),
    disabled: Boolean(data.disabled ?? data.disabledByUser ?? data.resourceLost),
  }
  switch (node.type) {
    case 'sticky':
      return mapSticky(base, data)
    case 'browser':
      return mapBrowser(base, data)
    case 'ai':
      return mapAi(base, data)
    case 'request':
      return mapRequest(base, data)
    case 'content':
      return mapContent(base, data)
    case 'group':
      return mapGroup(base, data)
    default:
      return null
  }
}

function mapLegacyEdge(edge: LegacyEdge): EdgeSpec | null {
  if (!edge) return null
  const id = typeof edge.id === 'string' ? edge.id : ''
  const source = typeof edge.source === 'string' ? edge.source : ''
  const target = typeof edge.target === 'string' ? edge.target : ''
  if (!id || !source || !target) return null
  return {
    id,
    source,
    target,
    sourceHandle: optionalHandle(edge.sourceHandle),
    targetHandle: optionalHandle(edge.targetHandle),
  }
}

export function legacyFlowToDocument(flow: Flow): FlowDocument {
  const now = Date.now()
  const nodes = Array.isArray(flow.nodes)
    ? flow.nodes.map(mapLegacyNode).filter((node): node is NodeSpec => node != null)
    : []
  const edges = Array.isArray(flow.edges)
    ? flow.edges.map(mapLegacyEdge).filter((edge): edge is EdgeSpec => edge != null)
    : []
  const name = String(flow.name || flow.title || '未命名')
  const title = String(flow.title || flow.name || name)
  const description = typeof flow.description === 'string' ? flow.description : undefined
  return {
    id: typeof flow.id === 'string' && flow.id.length > 0 ? flow.id : nanoid(),
    name,
    title,
    ...(description !== undefined ? { description } : {}),
    viewport: readViewport(flow.viewport),
    nodes,
    edges,
    createdAt: readTimestamp(flow.createdAt, now),
    updatedAt: readTimestamp(flow.updatedAt, now),
  }
}

/** 从旧 persist JSON 中取出 Flow[]；解析失败返回空。 */
function readLegacyPersistedFlows(raw: unknown): Flow[] {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (!isRecord(value)) return []
  const state = isRecord(value.state) ? value.state : value
  const flows = state.flows
  if (!Array.isArray(flows)) return []
  return flows.filter(
    (item): item is Flow => isRecord(item) && typeof item.id === 'string' && item.id.length > 0,
  )
}

/**
 * 直接读旧 persist（localforage key = cnote-flows）写入新文档存储。
 * 已存在同 id 则跳过（不重复 append index）；单项失败跳过并继续。
 */
export async function migrateLegacyFlows(): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0
  let skipped = 0
  try {
    const raw = await localforage.getItem<string>(LEGACY_FLOWS_PERSIST_KEY)
    if (raw == null) return { migrated: 0, skipped: 0 }
    const flows = readLegacyPersistedFlows(raw)
    if (flows.length === 0) return { migrated: 0, skipped: 0 }

    let existingIds = new Set<string>()
    try {
      existingIds = new Set((await listDocuments()).map((doc) => doc.id))
    } catch {
      existingIds = new Set()
    }

    for (const flow of flows) {
      try {
        if (existingIds.has(flow.id)) {
          skipped += 1
          continue
        }
        const doc = legacyFlowToDocument(flow)
        await saveDocument(doc)
        await appendDocumentIndex(doc.id)
        existingIds.add(doc.id)
        migrated += 1
      } catch {
        skipped += 1
      }
    }
  } catch {
    // 整体失败也返回已累计的统计，不向外抛
  }
  return { migrated, skipped }
}
