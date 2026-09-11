import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { applyNodeChanges, applyEdgeChanges } from 'reactflow'
import type { Node, Edge, OnNodesChange, OnEdgesChange } from 'reactflow'
import type { Flow, Folder, GenerationTaskState, RequestNodeData } from '@/types/flow'
import { FlowExecutor, type ExecutionContext, type ExecutionProgress } from '@/lib/flow'
import { useAIStore } from '@/stores/use-ai-store'
import { localForageStorage } from '@/lib/localforage-storage'
import { deleteLocalResource, hasLocalResource, retainLocalResource } from '@/lib/resource-storage'
import { hasNodeConnections, reconcileDisabledNodes } from '@/lib/flow/disabled'
import { cloneFlowValue } from '@/lib/flow/clone'
import {
  AI_NODE_DEFAULT_SIZE,
  REQUEST_NODE_DEFAULT_SIZE,
  BROWSER_NODE_DEFAULT_SIZE,
  CONTENT_NODE_DEFAULT_SIZE,
  GROUP_NODE_PADDING,
  STICKY_NODE_DEFAULT_SIZE,
} from '@/lib/flow/node-dimensions'
import { tryGetContentServiceClient } from '@/lib/content-service'
import { createRequestNodeData } from '@/lib/generation/defaults'
import { createGenerationResultContentData } from '@/lib/generation/results'

type FlowHistoryEntry = { nodes: Node[]; edges: Edge[] }

type DesktopExecutionJobRecord = {
  id: string
  kind: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  updatedAt: string
  retryCount: number
  checkpoint?: unknown
  error?: string
  startedAt?: string
  completedAt?: string
  resumeRequired?: boolean
}

type DesktopExecutionJobUpdate = {
  status?: DesktopExecutionJobRecord['status']
  checkpoint?: unknown
  error?: string
  retryCount?: number
  resumeRequired?: boolean
}

interface FlowExecutionCheckpoint {
  schemaVersion: 1
  flowId?: string
  flowUpdatedAt?: number
  nodes: Node[]
  edges: Edge[]
  currentNodeId?: string
  resumeAvailable: boolean
  contexts: Array<{
    nodeId: string
    inputs?: Record<string, unknown>
    output?: unknown
    error?: string
    status: ExecutionContext['status']
    startTime?: number
    endTime?: number
  }>
}

const DESKTOP_JOB_KIND = 'flow-execution'
const MAX_CHECKPOINT_VALUE_BYTES = 2 * 1024 * 1024

function getDesktopBridge() {
  return typeof window !== 'undefined' ? window.cnoteDesktop : undefined
}

function serializeCheckpointValue(value: unknown) {
  try {
    const json = JSON.stringify(value)
    if (json === undefined || json.length > MAX_CHECKPOINT_VALUE_BYTES) return { ok: false as const }
    return { ok: true as const, value: JSON.parse(json) as unknown }
  } catch {
    return { ok: false as const }
  }
}

function checkpointFromProgress(
  progress: ExecutionProgress,
  flowId: string | undefined,
  flowUpdatedAt: number | undefined,
  nodes: Node[],
  edges: Edge[],
): FlowExecutionCheckpoint {
  let resumeAvailable = true
  const contexts = [...progress.contexts.values()].map((context) => {
    const serializedOutput = context.output === undefined ? { ok: true as const, value: undefined } : serializeCheckpointValue(context.output)
    if (context.status === 'completed' && !serializedOutput.ok) resumeAvailable = false
    const serializedInputs = serializeCheckpointValue(context.inputs)
    return {
      nodeId: context.nodeId,
      ...(serializedInputs.ok ? { inputs: serializedInputs.value as Record<string, unknown> } : {}),
      ...(serializedOutput.ok ? { output: serializedOutput.value } : {}),
      ...(context.error ? { error: context.error } : {}),
      status: context.status,
      ...(context.startTime ? { startTime: context.startTime } : {}),
      ...(context.endTime ? { endTime: context.endTime } : {}),
    }
  })
  const graph = serializeCheckpointValue({ nodes, edges })
  if (!graph.ok) resumeAvailable = false
  return {
    schemaVersion: 1,
    ...(flowId ? { flowId } : {}),
    ...(flowUpdatedAt ? { flowUpdatedAt } : {}),
    nodes: graph.ok ? (graph.value as { nodes: Node[]; edges: Edge[] }).nodes : [],
    edges: graph.ok ? (graph.value as { nodes: Node[]; edges: Edge[] }).edges : [],
    currentNodeId: progress.nodeId,
    resumeAvailable,
    contexts,
  }
}

function parseFlowExecutionCheckpoint(value: unknown): FlowExecutionCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const checkpoint = value as Partial<FlowExecutionCheckpoint>
  if (checkpoint.schemaVersion !== 1 || !Array.isArray(checkpoint.nodes) || !Array.isArray(checkpoint.edges) || !Array.isArray(checkpoint.contexts)) return null
  return {
    schemaVersion: 1,
    flowId: typeof checkpoint.flowId === 'string' ? checkpoint.flowId : undefined,
    flowUpdatedAt: typeof checkpoint.flowUpdatedAt === 'number' ? checkpoint.flowUpdatedAt : undefined,
    nodes: checkpoint.nodes as Node[],
    edges: checkpoint.edges as Edge[],
    currentNodeId: typeof checkpoint.currentNodeId === 'string' ? checkpoint.currentNodeId : undefined,
    resumeAvailable: checkpoint.resumeAvailable === true,
    contexts: checkpoint.contexts.filter((context): context is FlowExecutionCheckpoint['contexts'][number] => Boolean(context && typeof context === 'object' && typeof context.nodeId === 'string' && typeof context.status === 'string')),
  }
}

const nodeLabelDefaults: Record<string, string> = {
  ai: 'AI 节点',
  request: '请求体',
  browser: '浏览器节点',
  sticky: '贴纸',
  content: '内容类型选择',
}

function getNodeLabel(node: Pick<Node, 'type' | 'data'>) {
  return String(node.data?.label || nodeLabelDefaults[node.type || ''] || '节点').trim() || '节点'
}

function getUniqueNodeLabel(requestedLabel: string, usedLabels: Set<string>) {
  const requested = requestedLabel.trim() || '节点'
  if (!usedLabels.has(requested)) {
    usedLabels.add(requested)
    return requested
  }

  const suffixMatch = requested.match(/^(.*?)(?:\s*\((\d+)\))$/)
  const base = suffixMatch?.[1]?.trim() || requested
  let index = 2
  let candidate = `${base} (${index})`
  while (usedLabels.has(candidate)) {
    index += 1
    candidate = `${base} (${index})`
  }
  usedLabels.add(candidate)
  return candidate
}

function ensureUniqueNodeLabels(nodes: Node[]) {
  const usedLabels = new Set<string>()
  return nodes.map((node) => {
    const label = getUniqueNodeLabel(getNodeLabel(node), usedLabels)
    return label === node.data?.label ? node : { ...node, data: { ...node.data, label } }
  })
}

function withDefaultNodeDimensions<T extends { type?: string; style?: Node['style'] }>(node: T): T {
  const defaults = node.type === 'browser'
    ? BROWSER_NODE_DEFAULT_SIZE
      : node.type === 'ai'
        ? AI_NODE_DEFAULT_SIZE
        : node.type === 'request'
          ? REQUEST_NODE_DEFAULT_SIZE
        : node.type === 'content'
        ? CONTENT_NODE_DEFAULT_SIZE
        : node.type === 'sticky'
          ? STICKY_NODE_DEFAULT_SIZE
          : undefined
  if (!defaults) return node
  const nodeData = (node as T & { data?: unknown }).data
  const browserData = node.type === 'browser' && nodeData && typeof nodeData === 'object'
    ? nodeData as Record<string, unknown>
    : undefined
  const isLegacyBaiduDefault = node.type === 'browser'
    && browserData?.browserUrlMigrationVersion === undefined
    && browserData?.url === 'https://www.baidu.com/'
    && browserData?.confirmedUrl === 'https://www.baidu.com/'
  const isLegacyBingDefault = node.type === 'browser'
    && (browserData?.browserUrlMigrationVersion === undefined || browserData?.browserUrlMigrationVersion === 2)
    && browserData?.url === 'https://www.bing.com/'
    && browserData?.confirmedUrl === 'https://www.bing.com/'
  const shouldMigrateBrowserDefault = isLegacyBaiduDefault || isLegacyBingDefault
  const normalizedNode = shouldMigrateBrowserDefault
    ? {
        ...node,
        data: {
          ...browserData,
          url: 'https://www.google.com/',
          confirmedUrl: 'https://www.google.com/',
          browserUrlMigrationVersion: 3,
        },
      }
    : node
  const style = normalizedNode.style || {}
  const isLegacyBrowserDefault = node.type === 'browser'
    && browserData?.browserLayoutVersion === undefined
    && Number(style.width) === 1280
    && Number(style.height) === 720
  if (isLegacyBrowserDefault) {
    return {
      ...normalizedNode,
      style: { ...style, ...BROWSER_NODE_DEFAULT_SIZE },
      data: { ...(normalizedNode as T & { data?: Record<string, unknown> }).data, browserLayoutVersion: 1 },
    } as T
  }
  const hasWidth = style.width !== undefined
  const hasHeight = style.height !== undefined
  if (hasWidth && hasHeight) return normalizedNode as T

  return {
    ...normalizedNode,
    style: {
      ...style,
      ...(hasWidth ? {} : { width: defaults.width }),
      ...(hasHeight ? {} : { height: defaults.height }),
    },
  } as T
}

function flowNodeDimension(node: Node, axis: 'width' | 'height') {
  const value = node.style?.[axis] ?? node[axis]
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  if (node.type === 'browser') return axis === 'width' ? BROWSER_NODE_DEFAULT_SIZE.width : BROWSER_NODE_DEFAULT_SIZE.height
  if (node.type === 'ai') return axis === 'width' ? AI_NODE_DEFAULT_SIZE.width : AI_NODE_DEFAULT_SIZE.height
  if (node.type === 'request') return axis === 'width' ? REQUEST_NODE_DEFAULT_SIZE.width : REQUEST_NODE_DEFAULT_SIZE.height
  if (node.type === 'content') return axis === 'width' ? CONTENT_NODE_DEFAULT_SIZE.width : CONTENT_NODE_DEFAULT_SIZE.height
  if (node.type === 'sticky') return axis === 'width' ? STICKY_NODE_DEFAULT_SIZE.width : STICKY_NODE_DEFAULT_SIZE.height
  return axis === 'width' ? 240 : 160
}

function browserOverlapsNode(browser: Node, other: Node, position = browser.position) {
  const gap = 24
  const browserRight = position.x + flowNodeDimension(browser, 'width') + gap
  const browserBottom = position.y + flowNodeDimension(browser, 'height') + gap
  const otherRight = other.position.x + flowNodeDimension(other, 'width') + gap
  const otherBottom = other.position.y + flowNodeDimension(other, 'height') + gap
  return position.x - gap < otherRight
    && browserRight > other.position.x - gap
    && position.y - gap < otherBottom
    && browserBottom > other.position.y - gap
}

function findOpenBrowserPosition(browser: Node, nodes: Node[]) {
  const start = browser.position
  const width = flowNodeDimension(browser, 'width')
  const height = flowNodeDimension(browser, 'height')
  const candidates = [{ x: start.x, y: start.y }]
  for (let ring = 1; ring <= 8; ring += 1) {
    const horizontal = ring * (width + 48)
    const vertical = ring * (height + 48)
    candidates.push(
      { x: start.x + horizontal, y: start.y },
      { x: start.x - horizontal, y: start.y },
      { x: start.x, y: start.y + vertical },
      { x: start.x, y: start.y - vertical },
    )
  }
  return candidates.find((candidate) => nodes.every((node) => node.id === browser.id || !browserOverlapsNode(browser, node, candidate))) || start
}

function normalizeBrowserPositions(nodes: Node[]) {
  const positioned = nodes.map((node) => node)
  return positioned.map((node, index) => {
    const browserData = node.type === 'browser' && node.data && typeof node.data === 'object'
      ? node.data as Record<string, unknown>
      : undefined
    const shouldFindOpenPosition = node.type === 'browser' && browserData?.browserLayoutVersion === 1
    const blockers = positioned.filter((_candidate, candidateIndex) => candidateIndex !== index)
    const position = shouldFindOpenPosition ? findOpenBrowserPosition(node, blockers) : node.position
    const next = shouldFindOpenPosition && (position.x !== node.position.x || position.y !== node.position.y)
      ? { ...node, position, data: { ...node.data, browserLayoutVersion: 2 } }
      : shouldFindOpenPosition
        ? { ...node, data: { ...node.data, browserLayoutVersion: 2 } }
        : node
    positioned[index] = next
    return next
  })
}

function recoverLegacyContentNodeDimensions(node: Node): Node {
  if (node.type !== 'content') return node

  const data = node.data as {
    category?: string | null
    layoutRecoveryVersion?: number
  }
  const height = Number(node.style?.height ?? node.height)
  const isNonMediaContent = data.category !== 'image' && data.category !== 'video'

  // Older builds could store a zoom-scaled text/details measurement as the
  // node height. Recover that specific legacy value once, then preserve any
  // later manual resize the user makes.
  if (!isNonMediaContent || data.layoutRecoveryVersion === 1 || height <= 1200) return node

  return {
    ...node,
    style: { ...(node.style || {}), height: CONTENT_NODE_DEFAULT_SIZE.height },
    data: { ...node.data, layoutRecoveryVersion: 1 },
  }
}

function normalizeRequestNode(node: Node): Node {
  if (node.type !== 'request') return node
  const data = (node.data || {}) as Record<string, unknown>
  const variant = (data.variant as 'body' | 'image' | 'video') || 'body'
  const defaults = createRequestNodeData(variant)
  const storedLabel = typeof data.label === 'string' ? data.label : ''
  const label = new Set(['请求体', '图片生成', '视频生成']).has(storedLabel) ? '请求体' : storedLabel || defaults.label
  const storedTasks = (data.tasks || {}) as Record<string, unknown>
  const storedResultNodeIds = (data.resultNodeIds || {}) as Record<string, unknown>
  const legacyTask = (data.task || {}) as Record<string, unknown>
  const tasks = {
    ...defaults.tasks,
    ...storedTasks,
    ...(variant === 'image' || variant === 'video') && !storedTasks[variant] && data.task ? { [variant]: { ...defaults.task, ...legacyTask } } : {},
  }
  const resultNodeIds = {
    ...defaults.resultNodeIds,
    ...storedResultNodeIds,
    ...(variant === 'image' || variant === 'video') && !storedResultNodeIds[variant] && data.resultNodeId ? { [variant]: data.resultNodeId } : {},
  }
  return {
    ...node,
    data: {
      ...defaults,
      ...data,
      label,
      image: { ...defaults.image, ...((data.image || {}) as Record<string, unknown>) },
      video: { ...defaults.video, ...((data.video || {}) as Record<string, unknown>) },
      tasks,
      resultNodeIds,
      task: variant === 'image' || variant === 'video' ? tasks[variant] : defaults.task,
      resultNodeId: variant === 'image' || variant === 'video' ? resultNodeIds[variant] : undefined,
    },
  }
}

function normalizeGroupPadding(nodes: Node[]) {
  const legacyGroupPadding = 28
  const groupPaddingDeltas = new Map<string, number>()

  nodes.forEach((node) => {
    if (node.type !== 'group') return
    const currentPadding = Number(node.data?.padding)
    const padding = Number.isFinite(currentPadding) ? currentPadding : legacyGroupPadding
    if (padding < GROUP_NODE_PADDING) groupPaddingDeltas.set(node.id, GROUP_NODE_PADDING - padding)
  })

  if (!groupPaddingDeltas.size) return nodes

  return nodes.map((node) => {
    if (node.type === 'group') {
      const delta = groupPaddingDeltas.get(node.id)
      if (!delta) return node
      const width = Number(node.style?.width ?? node.width) || 160
      const height = Number(node.style?.height ?? node.height) || 120
      return {
        ...node,
        position: { x: node.position.x - delta, y: node.position.y - delta },
        style: { ...(node.style || {}), width: width + delta * 2, height: height + delta * 2 },
        data: { ...node.data, padding: GROUP_NODE_PADDING },
      }
    }

    const delta = node.parentNode ? groupPaddingDeltas.get(node.parentNode) : undefined
    return delta
      ? { ...node, position: { x: node.position.x + delta, y: node.position.y + delta } }
      : node
  })
}

function normalizeGroupBehavior(nodes: Node[]) {
  const groupIds = new Set(nodes.filter((node) => node.type === 'group').map((node) => node.id))

  return nodes.map((node) => {
    // Groups are movable backplanes, not containment boundaries. Keep the
    // parent relationship so a backplane carries its members, but drop the
    // React Flow extent constraint that prevents members from leaving it.
    if (node.parentNode && groupIds.has(node.parentNode) && node.extent !== undefined) {
      return { ...node, extent: undefined, expandParent: undefined }
    }
    return node
  })
}

function normalizeNodes(nodes: Node[]) {
  return normalizeGroupBehavior(normalizeGroupPadding(normalizeBrowserPositions(nodes
    .map(withDefaultNodeDimensions)
    .map(recoverLegacyContentNodeDimensions)
    .map(normalizeRequestNode))))
}

function getPersistableNodes(nodes: Node[]) { return nodes }

function nodeResourceIds(node?: Node) {
  if (!node) return []
  const ids: string[] = []
  const source = node.data?.source
  if ((source?.kind === 'file' || source?.kind === 'clipboard-image') && source.resourceId) ids.push(source.resourceId)
  if (node.type === 'request') {
    const requestData = node.data as Partial<RequestNodeData>
    const references = [
      ...(requestData.image?.references || []),
      ...(requestData.video?.references || []),
    ]
    references.forEach((reference) => {
      if (reference.resourceId) ids.push(reference.resourceId)
    })
    // A request may use the same local Blob in multiple variants or roles.
    // Keep one lease per actual reference so node deletion and duplication
    // remain balanced.
    return ids
  }
  const payload = node.data?.payload
  const media = payload?.kind === 'image' || payload?.kind === 'video'
    ? payload.resources || []
    : payload?.kind === 'social'
      ? payload.contentBlocks.flatMap((block: any) => {
          if (block.type === 'image') return [block.resource]
          if (block.type === 'video') return [block.resource, block.poster]
          if (block.type === 'live-photo') return [block.image, block.motionVideo]
          return []
        })
      : []
  media.forEach((item: any) => {
    if (item?.resourceId) ids.push(item.resourceId)
    if (item?.resource?.resourceId) ids.push(item.resource.resourceId)
  })
  return [...new Set(ids)]
}

function isLocalMediaNode(node?: Node) {
  if (node?.type !== 'content') return false
  const category = node.data?.category
  return (category === 'image' || category === 'video') && nodeResourceIds(node).length > 0
}

function resourceCounts(nodes: Node[]) {
  const counts = new Map<string, number>()
  nodes.forEach((node) => {
    nodeResourceIds(node).forEach((resourceId) => counts.set(resourceId, (counts.get(resourceId) || 0) + 1))
  })
  return counts
}

async function adjustResourceReferences(fromNodes: Node[], toNodes: Node[]) {
  const from = resourceCounts(fromNodes)
  const to = resourceCounts(toNodes)
  const resourceIds = new Set([...from.keys(), ...to.keys()])
  await Promise.all([...resourceIds].map(async (resourceId) => {
    const delta = (to.get(resourceId) || 0) - (from.get(resourceId) || 0)
    if (delta > 0) {
      for (let index = 0; index < delta; index += 1) await retainLocalResource(resourceId)
    } else {
      for (let index = 0; index < Math.abs(delta); index += 1) await deleteLocalResource(resourceId)
    }
  }))
}

function cloneHistoryEntry(nodes: Node[], edges: Edge[]): FlowHistoryEntry {
  return { nodes: cloneFlowValue(nodes), edges: cloneFlowValue(edges) }
}

async function replaceHistoryResourceReferences(
  previous: FlowHistoryEntry[],
  next: FlowHistoryEntry[],
) {
  // Retain incoming snapshots first so a resource shared across the boundary
  // can never briefly reach zero references and lose its Blob.
  for (const entry of next) await adjustResourceReferences([], entry.nodes)
  for (const entry of previous) await adjustResourceReferences(entry.nodes, [])
}

interface FlowState {
  // 当前 Flow
  currentFlow: Flow | null
  currentFlowId: string | null

  // 所有 Flows
  flows: Flow[]

  // 文件夹
  folders: Folder[]

  // React Flow 状态
  nodes: Node[]
  edges: Edge[]

  // 撤销/重做历史
  history: FlowHistoryEntry[]
  historyIndex: number
  maxHistory: number

  // 画布状态
  isLocked: boolean

  // 执行状态
  isExecuting: boolean
  executionContexts: Map<string, ExecutionContext>
  desktopJobs: DesktopExecutionJobRecord[]
  activeDesktopJobId: string | null
  hasHydrated: boolean

  // 操作方法
  createFlow: (
    name: string,
    description?: string,
    folderId?: string,
    initialGraph?: { nodes: Node[]; edges: Edge[] }
  ) => Flow
  deleteFlow: (id: string) => void
  updateFlow: (id: string, updates: Partial<Flow>) => void
  loadFlow: (id: string) => void
  saveCurrentFlow: (thumbnail?: string, viewport?: Flow['viewport']) => void
  duplicateFlow: (id: string) => Flow

  // 文件夹操作
  createFolder: (name: string, color?: string) => Folder
  deleteFolder: (id: string) => void
  updateFolder: (id: string, updates: Partial<Folder>) => void
  moveFlowToFolder: (flowId: string, folderId: string | null) => void

  // 节点操作
  addNode: (node: Omit<Node, 'id'>) => Node
  deleteNode: (id: string) => void
  updateNode: (id: string, updates: Partial<Node>) => void
  setNodeDisabledByUser: (id: string, disabled: boolean) => void
  restoreNode: (id: string) => Promise<{ ok: boolean; message?: string }>
  duplicateNode: (id: string) => void
  replaceGraph: (nodes: Node[], edges: Edge[], recordHistory?: boolean) => void

  // 边操作
  addEdge: (edge: Omit<Edge, 'id'>) => void
  deleteEdge: (id: string) => void

  // React Flow 变更处理
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange

  // 撤销/重做
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  addToHistory: () => void
  clearHistory: () => void

  // 画布控制
  toggleLock: () => void
  fitView: () => void
  zoomIn: () => void
  zoomOut: () => void

  // 导入/导出
  exportFlowAsJSON: () => string
  importFlowFromJSON: (json: string) => void

  // Flow 执行
  executeFlow: (aiClient?: any, scraperClient?: any, options?: { resumeJobId?: string }) => Promise<void>
  stopExecution: () => void
  refreshDesktopJobs: () => Promise<void>
  resumeDesktopJob: (jobId: string, aiClient?: any, scraperClient?: any) => Promise<void>

  // 初始化
  initialize: () => Promise<void>
  setHasHydrated: (value: boolean) => void
}

type PersistedFlowState = Pick<
  FlowState,
  'currentFlowId' | 'flows' | 'folders' | 'isLocked'
>

let pendingFlowSaveTimer: ReturnType<typeof setTimeout> | null = null
let activeFlowExecutionController: AbortController | null = null
let desktopJobsUnsubscribe: (() => void) | null = null
let activeDesktopJobId: string | null = null

function scheduleCurrentFlowSave(get: () => FlowState, delay = 450) {
  if (pendingFlowSaveTimer) clearTimeout(pendingFlowSaveTimer)
  pendingFlowSaveTimer = setTimeout(() => {
    pendingFlowSaveTimer = null
    get().saveCurrentFlow()
  }, delay)
}

function flushScheduledFlowSave(get: () => FlowState) {
  if (!pendingFlowSaveTimer) return
  clearTimeout(pendingFlowSaveTimer)
  pendingFlowSaveTimer = null
  get().saveCurrentFlow()
}

let lastPersistedSnapshot: PersistedFlowState | null = null
let persistWriteQueue = Promise.resolve()

const DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

function pruneGenerationDiagnostics(value: PersistedFlowState): PersistedFlowState {
  const cutoff = Date.now() - DIAGNOSTIC_RETENTION_MS
  const flows = value.flows.map((flow) => ({
    ...flow,
    nodes: flow.nodes.map((node) => {
      const data = node.data as Record<string, any> | undefined
      if (!data?.tasks) return node
      const tasks = Object.fromEntries(Object.entries(data.tasks).map(([variant, task]) => {
        if (!task || typeof task !== 'object') return [variant, task]
        const next = { ...task as Record<string, any> }
        const expired = typeof next.completedAt === 'number' && next.completedAt < cutoff
        if (expired || next.status === 'completed') delete next.rawResponse
        else if (typeof next.rawResponse === 'string' && next.rawResponse.length > 16000) next.rawResponse = next.rawResponse.slice(0, 16000) + '…'
        return [variant, next]
      }))
      return { ...node, data: { ...data, tasks } }
    }),
  }))
  return { ...value, flows }
}

const flowPersistStorage: PersistStorage<PersistedFlowState> = {
  getItem: async (name) => {
    const rawValue = await localForageStorage.getItem(name)
    if (!rawValue) return null
    const storedValue = JSON.parse(rawValue) as StorageValue<Partial<FlowState>>
    const persistedState: PersistedFlowState = pruneGenerationDiagnostics({
      currentFlowId: storedValue.state.currentFlowId || null,
      flows: storedValue.state.flows || [],
      folders: storedValue.state.folders || [],
      isLocked: Boolean(storedValue.state.isLocked),
    })
    const value: StorageValue<PersistedFlowState> = { state: persistedState, version: storedValue.version }
    lastPersistedSnapshot = persistedState
    return value
  },
  setItem: async (name, value) => {
    const next = pruneGenerationDiagnostics(value.state)
    const previous = lastPersistedSnapshot
    if (
      previous &&
      previous.flows === next.flows &&
      previous.folders === next.folders &&
      previous.currentFlowId === next.currentFlowId &&
      previous.isLocked === next.isLocked
    ) return

    lastPersistedSnapshot = next
    const serializedValue = JSON.stringify(value)
    persistWriteQueue = persistWriteQueue.then(async () => {
      await localForageStorage.setItem(name, serializedValue)
    })
    await persistWriteQueue
  },
  removeItem: async (name) => {
    lastPersistedSnapshot = null
    await localForageStorage.removeItem(name)
  },
}

export const useFlowStore = create<FlowState>()(
  persist<FlowState, [], [], PersistedFlowState>(
    (set, get) => ({
      currentFlow: null,
      currentFlowId: null,
      flows: [],
      folders: [],
      nodes: [],
      edges: [],
      history: [],
      historyIndex: -1,
      maxHistory: 30,
      isLocked: false,
      isExecuting: false,
      executionContexts: new Map(),
      desktopJobs: [],
      activeDesktopJobId: null,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      // 创建新 Flow
      createFlow: (name, description, folderId, initialGraph) => {
        flushScheduledFlowSave(get)
        const previousHistory = get().history
        const nodeIdMap = new Map<string, string>()
        const initialNodes = ensureUniqueNodeLabels(normalizeNodes((initialGraph?.nodes || []).map((node) => {
          const id = nanoid()
          nodeIdMap.set(node.id, id)
          return {
            ...cloneFlowValue(node),
            id,
            selected: false,
          }
        })))
        const initialEdges = (initialGraph?.edges || []).map((edge) => ({
          ...cloneFlowValue(edge),
          id: nanoid(),
          source: nodeIdMap.get(edge.source) || edge.source,
          target: nodeIdMap.get(edge.target) || edge.target,
          selected: false,
        }))
        const reconciledNodes = reconcileDisabledNodes(initialNodes, initialEdges)
        const newFlow: Flow = {
          id: nanoid(),
          name,
          title: name,
          description: description || '',
          nodes: reconciledNodes,
          edges: initialEdges,
          folderId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        const initialHistory = cloneHistoryEntry(reconciledNodes, initialEdges)

        set((state) => ({
          flows: [...state.flows, newFlow],
          currentFlow: newFlow,
          currentFlowId: newFlow.id,
          nodes: reconciledNodes,
          edges: initialEdges,
          history: [initialHistory],
          historyIndex: 0,
        }))
        void adjustResourceReferences([], reconciledNodes)
        void replaceHistoryResourceReferences(previousHistory, [initialHistory])

        return newFlow
      },

      // 删除 Flow
      deleteFlow: (id) => {
        if (get().currentFlowId === id) flushScheduledFlowSave(get)
        const currentState = get()
        const removed = currentState.flows.find((flow) => flow.id === id)
        const isCurrentFlow = currentState.currentFlowId === id
        if (removed) void adjustResourceReferences(removed.nodes, [])
        if (isCurrentFlow) void replaceHistoryResourceReferences(currentState.history, [])
        set((state) => {
          const newFlows = state.flows.filter((f) => f.id !== id)

          return {
            flows: newFlows,
            currentFlow: isCurrentFlow ? null : state.currentFlow,
            currentFlowId: isCurrentFlow ? null : state.currentFlowId,
            nodes: isCurrentFlow ? [] : state.nodes,
            edges: isCurrentFlow ? [] : state.edges,
            history: isCurrentFlow ? [] : state.history,
            historyIndex: isCurrentFlow ? -1 : state.historyIndex,
          }
        })
      },

      // 更新 Flow
      updateFlow: (id, updates) => {
        set((state) => ({
          flows: state.flows.map((f) =>
            f.id === id ? { ...f, ...updates, updatedAt: Date.now() } : f
          ),
          currentFlow:
            state.currentFlowId === id && state.currentFlow
              ? { ...state.currentFlow, ...updates, updatedAt: Date.now() }
              : state.currentFlow,
        }))
      },

      // 加载 Flow
      loadFlow: (id) => {
        flushScheduledFlowSave(get)
        const previousHistory = get().history
        const flow = get().flows.find((f) => f.id === id)
        if (!flow) return
        const edges = cloneFlowValue(flow.edges || [])
        const normalizedNodes = ensureUniqueNodeLabels(normalizeNodes(cloneFlowValue(flow.nodes || [])))
        const nodes = reconcileDisabledNodes(normalizedNodes, edges)
        const layoutChanged = nodes.some((node, index) => {
          const previous = flow.nodes?.[index]
          return !previous
            || node.position.x !== previous.position.x
            || node.position.y !== previous.position.y
            || node.style?.width !== previous.style?.width
            || node.style?.height !== previous.style?.height
        })
        const normalizedFlow = { ...flow, ...(layoutChanged ? { viewport: undefined } : {}), nodes: cloneFlowValue(nodes), edges: cloneFlowValue(edges) }
        const initialHistory = cloneHistoryEntry(nodes, edges)

        set((state) => ({
          flows: state.flows.map((item) => item.id === id ? normalizedFlow : item),
          currentFlow: normalizedFlow,
          currentFlowId: id,
          nodes,
          edges,
          history: [initialHistory],
          historyIndex: 0,
        }))
        void replaceHistoryResourceReferences(previousHistory, [initialHistory])
      },

      // 保存当前 Flow
      saveCurrentFlow: (thumbnail, viewport) => {
        if (pendingFlowSaveTimer) {
          clearTimeout(pendingFlowSaveTimer)
          pendingFlowSaveTimer = null
        }
        const { currentFlowId, nodes, edges } = get()
        if (!currentFlowId) return

        const updatedAt = Date.now()
        const updates: Partial<Flow> = {
          nodes: cloneFlowValue(getPersistableNodes(nodes)),
          edges: cloneFlowValue(edges),
          updatedAt,
        }
        if (thumbnail) updates.thumbnail = thumbnail
        if (viewport) updates.viewport = viewport

        set((state) => {
          let flows = state.flows.map((flow) =>
            flow.id === currentFlowId ? { ...flow, ...updates } : flow
          )

          if (thumbnail) {
            const retainedIds = new Set(
              flows
                .filter((flow) => flow.thumbnail)
                .sort((first, second) => second.updatedAt - first.updatedAt)
                .slice(0, 30)
                .map((flow) => flow.id)
            )
            flows = flows.map((flow) =>
              flow.thumbnail && !retainedIds.has(flow.id)
                ? { ...flow, thumbnail: undefined }
                : flow
            )
          }

          const currentFlow = flows.find((flow) => flow.id === currentFlowId) || null
          return { flows, currentFlow }
        })
      },

      // 复制 Flow
      duplicateFlow: (id) => {
        const flow = get().flows.find((f) => f.id === id)
        if (!flow) throw new Error('Flow not found')

        const nodeIdMap = new Map<string, string>()
        const clonedNodes = flow.nodes.map((node) => {
          const id = nanoid()
          nodeIdMap.set(node.id, id)
          return { ...cloneFlowValue(node), id, selected: false }
        })
        const newNodes = clonedNodes.map((node) => node.type === 'request'
          ? {
              ...node,
              data: {
                ...node.data,
                resultNodeId: (node.data as RequestNodeData)?.resultNodeId ? nodeIdMap.get((node.data as RequestNodeData).resultNodeId as string) : undefined,
                resultNodeIds: (node.data as RequestNodeData)?.resultNodeIds
                  ? Object.fromEntries(Object.entries((node.data as RequestNodeData).resultNodeIds as Record<string, string | undefined>).map(([variant, resultNodeId]) => [variant, resultNodeId ? nodeIdMap.get(resultNodeId) : undefined]))
                  : undefined,
                task: (node.data as RequestNodeData)?.task?.status === 'completed' ? (node.data as RequestNodeData).task : { status: 'idle' },
                tasks: (node.data as RequestNodeData)?.tasks
                  ? Object.fromEntries(Object.entries((node.data as RequestNodeData).tasks as Record<string, GenerationTaskState | undefined>).map(([variant, task]) => [variant, task?.status === 'completed' ? task : { status: 'idle' }]))
                  : undefined,
              },
            }
          : node)
        const newFlow: Flow = {
          ...cloneFlowValue(flow),
          id: nanoid(),
          name: `${flow.name} (副本)`,
          title: `${flow.title} (副本)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodes: newNodes,
          edges: flow.edges.map((edge) => ({ ...cloneFlowValue(edge), id: nanoid(), source: nodeIdMap.get(edge.source) || edge.source, target: nodeIdMap.get(edge.target) || edge.target, selected: false })),
        }
        void adjustResourceReferences([], newFlow.nodes)

        set((state) => ({
          flows: [...state.flows, newFlow],
        }))

        return newFlow
      },

      // 添加节点
      addNode: (node) => {
        let createdNode!: Node
        set((state) => {
          const clonedNode = withDefaultNodeDimensions(cloneFlowValue(node))
          const positionedNode = clonedNode.type === 'browser'
            ? {
                ...clonedNode,
                position: findOpenBrowserPosition({ ...clonedNode, id: '__new-browser__' } as Node, state.nodes),
                data: { ...clonedNode.data, browserLayoutVersion: 2 },
              }
            : clonedNode
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(positionedNode), usedLabels)
          const newNode: Node = {
            ...positionedNode,
            id: nanoid(),
            data: { ...positionedNode.data, label },
          }
          createdNode = newNode
          const newNodes = reconcileDisabledNodes([...state.nodes, newNode], state.edges)
          return { nodes: newNodes }
        })

        get().addToHistory()
        get().saveCurrentFlow()
        return createdNode
      },

      // 删除节点
      deleteNode: (id) => {
        const removed = get().nodes.find((node) => node.id === id)
        if (!removed) return
        if (removed.type === 'group') {
          set((state) => ({
            nodes: reconcileDisabledNodes(state.nodes.map((node) => {
              if (node.parentNode !== id) return node
              return {
                ...node,
                parentNode: undefined,
                extent: undefined,
                position: {
                  x: removed.position.x + node.position.x,
                  y: removed.position.y + node.position.y,
                },
              }
            }).filter((node) => node.id !== id), state.edges),
          }))
          get().addToHistory()
          get().saveCurrentFlow()
          return
        }
        nodeResourceIds(removed).forEach((resourceId) => { void deleteLocalResource(resourceId) })
        set((state) => ({
          nodes: reconcileDisabledNodes(
            state.nodes.filter((n) => n.id !== id),
            state.edges.filter((e) => e.source !== id && e.target !== id),
          ),
          edges: state.edges.filter((e) => e.source !== id && e.target !== id),
        }))

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // 更新节点
      updateNode: (id, updates) => {
        const clonedUpdates = cloneFlowValue(updates)
        set((state) => {
          const current = state.nodes.find((node) => node.id === id)
          if (!current) return state
          const merged = {
            ...current,
            ...clonedUpdates,
            data: clonedUpdates.data ? { ...current.data, ...clonedUpdates.data } : current.data,
          }
          const usedLabels = new Set(state.nodes.filter((node) => node.id !== id).map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(merged), usedLabels)
          const nextNodes = state.nodes.map((node) => node.id === id ? { ...merged, data: { ...merged.data, label } } : node)
          return { nodes: reconcileDisabledNodes(nextNodes, state.edges) }
        })

        scheduleCurrentFlowSave(get)
      },

      setNodeDisabledByUser: (id, disabled) => {
        const current = get().nodes.find((node) => node.id === id)
        if (!current) return
        set((state) => ({
          nodes: reconcileDisabledNodes(
            state.nodes.map((node) => node.id === id
              ? { ...node, data: { ...node.data, disabledByUser: disabled } }
              : node),
            state.edges,
          ),
        }))
        get().addToHistory()
        get().saveCurrentFlow()
      },

      restoreNode: async (id) => {
        const initial = get().nodes.find((node) => node.id === id)
        if (!initial) return { ok: false, message: '节点不存在，无法恢复。' }
        if (hasNodeConnections(id, get().edges)) return { ok: false, message: '请先断开节点连接，再恢复该节点。' }

        if (isLocalMediaNode(initial)) {
          const resourceIds = nodeResourceIds(initial)
          const exists = resourceIds.length > 0 && (await Promise.all(resourceIds.map((resourceId) => hasLocalResource(resourceId)))).every(Boolean)
          if (!exists) {
            const current = get().nodes.find((node) => node.id === id)
            if (current) {
              get().updateNode(id, { data: { ...current.data, state: 'missing', resourceLost: true } })
            }
            return { ok: false, message: '本地图片或视频资源不存在，节点仍保持禁用。请刷新节点连接资源。' }
          }
        }

        const current = get().nodes.find((node) => node.id === id)
        if (!current || hasNodeConnections(id, get().edges)) return { ok: false, message: '节点连接已变化，请先断开连接。' }
        set((state) => ({
          nodes: reconcileDisabledNodes(
            state.nodes.map((node) => {
              if (node.id !== id) return node
              const data = { ...node.data, disabledByUser: false, resourceLost: false }
              if (data.state === 'missing') data.state = 'ready'
              return { ...node, data }
            }),
            state.edges,
          ),
        }))
        get().addToHistory()
        get().saveCurrentFlow()
        return { ok: true }
      },

      // 复制节点
      duplicateNode: (id) => {
        const node = get().nodes.find((n) => n.id === id)
        if (!node) return
        nodeResourceIds(node).forEach((resourceId) => { void retainLocalResource(resourceId) })

        set((state) => {
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(node), usedLabels)
          const clonedData = cloneFlowValue(node.data)
          const duplicateData = node.type === 'request'
            ? { ...clonedData, label, sourceId: undefined, resultNodeId: undefined, resultNodeIds: {}, resultCreatedAt: undefined, task: { status: 'idle' }, tasks: { image: { status: 'idle' }, video: { status: 'idle' } } }
            : { ...clonedData, label, sourceId: undefined }
          const newNode: Node = {
            ...cloneFlowValue(node),
            id: nanoid(),
            selected: false,
            data: duplicateData,
            position: {
              x: node.position.x + 50,
              y: node.position.y + 50,
            },
          }
          return { nodes: reconcileDisabledNodes([...state.nodes, newNode], state.edges) }
        })

        get().addToHistory()
        get().saveCurrentFlow()
      },

      replaceGraph: (nodes, edges, recordHistory = true) => {
        const previousNodes = get().nodes
        const nextEdges = cloneFlowValue(edges)
        const nextNodes = reconcileDisabledNodes(cloneFlowValue(nodes), nextEdges)
        set({ nodes: nextNodes, edges: nextEdges })
        void adjustResourceReferences(previousNodes, nextNodes)
        if (recordHistory) {
          get().addToHistory()
          get().saveCurrentFlow()
        }
      },

      // 添加边
      addEdge: (edge) => {
        const newEdge: Edge = {
          ...cloneFlowValue(edge),
          id: nanoid(),
        }

        set((state) => ({
          nodes: reconcileDisabledNodes(state.nodes, [...state.edges, newEdge]),
          edges: [...state.edges, newEdge],
        }))

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // 删除边
      deleteEdge: (id) => {
        if (!get().edges.some((edge) => edge.id === id)) return
        set((state) => {
          const nextEdges = state.edges.filter((e) => e.id !== id)
          return { nodes: reconcileDisabledNodes(state.nodes, nextEdges), edges: nextEdges }
        })

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // React Flow 节点变更处理
      onNodesChange: (changes) => {
        const currentNodes = get().nodes
        const removedIds = changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id)
          .filter((id) => currentNodes.some((node) => node.id === id))
        removedIds.forEach((id) => { nodeResourceIds(currentNodes.find((node) => node.id === id)).forEach((resourceId) => { void deleteLocalResource(resourceId) }) })
        set((state) => ({
          nodes: applyNodeChanges(changes, state.nodes),
        }))

        // 选择状态不属于画板内容；位置、尺寸和删除等变更统一通过
        // 一个可取消的定时器提交，避免拖动时堆积数十次保存任务。
        if (changes.some((change) => change.type !== 'select')) {
          scheduleCurrentFlowSave(get)
        }
        if (changes.some((change) => change.type === 'position' && change.dragging === false)) {
          get().addToHistory()
        }
        if (removedIds.length) get().addToHistory()
      },

      // React Flow 边变更处理
      onEdgesChange: (changes) => {
        set((state) => {
          const nextEdges = applyEdgeChanges(changes, state.edges)
          return { nodes: reconcileDisabledNodes(state.nodes, nextEdges), edges: nextEdges }
        })

        if (changes.some((change) => change.type !== 'select')) {
          scheduleCurrentFlowSave(get)
        }
      },

      // 添加到历史记录
      addToHistory: () => {
        const snapshot = cloneHistoryEntry(get().nodes, get().edges)
        const removedEntries: FlowHistoryEntry[] = []
        set((state) => {
          const { history, historyIndex, maxHistory } = state
          removedEntries.push(...history.slice(historyIndex + 1))
          const newHistory = history.slice(0, historyIndex + 1)
          newHistory.push(snapshot)

          // 限制历史记录数量
          if (newHistory.length > maxHistory) {
            const removed = newHistory.shift()
            if (removed) removedEntries.push(removed)
          }

          return {
            history: newHistory,
            historyIndex: newHistory.length - 1,
          }
        })
        void replaceHistoryResourceReferences(removedEntries, [snapshot])
      },

      clearHistory: () => {
        const previousHistory = get().history
        if (previousHistory.length === 0) return
        set({ history: [], historyIndex: -1 })
        void replaceHistoryResourceReferences(previousHistory, [])
      },

      // 撤销
      undo: () => {
        const { history, historyIndex } = get()
        if (historyIndex <= 0) return

        const prevState = history[historyIndex - 1]
        const nextState = cloneHistoryEntry(
          reconcileDisabledNodes(prevState.nodes, prevState.edges),
          prevState.edges,
        )
        void adjustResourceReferences(get().nodes, nextState.nodes)
        set({
          nodes: nextState.nodes,
          edges: nextState.edges,
          historyIndex: historyIndex - 1,
        })

        get().saveCurrentFlow()
      },

      // 重做
      redo: () => {
        const { history, historyIndex } = get()
        if (historyIndex >= history.length - 1) return

        const historyState = history[historyIndex + 1]
        const nextState = cloneHistoryEntry(
          reconcileDisabledNodes(historyState.nodes, historyState.edges),
          historyState.edges,
        )
        void adjustResourceReferences(get().nodes, nextState.nodes)
        set({
          nodes: nextState.nodes,
          edges: nextState.edges,
          historyIndex: historyIndex + 1,
        })

        get().saveCurrentFlow()
      },

      // 可以撤销
      canUndo: () => {
        const { historyIndex } = get()
        return historyIndex > 0
      },

      // 可以重做
      canRedo: () => {
        const { history, historyIndex } = get()
        return historyIndex < history.length - 1
      },

      // 切换锁定
      toggleLock: () => {
        set((state) => ({ isLocked: !state.isLocked }))
      },

      // 适应视图
      fitView: () => {
        // 这个方法需要访问 ReactFlow 实例，在组件中实现
      },

      // 放大
      zoomIn: () => {
        // 这个方法需要访问 ReactFlow 实例，在组件中实现
      },

      // 缩小
      zoomOut: () => {
        // 这个方法需要访问 ReactFlow 实例，在组件中实现
      },

      // 导出为 JSON
      exportFlowAsJSON: () => {
        const { currentFlow, nodes, edges } = get()
        if (!currentFlow) return '{}'

        const exportData = {
          ...currentFlow,
          nodes,
          edges,
        }

        return JSON.stringify(exportData, null, 2)
      },

      // 从 JSON 导入
      importFlowFromJSON: (json) => {
        try {
          flushScheduledFlowSave(get)
          const previousHistory = get().history
          const data = JSON.parse(json)
          const edges = cloneFlowValue(data.edges || [])
          const normalizedNodes = ensureUniqueNodeLabels(normalizeNodes(cloneFlowValue(data.nodes || [])))
          const nodes = reconcileDisabledNodes(normalizedNodes, edges)
          const newFlow: Flow = {
            id: nanoid(),
            name: data.name || '导入的 Flow',
            title: data.title || data.name || '导入的 Flow',
            description: data.description || '',
            nodes,
            edges,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          const initialHistory = cloneHistoryEntry(nodes, edges)

          set((state) => ({
            flows: [...state.flows, newFlow],
            currentFlow: newFlow,
            currentFlowId: newFlow.id,
            nodes: newFlow.nodes,
            edges: newFlow.edges,
            history: [initialHistory],
            historyIndex: 0,
          }))
          void adjustResourceReferences([], newFlow.nodes)
          void replaceHistoryResourceReferences(previousHistory, [initialHistory])
        } catch (error) {
          console.error('导入失败:', error)
          throw new Error('无效的 JSON 格式')
        }
      },

      refreshDesktopJobs: async () => {
        const desktop = getDesktopBridge()
        if (!desktop) {
          set({ desktopJobs: [] })
          return
        }
        const jobs = await desktop.jobs.list()
        set({ desktopJobs: jobs })
        if (!desktopJobsUnsubscribe) {
          desktopJobsUnsubscribe = desktop.jobs.onUpdated((job) => {
            set((state) => ({
              desktopJobs: [job, ...state.desktopJobs.filter((item) => item.id !== job.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            }))
            if (job.id === activeDesktopJobId && job.status === 'cancelled') {
              activeFlowExecutionController?.abort()
            }
          })
        }
      },

      resumeDesktopJob: async (jobId, aiClient, scraperClient) => {
        const desktop = getDesktopBridge()
        if (!desktop) throw new Error('当前不是 Desktop 运行时，无法恢复后台任务。')
        const jobs = await desktop.jobs.list()
        const job = jobs.find((item) => item.id === jobId)
        if (!job) throw new Error('找不到要恢复的 Desktop 任务。')
        const checkpoint = parseFlowExecutionCheckpoint(job.checkpoint)
        if (checkpoint?.flowId && get().currentFlowId !== checkpoint.flowId) {
          get().loadFlow(checkpoint.flowId)
        }
        await get().executeFlow(aiClient, scraperClient, { resumeJobId: jobId })
      },

      // 初始化
      initialize: async () => {
        if (!useFlowStore.persist.hasHydrated()) {
          await useFlowStore.persist.rehydrate()
        }
        // 如果没有 Flow，创建一个默认的
        const { flows } = get()
        if (flows.length === 0) {
          get().createFlow('我的第一个 Flow', '开始你的创作之旅')
        }
        await get().refreshDesktopJobs()
      },

      // 执行 Flow
      executeFlow: async (aiClient, scraperClient, options) => {
        if (get().isExecuting) return

        const desktop = getDesktopBridge()
        let resumedJob: DesktopExecutionJobRecord | undefined
        let resumeCheckpoint: FlowExecutionCheckpoint | null = null
        if (options?.resumeJobId && desktop) {
          const jobs = await desktop.jobs.list()
          resumedJob = jobs.find((job) => job.id === options.resumeJobId)
          resumeCheckpoint = parseFlowExecutionCheckpoint(resumedJob?.checkpoint)
        }

        const currentFlow = get().currentFlow
        const graphNodes = resumeCheckpoint?.nodes?.length ? resumeCheckpoint.nodes : get().nodes
        const graphEdges = resumeCheckpoint?.edges?.length ? resumeCheckpoint.edges : get().edges
        const executableNodes = graphNodes.filter((node) => node.type !== 'group' && !node.data?.disabled)
        const executableIds = new Set(executableNodes.map((node) => node.id))
        const executableEdges = graphEdges.filter((edge) => executableIds.has(edge.source) && executableIds.has(edge.target))

        const resolvedScraperClient = scraperClient || tryGetContentServiceClient()
        const controller = new AbortController()
        activeFlowExecutionController = controller
        let desktopJobId = resumedJob?.id || null
        let lastProgressNodeId = resumeCheckpoint?.currentNodeId || ''
        let pendingJobWrites = Promise.resolve()

        const updateDesktopJob = (update: DesktopExecutionJobUpdate) => {
          if (!desktop || !desktopJobId) return pendingJobWrites
          pendingJobWrites = pendingJobWrites.then(async () => {
            const updated = await desktop.jobs.update(desktopJobId as string, update)
            set((state) => ({
              desktopJobs: [updated, ...state.desktopJobs.filter((item) => item.id !== updated.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            }))
          })
          return pendingJobWrites
        }

        if (desktop) {
          try {
            if (!desktopJobId) {
              const initialProgress: ExecutionProgress = {
                nodeId: '',
                status: 'pending',
                contexts: new Map(executableNodes.map((node) => [node.id, {
                  nodeId: node.id,
                  inputs: {},
                  status: 'pending' as const,
                }])),
              }
              const initialCheckpoint = checkpointFromProgress(
                initialProgress,
                currentFlow?.id,
                currentFlow?.updatedAt,
                executableNodes,
                executableEdges,
              )
              const created = await desktop.jobs.create(DESKTOP_JOB_KIND, initialCheckpoint)
              desktopJobId = created.id
              set((state) => ({ desktopJobs: [created, ...state.desktopJobs.filter((item) => item.id !== created.id)] }))
            }
            activeDesktopJobId = desktopJobId
            set({ activeDesktopJobId: desktopJobId })
            await updateDesktopJob({ status: 'running', resumeRequired: false })
          } catch (error) {
            console.warn('Desktop 后台任务持久化不可用，继续使用前台执行：', error)
            desktopJobId = null
            activeDesktopJobId = null
            set({ activeDesktopJobId: null })
          }
        }

        set({ isExecuting: true, executionContexts: new Map() })

        const materializeGenerationResults = (contexts: Map<string, ExecutionContext>) => {
          contexts.forEach((context, nodeId) => {
            const output = context.output as {
              kind?: unknown
              variant?: unknown
              task?: GenerationTaskState
            } | undefined
            if (output?.kind !== 'generation-result' || (output.variant !== 'image' && output.variant !== 'video')) return

            const task = output.task
            const urls = Array.isArray(task?.resultUrls)
              ? task.resultUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
              : []
            if (!urls.length) return

            const state = get()
            const requestNode = state.nodes.find((node) => node.id === nodeId)
            if (!requestNode || requestNode.type !== 'request') return
            const requestData = requestNode.data as RequestNodeData
            const variant = output.variant
            const resultData = createGenerationResultContentData(
              variant,
              urls,
              `${requestData.label || (variant === 'image' ? '图片' : '视频')}结果`,
              task?.resultResourceIds,
              task?.resultMimeTypes,
            )
            const storedResultId = requestData.resultNodeIds?.[variant]
            let resultNode = storedResultId ? state.nodes.find((node) => node.id === storedResultId) : undefined

            if (resultNode?.type === 'content') {
              state.updateNode(resultNode.id, { data: resultData })
            } else {
              const width = Number(requestNode.style?.width || requestNode.width || 520)
              resultNode = state.addNode({
                type: 'content',
                position: { x: requestNode.position.x + width + 90, y: requestNode.position.y },
                data: resultData,
              })
            }

            if (!state.edges.some((edge) => edge.source === nodeId && edge.target === resultNode?.id)) {
              state.addEdge({ source: nodeId, target: resultNode.id, sourceHandle: 'out', targetHandle: 'in', type: 'interactive' })
            }
            state.updateNode(nodeId, {
              data: {
                resultNodeIds: { ...(requestData.resultNodeIds || {}), [variant]: resultNode.id },
                resultNodeId: resultNode.id,
                resultCreatedAt: Date.now(),
              },
            })
          })
        }

        try {
          const executor = new FlowExecutor(
            executableNodes.map((n) => ({ ...n, data: n.data || {} })),
            executableEdges.map((e) => ({ ...e, type: e.type || 'smoothstep' })),
            aiClient,
            resolvedScraperClient,
            (channelId) => channelId
              ? useAIStore.getState().createClientForChannel(channelId) || undefined
              : undefined,
            (nodeId, data) => get().updateNode(nodeId, { data }),
            controller.signal,
            (progress) => {
              lastProgressNodeId = progress.nodeId
              const checkpoint = checkpointFromProgress(
                progress,
                currentFlow?.id || resumeCheckpoint?.flowId,
                currentFlow?.updatedAt || resumeCheckpoint?.flowUpdatedAt,
                executableNodes,
                executableEdges,
              )
              void updateDesktopJob({ checkpoint })
            },
            resumeCheckpoint?.resumeAvailable ? resumeCheckpoint.contexts : undefined,
          )

          const result = await executor.execute()
          const finalCheckpoint = checkpointFromProgress(
            { nodeId: lastProgressNodeId, status: result.success ? 'completed' : controller.signal.aborted ? 'cancelled' : 'failed', contexts: result.contexts },
            currentFlow?.id || resumeCheckpoint?.flowId,
            currentFlow?.updatedAt || resumeCheckpoint?.flowUpdatedAt,
            executableNodes,
            executableEdges,
          )
          await updateDesktopJob({
            status: result.success ? 'completed' : controller.signal.aborted ? 'cancelled' : 'failed',
            checkpoint: finalCheckpoint,
            error: result.success ? undefined : result.error,
            resumeRequired: false,
          })
          await pendingJobWrites

          if (result.success) materializeGenerationResults(result.contexts)

          set({
            executionContexts: result.contexts,
            isExecuting: false,
            activeDesktopJobId: null,
          })

          if (!result.success && result.error !== '执行已停止') {
            console.error('Flow execution failed:', result.error)
            alert(`执行失败: ${result.error}`)
          } else if (result.success) {
            alert('Flow 执行完成！')
          }
        } catch (error) {
          console.error('Flow execution error:', error)
          const failureStatus = controller.signal.aborted ? 'cancelled' as const : 'failed' as const
          await updateDesktopJob({ status: failureStatus, error: controller.signal.aborted ? '执行已停止' : error instanceof Error ? error.message : '未知错误', resumeRequired: false })
          await pendingJobWrites
          set({ isExecuting: false, activeDesktopJobId: null })
          if (!controller.signal.aborted) alert(`执行错误: ${error instanceof Error ? error.message : '未知错误'}`)
        } finally {
          if (activeFlowExecutionController === controller) activeFlowExecutionController = null
          if (activeDesktopJobId === desktopJobId) activeDesktopJobId = null
        }
      },

      // 停止执行
      stopExecution: () => {
        const desktop = getDesktopBridge()
        const jobId = activeDesktopJobId
        if (desktop && jobId) void desktop.jobs.cancel(jobId).catch((error) => console.warn('取消 Desktop 任务失败:', error))
        activeFlowExecutionController?.abort()
        activeFlowExecutionController = null
        set({ isExecuting: false, activeDesktopJobId: null })
      },

      // 创建文件夹
      createFolder: (name, color) => {
        const newFolder: Folder = {
          id: nanoid(),
          name,
          color: color || '#3B6DFF',
          createdAt: Date.now(),
        }

        set((state) => ({
          folders: [...state.folders, newFolder],
        }))

        return newFolder
      },

      // 删除文件夹
      deleteFolder: (id) => {
        set((state) => ({
          folders: state.folders.filter((f) => f.id !== id),
          // 将该文件夹下的 flows 移到根目录
          flows: state.flows.map((f) =>
            f.folderId === id ? { ...f, folderId: undefined } : f
          ),
        }))
      },

      // 更新文件夹
      updateFolder: (id, updates) => {
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
        }))
      },

      // 移动 Flow 到文件夹
      moveFlowToFolder: (flowId, folderId) => {
        set((state) => ({
          flows: state.flows.map((f) =>
            f.id === flowId ? { ...f, folderId: folderId || undefined, updatedAt: Date.now() } : f
          ),
        }))
      },
    }),
    {
      name: 'cnote-flows',
      storage: flowPersistStorage,
      partialize: (state) => ({
        currentFlowId: state.currentFlowId,
        flows: state.flows,
        folders: state.folders,
        isLocked: state.isLocked,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
)
