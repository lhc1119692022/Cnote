/**
 * Runtime entities independent of graph persistence.
 *
 * Flow nodes reference these by id (`sessionId`, `latestCaptureId`,
 * `captureId`, `activeSessionId`, `latestRunId`, `assetId`). Do not embed
 * them in `NodeSpec` / `FlowDocument`.
 */

import type { GenerationTaskRequestSnapshot } from '@/types/flow'

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
  nodeId?: string
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

export type GenerationTaskRecoveryState =
  | 'pending'
  | 'submitted'
  | 'resuming'
  | 'waiting-for-user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface GenerationTaskRecoveryMetadata {
  requestNodeId: string
  variant: 'image' | 'video'
  channelId: string
  model: string
  inputVersion: string
  state: GenerationTaskRecoveryState
  updatedAt: number
  reason?: string
}

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
  /** Remote provider task id used to resume polling after restart. */
  remoteTaskId?: string
  /** Request node and variant are duplicated here for task-level recovery. */
  requestNodeId?: string
  variant?: 'image' | 'video'
  /** Stable identifier for the submit-time input snapshot. */
  inputVersion?: string
  /**
   * Frozen submit-time input (channel/model/protocol/config). This is the
   * recoverable request version — no secrets or raw responses.
   */
  requestSnapshot?: GenerationTaskRequestSnapshot
  /** Explicit recovery state retained when polling or persistence is interrupted. */
  recovery?: GenerationTaskRecoveryMetadata
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
  resultNodeId?: string
  id: string
  status: GenerationRunStatus
  tasks: GenerationTask[]
  createdAt: number
  /** Request node that created this run. */
  requestNodeId?: string
  /** Generation variant submitted for this run. */
  variant?: 'image' | 'video'
}
