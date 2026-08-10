import { useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import ReactFlow, {
  Background,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  type Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useFlowStore } from '@/stores/use-flow-store'
import { captureFlowThumbnail } from '@/lib/flow/thumbnail'
import { Toolbar } from './Toolbar'
import { CanvasControls } from './CanvasControls'
import {
  ContentNode,
  AINode,
  BrowserNode,
  OutputNode,
  EditorNode,
  StickyNode,
  GroupNode,
  PDFNode,
} from './nodes'

// 注册自定义节点类型
const nodeTypes: NodeTypes = {
  content: ContentNode,
  ai: AINode,
  browser: BrowserNode,
  output: OutputNode,
  editor: EditorNode,
  sticky: StickyNode,
  group: GroupNode,
  pdf: PDFNode,
}

function FlowEditorInner() {
  const { flowId } = useParams()
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addEdge: addEdgeToStore,
    isLocked,
    currentFlow,
    currentFlowId,
    loadFlow,
    saveCurrentFlow,
  } = useFlowStore()

  useEffect(() => {
    if (flowId) loadFlow(flowId)
  }, [flowId, loadFlow])

  // 生成画布缩略图
  const generateThumbnail = useCallback(async () => {
    if (nodes.length === 0) return undefined
    return captureFlowThumbnail()
  }, [nodes.length])

  const saveWithThumbnail = useCallback(async (viewport?: Viewport) => {
    const thumbnail = await generateThumbnail()
    saveCurrentFlow(thumbnail, viewport || reactFlowInstance.getViewport())
  }, [generateThumbnail, reactFlowInstance, saveCurrentFlow])

  // 连接节点时的回调
  const onConnect = useCallback(
    (connection: any) => {
      addEdgeToStore({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    },
    [addEdgeToStore]
  )

  // 处理粘贴事件（智能粘贴）
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text')
      if (!text) return

      // YouTube 链接检测
      const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/
      const isYouTube = youtubeRegex.test(text)

      if (isYouTube) {
        // TODO: 创建 YouTube 内容节点
        console.log('检测到 YouTube 链接:', text)
      } else {
        // TODO: 创建 Text 内容节点
        console.log('检测到文本内容:', text)
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey

      // Ctrl/Cmd + S: 保存
      if (isCtrlOrCmd && e.key === 's') {
        e.preventDefault()
        await saveWithThumbnail()
        return
      }

      // Ctrl/Cmd + Z: 撤销
      if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useFlowStore.getState().undo()
      }

      // Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y: 重做
      if (
        (isCtrlOrCmd && e.shiftKey && e.key === 'z') ||
        (isCtrlOrCmd && e.key === 'y')
      ) {
        e.preventDefault()
        useFlowStore.getState().redo()
      }

      // Ctrl/Cmd + D: 复制节点
      if (isCtrlOrCmd && e.key === 'd') {
        e.preventDefault()
        // TODO: 复制选中的节点
        console.log('复制节点')
      }

      // F: 适应视图
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        reactFlowInstance.fitView({ padding: 0.2 })
      }

      // +: 放大
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        reactFlowInstance.zoomIn()
      }

      // -: 缩小
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        reactFlowInstance.zoomOut()
      }

      // Ctrl/Cmd + 0: 适应视图
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault()
        reactFlowInstance.fitView({ padding: 0.2 })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [reactFlowInstance, saveWithThumbnail])

  useEffect(() => {
    if (nodes.length === 0) return
    const timeoutId = window.setTimeout(() => {
      saveWithThumbnail()
    }, 800)
    return () => window.clearTimeout(timeoutId)
  }, [nodes, edges, saveWithThumbnail])

  // 窗口关闭/刷新前自动保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentFlow(undefined, reactFlowInstance.getViewport())
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [reactFlowInstance, saveCurrentFlow])

  return (
    <div className="relative h-screen w-screen bg-background">
      {/* 顶部工具栏 */}
      <Toolbar />

      {/* React Flow 画布 */}
      <div ref={reactFlowWrapper} className="h-full w-full">
        <ReactFlow
          key={currentFlowId || flowId}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          nodesDraggable={!isLocked}
          nodesConnectable={!isLocked}
          elementsSelectable={!isLocked}
          defaultViewport={currentFlow?.viewport}
          fitView={!currentFlow?.viewport}
          onMoveEnd={(_, viewport) => saveWithThumbnail(viewport)}
          minZoom={0.1}
          maxZoom={4}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: 'var(--primary)', strokeWidth: 2 },
          }}
        >
          <Background color="var(--border)" gap={16} />
          <MiniMap
            nodeColor="var(--primary)"
            maskColor="rgba(0, 0, 0, 0.1)"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
            }}
          />
        </ReactFlow>
      </div>

      {/* 左下角画布控制 */}
      <CanvasControls />
    </div>
  )
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  )
}
