import type { Node, Edge } from 'reactflow'

export type FlowNode = Node
export type FlowEdge = Edge

export type NodeType = 'content' | 'ai' | 'request' | 'browser' | 'sticky' | 'group'

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

export type ContentState =
  | 'empty'
  | 'importing'
  | 'detecting'
  | 'parsing'
  | 'ready'
  | 'partial'
  | 'unsupported'
  | 'error'
  | 'missing'

export type ContentSource =
  | { kind: 'text'; text: string; mimeType: 'text/plain' | 'text/markdown'; checksum: string }
  | { kind: 'url'; originalUrl: string; normalizedUrl: string; provider?: ContentUrlProvider }
  | { kind: 'file'; resourceId: string; checksum: string; fileName: string; mimeType: string; size: number; lastModified?: number }
  | { kind: 'clipboard-image'; resourceId: string; checksum: string; mimeType: string; size: number }

export interface ContentPreview {
  title?: string
  description?: string
  thumbnailUrl?: string
  thumbnailResourceId?: string
  badge?: string
  meta?: string[]
}

export interface ParseWarning { code: string; message: string }
export interface ParseError { code: string; message: string; retryable?: boolean }

export interface ContentParseState {
  requestId: string
  revision: number
  parserId?: string
  parserVersion?: string
  startedAt?: number
  completedAt?: number
  progress?: number
  sourceChecksum?: string
  warnings?: ParseWarning[]
  error?: ParseError
  /** Original pasted text/URL retained so a failed parse can be retried. */
  retryText?: string
}

export interface DocumentPayload {
  kind: 'document'
  document?: RichTextDocument
  rawText?: string
  plainText: string
  headings?: Array<{ level: number; text: string }>
  pageCount?: number
  pages?: Array<{ page: number; text: string }>
  metadata?: Record<string, string | number | undefined>
}

export interface DataPayload {
  kind: 'data'
  sheets: Array<{ name: string; columns: string[]; rows: unknown[][]; totalRows: number; truncated: boolean }>
}

export interface MindmapTreeNode { id: string; text: string; children: MindmapTreeNode[] }
export interface MindmapPayload { kind: 'mindmap'; root: MindmapTreeNode; sourceMarkdown?: string }

export interface RemoteMediaRef { url: string; sourceUrl?: string; resourceId?: string; fileName?: string; mimeType?: string; width?: number; height?: number }

/** A media item kept by image/video nodes and passed through graph connections. */
export interface ContentMediaItem {
  resource: RemoteMediaRef
  poster?: RemoteMediaRef
  label?: string
}
export type SocialContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; resource: RemoteMediaRef; caption?: string }
  | { type: 'video'; resource: RemoteMediaRef; poster?: RemoteMediaRef }
  | { type: 'live-photo'; image: RemoteMediaRef; motionVideo?: RemoteMediaRef }
  | { type: 'topic'; name: string; url?: string }
  | { type: 'mention'; name: string; url?: string }
  | { type: 'link'; title?: string; url: string }

export interface SocialPayload {
  kind: 'social'
  platform: 'xiaohongshu' | 'weibo' | 'douyin' | 'instagram' | 'generic'
  canonicalUrl: string
  title: string
  bodyText: string
  contentBlocks: SocialContentBlock[]
  author?: { id?: string; name: string; avatarUrl?: string; profileUrl?: string }
  publishedAt?: string
  metrics?: { likes?: number; collects?: number; comments?: number; shares?: number; capturedAt?: string }
  topics?: string[]
}

export interface VideoPayload {
  kind: 'video'
  provider: 'youtube' | 'bilibili' | 'vimeo' | 'podcast' | 'direct' | 'local' | 'generic'
  playback?: 'video' | 'audio' | 'embed' | 'preview'
  displayAspect?: 'auto' | 'landscape' | 'portrait'
  url?: string
  title?: string
  duration?: number
  transcript?: string
  transcriptStatus?: 'loading' | 'ready' | 'unavailable' | 'error'
  width?: number
  height?: number
  resources?: ContentMediaItem[]
  activeResourceIndex?: number
}

export interface ImagePayload {
  kind: 'image'
  width?: number
  height?: number
  alt?: string
  resources?: ContentMediaItem[]
  activeResourceIndex?: number
}
export interface PresentationPayload {
  kind: 'presentation'
  title?: string
  slideCount?: number
  outline?: string[]
  slides?: Array<{ index: number; title?: string; text: string }>
}
export interface RichTextDocument {
  version: 1
  format: 'tiptap-json'
  plainText: string
  json: import('@tiptap/core').JSONContent
}

export interface TextPayload {
  kind: 'text'
  value: string
  format: 'plain' | 'markdown' | 'rich-text'
  document?: RichTextDocument
}

export type ContentPayload = TextPayload | DocumentPayload | DataPayload | MindmapPayload | SocialPayload | VideoPayload | ImagePayload | PresentationPayload

export interface BaseNodeData {
  label: string
  description?: string
  disabled?: boolean
  disabledByUser?: boolean
  disabledByGraph?: boolean
}
export interface ContentNodeData extends BaseNodeData {
  schemaVersion: 2
  category: ContentCategory | null
  subtype: ContentSubtype | null
  state: ContentState
  source: ContentSource | null
  payload?: ContentPayload
  preview?: ContentPreview
  parse?: ContentParseState
  sourceId?: string
  disabled?: boolean
  resourceLost?: boolean
  /** Marks that a legacy oversized content-node layout has been recovered. */
  layoutRecoveryVersion?: number
  upstreamSync?: { sourceIds: string[]; sourceSignature: string; syncedAt: number }
  /** Set after the user explicitly uses the resize control. */
  manualSize?: boolean
}

export type AIMessage = {
  role: 'user' | 'assistant'
  content: string
  requestContent?: string
  /** Request settings captured at send time so retry always replays the same request. */
  channelId?: string
  model?: string
  webSearch?: AIWebSearchMode
  reasoningLevel?: AIReasoningLevel
  systemPrompt?: string
  maxOutputTokens?: number
  createdAt?: number
}
export type AIWebSearchMode = 'auto' | 'on' | 'off'
export type AIReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface AISession { id: string; title: string; createdAt: number; updatedAt: number; messages: AIMessage[] }
export interface AINodeData extends BaseNodeData {
  channelId?: string
  model?: string
  systemPrompt?: string
  userPrompt?: string
  prompt?: string
  temperature?: number
  maxTokens?: number
  /** 单次回复的输出 token 上限；未设置时使用 8192。 */
  maxOutputTokens?: number
  autoCompressThreshold?: number
  webSearch?: AIWebSearchMode
  reasoningLevel?: AIReasoningLevel
  messages?: AIMessage[]
  sessions?: AISession[]
  activeSessionId?: string
  output?: string
  disabled?: boolean
}

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

export type GenerationReferenceType = 'image' | 'video' | 'audio'
export type GenerationReferenceRole =
  | 'reference_image'
  | 'reference_video'
  | 'first_frame'
  | 'last_frame'
  | 'reference_voice'
  | 'reference_audio'

export interface GenerationReference {
  expiresAt?: number
  id: string
  type: GenerationReferenceType
  role?: GenerationReferenceRole
  label?: string
  source: 'local' | 'url' | 'uploaded'
  url?: string
  previewUrl?: string
  resourceId?: string
  fileName?: string
  mimeType?: string
  size?: number
  duration?: number
  order: number
  status?: 'ready' | 'pending-upload' | 'unsupported' | 'error'
  error?: string
}

export type GenerationTaskStatus =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'queued'
  | 'in_progress'
  | 'timeout'
  | 'completed'
  | 'failed'
  | 'unknown'

export interface GenerationTaskState {
  children?: GenerationTaskState[]
  taskId?: string
  provider?: string
  channelId?: string
  model?: string
  status: GenerationTaskStatus
  progress?: number
  submittedAt?: number
  completedAt?: number
  elapsedMs?: number
  timeoutAt?: number
  resultUrls?: string[]
  resultResourceIds?: string[]
  resultMimeTypes?: string[]
  resultFileNames?: string[]
  resultMetadata?: Array<{ mimeType: string; size: number; width?: number; height?: number }>
  warnings?: string[]
  error?: string
  rawStatus?: string
  rawResponse?: unknown
  lastPolledAt?: number
  /** Immutable request data used to resume polling after the channel is edited. */
  requestSnapshot?: GenerationTaskRequestSnapshot
}

export interface GenerationTaskRequestSnapshot {
  variant: 'image' | 'video'
  channelId: string
  providerId: string
  protocol?: string
  baseURL: string
  secretName?: string
mediaTransport?: import('@/lib/generation/media-policy').MediaTransport
  mediaUploadPath?: string
  mediaUploadURL?: string
  mediaUploadSecretName?: string
  model: string
  config: GenerationVariantConfig
}

export interface GenerationVariantConfig {
  channelId?: string
  model?: string
  /** Selected protocol adapter when one connection exposes several contracts. */
  adapterId?: string
  capability?: GenerationCapability
  prompt: string
  negativePrompt?: string
  references: GenerationReference[]
  generateAudio?: boolean
  noMusic?: boolean
  seconds?: number
  resolution?: string
  aspectRatio?: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'standard' | string
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  outputCompression?: number
  moderation?: 'auto' | 'low'
  outputCount?: number
  thinkingLevel?: 'minimal' | 'high'
}

export interface RequestNodeData extends BaseNodeData {
  schemaVersion: 1
  variant: RequestVariant
  image: GenerationVariantConfig
  video: GenerationVariantConfig
  /** Per-variant task state. `task` remains as a backwards-compatible active alias. */
  tasks?: Partial<Record<'image' | 'video', GenerationTaskState>>
  task?: GenerationTaskState
  /** Per-variant result node links. `resultNodeId` remains as a backwards-compatible active alias. */
  resultNodeIds?: Partial<Record<'image' | 'video', string>>
  /** All connected preview nodes for each generation variant. */
  resultNodeIdsByVariant?: Partial<Record<'image' | 'video', string[]>>
  resultNodeId?: string
  resultCreatedAt?: number
}
export type WebPageOutputMode = 'url' | 'text' | 'both'
export type WebPageSyncStatus = 'synced' | 'possibly_changed'
export interface PageTextSnapshot {
  url: string
  title?: string
  text: string
  fetchedAt: number
  headings?: Array<{ level: number; text: string }>
  links?: Array<{ text: string; url: string }>
  parserId?: string
  parserVersion?: string
}
export interface BrowserNodeData extends BaseNodeData {
  url: string
  /** The only URL used by Flow execution and content extraction. */
  confirmedUrl?: string
  /** Desktop uses an embedded webview; Web Preview continues to use its iframe fallback. */
  browserRuntime?: 'desktop-native' | 'web-iframe'
  outputMode?: WebPageOutputMode
  syncStatus?: WebPageSyncStatus
  observedUrl?: string
  snapshot?: PageTextSnapshot
  /** Content node that should receive automatic page captures. */
  linkedContentNodeId?: string
  /** Marks a browser created by the automatic social-link import flow. */
  socialImport?: boolean
  /** Legacy field retained for flows created before output modes existed. */
  extractedContent?: string
  status: 'idle' | 'loading' | 'ready' | 'error'
}
export type StickyNodeColor = 'yellow' | 'pink' | 'green' | 'blue' | 'purple'
export interface StickyNodeData extends BaseNodeData {
  content: string
  document?: RichTextDocument
  color: StickyNodeColor
  background: 'solid' | 'none'
  /** A pinned sticky stays selectable and editable, but cannot be dragged. */
  pinned?: boolean
}
export interface GroupNodeData extends BaseNodeData { memberCount: number; padding?: number }

export interface Flow {
  id: string; name: string; title: string; description?: string; nodes: Node[]; edges: Edge[]
  viewport?: { x: number; y: number; zoom: number }; thumbnail?: string; folderId?: string; createdAt: number; updatedAt: number
}
export interface Folder { id: string; name: string; color?: string; createdAt: number }
export interface Template { id: string; title: string; description?: string; thumbnail?: string; nodes: Node[]; edges: Edge[]; category?: string; usageCount: number; createdAt: number }
export interface Source { id: string; title: string; nodeData: ContentNodeData; createdAt: number; updatedAt: number }


