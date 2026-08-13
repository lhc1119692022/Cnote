import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { applyNodeChanges, applyEdgeChanges } from 'reactflow'
import type { Node, Edge, OnNodesChange, OnEdgesChange } from 'reactflow'
import type { Flow, Folder } from '@/types/flow'
import { FlowExecutor, type ExecutionContext } from '@/lib/flow'
import { useAIStore } from '@/stores/use-ai-store'
import { localForageStorage } from '@/lib/localforage-storage'
import { deleteLocalResource, retainLocalResource } from '@/lib/resource-storage'
import { cloneFlowValue } from '@/lib/flow/clone'
import {
  AI_NODE_DEFAULT_SIZE,
  BROWSER_NODE_DEFAULT_SIZE,
  CONTENT_NODE_DEFAULT_SIZE,
  GROUP_NODE_PADDING,
  STICKY_NODE_DEFAULT_SIZE,
} from '@/lib/flow/node-dimensions'
import { tryGetContentServiceClient } from '@/lib/content-service'

type FlowHistoryEntry = { nodes: Node[]; edges: Edge[] }

const nodeLabelDefaults: Record<string, string> = {
  ai: 'AI 节点',
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
      : node.type === 'content'
        ? CONTENT_NODE_DEFAULT_SIZE
        : node.type === 'sticky'
          ? STICKY_NODE_DEFAULT_SIZE
          : undefined
  if (!defaults) return node
  const style = node.style || {}
  const hasWidth = style.width !== undefined
  const hasHeight = style.height !== undefined
  if (hasWidth && hasHeight) return node

  return {
    ...node,
    style: {
      ...style,
      ...(hasWidth ? {} : { width: defaults.width }),
      ...(hasHeight ? {} : { height: defaults.height }),
    },
  } as T
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
  return normalizeGroupBehavior(normalizeGroupPadding(nodes
    .map(withDefaultNodeDimensions)
    .map(recoverLegacyContentNodeDimensions)))
}

function getPersistableNodes(nodes: Node[]) { return nodes }

function nodeResourceId(node?: Node) {
  if (!node) return undefined
  const source = node.data?.source
  return source?.kind === 'file' || source?.kind === 'clipboard-image' ? source.resourceId as string : undefined
}

function resourceCounts(nodes: Node[]) {
  const counts = new Map<string, number>()
  nodes.forEach((node) => {
    const resourceId = nodeResourceId(node)
    if (resourceId) counts.set(resourceId, (counts.get(resourceId) || 0) + 1)
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
  executeFlow: (aiClient?: any, scraperClient?: any) => Promise<void>
  stopExecution: () => void

  // 初始化
  initialize: () => Promise<void>
  setHasHydrated: (value: boolean) => void
}

type PersistedFlowState = Pick<
  FlowState,
  'currentFlowId' | 'flows' | 'folders' | 'isLocked'
>

let pendingFlowSaveTimer: ReturnType<typeof setTimeout> | null = null

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

const flowPersistStorage: PersistStorage<PersistedFlowState> = {
  getItem: async (name) => {
    const rawValue = await localForageStorage.getItem(name)
    if (!rawValue) return null
    const storedValue = JSON.parse(rawValue) as StorageValue<Partial<FlowState>>
    const persistedState: PersistedFlowState = {
      currentFlowId: storedValue.state.currentFlowId || null,
      flows: storedValue.state.flows || [],
      folders: storedValue.state.folders || [],
      isLocked: Boolean(storedValue.state.isLocked),
    }
    const value: StorageValue<PersistedFlowState> = { state: persistedState, version: storedValue.version }
    lastPersistedSnapshot = persistedState
    return value
  },
  setItem: async (name, value) => {
    const next = value.state
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
        const newFlow: Flow = {
          id: nanoid(),
          name,
          title: name,
          description: description || '',
          nodes: initialNodes,
          edges: initialEdges,
          folderId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        const initialHistory = cloneHistoryEntry(initialNodes, initialEdges)

        set((state) => ({
          flows: [...state.flows, newFlow],
          currentFlow: newFlow,
          currentFlowId: newFlow.id,
          nodes: initialNodes,
          edges: initialEdges,
          history: [initialHistory],
          historyIndex: 0,
        }))
        void adjustResourceReferences([], initialNodes)
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
        const nodes = ensureUniqueNodeLabels(normalizeNodes(cloneFlowValue(flow.nodes || [])))
        const edges = cloneFlowValue(flow.edges || [])
        const normalizedFlow = { ...flow, nodes: cloneFlowValue(nodes), edges: cloneFlowValue(edges) }
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
        const newNodes = flow.nodes.map((node) => {
          const id = nanoid()
          nodeIdMap.set(node.id, id)
          return { ...cloneFlowValue(node), id, selected: false }
        })
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
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(clonedNode), usedLabels)
          const newNode: Node = {
            ...clonedNode,
            id: nanoid(),
            data: { ...clonedNode.data, label },
          }
          createdNode = newNode
          const newNodes = [...state.nodes, newNode]
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
            nodes: state.nodes.map((node) => {
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
            }).filter((node) => node.id !== id),
          }))
          get().addToHistory()
          get().saveCurrentFlow()
          return
        }
        void deleteLocalResource(nodeResourceId(removed))
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== id),
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
          return { nodes: state.nodes.map((node) => node.id === id ? { ...merged, data: { ...merged.data, label } } : node) }
        })

        scheduleCurrentFlowSave(get)
      },

      // 复制节点
      duplicateNode: (id) => {
        const node = get().nodes.find((n) => n.id === id)
        if (!node) return
        void retainLocalResource(nodeResourceId(node))

        set((state) => {
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(node), usedLabels)
          const newNode: Node = {
            ...cloneFlowValue(node),
            id: nanoid(),
            selected: false,
            data: { ...cloneFlowValue(node.data), label, sourceId: undefined },
            position: {
              x: node.position.x + 50,
              y: node.position.y + 50,
            },
          }
          return { nodes: [...state.nodes, newNode] }
        })

        get().addToHistory()
        get().saveCurrentFlow()
      },

      replaceGraph: (nodes, edges, recordHistory = true) => {
        const previousNodes = get().nodes
        const nextNodes = cloneFlowValue(nodes)
        const nextEdges = cloneFlowValue(edges)
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
          edges: [...state.edges, newEdge],
        }))

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // 删除边
      deleteEdge: (id) => {
        if (!get().edges.some((edge) => edge.id === id)) return
        set((state) => ({
          edges: state.edges.filter((e) => e.id !== id),
        }))

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
        removedIds.forEach((id) => { void deleteLocalResource(nodeResourceId(currentNodes.find((node) => node.id === id))) })
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
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
        }))

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
        const nextState = cloneHistoryEntry(prevState.nodes, prevState.edges)
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
        const nextState = cloneHistoryEntry(historyState.nodes, historyState.edges)
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
          const nodes = ensureUniqueNodeLabels(normalizeNodes(cloneFlowValue(data.nodes || [])))
          const edges = cloneFlowValue(data.edges || [])
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
      },

      // 执行 Flow
      executeFlow: async (aiClient, scraperClient) => {
        const { nodes, edges } = get()
        if (get().isExecuting) return
        const executableNodes = nodes.filter((node) => node.type !== 'group')
        const executableIds = new Set(executableNodes.map((node) => node.id))
        const executableEdges = edges.filter((edge) => executableIds.has(edge.source) && executableIds.has(edge.target))

        const resolvedScraperClient = scraperClient || tryGetContentServiceClient()

        set({ isExecuting: true, executionContexts: new Map() })

        try {
          const executor = new FlowExecutor(
            executableNodes.map((n) => ({ ...n, data: n.data || {} })),
            executableEdges.map((e) => ({ ...e, type: e.type || 'smoothstep' })),
            aiClient,
            resolvedScraperClient,
            (channelId) => channelId
              ? useAIStore.getState().createClientForChannel(channelId) || undefined
              : undefined,
            (nodeId, data) => get().updateNode(nodeId, { data })
          )

          const result = await executor.execute()

          set({
            executionContexts: result.contexts,
            isExecuting: false,
          })

          if (!result.success) {
            console.error('Flow execution failed:', result.error)
            alert(`执行失败: ${result.error}`)
          } else {
            alert('Flow 执行完成！')
          }
        } catch (error) {
          console.error('Flow execution error:', error)
          set({ isExecuting: false })
          alert(`执行错误: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      },

      // 停止执行
      stopExecution: () => {
        set({ isExecuting: false })
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
