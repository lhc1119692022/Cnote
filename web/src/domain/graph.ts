/**
 * Declarative graph document.
 *
 * A spec is what gets persisted with the Flow: identity, layout, and scalar/ref
 * configuration. It must not embed runtime objects (webview/iframe handles,
 * editor cursors, playback position, scrape snapshots, AI transcripts, or
 * generation jobs). Those live in `runtime.ts` and are referenced by id.
 */

import type { Point, Size, Viewport } from './geometry'

export type NodeKind = 'content' | 'ai' | 'request' | 'browser' | 'sticky' | 'group'

export interface BaseNodeSpec {
  id: string
  kind: NodeKind
  position: Point
  size: Size
  z?: number
  parentGroupId?: string
  disabled?: boolean
  /** User-marked favorite; persisted with the flow document. */
  favorite?: boolean
  /** Set after a user resize so content auto-height stops fighting the shell. */
  manualSize?: boolean
  label: string
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type ContentCategory =
  | 'audio'
  | 'text'
  | 'video'
  | 'social'
  | 'document'
  | 'data'
  | 'presentation'
  | 'mindmap'
  | 'image'

export type ContentSubtype =
  | 'plain-text'
  | 'markdown'
  | 'pdf'
  | 'docx'
  | 'csv'
  | 'xlsx'
  | 'youtube'
  | 'bilibili'
  | 'vimeo'
  | 'podcast'
  | 'remote-video'
  | 'xiaohongshu'
  | 'weibo'
  | 'douyin'
  | 'instagram'
  | 'social-post'
  | 'direct-video'
  | 'local-video'
  | 'image'
  | 'ppt'
  | 'pptx'
  | 'google-slides'
  | 'feishu-slides'
  | 'online-presentation'
  | 'feishu-doc'
  | 'notion'
  | 'blog'
  | 'google-sheets'
  | 'feishu-sheets'
  | 'notion-database'
  | 'online-data'
  | 'xmind'
  | 'processon'
  | 'mindnode'
  | 'online-mindmap'
  | 'markdown-mindmap'
  | 'mermaid-mindmap'
  | 'web-page'
  | 'unknown'

export type ContentUrlProvider =
  | 'youtube'
  | 'bilibili'
  | 'vimeo'
  | 'podcast'
  | 'xiaohongshu'
  | 'weibo'
  | 'douyin'
  | 'instagram'
  | 'feishu-doc'
  | 'notion'
  | 'blog'
  | 'google-sheets'
  | 'feishu-sheets'
  | 'notion-database'
  | 'google-slides'
  | 'feishu-slides'
  | 'processon'
  | 'generic'

/**
 * Origin of a content node. Bytes and checksums belong on `ContentAsset`.
 * Parsed, serializable author content (`payload`) is persisted on the spec
 * because it is the node's document, not a runtime handle.
 */
export type ContentSourceRef =
  | { kind: 'text'; mimeType: 'text/plain' | 'text/markdown' }
  | { kind: 'url'; url: string; provider?: ContentUrlProvider }
  /** `fileName` is display-only; resolution uses `assetId` + `mimeType`. */
  | { kind: 'file'; assetId: string; mimeType: string; fileName?: string }
  | { kind: 'clipboard-image'; assetId: string; mimeType: string }

/**
 * Lightweight, serializable provenance for a generated content node.
 * Optional fields may be omitted. Legacy documents may only store
 * `requestNodeId` and `variant`.
 *
 * Must not embed GenerationTask, requestSnapshot, raw responses,
 * URL tokens, secrets, or media bytes.
 */
export interface ContentGenerationProvenance {
  detached?: boolean
  requestNodeId: string
  variant: 'image' | 'video'
  runId?: string
  taskId?: string
  channelId?: string
  providerId?: string
  model?: string
  /** Stable GenerationReference ids used as inputs. */
  inputReferenceIds?: string[]
  /** ContentAsset ids used as generation inputs. */
  inputAssetIds?: string[]
  /** Upstream node ids that contributed generation inputs. */
  inputNodeIds?: string[]
  /** Epoch milliseconds when this result was materialized. */
  createdAt?: number
}

export interface ContentNodeSpec extends BaseNodeSpec {
  kind: 'content'
  category: ContentCategory | null
  subtype: ContentSubtype | null
  source: ContentSourceRef | null
  /** Library `Source` id, when this node was created from a saved source. */
  sourceId?: string
  /** Runtime `Capture` id when this node was materialized from a browser capture. Not a `ContentSourceRef`. */
  captureId?: string
  /** ContentAsset resolved/imported from `source`. Must not be set together with `content`. */
  assetId?: string
  /** Author-entered text only when `source.kind === 'text'`. Must not be set together with `assetId`. */
  content?: string
  /** Parsed, serializable author content. Not a runtime handle. */
  payload?: import('@/types/flow').ContentPayload
  preview?: import('@/types/flow').ContentPreview
  state?: import('@/types/flow').ContentState
  parse?: import('@/types/flow').ContentParseState
  /** Present when this node was materialized as a request generation result. */
  generatedBy?: ContentGenerationProvenance
  generationBatch?: { runId: string; expectedCount: number; resourceKeys: string[]; expanded?: boolean; collapsedSize?: Size }
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type AIWebSearchMode = 'auto' | 'on' | 'off'
export type AIReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AINodeSpec extends BaseNodeSpec {
  kind: 'ai'
  channelId?: string
  model?: string
  systemPrompt?: string
  prompt?: string
  temperature?: number
  maxOutputTokens?: number
  webSearch?: AIWebSearchMode
  reasoningLevel?: AIReasoningLevel
  /** Active `AISession` id. Messages live on the session, not on this spec. */
  activeSessionId?: string
}

// ---------------------------------------------------------------------------
// Request / generation
// ---------------------------------------------------------------------------

export type RequestVariant = 'body' | 'image' | 'video'

export type GenerationCapability =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'first-last-frame'
  | 'video-reference'
  | 'audio-reference'
  | 'video-edit'
  | 'generate-audio'

export type GenerationReferenceRole =
  | 'reference_image'
  | 'reference_video'
  | 'first_frame'
  | 'last_frame'
  | 'reference_voice'
  | 'reference_audio'

/** Persisted role/order/exclude for a derived or local reference id. */
export interface GenerationReferenceOverride {
  role?: GenerationReferenceRole
  order?: number
  excluded?: boolean
  compatibleCopy?: {
    sourceIdentity: string
    assetId: string
    fileName: string
    mimeType: string
    size: number
    processingKey: string
  }
}

/** Declared generation parameters. Task/run state is `GenerationRun`. */
export interface GenerationConfig {
  autoAdaptImages?: boolean
  channelId?: string
  model?: string
  /** Adapter that owns the selected model when a channel exposes several contracts. */
  adapterId?: string
  capability?: GenerationCapability
  prompt: string
  negativePrompt?: string
  /** Ordered local `ContentAsset` ids. Upstream media is derived from inbound edges. */
  referenceAssetIds?: string[]
  /** Stable referenceId-to-token bindings used by the video prompt @ picker. */
  promptMentions?: Record<string, string>
  /** Role, order, and exclude flags keyed by derived/local reference id. */
  referenceOverrides?: Record<string, GenerationReferenceOverride>
  generateAudio?: boolean
  seconds?: number
  resolution?: string
  aspectRatio?: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'standard' | string
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  outputCompression?: number
  thinkingLevel?: 'minimal' | 'high'
  outputCount?: number
}

export interface RequestNodeSpec extends BaseNodeSpec {
  kind: 'request'
  variant: RequestVariant
  image: GenerationConfig
  video: GenerationConfig
  /** Latest `GenerationRun` for this node. */
  latestRunId?: string
  /** Content nodes that should receive a completed variant's output. Legacy docs may store a single id. */
  resultNodeIds?: Partial<Record<'image' | 'video', string | string[]>>
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

export type BrowserOutputMode = 'url' | 'text' | 'both'

/** Whether the node may navigate away from its declared URL. */
export type BrowserNavigationPolicy = 'free' | 'locked'

/** When a `Capture` should be produced from the referenced session. */
export type BrowserCapturePolicy = 'manual' | 'on-load' | 'on-confirm'

/**
 * Browser node declaration. The live webview/iframe, tab status, and page
 * snapshot are *not* stored here — see `BrowserSession` and `Capture`.
 */
export interface BrowserNodeSpec extends BaseNodeSpec {
  kind: 'browser'
  /** Declared / confirmed URL. The live tab URL lives on `BrowserTab`. */
  url: string
  sessionId?: string
  /** Tab id (or URL) this node currently targets inside the session. */
  activeTarget?: string
  navigationPolicy?: BrowserNavigationPolicy
  capturePolicy?: BrowserCapturePolicy
  outputMode?: BrowserOutputMode
  latestCaptureId?: string
  /** Content node that should receive automatic captures. */
  linkedContentNodeId?: string
}

// ---------------------------------------------------------------------------
// Sticky / group
// ---------------------------------------------------------------------------

export type StickyColor = 'yellow' | 'pink' | 'green' | 'blue' | 'purple'

export interface StickyNodeSpec extends BaseNodeSpec {
  kind: 'sticky'
  content: string
  document?: import('@/types/flow').RichTextDocument
  color: StickyColor
  background: 'solid' | 'none'
  pinned?: boolean
}

export interface GroupNodeSpec extends BaseNodeSpec {
  kind: 'group'
  memberCount: number
  padding?: number
}

export type GroupSpec = GroupNodeSpec

// ---------------------------------------------------------------------------
// Graph document
// ---------------------------------------------------------------------------

export type NodeSpec =
  | ContentNodeSpec
  | AINodeSpec
  | RequestNodeSpec
  | BrowserNodeSpec
  | StickyNodeSpec
  | GroupNodeSpec

export interface EdgeSpec {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface FlowDocument {
  id: string
  name: string
  title: string
  description?: string
  viewport: Viewport
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  createdAt: number
  updatedAt: number
}
