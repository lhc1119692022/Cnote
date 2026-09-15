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
  label: string
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type ContentCategory =
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
 * Origin of a content node. Bytes, checksums, and parsed payloads belong on
 * `ContentAsset` / `Capture` — this only records how the node was sourced.
 */
export type ContentSourceRef =
  | { kind: 'text'; mimeType: 'text/plain' | 'text/markdown' }
  | { kind: 'url'; url: string; provider?: ContentUrlProvider }
  /** `fileName` is display-only; resolution uses `assetId` + `mimeType`. */
  | { kind: 'file'; assetId: string; mimeType: string; fileName?: string }
  | { kind: 'clipboard-image'; assetId: string; mimeType: string }

export interface ContentNodeSpec extends BaseNodeSpec {
  kind: 'content'
  category: ContentCategory | null
  subtype: ContentSubtype | null
  source: ContentSourceRef | null
  /** Library `Source` id, when this node was created from a saved source. */
  sourceId?: string
  /** ContentAsset resolved/imported from `source`. Must not be set together with `content`. */
  assetId?: string
  /** Author-entered text only when `source.kind === 'text'`. Must not be set together with `assetId`. */
  content?: string
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

/** Declared generation parameters. Task/run state is `GenerationRun`. */
export interface GenerationConfig {
  channelId?: string
  model?: string
  capability?: GenerationCapability
  prompt: string
  negativePrompt?: string
  /** Ordered `ContentAsset` ids used as generation references. */
  referenceAssetIds?: string[]
  generateAudio?: boolean
  seconds?: number
  resolution?: string
  aspectRatio?: string
  outputCount?: number
}

export interface RequestNodeSpec extends BaseNodeSpec {
  kind: 'request'
  variant: RequestVariant
  image: GenerationConfig
  video: GenerationConfig
  /** Latest `GenerationRun` for this node. */
  latestRunId?: string
  /** Content node that should receive a completed variant's output. */
  resultNodeIds?: Partial<Record<'image' | 'video', string>>
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
