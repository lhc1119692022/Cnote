import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { applyNodeChanges, applyEdgeChanges } from 'reactflow'
import type { Node, Edge, OnNodesChange, OnEdgesChange } from 'reactflow'
import { localForageStorage } from '@/lib/localforage-storage'
import type { Flow } from '@/types/flow'
import { FlowExecutor, type ExecutionContext } from '@/lib/flow'

interface FlowState {
  // 当前 Flow
  currentFlow: Flow | null
  currentFlowId: string | null

  // 所有 Flows
  flows: Flow[]

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

  // 操作方法
  createFlow: (name: string, description?: string) => Flow
  deleteFlow: (id: string) => void
  updateFlow: (id: string, updates: Partial<Flow>) => void
  loadFlow: (id: string) => void
  saveCurrentFlow: () => void
  duplicateFlow: (id: string) => Flow

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
}

export const useFlowStore = create<FlowState>()(
  persist(
    (set, get) => ({
      currentFlow: null,
      currentFlowId: null,
      flows: [],
      nodes: [],
      edges: [],
      history: [],
      historyIndex: -1,
      maxHistory: 50,
      isLocked: false,
      isExecuting: false,
      executionContexts: new Map(),

      // 创建新 Flow
      createFlow: (name, description) => {
        const newFlow: Flow = {
          id: nanoid(),
          name,
          title: name,
          description: description || '',
          nodes: [],
          edges: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          flows: [...state.flows, newFlow],
          currentFlow: newFlow,
          currentFlowId: newFlow.id,
          nodes: [],
          edges: [],
          history: [],
          historyIndex: -1,
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
        const flow = get().flows.find((f) => f.id === id)
        if (!flow) return

        set({
          currentFlow: flow,
          currentFlowId: id,
          nodes: flow.nodes || [],
          edges: flow.edges || [],
          history: [],
          historyIndex: -1,
        })
      },

      // 保存当前 Flow
      saveCurrentFlow: () => {
        const { currentFlowId, nodes, edges } = get()
        if (!currentFlowId) return

        get().updateFlow(currentFlowId, { nodes, edges })
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
        const newNode: Node = {
          ...node,
          id: nanoid(),
        }

        set((state) => {
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
        set((state) => ({
          nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
        }))

        get().saveCurrentFlow()
      },

      // 复制节点
      duplicateNode: (id) => {
        const node = get().nodes.find((n) => n.id === id)
        if (!node) return

        const newNode: Node = {
          ...node,
          id: nanoid(),
          position: {
            x: node.position.x + 50,
            y: node.position.y + 50,
          },
        }

        set((state) => ({
          nodes: [...state.nodes, newNode],
        }))

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

        // 延迟保存，避免拖拽时频繁保存
        setTimeout(() => {
          get().saveCurrentFlow()
        }, 500)
      },

      // React Flow 边变更处理
      onEdgesChange: (changes) => {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
        }))

        get().saveCurrentFlow()
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
            nodes: data.nodes || [],
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
            scraperClient
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
    }),
    {
      name: 'cnote-flows',
      storage: localForageStorage as any,
    }
  )
)
