/**
 * Runtime entities independent of graph persistence.
 *
 * Flow nodes reference these by id (`sessionId`, `latestCaptureId`,
 * `activeSessionId`, `latestRunId`, `assetId`). Do not embed them in
 * `NodeSpec` / `FlowDocument`.
 */

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

export type BrowserTabStatus = 'loading' | 'ready' | 'error'

export interface BrowserTab {
  id: string
  url: string
  title?: string
  status: BrowserTabStatus
}

export interface BrowserSession {
  id: string
  partition: string
  /** Id of the focused tab in `tabs`; `null` when the session has no tabs. */
  activeTabId: string | null
  tabs: BrowserTab[]
  createdAt: number
}

// ---------------------------------------------------------------------------
// Capture / assets
// ---------------------------------------------------------------------------

export interface CaptureHeading {
  level: number
  text: string
}

export interface CaptureLink {
  text: string
  url: string
}

export type CaptureMedia =
  | { kind: 'asset'; assetId: string; mimeType?: string }
  | { kind: 'url'; url: string; mimeType?: string }

export interface Capture {
  id: string
  sessionId: string
  url: string
  title?: string
  html?: string
  text: string
  media?: CaptureMedia[]
  headings?: CaptureHeading[]
  links?: CaptureLink[]
  fetchedAt: number
}

/** 引用计数由资源层管理，领域类型不持有。 */
export interface ContentAsset {
  id: string
  hash: string
  mimeType: string
  size: number
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
  channelId?: string
  model?: string
  createdAt?: number
}

export interface AISession {
  id: string
  title: string
  messages: AIMessage[]
  model?: string
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GenerationTaskStatus =
  | 'idle'
  | 'validating'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface GenerationTask {
  id: string
  status: GenerationTaskStatus
  progress?: number
  channelId?: string
  model?: string
  /** Completed outputs as `ContentAsset` ids — not ephemeral URLs. */
  resultAssetIds?: string[]
  error?: string
  submittedAt?: number
  completedAt?: number
}

export type GenerationRunStatus =
  | 'created'
  | 'validating'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting-for-user'

export interface GenerationRun {
  id: string
  status: GenerationRunStatus
  tasks: GenerationTask[]
  createdAt: number
}
