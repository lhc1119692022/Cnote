import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import ReactFlow, {
  Background,
  useReactFlow,
  useStore,
  ReactFlowProvider,
  ConnectionLineType,
  type NodeTypes,
  type EdgeTypes,
  type Viewport,
} from 'reactflow'
import { Check, CheckSquare, ChevronDown, ChevronRight, Download, FileText, FileUp, Globe, Image as ImageIcon, Layers3, Library, Sparkles, Square, StickyNote, Table2, Trash2, Video, Youtube, X } from 'lucide-react'
import 'reactflow/dist/style.css'
import { useFlowStore } from '@/stores/use-flow-store'
import { useAIStore } from '@/stores/use-ai-store'
import { useSourceStore } from '@/stores/use-source-store'
import { captureFlowThumbnail } from '@/lib/flow/thumbnail'
import { Toolbar } from './Toolbar'
import { CanvasControls } from './CanvasControls'
import { InteractiveEdge } from './InteractiveEdge'
import {
  ContentNode,
  ContentLeafNode,
  AINode,
  BrowserNode,
  StickyNode,
  PDFNode,
} from './nodes'

const MINIMAP_WIDTH = 280
const MINIMAP_HEIGHT = 180
const FLOATING_MENU_MARGIN = 12
const MIN_EDITOR_WIDTH = 288
const MIN_EDITOR_HEIGHT = 256
const NODE_PANEL_INSET = 284
const EXTENSION_PANEL_MARGIN = 28
const TOOLBAR_HORIZONTAL_PADDING = 32
const MIN_TOOLBAR_GROUP_GAP = 40
const panelFilterLabels: Record<string, string> = {
  all: '全部',
  ai: 'AI 节点',
  'content:text': '文本',
  media: 'Youtube',
  pdf: 'PDF',
  'content:image': '图片',
  'content:video': '视频',
  'content:table': '表格',
  browser: '浏览器',
}
const panelFilterOptions = Object.entries(panelFilterLabels)

const leafContentModes = new Set(['text', 'image', 'video', 'table', 'youtube', 'pdf'])
function getNodeContentMode(node: { type?: string; data?: any }) {
  if (node.type === 'content') return node.data?.mode
  return leafContentModes.has(node.type || '') ? node.type : undefined
}

function isNodeDisabled(node: { type?: string; data?: any }) {
  const mode = getNodeContentMode(node)
  const pendingMedia = ['image', 'video'].includes(mode || '') && !node.data?.content && !node.data?.resourceLost
  if (pendingMedia) return false
  if (node.data?.resourceLost) return false
  if (node.data?.disabled || node.data?.enabled === false || node.data?.hidden) return true
  if (node.type === 'ai') return !node.data?.channelId || !node.data?.model
  // 空的图片/视频节点代表“等待添加资源”，仍然是可用状态。
  return false
}

function getPointerPosition(event: MouseEvent | TouchEvent | PointerEvent) {
  if ('touches' in event && event.touches.length) return { x: event.touches[0].clientX, y: event.touches[0].clientY }
  if ('changedTouches' in event && event.changedTouches.length) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }
}

function InteractiveMiniMap({ right }: { right: number }) {
  const reactFlow = useReactFlow()
  const { flowNodes, transform, canvasWidth, canvasHeight } = useStore((state) => ({
    flowNodes: state.getNodes(),
    transform: state.transform,
    canvasWidth: state.width,
    canvasHeight: state.height,
  }))

  const zoom = transform[2] || 1
  const viewBox = {
    x: -transform[0] / zoom,
    y: -transform[1] / zoom,
    width: canvasWidth / zoom,
    height: canvasHeight / zoom,
  }
  const visibleNodes = flowNodes.filter((node) => !node.hidden)
  const minX = visibleNodes.length ? Math.min(...visibleNodes.map((node) => node.position.x)) : viewBox.x
  const minY = visibleNodes.length ? Math.min(...visibleNodes.map((node) => node.position.y)) : viewBox.y
  const maxX = visibleNodes.length ? Math.max(...visibleNodes.map((node) => node.position.x + (node.width || 0))) : viewBox.x + viewBox.width
  const maxY = visibleNodes.length ? Math.max(...visibleNodes.map((node) => node.position.y + (node.height || 0))) : viewBox.y + viewBox.height
  const nodeWidth = Math.max(1, maxX - minX)
  const nodeHeight = Math.max(1, maxY - minY)
  const worldWidth = Math.max(2400, nodeWidth + 640)
  const worldHeight = Math.max(1600, nodeHeight + 480)
  const bounds = {
    x: (minX + maxX) / 2 - worldWidth / 2,
    y: (minY + maxY) / 2 - worldHeight / 2,
    width: worldWidth,
    height: worldHeight,
  }
  const mapInset = 2
  const scale = Math.max(bounds.width / (MINIMAP_WIDTH - mapInset * 2), bounds.height / (MINIMAP_HEIGHT - mapInset * 2)) || 1
  const mapX = (worldX: number) => mapInset + (worldX - bounds.x) / scale
  const mapY = (worldY: number) => mapInset + (worldY - bounds.y) / scale
  const viewportRectX = mapX(viewBox.x)
  const viewportRectY = mapY(viewBox.y)
  const viewportRectRight = mapX(viewBox.x + viewBox.width)
  const viewportRectBottom = mapY(viewBox.y + viewBox.height)
  const clippedRectX = Math.max(mapInset, Math.min(MINIMAP_WIDTH - mapInset, viewportRectX))
  const clippedRectY = Math.max(mapInset, Math.min(MINIMAP_HEIGHT - mapInset, viewportRectY))
  const clippedRectRight = Math.max(mapInset, Math.min(MINIMAP_WIDTH - mapInset, viewportRectRight))
  const clippedRectBottom = Math.max(mapInset, Math.min(MINIMAP_HEIGHT - mapInset, viewportRectBottom))
  const dragRef = useRef(false)
  const moveToPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(mapInset, Math.min(MINIMAP_WIDTH - mapInset, event.clientX - rect.left))
    const y = Math.max(mapInset, Math.min(MINIMAP_HEIGHT - mapInset, event.clientY - rect.top))
    void reactFlow.setCenter(bounds.x + (x - mapInset) * scale, bounds.y + (y - mapInset) * scale, { zoom, duration: 0 })
  }
  return <div data-flow-minimap className="pointer-events-auto absolute z-[5] overflow-hidden rounded-xl border border-border bg-white shadow-lg" style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, right, bottom: 24 }}><svg aria-label="画布小地图" width="100%" height="100%" viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`} preserveAspectRatio="none" onPointerDown={(event) => { dragRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); moveToPoint(event) }} onPointerMove={(event) => { if (dragRef.current) moveToPoint(event) }} onPointerUp={(event) => { dragRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { dragRef.current = false }}><rect x={mapInset} y={mapInset} width={MINIMAP_WIDTH - mapInset * 2} height={MINIMAP_HEIGHT - mapInset * 2} fill="#fff" />{visibleNodes.map((node) => <rect key={node.id} x={mapX(node.position.x)} y={mapY(node.position.y)} width={Math.max(4, (node.width || 160) / scale)} height={Math.max(4, (node.height || 100) / scale)} rx="2" fill={isNodeDisabled(node) ? '#fecaca' : '#f1f5f9'} />)}<rect x={clippedRectX} y={clippedRectY} width={Math.max(0, clippedRectRight - clippedRectX)} height={Math.max(0, clippedRectBottom - clippedRectY)} fill="rgba(59, 109, 255, 0.14)" stroke="rgba(59, 109, 255, 0.8)" strokeWidth="1.5" /></svg></div>
}

// 注册自定义节点类型
const nodeTypes: NodeTypes = {
  content: ContentNode,
  text: ContentLeafNode,
  youtube: ContentLeafNode,
  image: ContentLeafNode,
  video: ContentLeafNode,
  table: ContentLeafNode,
  pdf: PDFNode,
  ai: AINode,
  browser: BrowserNode,
  sticky: StickyNode,
}
const edgeTypes: EdgeTypes = { interactive: InteractiveEdge }

function FlowEditorInner() {
  const { flowId } = useParams()
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved'>('saved')
  const [showNodePanel, setShowNodePanel] = useState(false)
  const [showExtensionPanel, setShowExtensionPanel] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showGuide, setShowGuide] = useState(false)
  const [panelTab, setPanelTab] = useState<'nodes' | 'content'>('nodes')
  const [panelFilter, setPanelFilter] = useState('all')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [panelSearch, setPanelSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedPanelIds, setSelectedPanelIds] = useState<string[]>([])
  const [extensionWidth, setExtensionWidth] = useState(370)
  const [isResizingPanel, setIsResizingPanel] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [toolbarGroupLayout, setToolbarGroupLayout] = useState({ leftWidth: 88, centerWidth: 128, rightWidth: 48, leftInset: 0, rightInset: 0 })
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const [addMenuLayout, setAddMenuLayout] = useState<{ left: number; top: number } | null>(null)
  const [connectionMenu, setConnectionMenu] = useState<{ x: number; y: number; position: { x: number; y: number }; nodeId: string; handleType: 'source' | 'target' } | null>(null)
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false)
  const [libraryMenuLayout, setLibraryMenuLayout] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const clipboardRef = useRef<any[]>([])
  const addMenuRef = useRef<HTMLDivElement>(null)
  const libraryTriggerRef = useRef<HTMLDivElement>(null)
  const libraryMenuRef = useRef<HTMLDivElement>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const libraryCloseTimerRef = useRef<number | null>(null)
  const connectionStartRef = useRef<{ nodeId: string; handleType: 'source' | 'target'; x: number; y: number } | null>(null)
  const connectionCreatedRef = useRef(false)

  const closeCanvasMenus = useCallback(() => {
    setAddMenu(null)
    setLibraryMenuOpen(false)
    setConnectionMenu(null)
  }, [])

  const handleCanvasDoubleClick = useCallback((event: ReactMouseEvent) => {
    const target = event.target as HTMLElement
    // 只响应真正的画布空白区域，节点、边和控件上的双击不应打开创建菜单。
    if (target.closest('.react-flow__node, .react-flow__edge, .react-flow__panel, .react-flow__controls, [data-flow-minimap]')) return
    if (!target.closest('.react-flow, .react-flow__pane, .react-flow__renderer')) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = reactFlowWrapper.current?.getBoundingClientRect()
    setAddMenuLayout(null)
    setLibraryMenuLayout(null)
    setLibraryMenuOpen(false)
    setAddMenu({ x: event.clientX - (bounds?.left || 0), y: event.clientY - (bounds?.top || 0) })
  }, [])

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
    addNode,
    deleteNode,
  } = useFlowStore()
  const sources = useSourceStore((state) => state.sources)
  const editorWidth = viewportSize.width === 0 ? 1200 : Math.max(viewportSize.width, MIN_EDITOR_WIDTH)
  const hasSafeToolbarSpacing = useCallback((leftInset: number, rightInset: number) => {
    const availableWidth = editorWidth - leftInset - rightInset - TOOLBAR_HORIZONTAL_PADDING
    const groupWidths = [toolbarGroupLayout.leftWidth, toolbarGroupLayout.centerWidth, toolbarGroupLayout.rightWidth].filter((width) => width > 0)
    const requiredWidth = groupWidths.reduce((total, width) => total + width, 0) + MIN_TOOLBAR_GROUP_GAP * Math.max(0, groupWidths.length - 1)
    if (availableWidth >= requiredWidth) return true
    // 中间按钮组的隐藏优先级高于侧边栏关闭；若隐藏中间组后
    // 仍能保留 40px 间隔，就允许侧边栏继续保持开启。
    const sideGroupWidths = [toolbarGroupLayout.leftWidth, toolbarGroupLayout.rightWidth].filter((width) => width > 0)
    const requiredWithoutCenter = sideGroupWidths.reduce((total, width) => total + width, 0) + MIN_TOOLBAR_GROUP_GAP * Math.max(0, sideGroupWidths.length - 1)
    return availableWidth >= requiredWithoutCenter
  }, [editorWidth, toolbarGroupLayout.centerWidth, toolbarGroupLayout.leftWidth, toolbarGroupLayout.rightWidth])
  const currentLeftInset = showNodePanel ? NODE_PANEL_INSET : 0
  const currentRightInset = showExtensionPanel ? extensionWidth + EXTENSION_PANEL_MARGIN : 0
  const canOpenNodePanel = hasSafeToolbarSpacing(NODE_PANEL_INSET, currentRightInset)
  const canOpenExtensionPanel = hasSafeToolbarSpacing(currentLeftInset, extensionWidth + EXTENSION_PANEL_MARGIN)
  const toolbarMeasurementIsCurrent = toolbarGroupLayout.leftInset === currentLeftInset && toolbarGroupLayout.rightInset === currentRightInset
  const currentToolbarSpacingIsSafe = hasSafeToolbarSpacing(currentLeftInset, currentRightInset)
  const handleToolbarGroupLayoutChange = useCallback((layout: { leftWidth: number; centerWidth: number; rightWidth: number; leftInset: number; rightInset: number }) => {
    setToolbarGroupLayout((current) => current.leftWidth === layout.leftWidth && current.centerWidth === layout.centerWidth && current.rightWidth === layout.rightWidth && current.leftInset === layout.leftInset && current.rightInset === layout.rightInset ? current : layout)
  }, [])
  const renderedEdges = useMemo(() => edges.map((edge) => ({ ...edge, type: 'interactive' })), [edges])

  useEffect(() => {
    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    return () => window.removeEventListener('resize', updateViewportSize)
  }, [])

  useEffect(() => {
    if ((!showNodePanel && !showExtensionPanel) || !toolbarMeasurementIsCurrent || currentToolbarSpacingIsSafe || isResizingPanel) return
    setShowNodePanel(false)
    setShowExtensionPanel(false)
  }, [currentToolbarSpacingIsSafe, isResizingPanel, showExtensionPanel, showNodePanel, toolbarMeasurementIsCurrent])

  useEffect(() => {
    if (flowId) loadFlow(flowId)
  }, [flowId, loadFlow])

  useEffect(() => () => {
    resizeCleanupRef.current?.()
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current)
    if (libraryCloseTimerRef.current !== null) window.clearTimeout(libraryCloseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!addMenu) return
    const closeOnOutsideAction = (event: Event) => {
      if (!(event.target as HTMLElement | null)?.closest?.('[data-canvas-add-menu]')) closeCanvasMenus()
    }
    document.addEventListener('pointerdown', closeOnOutsideAction, true)
    document.addEventListener('keydown', closeOnOutsideAction, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideAction, true)
      document.removeEventListener('keydown', closeOnOutsideAction, true)
    }
  }, [addMenu, closeCanvasMenus])

  useLayoutEffect(() => {
    if (!addMenu || !addMenuRef.current) return
    const containerRect = reactFlowWrapper.current?.getBoundingClientRect()
    if (!containerRect) return
    const menuRect = addMenuRef.current.getBoundingClientRect()
    const maxLeft = Math.max(FLOATING_MENU_MARGIN, containerRect.width - menuRect.width - FLOATING_MENU_MARGIN)
    const maxTop = Math.max(FLOATING_MENU_MARGIN, containerRect.height - menuRect.height - FLOATING_MENU_MARGIN)
    const nextLayout = {
      left: Math.min(Math.max(addMenu.x, FLOATING_MENU_MARGIN), maxLeft),
      top: Math.min(Math.max(addMenu.y, FLOATING_MENU_MARGIN), maxTop),
    }
    setAddMenuLayout((current) => current?.left === nextLayout.left && current?.top === nextLayout.top ? current : nextLayout)
  }, [addMenu])

  useEffect(() => {
    if (!filterMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-node-filter-menu]')) setFilterMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [filterMenuOpen])

  useEffect(() => {
    if (!connectionMenu) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-connection-menu]')) setConnectionMenu(null)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [connectionMenu])

  // 生成画布缩略图
  const generateThumbnail = useCallback(async () => {
    if (nodes.length === 0) return undefined
    return captureFlowThumbnail()
  }, [nodes.length])

  const saveWithThumbnail = useCallback(async (viewport?: Viewport) => {
    const thumbnail = await generateThumbnail()
    saveCurrentFlow(thumbnail, viewport || reactFlowInstance.getViewport())
    setSaveStatus('saved')
  }, [generateThumbnail, reactFlowInstance, saveCurrentFlow])

  const saveLightweight = useCallback((viewport?: Viewport) => {
    saveCurrentFlow(undefined, viewport || reactFlowInstance.getViewport())
    setSaveStatus('saved')
  }, [reactFlowInstance, saveCurrentFlow])

  useEffect(() => {
    if (nodes.length || edges.length) setSaveStatus('unsaved')
  }, [nodes, edges])

  const focusNode = useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId)
    if (!node) return
    reactFlowInstance.setCenter(node.position.x + (node.width || 0) / 2, node.position.y + (node.height || 0) / 2, { zoom: 1.1, duration: 350 })
    onNodesChange(nodes.map((item) => ({ type: 'select' as const, id: item.id, selected: item.id === nodeId })))
  }, [nodes, onNodesChange, reactFlowInstance])

  const arrangeNodes = useCallback(() => {
    nodes.forEach((node, index) => {
      useFlowStore.getState().updateNode(node.id, { position: { x: 120 + (index % 3) * 320, y: 140 + Math.floor(index / 3) * 240 } })
    })
    reactFlowInstance.fitView({ padding: 0.2, duration: 400 })
  }, [nodes, reactFlowInstance])

  const filteredPanelNodes = nodes.filter((node) => {
    const mode = getNodeContentMode(node)
    const typeMatch = panelFilter === 'all' || node.type === panelFilter || (panelFilter === 'pdf' && mode === 'pdf') || (panelFilter === 'media' && mode === 'youtube') || (panelFilter.startsWith('content:') && mode === panelFilter.slice(8))
    const searchText = `${node.data?.label || ''} ${node.type || ''} ${node.data?.mode || ''} ${node.data?.description || ''} ${node.data?.content || ''}`.toLowerCase()
    const searchMatch = !panelSearch.trim() || searchText.includes(panelSearch.toLowerCase())
    return typeMatch && searchMatch
  })

  // 内容资料库与主页“内容”页共享 useSourceStore；画布上的普通内容节点不计入资料库。
  const libraryItems = sources.slice().sort((a, b) => b.updatedAt - a.updatedAt)

  useLayoutEffect(() => {
    if (!addMenu || !libraryMenuOpen || !libraryTriggerRef.current || !libraryMenuRef.current) return
    const containerRect = reactFlowWrapper.current?.getBoundingClientRect()
    if (!containerRect) return
    const triggerRect = libraryTriggerRef.current.getBoundingClientRect()
    const menuElement = libraryMenuRef.current
    const menuRect = menuElement.getBoundingClientRect()
    const overlap = 4
    const opensRight = triggerRect.right - overlap + menuRect.width <= containerRect.right - FLOATING_MENU_MARGIN
    const left = opensRight ? triggerRect.width - overlap : -menuRect.width + overlap
    const desiredHeight = Math.max(menuElement.scrollHeight, menuRect.height)
    const availableBelow = Math.max(96, containerRect.bottom - FLOATING_MENU_MARGIN - triggerRect.top)
    const availableAbove = Math.max(96, triggerRect.bottom - containerRect.top - FLOATING_MENU_MARGIN)
    const opensDown = desiredHeight <= availableBelow || availableBelow >= availableAbove
    const maxHeight = Math.min(desiredHeight, opensDown ? availableBelow : availableAbove)
    const top = opensDown ? 0 : triggerRect.height - maxHeight
    const nextLayout = { left, top, maxHeight }
    setLibraryMenuLayout((current) => current?.left === left && current?.top === top && current?.maxHeight === maxHeight ? current : nextLayout)
  }, [addMenu, addMenuLayout, libraryItems.length, libraryMenuOpen])
  const panelContentNodes = libraryItems.filter((source) => {
    const searchText = `${source.title || ''} ${source.type || ''} ${source.content || ''}`.toLowerCase()
    return !panelSearch.trim() || searchText.includes(panelSearch.toLowerCase())
  }).map((source) => ({ id: `source:${source.id}`, type: 'content', data: { label: source.title, mode: source.type, content: source.content, sourceId: source.id } }))

  const nodeSummary = (node: any) => {
    const mode = getNodeContentMode(node)
    if (mode) {
      const labels: Record<string, string> = { text: '文本', image: '图片', video: '视频', table: '表格', youtube: 'YouTube', pdf: 'PDF' }
      return labels[mode] || '内容'
    }
    return node.type === 'ai' ? 'AI' : node.type || '节点'
  }

  const nodeDisplayName = (node: any) => {
    const mode = getNodeContentMode(node)
    if (mode) return node.data?.label || ({ text: '文本节点', image: '图片节点', video: '视频节点', table: '表格节点', youtube: 'YouTube 节点', pdf: 'PDF 节点' } as Record<string, string>)[mode]
    return node.type === 'content' ? '内容类型选择' : node.data?.label || (node.type === 'ai' ? 'AI 节点' : node.type)
  }

  const nodeIcon = (node: any) => {
    if (node.type === 'ai') return <Sparkles className="h-4 w-4" />
    if (node.type === 'browser') return <Globe className="h-4 w-4" />
    switch (getNodeContentMode(node)) {
      case 'image': return <ImageIcon className="h-4 w-4" />
      case 'video': return <Video className="h-4 w-4" />
      case 'table': return <Table2 className="h-4 w-4" />
      case 'youtube': return <Youtube className="h-4 w-4" />
      default: return <FileText className="h-4 w-4" />
    }
  }

  const addNodeAt = (type: string, position: { x: number; y: number }) => {
    if (type === 'ai') {
      const store = useAIStore.getState()
      const channel = store.apiKeys.find((item) => Boolean(store.getAPIKey(item.id)) && Boolean(item.modelIds?.length))
      addNode({ type: 'ai', position, data: { label: 'AI 节点', channelId: channel?.id, model: channel?.modelIds?.[0], prompt: '', temperature: 0.7 } })
    } else if (type === 'browser') {
      addNode({ type: 'browser', position, data: { label: '浏览器节点', url: '', status: 'idle' } })
    } else if (type === 'sticky') {
      addNode({ type: 'sticky', position, data: { label: '贴纸', text: '' } })
    } else {
      addNode({ type: 'content', position, data: { label: '内容', content: '' } })
    }
    setAddMenu(null)
  }

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    const position = reactFlowInstance.project({ x: event.clientX, y: event.clientY })
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'json') { const reader = new FileReader(); reader.onload = () => { try { useFlowStore.getState().importFlowFromJSON(String(reader.result || '')) } catch (error) { console.error('导入失败:', error) } }; reader.readAsText(file); return }
    const mode = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension || '') ? 'image' : ['mp4', 'webm', 'mov'].includes(extension || '') ? 'video' : 'text'
    const leafMode = extension === 'csv' || extension === 'tsv' ? 'table' : mode
    if (leafMode === 'text' || leafMode === 'table') { const reader = new FileReader(); reader.onload = () => addNode({ type: leafMode, position, data: { label: leafMode === 'table' ? '表格节点' : '文本节点', mode: leafMode, content: String(reader.result || '') } }); reader.readAsText(file) } else addNode({ type: leafMode, position, data: { label: leafMode === 'image' ? '图片节点' : '视频节点', mode: leafMode, content: URL.createObjectURL(file) } })
  }

  const onConnectStart = useCallback((event: any, params: { nodeId: string | null; handleType: 'source' | 'target' | null }) => {
    if (!params.nodeId || !params.handleType) return
    const point = getPointerPosition(event)
    connectionStartRef.current = { nodeId: params.nodeId, handleType: params.handleType, ...point }
    connectionCreatedRef.current = false
    setConnectionMenu(null)
  }, [])

  const onConnect = useCallback((connection: any) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    if (connection.sourceHandle && connection.sourceHandle !== 'out') return
    if (connection.targetHandle && connection.targetHandle !== 'in') return
    connectionCreatedRef.current = true
    addEdgeToStore({
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle || 'out',
      targetHandle: connection.targetHandle || 'in',
      type: 'interactive',
    })
  }, [addEdgeToStore])

  const onConnectEnd = useCallback((event: any) => {
    const start = connectionStartRef.current
    connectionStartRef.current = null
    if (!start || connectionCreatedRef.current) return
    const point = getPointerPosition(event)
    const targetElement = (event.target as HTMLElement | null)?.closest('.react-flow__node')
    const targetNodeId = targetElement?.getAttribute('data-id') || targetElement?.getAttribute('data-nodeid')
    const sameNode = targetNodeId === start.nodeId
    const isSimpleClick = Math.hypot(point.x - start.x, point.y - start.y) < 10

    if (targetNodeId && !sameNode) {
      if (start.handleType === 'source') onConnect({ source: start.nodeId, target: targetNodeId, sourceHandle: 'out', targetHandle: 'in' })
      else onConnect({ source: targetNodeId, target: start.nodeId, sourceHandle: 'out', targetHandle: 'in' })
      return
    }
    if (sameNode && !isSimpleClick) return

    const bounds = reactFlowWrapper.current?.getBoundingClientRect()
    const x = point.x - (bounds?.left || 0)
    const y = point.y - (bounds?.top || 0)
    setConnectionMenu({
      x,
      y,
      position: reactFlowInstance.project({ x, y }),
      nodeId: start.nodeId,
      handleType: start.handleType,
    })
  }, [onConnect, reactFlowInstance])

  const createConnectedNode = (type: 'ai' | 'content') => {
    if (!connectionMenu) return
    const position = connectionMenu.position
    const store = useAIStore.getState()
    const channel = store.apiKeys.find((item) => Boolean(store.getAPIKey(item.id)) && Boolean(item.modelIds?.length))
    const existingIds = new Set(useFlowStore.getState().nodes.map((node) => node.id))
    addNode(type === 'ai'
      ? { type: 'ai', position, data: { label: 'AI 节点', channelId: channel?.id, model: channel?.modelIds?.[0], prompt: '', temperature: 0.7 } }
      : { type: 'content', position, data: { label: '内容', content: '' } })
    const created = useFlowStore.getState().nodes.find((node) => !existingIds.has(node.id))
    if (created) {
      const edge = connectionMenu.handleType === 'source'
        ? { source: connectionMenu.nodeId, target: created.id, sourceHandle: 'out', targetHandle: 'in' }
        : { source: created.id, target: connectionMenu.nodeId, sourceHandle: 'out', targetHandle: 'in' }
      addEdgeToStore({ ...edge, type: 'interactive' })
    }
    setConnectionMenu(null)
  }

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

      if (isCtrlOrCmd && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        clipboardRef.current = nodes.filter((node) => node.selected).map((node) => ({ ...node, id: undefined, position: { x: node.position.x + 40, y: node.position.y + 40 } }))
        return
      }
      if (isCtrlOrCmd && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        clipboardRef.current.forEach((node) => addNode({ ...node, id: undefined }))
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
        nodes.filter((node) => node.selected).forEach((node) => deleteNode(node.id))
        return
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
  }, [addNode, deleteNode, nodes, reactFlowInstance, saveWithThumbnail])

  useEffect(() => {
    if (nodes.length === 0) return
    const timeoutId = window.setTimeout(() => {
      saveLightweight()
    }, 1000)
    return () => window.clearTimeout(timeoutId)
  }, [nodes, edges, saveLightweight])

  // 窗口关闭/刷新前自动保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentFlow(undefined, reactFlowInstance.getViewport())
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [reactFlowInstance, saveCurrentFlow])

  return (
    <div className="relative h-dvh overflow-hidden bg-background" style={{ minWidth: MIN_EDITOR_WIDTH, minHeight: MIN_EDITOR_HEIGHT }}>
      {/* 顶部工具栏 */}
      <Toolbar saveStatus={saveStatus} leftInset={currentLeftInset} rightInset={currentRightInset} isResizing={isResizingPanel} canOpenNodePanel={canOpenNodePanel} canOpenExtensionPanel={canOpenExtensionPanel} onGroupLayoutChange={handleToolbarGroupLayoutChange} onOpenNodePanel={() => canOpenNodePanel && setShowNodePanel((value) => !value)} onOpenContentLibrary={() => { if (!canOpenNodePanel) return; setShowNodePanel(true); setPanelTab('content'); setPanelFilter('all') }} onOpenExtensionPanel={() => canOpenExtensionPanel && setShowExtensionPanel((value) => !value)} />

      {showNodePanel && <aside className="absolute bottom-4 left-4 top-4 z-40 flex w-[260px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="mx-3 mt-2 flex items-center gap-1 p-2 px-0"><button className={`flex-1 rounded-full px-2 py-2 text-sm font-semibold text-foreground ${panelTab === 'nodes' ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setPanelTab('nodes')}>节点</button><button className={`flex-1 rounded-full px-2 py-2 text-sm font-semibold text-foreground ${panelTab === 'content' ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setPanelTab('content')}>内容</button></div>
        <div className="mx-3 flex items-center gap-2 p-2 px-0"><input value={panelSearch} onChange={(event) => setPanelSearch(event.target.value)} placeholder="搜索节点" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" /><div data-node-filter-menu className="relative flex-none"><button type="button" aria-label="节点类型筛选" aria-haspopup="menu" aria-expanded={filterMenuOpen} onClick={() => setFilterMenuOpen((value) => !value)} className="inline-flex h-9 w-max items-center gap-1.5 whitespace-nowrap rounded-lg bg-card px-3 pr-2 text-left text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span>{panelFilterLabels[panelFilter]}</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`} /></button>{filterMenuOpen && <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-max min-w-[116px] space-y-1 rounded-xl border border-border bg-card p-1.5 text-left shadow-xl">{panelFilterOptions.map(([value, label]) => <button key={value} type="button" role="menuitemradio" aria-checked={panelFilter === value} onClick={() => { setPanelFilter(value); setFilterMenuOpen(false) }} className={`flex w-full items-center rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors ${panelFilter === value ? 'bg-muted font-medium text-foreground' : 'text-foreground hover:bg-muted'}`}><span className="whitespace-nowrap text-left">{label}</span></button>)}</div>}</div></div>
        <div className="flex-1 space-y-1 overflow-auto p-3">{(panelTab === 'content' ? panelContentNodes : filteredPanelNodes).map((node) => { const resourceLost = Boolean(node.data?.resourceLost); const disabled = isNodeDisabled(node); const linkedNodeId = node.data?.sourceId ? nodes.find((item) => item.data?.sourceId === node.data.sourceId)?.id : node.id; const isSourceItem = node.id.startsWith('source:'); return <button key={node.id} className={`flex h-12 w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-muted ${selectedPanelIds.includes(node.id) ? 'bg-muted ring-1 ring-primary/40' : ''} ${disabled ? 'opacity-60 grayscale' : resourceLost ? 'opacity-80' : ''}`} onClick={() => selectionMode ? setSelectedPanelIds((ids) => ids.includes(node.id) ? ids.filter((id) => id !== node.id) : [...ids, node.id]) : linkedNodeId ? focusNode(linkedNodeId) : undefined}>{selectionMode ? (selectedPanelIds.includes(node.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />) : node.data?.mode === 'image' && node.data?.content ? <img src={node.data.content} alt="" onLoad={() => { if (!isSourceItem) useFlowStore.getState().updateNode(node.id, { data: { ...node.data, resourceLost: false, disabled: false, enabled: true } }) }} onError={() => { if (!isSourceItem) useFlowStore.getState().updateNode(node.id, { data: { ...node.data, resourceLost: true } }) }} className="h-9 w-9 rounded-md object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">{nodeIcon(node)}</span>}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{nodeDisplayName(node)}</span><span className="block truncate text-[10px] text-muted-foreground">{node.data?.description || nodeSummary(node)}</span></span><span className={`h-2 w-2 rounded-full ${resourceLost ? 'bg-red-500' : disabled ? 'bg-muted-foreground/40' : 'bg-emerald-500'}`} title={resourceLost ? '资源丢失' : disabled ? '未启用' : '正常'} />{!isSourceItem && <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" onClick={(event) => { event.stopPropagation(); deleteNode(node.id) }} />}</button> })}{((panelTab === 'content' && panelContentNodes.length === 0) || (panelTab !== 'content' && filteredPanelNodes.length === 0)) && <p className="py-8 text-center text-xs text-muted-foreground">{panelTab === 'content' ? '暂无内容收藏' : nodes.length === 0 ? '当前面板暂未创建节点' : '暂无匹配节点'}</p>}</div>
        <div className="mx-3 flex items-center gap-1 p-3 px-0"><button className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { setSelectionMode((value) => !value); setSelectedPanelIds([]) }}>{selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}{selectionMode ? '取消' : '选择'}</button>{selectionMode && <><button className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => setSelectedPanelIds((panelTab === 'content' ? panelContentNodes : filteredPanelNodes).map((node) => node.id))}><Check className="h-3.5 w-3.5" />全选</button><button className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { const selected = nodes.filter((node) => selectedPanelIds.includes(node.id)); const blob = new Blob([JSON.stringify({ nodes: selected }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'selected-nodes.json'; link.click(); URL.revokeObjectURL(url) }}><Download className="h-3.5 w-3.5" />导出</button></>}</div>
      </aside>}

      {showExtensionPanel && <aside className="absolute bottom-4 right-4 top-4 z-40 overflow-hidden rounded-2xl border border-border bg-card shadow-xl" style={{ width: extensionWidth, minWidth: 280, maxWidth: '70%' }}><div className={`group absolute -left-1 top-0 z-10 h-full w-2 cursor-ew-resize ${isResizingPanel ? 'bg-emerald-400/20' : 'hover:bg-emerald-400/20'}`} onMouseDown={(event) => { event.preventDefault(); const startX = event.clientX; const startWidth = extensionWidth; const startViewport = reactFlowInstance.getViewport(); setIsResizingPanel(true); document.body.style.userSelect = 'none'; let pendingWidth = startWidth; const move = (moveEvent: MouseEvent) => { pendingWidth = Math.max(280, Math.min(window.innerWidth * 0.7, startWidth + startX - moveEvent.clientX)); if (resizeFrameRef.current !== null) return; resizeFrameRef.current = requestAnimationFrame(() => { resizeFrameRef.current = null; const widthDelta = pendingWidth - startWidth; setExtensionWidth(pendingWidth); void reactFlowInstance.setViewport({ ...startViewport, x: startViewport.x - widthDelta }) }) }; const up = () => { if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current); resizeFrameRef.current = null; document.body.style.userSelect = ''; setIsResizingPanel(false); resizeCleanupRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }; resizeCleanupRef.current = up; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up) }}><div className="absolute left-0 top-1/2 h-16 w-0.5 -translate-y-1/2 rounded-full bg-transparent group-hover:bg-emerald-400" /></div><div className="flex items-center justify-between px-4 py-3"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-semibold">{nodes.find((node) => node.selected)?.data?.label || '未选中节点'}</h2></div><button className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="关闭面板" onClick={() => setShowExtensionPanel(false)}><X className="h-4 w-4" /></button></div>{nodes.some((node) => node.selected) ? <p className="px-4 text-xs leading-relaxed text-muted-foreground">在这里查看当前选中节点的内容和可用操作。</p> : <div className="flex h-[calc(100%-56px)] flex-col items-center justify-center px-8 text-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted"><Layers3 className="h-8 w-8 text-muted-foreground" /></div><p className="text-sm text-muted-foreground">在画布上选中一个节点，即可在这里查看内容</p></div>}</aside>}

      {/* React Flow 画布 */}
      <div ref={reactFlowWrapper} className="h-full w-full overflow-hidden" onDoubleClickCapture={handleCanvasDoubleClick} onDragOver={(event) => event.preventDefault()} onDrop={handleFileDrop}>
        <ReactFlow
          key={currentFlowId || flowId}
          nodes={nodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && (!connection.sourceHandle || connection.sourceHandle === 'out') && (!connection.targetHandle || connection.targetHandle === 'in'))}
          connectionRadius={48}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: 'var(--muted-foreground)', strokeWidth: 2, strokeDasharray: '8 8' }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!isLocked}
          nodesConnectable={!isLocked}
          elementsSelectable={!isLocked}
          selectionOnDrag
          selectionKeyCode="Control"
          multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
          panActivationKeyCode="Space"
          panOnDrag={[1, 2]}
          defaultViewport={currentFlow?.viewport}
          proOptions={{ hideAttribution: true }}
          fitView={!currentFlow?.viewport}
          zoomOnDoubleClick={false}
          onMoveStart={closeCanvasMenus}
          onMoveEnd={(_, viewport) => { if (!isResizingPanel) saveLightweight(viewport) }}
          minZoom={0.1}
          maxZoom={4}
          defaultEdgeOptions={{
            type: 'interactive',
            animated: false,
            style: { stroke: 'var(--muted-foreground)', strokeWidth: 2 },
          }}
        >
          <Background color="var(--border)" gap={16} />
          {showMinimap && <InteractiveMiniMap right={showExtensionPanel ? extensionWidth + 24 : 24} />}
        </ReactFlow>
      </div>

      {connectionMenu && <div data-connection-menu className="absolute z-[58] w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl" style={{ left: connectionMenu.x, top: connectionMenu.y }} onClick={(event) => event.stopPropagation()}>
        <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">选择要连接的节点</p>
        <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => createConnectedNode('ai')}><Sparkles className="h-4 w-4 text-primary" />AI 节点</button>
        <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => createConnectedNode('content')}><FileText className="h-4 w-4 text-primary" />内容节点</button>
      </div>}

      {addMenu && <div ref={addMenuRef} data-canvas-add-menu className="absolute z-[55] w-60 select-none rounded-xl border border-border bg-card p-1.5 shadow-xl" style={{ left: addMenuLayout?.left ?? addMenu.x, top: addMenuLayout?.top ?? addMenu.y }} onClick={(event) => event.stopPropagation()}>
        <div className="space-y-0.5">
          <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addNodeAt('ai', reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }))}><Sparkles className="h-4 w-4 text-primary" />添加 AI 节点</button>
          <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addNodeAt('content', reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }))}><FileText className="h-4 w-4 text-primary" />添加内容节点</button>
          <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addNodeAt('browser', reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }))}><Globe className="h-4 w-4 text-primary" />添加浏览器节点</button>
        </div>
        <div className="my-1 h-px bg-border/50" />
        <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addNodeAt('sticky', reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }))}><StickyNote className="h-4 w-4 text-primary" />添加贴纸</button>
        <div className="my-1 h-px bg-border/50" />
        <div ref={libraryTriggerRef} className="relative" onMouseEnter={() => { if (libraryCloseTimerRef.current !== null) { window.clearTimeout(libraryCloseTimerRef.current); libraryCloseTimerRef.current = null }; setLibraryMenuOpen(true) }} onMouseLeave={() => { libraryCloseTimerRef.current = window.setTimeout(() => setLibraryMenuOpen(false), 140) }}>
          <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setLibraryMenuOpen(true)}><Library className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1">内容资料库 ({libraryItems.length})</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></button>
          {libraryMenuOpen && <div ref={libraryMenuRef} className="absolute left-[calc(100%-4px)] top-0 z-[56] w-56 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1.5 shadow-xl" style={libraryMenuLayout || { maxHeight: 'calc(100dvh - 24px)' }} onMouseEnter={() => { if (libraryCloseTimerRef.current !== null) { window.clearTimeout(libraryCloseTimerRef.current); libraryCloseTimerRef.current = null } }} onMouseLeave={() => { libraryCloseTimerRef.current = window.setTimeout(() => setLibraryMenuOpen(false), 140) }}>
            <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">最近使用</p>
            {libraryItems.slice(0, 8).map((item) => <button key={item.id} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted" onClick={() => { addNode({ type: item.type, position: reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }), data: { ...(item.metadata?.nodeData || {}), label: item.title, mode: item.type, content: item.content, sourceId: item.id } }); setAddMenu(null); setLibraryMenuOpen(false) }}><span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">{nodeIcon({ type: item.type, data: { mode: item.type } })}</span><span className="truncate">{item.title}</span></button>)}
            {libraryItems.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">暂无内容收藏</p>}
            {libraryItems.length > 8 && <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-primary hover:bg-muted" onClick={() => { setShowNodePanel(true); setPanelTab('content'); setPanelFilter('all'); setAddMenu(null); setLibraryMenuOpen(false) }}>展开更多</button>}
          </div>}
        </div>
        <button className="flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setAddMenu(null); document.getElementById('flow-file-import')?.click() }}><FileUp className="h-4 w-4 text-primary" />导入文件</button>
        <input id="flow-file-import" type="file" className="hidden" accept=".json,.txt,.doc,.docx,.md,.markdown,.csv,.tsv,.xlsx,.xls,.pdf,.pptx,.ppt,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.webm,.mov,.avi,.mkv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const extension = file.name.split('.').pop()?.toLowerCase(); const position = reactFlowInstance.project({ x: addMenu.x, y: addMenu.y }); const imageTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']; const videoTypes = ['mp4', 'webm', 'mov', 'avi', 'mkv']; const tableTypes = ['csv', 'tsv', 'xlsx', 'xls']; if (extension === 'json') { const reader = new FileReader(); reader.onload = () => { try { useFlowStore.getState().importFlowFromJSON(String(reader.result || '')) } catch (error) { console.error('导入失败:', error) } }; reader.readAsText(file) } else if (imageTypes.includes(extension || '')) addNode({ type: 'image', position, data: { label: '图片节点', mode: 'image', content: URL.createObjectURL(file), resourceLost: false } }); else if (videoTypes.includes(extension || '')) addNode({ type: 'video', position, data: { label: '视频节点', mode: 'video', content: URL.createObjectURL(file), resourceLost: false } }); else if (extension === 'pdf') addNode({ type: 'pdf', position, data: { label: 'PDF 节点', mode: 'pdf', content: URL.createObjectURL(file) } }); else { const reader = new FileReader(); reader.onload = () => addNode({ type: tableTypes.includes(extension || '') ? 'table' : 'text', position, data: { label: tableTypes.includes(extension || '') ? '表格节点' : '文本节点', mode: tableTypes.includes(extension || '') ? 'table' : 'text', content: String(reader.result || '') } }); reader.readAsText(file) } event.currentTarget.value = '' }} />
      </div>}

      {/* 左下角画布控制 */}
      <CanvasControls minimapVisible={showMinimap} leftOffset={showNodePanel ? 284 : 24} onToggleMinimap={() => setShowMinimap((value) => !value)} onArrange={arrangeNodes} onGuide={() => setShowGuide(true)} />

      {showGuide && <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowGuide(false)}><div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-border pb-3"><h2 className="text-base font-semibold">快捷键</h2><button className="text-xs text-muted-foreground" onClick={() => setShowGuide(false)}>关闭</button></div><div className="mt-4 space-y-3 text-sm"><p className="flex justify-between"><span>Ctrl / Space + 拖动</span><span className="text-muted-foreground">临时切换选择 / 移动</span></p><p className="flex justify-between"><span>滚轮</span><span className="text-muted-foreground">缩放画布</span></p><p className="flex justify-between"><span>拖动</span><span className="text-muted-foreground">框选多个节点</span></p><p className="flex justify-between"><span>Shift / Cmd + 点击</span><span className="text-muted-foreground">追加选择节点</span></p><p className="flex justify-between"><span>Ctrl / Cmd + C / V</span><span className="text-muted-foreground">复制 / 粘贴节点</span></p><p className="flex justify-between"><span>Delete / Backspace</span><span className="text-muted-foreground">删除选中节点</span></p><p className="flex justify-between"><span>双击空白</span><span className="text-muted-foreground">添加节点</span></p><p className="flex justify-between"><span>空格 + 左键 / 鼠标中键</span><span className="text-muted-foreground">拖动画布</span></p></div></div></div>}
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
