import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { applyNodeChanges, applyEdgeChanges } from 'reactflow'
import type { Node, Edge, OnNodesChange, OnEdgesChange } from 'reactflow'
import type { Flow, Folder } from '@/types/flow'
import { FlowExecutor, type ExecutionContext } from '@/lib/flow'
import { useAIStore } from '@/stores/use-ai-store'
import { localForageStorage } from '@/lib/localforage-storage'

const nodeLabelDefaults: Record<string, string> = {
  ai: 'AI 节点',
  browser: '浏览器节点',
  sticky: '贴纸',
  content: '内容类型选择',
  text: '文本节点',
  youtube: 'YouTube 节点',
  pdf: 'PDF 节点',
  image: '图片节点',
  video: '视频节点',
  table: '表格节点',
}

function getNodeLabel(node: Pick<Node, 'type' | 'data'>) {
  const mode = node.type === 'content' ? node.data?.mode : node.type
  return String(node.data?.label || nodeLabelDefaults[mode || ''] || '节点').trim() || '节点'
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

function normalizeLegacyNodes(nodes: Node[]) {
  return nodes.map((node) => {
    if (node.type === 'output' || node.type === 'editor') {
      return {
        ...node,
        type: 'text',
        data: {
          ...node.data,
          mode: 'text',
          content: node.data?.content || node.data?.output || '',
        },
      }
    }
    if (node.type === 'group') {
      return {
        ...node,
        type: 'sticky',
        data: { ...node.data, text: node.data?.text || node.data?.label || '' },
      }
    }
    return node
  })
}

function getPersistableNodes(nodes: Node[]) {
  return nodes.map((node) => {
    if (!node.data?.resourceId || !String(node.data?.content || '').startsWith('blob:')) return node
    return { ...node, data: { ...node.data, content: '' } }
  })
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
  history: { nodes: Node[]; edges: Edge[] }[]
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
  addNode: (node: Omit<Node, 'id'>) => void
  deleteNode: (id: string) => void
  updateNode: (id: string, updates: Partial<Node>) => void
  duplicateNode: (id: string) => void

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
        const nodeIdMap = new Map<string, string>()
        const initialNodes = ensureUniqueNodeLabels(normalizeLegacyNodes((initialGraph?.nodes || []).map((node) => {
          const id = nanoid()
          nodeIdMap.set(node.id, id)
          return {
            ...node,
            id,
            data: { ...node.data },
            selected: false,
          }
        })))
        const initialEdges = (initialGraph?.edges || []).map((edge) => ({
          ...edge,
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

        set((state) => ({
          flows: [...state.flows, newFlow],
          currentFlow: newFlow,
          currentFlowId: newFlow.id,
          nodes: initialNodes,
          edges: initialEdges,
          history: [{ nodes: initialNodes, edges: initialEdges }],
          historyIndex: 0,
        }))

        return newFlow
      },

      // 删除 Flow
      deleteFlow: (id) => {
        set((state) => {
          const newFlows = state.flows.filter((f) => f.id !== id)
          const isCurrentFlow = state.currentFlowId === id

          return {
            flows: newFlows,
            currentFlow: isCurrentFlow ? null : state.currentFlow,
            currentFlowId: isCurrentFlow ? null : state.currentFlowId,
            nodes: isCurrentFlow ? [] : state.nodes,
            edges: isCurrentFlow ? [] : state.edges,
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
        const flow = get().flows.find((f) => f.id === id)
        if (!flow) return
        const nodes = ensureUniqueNodeLabels(normalizeLegacyNodes(flow.nodes || []))
        const normalizedFlow = { ...flow, nodes }

        set((state) => ({
          flows: state.flows.map((item) => item.id === id ? normalizedFlow : item),
          currentFlow: normalizedFlow,
          currentFlowId: id,
          nodes,
          edges: flow.edges || [],
          history: [{ nodes, edges: flow.edges || [] }],
          historyIndex: 0,
        }))
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
          nodes: getPersistableNodes(nodes),
          edges,
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

        const newFlow: Flow = {
          ...flow,
          id: nanoid(),
          name: `${flow.name} (副本)`,
          title: `${flow.title} (副本)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          flows: [...state.flows, newFlow],
        }))

        return newFlow
      },

      // 添加节点
      addNode: (node) => {
        set((state) => {
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(node), usedLabels)
          const newNode: Node = {
            ...node,
            id: nanoid(),
            data: { ...node.data, label },
          }
          const newNodes = [...state.nodes, newNode]
          return { nodes: newNodes }
        })

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // 删除节点
      deleteNode: (id) => {
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== id),
          edges: state.edges.filter((e) => e.source !== id && e.target !== id),
        }))

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // 更新节点
      updateNode: (id, updates) => {
        set((state) => {
          const current = state.nodes.find((node) => node.id === id)
          if (!current) return state
          const merged = {
            ...current,
            ...updates,
            data: updates.data ? { ...current.data, ...updates.data } : current.data,
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

        set((state) => {
          const usedLabels = new Set(state.nodes.map(getNodeLabel))
          const label = getUniqueNodeLabel(getNodeLabel(node), usedLabels)
          const newNode: Node = {
            ...node,
            id: nanoid(),
            selected: false,
            data: { ...node.data, label, sourceId: undefined },
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

      // 添加边
      addEdge: (edge) => {
        const newEdge: Edge = {
          ...edge,
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
        set((state) => ({
          edges: state.edges.filter((e) => e.id !== id),
        }))

        get().addToHistory()
        get().saveCurrentFlow()
      },

      // React Flow 节点变更处理
      onNodesChange: (changes) => {
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
        set((state) => {
          const { nodes, edges, history, historyIndex, maxHistory } = state
          const newHistory = history.slice(0, historyIndex + 1)
          newHistory.push({ nodes: [...nodes], edges: [...edges] })

          // 限制历史记录数量
          if (newHistory.length > maxHistory) {
            newHistory.shift()
          }

          return {
            history: newHistory,
            historyIndex: newHistory.length - 1,
          }
        })
      },

      // 撤销
      undo: () => {
        const { history, historyIndex } = get()
        if (historyIndex <= 0) return

        const prevState = history[historyIndex - 1]
        set({
          nodes: prevState.nodes,
          edges: prevState.edges,
          historyIndex: historyIndex - 1,
        })

        get().saveCurrentFlow()
      },

      // 重做
      redo: () => {
        const { history, historyIndex } = get()
        if (historyIndex >= history.length - 1) return

        const nextState = history[historyIndex + 1]
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
          const data = JSON.parse(json)
          const newFlow: Flow = {
            id: nanoid(),
            name: data.name || '导入的 Flow',
            title: data.title || data.name || '导入的 Flow',
            description: data.description || '',
            nodes: ensureUniqueNodeLabels(normalizeLegacyNodes(data.nodes || [])),
            edges: data.edges || [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }

          set((state) => ({
            flows: [...state.flows, newFlow],
            currentFlow: newFlow,
            currentFlowId: newFlow.id,
            nodes: newFlow.nodes,
            edges: newFlow.edges,
          }))
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

        set({ isExecuting: true, executionContexts: new Map() })

        try {
          const executor = new FlowExecutor(
            nodes.map((n) => ({ ...n, data: n.data || {} })),
            edges.map((e) => ({ ...e, type: e.type || 'smoothstep' })),
            aiClient,
            scraperClient,
            (channelId) => channelId
              ? useAIStore.getState().createClientForChannel(channelId) || undefined
              : undefined
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
