import { audioTrimDisplayNode } from '@/canvas/audio-trim-layout'
import { restoreHostFocus } from '@/canvas/restore-host-focus'
import { installEdgeCutting } from '@/canvas/cut-edges'
import { CutTrail } from './CutTrail'
import { preserveMotionMedia } from '@/canvas/motion-media'
import { installVideoInputValidation } from '@/canvas/video-input-validation'
import { useShallow } from 'zustand/react/shallow'
import { createFrameTask } from '@/lib/frame-task'
import { interpolateViewport } from '@/canvas/navigation-motion'
import { commitCanvasViewport, currentCanvasViewport, isValidCanvasViewport, stageCanvasViewport, useCanvasViewportStore } from '@/stores/canvas-viewport-store'
/**
 * 画布视口上下文 + 指针手势接线。
 * 节点拖拽契约：原始 position + 累计 deltaWorld，禁止增量累加。
 * 连线由 beginConnect / updateConnect / endConnect 驱动，不走普通 pointerDown 分支。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { EdgeSpec, NodeKind, NodeSpec, Point, Size, Viewport } from '@/domain'
import {
  CanvasInteraction,
  nodeRect,
  panBy,
  rectFromPoints,
  rectsIntersect,
  screenToWorld as screenToWorldPure,
  visibleScreenCenter,
  wheelDeltaToPixels,
  worldToScreen as worldToScreenPure,
  zoomAt,
  type CanvasInteractionEvent,
  type PointerInput,
} from '@/canvas'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { hitTestStackedNode } from '@/canvas/node-stacking'
import { handleCanvasDrop, rememberClientPoint } from '@/canvas/clipboard-import'
import { movableDragIds } from '@/canvas/grouping'
import { createAddableNode, defaultSizeFor, type AddableKind } from '@/canvas/node-factory'
import {
  AI_NODE_MIN_SIZE,
  BROWSER_NODE_MIN_SIZE,
  CONTENT_NODE_MIN_SIZE,
  AUDIO_NODE_MIN_SIZE,
  REQUEST_NODE_MIN_SIZE,
  STICKY_NODE_MIN_SIZE,
} from '@/lib/flow/node-dimensions'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { CanvasAddMenu, type CanvasAddMenuState } from './CanvasAddMenu'
import { CanvasBackground } from './CanvasBackground'

export interface MarqueeState {
  start: Point
  current: Point
}

/** 连线预览：source 节点 id + 指针的世界坐标。 */
export interface ConnectingState {
  sourceId: string
  current: Point
}

/** 节点缩放：原始 size + 当前 size，位移按 viewport.zoom 换算。 */
export interface ResizeState {
  nodeId: string
  origin: Size
  current: Size
}

interface ResizeSession {
  nodeId: string
  origin: Size
  startScreen: Point
  min: Size
}

export interface CanvasContextValue {
  viewport: Viewport
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  selection: string[]
  marquee: MarqueeState | null
  connecting: ConnectingState | null
  connectingTargetId: string | null
  resizing: ResizeState | null
  draggingNodeIds: string[]
  containerSize: Size
  containerRef: RefObject<HTMLDivElement | null>
  screenToWorld: (point: Point) => Point
  worldToScreen: (point: Point) => Point
  zoomAtCursor: (factor: number, screenPoint: Point) => void
  panByScreen: (delta: Point) => void
  setViewport: (view: Viewport) => void
  navigateToViewport: (view: Viewport) => void
  centerOnWorld: (world: Point) => void
  nodeById: (id: string) => NodeSpec | undefined
  getPointerInput: (e: ReactPointerEvent, hitNodeId?: string) => PointerInput
  hitTestNode: (world: Point) => string | undefined
  pointerDown: (input: PointerInput, hitNodeId?: string) => void
  pointerMove: (input: PointerInput) => void
  pointerUp: (input: PointerInput) => void
  beginConnect: (sourceId: string) => void
  updateConnect: (screenPoint: Point) => void
  endConnect: (targetId: string | null) => void
  beginResize: (nodeId: string, screenPoint: Point) => void
  updateResize: (screenPoint: Point) => void
  endResize: () => void
  hoveredNodeId: string | null
  focusedNodeId: string | null
  setFocusedNodeId: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  beginNodeDrag: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void
}

const CanvasContext = createContext<CanvasContextValue | null>(null)
type CanvasInteractionValue = Omit<CanvasContextValue, 'viewport' | 'nodes' | 'edges'>
const CanvasInteractionContext = createContext<CanvasInteractionValue | null>(null)

export function useCanvasInteraction(): CanvasInteractionValue {
  const value = useContext(CanvasInteractionContext)
  if (!value) throw new Error('Canvas interaction requires CanvasProvider')
  return value
}

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext)
  if (!value) {
    throw new Error('useCanvas 必须在 CanvasProvider 内使用')
  }
  return value
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function sourceRightMid(sourceId: string, nodes: readonly NodeSpec[]): Point {
  const node = nodes.find((candidate) => candidate.id === sourceId)
  if (!node) return { x: 0, y: 0 }
  return {
    x: node.position.x + node.size.width,
    y: node.position.y + node.size.height / 2,
  }
}

function canConnect(
  sourceId: string | undefined,
  targetId: string | undefined,
  nodes: readonly NodeSpec[],
  edges: readonly EdgeSpec[],
): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false
  const target = nodes.find((node) => node.id === targetId)
  if (!target || target.disabled) return false
  return !edges.some((edge) => edge.source === sourceId && edge.target === targetId)
}

export function CanvasProvider({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const viewport = useCanvasViewportStore((state) => state.view)
  const currentDocument = useGraphStore((state) => state.currentDocument)
  const selection = useGraphStore((state) => state.selection)
  const isViewportMoving = useUiStore((state) => state.isViewportMoving)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const overlayInsets = useMemo(
    () => canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth }),
    [extensionWidth, showExtensionPanel, showNodePanel],
  )

  const nodeChrome = useUiStore((state) => state.nodeChrome)
  const nodes = useMemo(() => (currentDocument?.nodes ?? EMPTY_NODES).map((node) => audioTrimDisplayNode(node, nodeChrome[node.id]?.audioTrim === true)), [currentDocument?.nodes, nodeChrome])
  const edges = currentDocument?.edges ?? EMPTY_EDGES

  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (containerRef.current) return installEdgeCutting(containerRef.current) }, [])
  const viewportRef = useRef(viewport)
  useEffect(() => useCanvasViewportStore.subscribe((state) => { viewportRef.current = state.view }), [])
  const moveFrame = useMemo(() => createFrameTask({ request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle) }), [])
  const viewportFrame = useMemo(() => createFrameTask({ request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle) }), [])
  const panOriginRef = useRef<Viewport | null>(null)
  const motionRef = useRef<number | null>(null)
  const wheelCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelMotion = useCallback(() => {
    if (motionRef.current !== null) cancelAnimationFrame(motionRef.current)
    motionRef.current = null
  }, [])
  const publishViewport = useCallback((view: Viewport) => {
    useCanvasViewportStore.getState().setView(view)
    viewportRef.current = currentCanvasViewport()
  }, [])
  const finishViewport = useCallback(() => {
    viewportFrame.flush()
    if (wheelCommitRef.current !== null) clearTimeout(wheelCommitRef.current)
    wheelCommitRef.current = null
    commitCanvasViewport()
  }, [viewportFrame])
  const setViewport = useCallback((view: Viewport) => {
    if (!isValidCanvasViewport(view)) return
    cancelMotion()
    viewportFrame.cancel()
    publishViewport(view)
    finishViewport()
  }, [cancelMotion, finishViewport, publishViewport, viewportFrame])
  const queueViewport = useCallback((view: Viewport) => {
    if (!stageCanvasViewport(view)) return
    cancelMotion()
    viewportRef.current = view
    viewportFrame.schedule(() => publishViewport(viewportRef.current))
    if (wheelCommitRef.current !== null) clearTimeout(wheelCommitRef.current)
    wheelCommitRef.current = setTimeout(finishViewport, 120)
  }, [cancelMotion, finishViewport, publishViewport, viewportFrame])
  const navigateToViewport = useCallback((target: Viewport) => {
    if (!isValidCanvasViewport(target)) return
    cancelMotion()
    finishViewport()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setViewport(target)
      return
    }
    const start = { ...viewportRef.current }
    const documentId = useGraphStore.getState().currentDocumentId
    const startedAt = performance.now()
    const tick = () => {
      if (useGraphStore.getState().currentDocumentId !== documentId) { cancelMotion(); return }
      const progress = Math.min(1, (performance.now() - startedAt) / 220)
      publishViewport(interpolateViewport(start, target, progress))
      if (progress < 1) motionRef.current = requestAnimationFrame(tick)
      else { motionRef.current = null; finishViewport() }
    }
    motionRef.current = requestAnimationFrame(tick)
  }, [cancelMotion, finishViewport, publishViewport, setViewport])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // 拖拽起始世界坐标：全程用「原点 + 累计 delta」，不要在 move 里叠加上一次结果
  const dragOriginRef = useRef(new Map<string, Point>())
  const panClickRef = useRef(false)
  const duplicateDragRef = useRef<{ selection: string[]; copies: string[] } | null>(null)

  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [connecting, setConnecting] = useState<ConnectingState | null>(null)
  useEffect(() => installVideoInputValidation(), [])
  const [connectingTargetId, setConnectingTargetId] = useState<string | null>(null)
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null)
  const connectionFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectingRef = useRef<ConnectingState | null>(null)
  connectingRef.current = connecting
  const overlayInsetsRef = useRef(overlayInsets)
  const [resizing, setResizing] = useState<ResizeState | null>(null)
  const [draggingNodeIds, setDraggingNodeIds] = useState<string[]>([])
  const mediaInMotion = isViewportMoving || draggingNodeIds.length > 0
  useEffect(() => {
    if (mediaInMotion && containerRef.current) return preserveMotionMedia(containerRef.current)
  }, [mediaInMotion])
  const resizeRef = useRef<ResizeSession | null>(null)
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const containerSizeRef = useRef(containerSize)
  containerSizeRef.current = containerSize
  const [spacePressed, setSpacePressed] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const stackInteraction = { hoveredNodeId, focusedNodeId, draggingNodeIds, resizingNodeId: resizing?.nodeId }
  const stackInteractionRef = useRef(stackInteraction)
  stackInteractionRef.current = stackInteraction
  const hoverClearTimer = useRef<number | null>(null)
  const [addMenu, setAddMenu] = useState<CanvasAddMenuState | null>(null)
  const [connectionMenu, setConnectionMenu] = useState<{
    x: number
    y: number
    sourceId: string
    world: Point
  } | null>(null)

  const setHoveredNode = useCallback((id: string | null) => {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current)
      hoverClearTimer.current = null
    }
    if (id) {
      setHoveredNodeId(id)
      return
    }
    hoverClearTimer.current = window.setTimeout(() => {
      setHoveredNodeId(null)
      hoverClearTimer.current = null
    }, 120)
  }, [])

  useEffect(() => () => {
    if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current)
  }, [])

  const emitRef = useRef<(event: CanvasInteractionEvent) => void>(() => {})
  emitRef.current = (event: CanvasInteractionEvent) => {
    const graph = useGraphStore.getState()
    const ui = useUiStore.getState()

    switch (event.type) {
      case 'pan-start':
        panOriginRef.current = { ...viewportRef.current }
        ui.setViewportMoving(true)
        return
      case 'pan-move':
        ui.setViewportMoving(true)
        publishViewport(panBy(viewportRef.current, event.delta))
        return
      case 'pan-end':
        ui.setViewportMoving(false)
        finishViewport()
        return
      case 'gesture-cancel':
        moveFrame.cancel()
        if (panOriginRef.current) setViewport(panOriginRef.current)
        panOriginRef.current = null
        ui.setViewportMoving(false)
        if (duplicateDragRef.current) {
          const { selection, copies } = duplicateDragRef.current
          const document = graph.currentDocument
          if (document && copies.length) useGraphStore.setState({
            currentDocument: {
              ...document,
              nodes: document.nodes.filter((node) => !copies.includes(node.id)),
              edges: document.edges.filter((edge) => !copies.includes(edge.source) && !copies.includes(edge.target)),
              updatedAt: Date.now(),
            },
            selection,
          })
          duplicateDragRef.current = null
        } else {
          graph.updateNodes(new Map([...dragOriginRef.current].map(([id, position]) => [id, { position }])))
        }
        dragOriginRef.current.clear()
        setDraggingNodeIds([])
        setMarquee(null)
        return
      case 'node-drag-start': {
        ui.setSelectedEdgeId(null)
        const nodes = nodesRef.current
        const selected = graph.selection.includes(event.nodeId) ? graph.selection : [event.nodeId]
        const dragIds = movableDragIds(nodes, selected)
        setDraggingNodeIds(dragIds)
        dragOriginRef.current.clear()
        for (const id of dragIds) {
          const node = nodes.find((candidate) => candidate.id === id)
          if (node) dragOriginRef.current.set(id, { x: node.position.x, y: node.position.y })
        }
        return
      }
      case 'node-drag-move':
      case 'node-drag-end': {
        if (event.type === 'node-drag-end') setDraggingNodeIds([])
        if (graph.isLocked) {
          emitRef.current({ type: 'gesture-cancel' })
          return
        }
        const duplicate = duplicateDragRef.current
        if (duplicate && !duplicate.copies.length) {
          if (Math.hypot(event.deltaWorld.x, event.deltaWorld.y) * viewportRef.current.zoom < 2) {
            if (event.type === 'node-drag-end') {
              duplicateDragRef.current = null
              dragOriginRef.current.clear()
            }
            return
          }
          duplicate.copies = graph.duplicateSelected({ offset: { x: 0, y: 0 }, deferHistory: true })
          const copiedNodes = useGraphStore.getState().currentDocument?.nodes ?? []
          dragOriginRef.current.clear()
          for (const node of copiedNodes) {
            if (duplicate.copies.includes(node.id)) dragOriginRef.current.set(node.id, { ...node.position })
          }
          if (event.type !== 'node-drag-end') setDraggingNodeIds(duplicate.copies)
        }
        graph.updateNodes(new Map([...dragOriginRef.current].map(([id, origin]) => [id, {
            position: {
              x: origin.x + event.deltaWorld.x,
              y: origin.y + event.deltaWorld.y,
            },
          }])))
        if (event.type === 'node-drag-end') {
          const dist = Math.hypot(event.deltaWorld.x, event.deltaWorld.y)
          if (dist >= 2 || duplicate?.copies.length) graph.finishNodeDrag([...dragOriginRef.current.keys()])
          duplicateDragRef.current = null
          dragOriginRef.current.clear()
        }
        return
      }
      case 'marquee-start':
      case 'marquee-move':
        setMarquee({ start: event.start, current: event.current })
        return
      case 'marquee-end': {
        const box = rectFromPoints(event.start, event.current)
        const ids = nodesRef.current
          .filter((node) => rectsIntersect(nodeRect(node), box))
          .map((node) => node.id)
        ui.setSelectedEdgeId(null)
        graph.setSelection(event.shiftKey ? [...new Set([...graph.selection, ...ids])] : ids)
        setMarquee(null)
        return
      }
      case 'connect-start':
      case 'connect-move':
      case 'connect-end':
        // connecting 的 Reaevent.shiftKey ? [...new Set([...graph.selection, ...ids])] : ct 状态由 begin/update/endConnect 维护，这里不重复处理
        return
    }
  }

  const interaction = useMemo(
    () =>
      new CanvasInteraction(
        () => viewportRef.current,
        (event) => emitRef.current(event),
      ),
    [],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setContainerSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      cancelMotion()
      finishViewport()
      if (event.code !== 'Space') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      interaction.setSpacePressed(true)
      setSpacePressed(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      interaction.setSpacePressed(false)
      setSpacePressed(false)
    }
    const onBlur = () => {
      interaction.setSpacePressed(false)
      setSpacePressed(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [cancelMotion, finishViewport, interaction])

  // 滚轮锚定缩放；原生监听以便 preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (motionRef.current !== null) {
        cancelMotion()
        finishViewport()
      }
      const target = event.target as Element | null
      if (target?.closest('[data-canvas-content], [data-canvas-chrome], textarea, input, select, [contenteditable]')) {
        return
      }
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const delta = wheelDeltaToPixels(event.deltaY, event.deltaMode, rect.height)
      if (delta === 0) return
      const factor = Math.pow(1.0018, -delta)
      queueViewport(zoomAt(viewportRef.current, screen, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cancelMotion, finishViewport, queueViewport])

  const toInput = useCallback(
    (
      clientX: number,
      clientY: number,
      button: number,
      shiftKey: boolean,
      ctrlKey: boolean,
      metaKey: boolean,
    ): PointerInput => {
      const rect = containerRef.current?.getBoundingClientRect()
      const screen = {
        x: clientX - (rect?.left ?? 0),
        y: clientY - (rect?.top ?? 0),
      }
      return {
        screen,
        world: screenToWorldPure(screen, viewportRef.current),
        button,
        shiftKey,
        ctrlKey,
        metaKey,
      }
    },
    [],
  )

  const getPointerInput = useCallback(
    (e: ReactPointerEvent, _hitNodeId?: string): PointerInput => {
      rememberClientPoint(e.clientX, e.clientY)
      return toInput(e.clientX, e.clientY, e.button, e.shiftKey, e.ctrlKey, e.metaKey)
    },
    [toInput],
  )

  const hitTestNode = useCallback(
    (world: Point): string | undefined => hitTestStackedNode(nodesRef.current, world, stackInteractionRef.current),
    [],
  )

  const hitTestConnectionTarget = useCallback(
    (world: Point): string | undefined => hitTestStackedNode(nodesRef.current, world, stackInteractionRef.current, true),
    [],
  )

  const pointerDown = useCallback(
    (input: PointerInput, hitNodeId?: string) => {
      cancelMotion()
      finishViewport()
      interaction.pointerDown(input, hitNodeId)
    },
    [cancelMotion, finishViewport, interaction],
  )

  const pointerMove = useCallback(
    (input: PointerInput) => {
      moveFrame.schedule(() => interaction.pointerMove(input))
    },
    [interaction, moveFrame],
  )

  const pointerUp = useCallback(
    (input: PointerInput) => {
      moveFrame.flush()
      interaction.pointerMove(input)
      interaction.pointerUp(input)
      panOriginRef.current = null
    },
    [interaction, moveFrame],
  )

  const beginNodeDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string) => {
      event.stopPropagation()
      event.preventDefault()
      if (event.button !== 0 || useGraphStore.getState().isLocked) return
      if (interaction.getMode() !== 'idle') return
      const graph = useGraphStore.getState()
      if (event.shiftKey) {
        if (!graph.selection.includes(nodeId)) graph.setSelection([...graph.selection, nodeId])
      } else if (!graph.selection.includes(nodeId)) {
        graph.setSelection([nodeId])
      }
      const node = graph.currentDocument?.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.kind === 'sticky' && node.pinned) return
      duplicateDragRef.current = event.altKey && !spacePressed
        ? { selection: [...useGraphStore.getState().selection], copies: [] }
        : null
      containerRef.current?.setPointerCapture(event.pointerId)
      pointerDown(getPointerInput(event), nodeId)
    },
    [getPointerInput, pointerDown, interaction, spacePressed],
  )

  const beginConnect = useCallback(
    (sourceId: string) => {
      cancelMotion()
      finishViewport()
      if (useGraphStore.getState().isLocked) return
      if (connectionFeedbackTimerRef.current) clearTimeout(connectionFeedbackTimerRef.current)
      connectionFeedbackTimerRef.current = null
      setConnectionFeedback(null)
      interaction.beginConnect(sourceId)
      if (interaction.getMode() !== 'connecting') return
      const current = sourceRightMid(sourceId, nodesRef.current)
      interaction.updateConnect(current)
      connectingRef.current = { sourceId, current }
      setConnecting(connectingRef.current)
      setConnectingTargetId(null)
    },
    [cancelMotion, finishViewport, interaction],
  )

  const updateConnect = useCallback(
    (screenPoint: Point) => {
      moveFrame.schedule(() => {
      if (interaction.getMode() !== 'connecting') return
      const world = screenToWorldPure(screenPoint, viewportRef.current)
      const sourceId = connectingRef.current?.sourceId
      const target = hitTestConnectionTarget(world)
      const graph = useGraphStore.getState()
      const valid = canConnect(sourceId, target, nodesRef.current, graph.currentDocument?.edges ?? EMPTY_EDGES)
      setConnectingTargetId(valid ? target ?? null : target ? `invalid:${target}` : null)
      interaction.updateConnect(world)
      connectingRef.current = sourceId ? { sourceId, current: world } : null
      setConnecting(connectingRef.current)
      })
    },
    [interaction, hitTestConnectionTarget, moveFrame],
  )

  const endConnect = useCallback(
    (targetId: string | null) => {
      moveFrame.flush()
      if (interaction.getMode() !== 'connecting') return
      const graph = useGraphStore.getState()
      const sourceId = connectingRef.current?.sourceId
      const validTarget = canConnect(
        sourceId,
        targetId ?? undefined,
        nodesRef.current,
        graph.currentDocument?.edges ?? EMPTY_EDGES,
      ) ? targetId : null
      const connectionPoint = connectingRef.current?.current
      const rejectedTarget = Boolean(targetId && !validTarget)
      interaction.endConnect(validTarget)
      if (sourceId && validTarget && !graph.isLocked) {
        graph.addEdge(sourceId, validTarget)
      }
      if (sourceId && targetId === null && connectionPoint && !graph.isLocked) {
        const rect = containerRef.current?.getBoundingClientRect()
        const screen = worldToScreenPure(connectionPoint, viewportRef.current)
        setConnectionMenu({
          x: Math.max(8, Math.min((rect?.width ?? 320) - 208, screen.x)),
          y: Math.max(8, Math.min((rect?.height ?? 240) - 180, screen.y)),
          sourceId,
          world: connectionPoint,
        })
      }
      if (rejectedTarget) {
        if (connectionFeedbackTimerRef.current) clearTimeout(connectionFeedbackTimerRef.current)
        setConnectionFeedback("\u65e0\u6cd5\u8fde\u63a5\uff1a\u76ee\u6807\u65e0\u6548\u6216\u8fde\u63a5\u5df2\u5b58\u5728")
        connectionFeedbackTimerRef.current = setTimeout(() => {
          setConnectionFeedback(null)
          connectionFeedbackTimerRef.current = null
        }, 1800)
      }
      setConnecting(null)
      connectingRef.current = null
      setConnectingTargetId(null)
    },
    [interaction, moveFrame],
  )

  const createConnectedNode = useCallback((kind: AddableKind) => {
    const pending = connectionMenu
    if (!pending || useGraphStore.getState().isLocked) return
    const size = defaultSizeFor(kind)
    const node = createAddableNode(kind, {
      x: pending.world.x - size.width / 2,
      y: pending.world.y - size.height / 2,
    })
    const graph = useGraphStore.getState()
    graph.addConnectedNode(pending.sourceId, node)
    setConnectionMenu(null)
  }, [connectionMenu])

  const cancelConnect = useCallback(() => {
    moveFrame.cancel()
    interaction.endConnect(null)
    connectingRef.current = null
    setConnecting(null)
    setConnectingTargetId(null)
    setConnectionMenu(null)
  }, [interaction, moveFrame])

  useEffect(() => {
    return () => {
      if (connectionFeedbackTimerRef.current) clearTimeout(connectionFeedbackTimerRef.current)
    }
  }, [])

  const finishResize = useCallback((commit: boolean) => {
    if (commit) moveFrame.flush()
    else moveFrame.cancel()
    const session = resizeRef.current
    if (!session) return
    resizeRef.current = null
    setResizing(null)
    useUiStore.getState().setViewportMoving(false)
    const node = useGraphStore.getState().currentDocument?.nodes.find(
      (candidate) => candidate.id === session.nodeId,
    )
    if (!node) return
    if (!commit || useGraphStore.getState().isLocked) {
      useGraphStore.getState().updateNode(session.nodeId, { size: session.origin })
      return
    }
    const changed = node.size.width !== session.origin.width || node.size.height !== session.origin.height
    if (!changed) return
    if (!node.manualSize) useGraphStore.getState().updateNode(session.nodeId, { manualSize: true })
    useGraphStore.getState().commitHistory()
  }, [moveFrame])

  useEffect(() => {
    const cancelGesture = () => {
      cancelMotion()
      viewportFrame.cancel()
      moveFrame.cancel()
      finishResize(false)
      interaction.cancel()
      cancelConnect()
      finishViewport()
    }
    const onVisibility = () => { if (document.hidden) cancelGesture() }
    const unsubscribe = useGraphStore.subscribe((state, previous) => {
      if (state.currentDocumentId === previous.currentDocumentId) return
      moveFrame.cancel()
      viewportFrame.cancel()
      cancelMotion()
      if (wheelCommitRef.current !== null) clearTimeout(wheelCommitRef.current)
      wheelCommitRef.current = null
      dragOriginRef.current.clear()
      duplicateDragRef.current = null
      panOriginRef.current = null
      resizeRef.current = null
      connectingRef.current = null
      viewportRef.current = currentCanvasViewport()
      setResizing(null)
      cancelGesture()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', cancelGesture)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelGesture()
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', cancelGesture)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cancelConnect, cancelMotion, finishResize, finishViewport, interaction, moveFrame, viewportFrame])

  const beginResize = useCallback(
    (nodeId: string, screenPoint: Point) => {
      cancelMotion()
      finishViewport()
      if (resizeRef.current) finishResize(true)
      if (useGraphStore.getState().isLocked) return
      const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
      if (!node) return
      const stored = useGraphStore.getState().currentDocument?.nodes.find((candidate) => candidate.id === nodeId) || node
      const origin = { width: stored.size.width, height: stored.size.height }
      resizeRef.current = {
        nodeId,
        origin,
        startScreen: { x: screenPoint.x, y: screenPoint.y },
        min: node.kind === 'content' && node.category === 'audio' ? AUDIO_NODE_MIN_SIZE : minSizeForKind(node.kind),
      }
      setResizing({ nodeId, origin, current: origin })
      const ui = useUiStore.getState()
      ui.setViewportMoving(true)
      ui.setSelectedEdgeId(null)
    },
    [cancelMotion, finishViewport, finishResize],
  )

  const updateResize = useCallback((screenPoint: Point) => {
    moveFrame.schedule(() => {
    const session = resizeRef.current
    if (!session) return
    if (useGraphStore.getState().isLocked) {
      finishResize(false)
      return
    }
    const zoom = safeZoom(viewportRef.current.zoom)
    const width = Math.max(
      session.min.width,
      session.origin.width + (screenPoint.x - session.startScreen.x) / zoom,
    )
    const height = Math.max(
      session.min.height,
      session.origin.height + (screenPoint.y - session.startScreen.y) / zoom,
    )
    const size = { width, height }
    useGraphStore.getState().updateNode(session.nodeId, { size })
    setResizing({ nodeId: session.nodeId, origin: session.origin, current: size })
    })
  }, [finishResize, moveFrame])

  const endResize = useCallback(() => {
    finishResize(true)
  }, [finishResize])

  useEffect(() => {
    return () => {
      const session = resizeRef.current
      if (!session) return
      resizeRef.current = null
      useUiStore.getState().setViewportMoving(false)
      const node = useGraphStore.getState().currentDocument?.nodes.find(
        (candidate) => candidate.id === session.nodeId,
      )
      if (node) useGraphStore.getState().commitHistory()
    }
  }, [])

  const screenToWorldFn = useCallback(
    (point: Point) => screenToWorldPure(point, viewportRef.current),
    [],
  )

  const worldToScreenFn = useCallback(
    (point: Point) => worldToScreenPure(point, viewportRef.current),
    [],
  )

  const zoomAtCursor = useCallback(
    (factor: number, screenPoint: Point) => {
      setViewport(zoomAt(viewportRef.current, screenPoint, factor))
    },
    [setViewport],
  )

  const panByScreen = useCallback(
    (delta: Point) => {
      setViewport(panBy(viewportRef.current, delta))
    },
    [setViewport],
  )

  const nodeById = useCallback(
    (id: string) => nodesRef.current.find((node) => node.id === id),
    [],
  )

  const centerOnWorld = useCallback(
    (world: Point) => {
      const size = containerSizeRef.current
      if (size.width <= 0 || size.height <= 0) return
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return
      const view = viewportRef.current
      const zoom = safeZoom(view.zoom)
      const center = visibleScreenCenter(size, overlayInsetsRef.current)
      navigateToViewport({
        x: center.x - world.x * zoom,
        y: center.y - world.y * zoom,
        zoom,
      })
    },
    [navigateToViewport],
  )

  useEffect(() => {
    const previous = overlayInsetsRef.current
    const size = containerSizeRef.current
    overlayInsetsRef.current = overlayInsets
    if (size.width <= 0 || size.height <= 0) return
    const previousCenter = visibleScreenCenter(size, previous)
    const nextCenter = visibleScreenCenter(size, overlayInsets)
    const dx = nextCenter.x - previousCenter.x
    const dy = nextCenter.y - previousCenter.y
    if (dx === 0 && dy === 0) return
    setViewport(panBy(viewportRef.current, { x: dx, y: dy }))
  }, [overlayInsets, setViewport])

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    cancelMotion()
    finishViewport()
    restoreHostFocus(event.currentTarget, event.target)
    panClickRef.current = false
    const target = event.target as Element | null
    if (target?.closest('[data-canvas-chrome]')) return
    if (event.button !== 1 && !(event.button === 0 && spacePressed)) return
    if (interaction.getMode() !== 'idle' || resizeRef.current) return
    event.preventDefault()
    event.stopPropagation()
    panClickRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDown(getPointerInput(event))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (connectionFeedback) {
      if (connectionFeedbackTimerRef.current) clearTimeout(connectionFeedbackTimerRef.current)
      connectionFeedbackTimerRef.current = null
      setConnectionFeedback(null)
    }
    if (connectionMenu) setConnectionMenu(null)
    if (event.button !== 0 && event.button !== 1) return
    // 连线 / 缩放由 NodeShell 入口触发，根按下不介入
    if (interaction.getMode() === 'connecting' || resizeRef.current) return
    const input = getPointerInput(event)
    const hitNodeId = hitTestNode(input.world)
    // 责任边界：节点拖拽由 NodeShell 入口负责（stopPropagation + setPointerCapture(container) + pointerDown(nodeId)）。
    // 正常情况节点已 stopPropagation，不会到这里；若因穿透命中节点，防御性直接 return，避免重复捕获 / 竞态。
    // 根节点只处理空白处按下（pan / marquee），也只在空白处 setPointerCapture。
    if (hitNodeId) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    useUiStore.getState().setSelectedEdgeId(null)
    pointerDown(input, undefined)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const input = getPointerInput(event)
    if (resizeRef.current) {
      updateResize(input.screen)
      return
    }
    const mode = interaction.getMode()
    if (mode === 'idle') return
    if (mode === 'connecting') {
      updateConnect(input.screen)
      return
    }
    pointerMove(input)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const input = getPointerInput(event)
    if (resizeRef.current) {
      updateResize(input.screen)
      endResize()
      return
    }
    if (interaction.getMode() === 'connecting') {
      updateConnect(input.screen)
      endConnect(hitTestConnectionTarget(input.world) ?? null)
      return
    }
    pointerUp(input)
  }

  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 0) return
    if (resizeRef.current) {
      endResize()
      return
    }
    const mode = interaction.getMode()
    if (mode === 'idle') return
    if (mode === 'connecting') {
      cancelConnect()
      return
    }
    pointerUp(getPointerInput(event))
  }

  const value = useMemo<CanvasContextValue>(
    () => ({
      viewport,
      nodes,
      edges,
      selection,
      marquee,
      connecting,
      connectingTargetId,
      resizing,
      draggingNodeIds,
      containerSize,
      containerRef,
      screenToWorld: screenToWorldFn,
      worldToScreen: worldToScreenFn,
      zoomAtCursor,
      panByScreen,
      setViewport,
      navigateToViewport,
      centerOnWorld,
      nodeById,
      getPointerInput,
      hitTestNode,
      pointerDown,
      pointerMove,
      pointerUp,
      beginConnect,
      updateConnect,
      endConnect,
      beginResize,
      updateResize,
      endResize,
      hoveredNodeId,
      focusedNodeId,
      setFocusedNodeId,
      setHoveredNode,
      beginNodeDrag,
    }),
    [
      viewport,
      nodes,
      edges,
      selection,
      marquee,
      connecting,
      connectingTargetId,
      resizing,
      draggingNodeIds,
      containerSize,
      screenToWorldFn,
      worldToScreenFn,
      zoomAtCursor,
      panByScreen,
      setViewport,
      navigateToViewport,
      centerOnWorld,
      nodeById,
      getPointerInput,
      hitTestNode,
      pointerDown,
      pointerMove,
      pointerUp,
      beginConnect,
      updateConnect,
      endConnect,
      beginResize,
      updateResize,
      endResize,
      hoveredNodeId,
      focusedNodeId,
      setHoveredNode,
      beginNodeDrag,
    ],
  )

  const selectInteraction = useShallow((context: CanvasContextValue): CanvasInteractionValue => {
    const { viewport: _viewport, nodes: _nodes, edges: _edges, ...rest } = context
    return rest
  })
  const interactionValue = selectInteraction(value)

  return (
    <CanvasContext.Provider value={value}>
      <CanvasInteractionContext.Provider value={interactionValue}>
      <div
        ref={containerRef}
        data-cnote-canvas="engine"
        tabIndex={-1}
        className={[
          'relative h-full w-full overflow-hidden select-none outline-none',
          isViewportMoving ? 'canvas-viewport-moving' : '',
          spacePressed ? 'cursor-grab' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ backgroundColor: 'var(--background)', touchAction: 'none' }}
        onDoubleClick={(event) => {
          const target = event.target as Element
          if (event.button !== 0 || target.closest('[data-canvas-chrome], [data-content-node], [data-node-id], [data-canvas-handle]')) return
          const input = toInput(event.clientX, event.clientY, event.button, event.shiftKey, event.ctrlKey, event.metaKey)
          if (hitTestNode(input.world)) return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          setAddMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY })
        }}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onClickCapture={(event) => {
          if (!panClickRef.current) return
          event.preventDefault()
          event.stopPropagation()
          panClickRef.current = false
        }}
        onAuxClickCapture={(event) => {
          if (!panClickRef.current) return
          event.preventDefault()
          event.stopPropagation()
          panClickRef.current = false
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (interaction.getMode() === 'connecting') {
            cancelConnect()
            return
          }
          if (resizeRef.current) {
            finishResize(false)
            return
          }
          // Pointer cancellation must not commit a drag or marquee.
          interaction.cancel()
        }}
        onPointerLeave={onPointerLeave}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void handleCanvasDrop(event.nativeEvent)
        }}
        onContextMenu={(event) => {
          if (isEditableTarget(event.target)) return
          event.preventDefault()
        }}
      >
        <CanvasBackground />
        {children}
        <CutTrail />
        {connectionFeedback ? (
          <div
            data-canvas-chrome="true"
            data-connection-feedback
            className="pointer-events-none absolute top-[72px] z-50 -translate-x-1/2 rounded border border-destructive/30 bg-background/95 px-3 py-1.5 text-xs text-destructive shadow-sm"
            style={{
              left: visibleScreenCenter(containerSize, overlayInsets).x,
              maxWidth: Math.max(0, containerSize.width - overlayInsets.left - overlayInsets.right - 16),
            }}
            role="status"
            aria-live="polite"
          >
            {connectionFeedback}
          </div>
        ) : null}
        {connectionMenu ? (
          <div
            data-canvas-chrome="true"
            data-connection-menu
            className="cnote-menu-surface pointer-events-auto absolute z-50 w-48"
            style={clampOverlayPosition(connectionMenu, containerSize, { width: 192, height: 160 })}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 pt-1 text-[10px] font-medium text-muted-foreground">选择要连接的节点</p>
            {(['ai', 'content', 'request'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="cnote-menu-item"
                onClick={() => createConnectedNode(kind)}
              >
                {kind === 'ai' ? 'AI 节点' : kind === 'content' ? '内容节点' : '请求体节点'}
              </button>
            ))}
          </div>
        ) : null}
        {addMenu && <CanvasAddMenu menu={addMenu} container={containerRef.current} onClose={() => setAddMenu(null)} />}
      </div>
      </CanvasInteractionContext.Provider>
    </CanvasContext.Provider>
  )
}

const EMPTY_NODES: NodeSpec[] = []
const EMPTY_EDGES: EdgeSpec[] = []
const GROUP_NODE_MIN_SIZE: Size = { width: 160, height: 120 }

function safeZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom !== 0 ? zoom : 1
}

function clampOverlayPosition(
  point: Point,
  container: Size,
  overlay: Size,
): { left: number; top: number } {
  const maxX = Math.max(8, container.width - overlay.width - 8)
  const maxY = Math.max(8, container.height - overlay.height - 8)
  return {
    left: Math.max(8, Math.min(point.x, maxX)),
    top: Math.max(8, Math.min(point.y, maxY)),
  }
}

function minSizeForKind(kind: NodeKind): Size {
  switch (kind) {
    case 'sticky':
      return { width: STICKY_NODE_MIN_SIZE.width, height: STICKY_NODE_MIN_SIZE.height }
    case 'browser':
      return { width: BROWSER_NODE_MIN_SIZE.width, height: BROWSER_NODE_MIN_SIZE.height }
    case 'ai':
      return { width: AI_NODE_MIN_SIZE.width, height: AI_NODE_MIN_SIZE.height }
    case 'request':
      return { width: REQUEST_NODE_MIN_SIZE.width, height: REQUEST_NODE_MIN_SIZE.height }
    case 'content':
      return { width: CONTENT_NODE_MIN_SIZE.width, height: CONTENT_NODE_MIN_SIZE.height }
    case 'group':
      return GROUP_NODE_MIN_SIZE
  }
}
