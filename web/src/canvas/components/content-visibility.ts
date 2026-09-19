/**
 * 内容抬升层可见区域虚拟化（纯函数）。
 *
 * 屏幕可见矩形及预加载边距统一换算到世界坐标。
 * 仅决定是否调用 renderNode；壳、边、命中仍使用完整 nodes。
 */

import type {
  BrowserSession,
  GenerationRun,
  GenerationRunStatus,
  NodeSpec,
  Rect,
  Size,
  Viewport,
} from '@/domain'
import { nodeRect, rectsIntersect } from '../geometry'
import { screenRectToWorld, visibleScreenRect, worldToScreen, type ViewportPadding } from '../viewport'

/** 内容层预加载边距按屏幕像素计算。 */
export const CONTENT_OVERSCAN_WORLD_PX = 240

export function contentPresentationStyle(node: Pick<NodeSpec, 'kind' | 'size'> & { category?: string | null; payload?: { kind: string; provider?: string } }, viewport: Viewport) {
  if (node.kind === 'browser') return { width: '100%', height: '100%', zoom: 1, '--canvas-node-radius': `${24 * contentLayerViewport(viewport).zoom}px` }
  const ordinary = node.kind === 'content' && (
    node.category === 'image' || node.category === 'social' || node.category === 'data' || node.category === 'presentation' || node.category === 'document'
    || (node.category === 'video' && node.payload?.provider !== 'youtube')
  )
  if (ordinary) return { width: node.size.width, height: node.size.height, transform: `scale(${contentLayerViewport(viewport).zoom})`, transformOrigin: '0 0', zoom: 1 }
  return { width: node.size.width, height: node.size.height, zoom: contentLayerViewport(viewport).zoom }
}

const ACTIVE_GENERATION_RUN_STATUSES: ReadonlySet<GenerationRunStatus> = new Set([
  'created',
  'validating',
  'queued',
  'running',
  'waiting-for-user',
])

export function isActiveGenerationRunStatus(
  status: string | null | undefined,
): status is GenerationRunStatus {
  return typeof status === 'string' && ACTIVE_GENERATION_RUN_STATUSES.has(status as GenerationRunStatus)
}

export function isUsableContainerSize(size: Size): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}

export function isUsableViewport(viewport: Viewport): boolean {
  return (
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0
  )
}

/** 内容层定位用视口：非有限/非正 zoom 回落到 1，避免 NaN 或负尺寸样式。 */
export function contentLayerViewport(viewport: Viewport): Viewport {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom: Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1,
  }
}

/**
 * 屏幕 (0,0,container) → 世界矩形，再向四周扩展 overscan。
 * 容器未测得或 viewport 异常时返回 null（调用方应挂载全部内容）。
 */
export function visibleWorldRect(
  viewport: Viewport,
  containerSize: Size,
  overscan = CONTENT_OVERSCAN_WORLD_PX,
  overlayInsets: ViewportPadding = 0,
): Rect | null {
  if (!isUsableContainerSize(containerSize) || !isUsableViewport(viewport)) return null
  const visible = visibleScreenRect(containerSize, overlayInsets)
  if (visible.width <= 0 || visible.height <= 0) return null
  const world = screenRectToWorld(visible, viewport)
  const overscanValue = overscan === undefined ? CONTENT_OVERSCAN_WORLD_PX : overscan
  const pad = Number.isFinite(overscanValue) && overscanValue > 0 ? overscanValue / viewport.zoom : 0
  return {
    x: world.x - pad,
    y: world.y - pad,
    width: world.width + pad * 2,
    height: world.height + pad * 2,
  }
}

export interface ContentMountPinInput {
  selection?: readonly string[]
  resizingNodeId?: string | null
  connectingSourceId?: string | null
  runs?: Record<string, Pick<GenerationRun, 'id' | 'status' | 'requestNodeId'>>
  sessions?: Record<string, Pick<BrowserSession, 'tabs' | 'activeTabId'>>
  inflightAINodeIds?: readonly string[]
}

function browserHasActiveRuntime(
  session: Pick<BrowserSession, 'tabs' | 'activeTabId'> | undefined,
): boolean {
  if (!session) return false
  return session.tabs.length > 0 || session.activeTabId != null
}

/**
 * 内容挂载例外：选中、正在缩放、正在连线的 source、
 * 未结束 GenerationRun 的 request、有活动 session/tab 的 browser。
 * 只收集稳定 id，不把 runtime 实体写回 graph。
 */
export function collectContentMountPinIds(
  nodes: readonly NodeSpec[],
  input: ContentMountPinInput = {},
): Set<string> {
  const pinned = new Set<string>()
  for (const id of input.selection ?? []) {
    if (id) pinned.add(id)
  }
  if (input.resizingNodeId) pinned.add(input.resizingNodeId)
  if (input.connectingSourceId) pinned.add(input.connectingSourceId)
  for (const id of input.inflightAINodeIds ?? []) {
    if (id) pinned.add(id)
  }

  const runs = input.runs
  if (runs) {
    for (const run of Object.values(runs)) {
      if (!isActiveGenerationRunStatus(run.status)) continue
      if (run.requestNodeId) pinned.add(run.requestNodeId)
    }
  }

  const sessions = input.sessions
  for (const node of nodes) {
    if (node.kind === 'request') {
      const runId = node.latestRunId
      const run = runId && runs ? runs[runId] : undefined
      if (run && isActiveGenerationRunStatus(run.status)) pinned.add(node.id)
    } else if (node.kind === 'browser') {
      const sessionId = node.sessionId
      if (sessionId && browserHasActiveRuntime(sessions?.[sessionId])) {
        pinned.add(node.id)
      }
    }
  }

  return pinned
}

export function shouldMountNodeContent(
  node: Pick<NodeSpec, 'id' | 'position' | 'size'>,
  visibleWorld: Rect | null,
  pinnedIds?: ReadonlySet<string>,
): boolean {
  if (!visibleWorld) return true
  if (pinnedIds?.has(node.id)) return true
  return rectsIntersect(nodeRect(node), visibleWorld)
}

/** 内容层盒子：只平移、不 scale；width/height = size * zoom。 */
export function contentLayerStyle(
  node: Pick<NodeSpec, 'position' | 'size' | 'z'>,
  viewport: Viewport,
): {
  transform: string
  transformOrigin: '0 0'
  width: number
  height: number
  zIndex: number
} {
  const view = contentLayerViewport(viewport)
  const origin = worldToScreen(node.position, view)
  return {
    transform: `translate(${origin.x}px, ${origin.y}px)`,
    transformOrigin: '0 0',
    width: node.size.width * view.zoom,
    height: node.size.height * view.zoom,
    zIndex: node.z ?? 0,
  }
}
