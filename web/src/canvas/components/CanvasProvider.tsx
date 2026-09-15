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
import type { EdgeSpec, NodeSpec, Point, Size, Viewport } from '@/domain'
import {
  CanvasInteraction,
  nodeRect,
  panBy,
  pointInRect,
  rectFromPoints,
  rectsIntersect,
  screenToWorld as screenToWorldPure,
  worldToScreen as worldToScreenPure,
  zoomAt,
  type CanvasInteractionEvent,
  type PointerInput,
} from '@/canvas'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'

export interface MarqueeState {
  start: Point
  current: Point
}

/** 连线预览：source 节点 id + 指针的世界坐标。 */
export interface ConnectingState {
  sourceId: string
  current: Point
}

export interface CanvasContextValue {
  viewport: Viewport
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  selection: string[]
  marquee: MarqueeState | null
  connecting: ConnectingState | null
  containerSize: Size
  containerRef: RefObject<HTMLDivElement | null>
  screenToWorld: (point: Point) => Point
  worldToScreen: (point: Point) => Point
  zoomAtCursor: (factor: number, screenPoint: Point) => void
  panByScreen: (delta: Point) => void
  setViewport: (view: Viewport) => void
  nodeById: (id: string) => NodeSpec | undefined
  getPointerInput: (e: ReactPointerEvent, hitNodeId?: string) => PointerInput
  hitTestNode: (world: Point) => string | undefined
  pointerDown: (input: PointerInput, hitNodeId?: string) => void
  pointerMove: (input: PointerInput) => void
  pointerUp: (input: PointerInput) => void
  beginConnect: (sourceId: string) => void
  updateConnect: (screenPoint: Point) => void
  endConnect: (targetId: string | null) => void
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

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

function hitTestTopNode(nodes: readonly NodeSpec[], world: Point): string | undefined {
  let found: NodeSpec | undefined
  for (const node of nodes) {
    if (!pointInRect(world, nodeRect(node))) continue
    if (!found) {
      found = node
      continue
    }
    const z = node.z ?? 0
    const foundZ = found.z ?? 0
    // z 高者优先；同 z 取后加入（数组更后者）
    if (z >= foundZ) found = node
  }
  return found?.id
}

function sourceRightMid(sourceId: string, nodes: readonly NodeSpec[]): Point {
  const node = nodes.find((candidate) => candidate.id === sourceId)
  if (!node) return { x: 0, y: 0 }
  return {
    x: node.position.x + node.size.width,
    y: node.position.y + node.size.height / 2,
  }
}

export function CanvasProvider({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const viewport = useGraphStore((state) => state.view)
  const currentDocument = useGraphStore((state) => state.currentDocument)
  const selection = useGraphStore((state) => state.selection)
  const setViewport = useGraphStore((state) => state.setViewport)
  const isViewportMoving = useUiStore((state) => state.isViewportMoving)

  const nodes = currentDocument?.nodes ?? EMPTY_NODES
  const edges = currentDocument?.edges ?? EMPTY_EDGES

  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // 拖拽起始世界坐标：全程用「原点 + 累计 delta」，不要在 move 里叠加上一次结果
  const dragOriginRef = useRef(new Map<string, Point>())

  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [connecting, setConnecting] = useState<ConnectingState | null>(null)
  const connectingRef = useRef<ConnectingState | null>(null)
  connectingRef.current = connecting
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const [spacePressed, setSpacePressed] = useState(false)

  const emitRef = useRef<(event: CanvasInteractionEvent) => void>(() => {})
  emitRef.current = (event: CanvasInteractionEvent) => {
    const graph = useGraphStore.getState()
    const ui = useUiStore.getState()

    switch (event.type) {
      case 'pan-start':
        ui.setViewportMoving(true)
        return
      case 'pan-move':
        ui.setViewportMoving(true)
        graph.setViewport(panBy(viewportRef.current, event.delta))
        return
      case 'pan-end':
        ui.setViewportMoving(false)
        return
      case 'node-drag-start': {
        const node = nodesRef.current.find((candidate) => candidate.id === event.nodeId)
        if (node) {
          dragOriginRef.current.set(event.nodeId, {
            x: node.position.x,
            y: node.position.y,
          })
        }
        return
      }
      case 'node-drag-move':
      case 'node-drag-end': {
        if (graph.isLocked) {
          if (event.type === 'node-drag-end') {
            dragOriginRef.current.delete(event.nodeId)
          }
          return
        }
        const origin = dragOriginRef.current.get(event.nodeId)
        if (origin) {
          graph.updateNode(event.nodeId, {
            position: {
              x: origin.x + event.deltaWorld.x,
              y: origin.y + event.deltaWorld.y,
            },
          })
        }
        if (event.type === 'node-drag-end') {
          const dist = Math.hypot(event.deltaWorld.x, event.deltaWorld.y)
          // 位移很小视为点击选中，不写历史
          if (dist < 2) {
            graph.setSelection([event.nodeId])
          } else {
            graph.commitHistory()
          }
          dragOriginRef.current.delete(event.nodeId)
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
        graph.setSelection(ids)
        setMarquee(null)
        return
      }
      case 'connect-start':
      case 'connect-move':
      case 'connect-end':
        // connecting 的 React 状态由 begin/update/endConnect 维护，这里不重复处理
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
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [interaction])

  // 滚轮锚定缩放；原生监听以便 preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      useGraphStore.getState().setViewport(zoomAt(viewportRef.current, screen, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
      return toInput(e.clientX, e.clientY, e.button, e.shiftKey, e.ctrlKey, e.metaKey)
    },
    [toInput],
  )

  const hitTestNode = useCallback(
    (world: Point): string | undefined => hitTestTopNode(nodesRef.current, world),
    [],
  )

  const pointerDown = useCallback(
    (input: PointerInput, hitNodeId?: string) => {
      interaction.pointerDown(input, hitNodeId)
    },
    [interaction],
  )

  const pointerMove = useCallback(
    (input: PointerInput) => {
      interaction.pointerMove(input)
    },
    [interaction],
  )

  const pointerUp = useCallback(
    (input: PointerInput) => {
      interaction.pointerUp(input)
    },
    [interaction],
  )

  const beginConnect = useCallback(
    (sourceId: string) => {
      if (useGraphStore.getState().isLocked) return
      interaction.beginConnect(sourceId)
      if (interaction.getMode() !== 'connecting') return
      const current = sourceRightMid(sourceId, nodesRef.current)
      interaction.updateConnect(current)
      setConnecting({ sourceId, current })
    },
    [interaction],
  )

  const updateConnect = useCallback(
    (screenPoint: Point) => {
      if (interaction.getMode() !== 'connecting') return
      const world = screenToWorldPure(screenPoint, viewportRef.current)
      interaction.updateConnect(world)
      setConnecting((prev) => (prev ? { ...prev, current: world } : prev))
    },
    [interaction],
  )

  const endConnect = useCallback(
    (targetId: string | null) => {
      if (interaction.getMode() !== 'connecting') return
      const sourceId = connectingRef.current?.sourceId
      interaction.endConnect(targetId)
      const graph = useGraphStore.getState()
      // 目标命中由宿主 hitTestNode 传入；自环不建边
      if (sourceId && targetId && sourceId !== targetId && !graph.isLocked) {
        graph.addEdge(sourceId, targetId)
      }
      setConnecting(null)
    },
    [interaction],
  )

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
    (id: string) => nodes.find((node) => node.id === id),
    [nodes],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    // 连线由 NodeShell 的 source 点触发 beginConnect，根按下不介入
    if (interaction.getMode() === 'connecting') return
    const input = getPointerInput(event)
    const hitNodeId = hitTestNode(input.world)
    // 责任边界：节点拖拽由 NodeShell 入口负责（stopPropagation + setPointerCapture(container) + pointerDown(nodeId)）。
    // 正常情况节点已 stopPropagation，不会到这里；若因穿透命中节点，防御性直接 return，避免重复捕获 / 竞态。
    // 根节点只处理空白处按下（pan / marquee），也只在空白处 setPointerCapture。
    if (hitNodeId) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDown(input, undefined)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const mode = interaction.getMode()
    if (mode === 'idle') return
    const input = getPointerInput(event)
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
    if (interaction.getMode() === 'connecting') {
      // 抬起时用 hitTestNode 解析目标节点；未命中则 targetId=null
      endConnect(hitTestNode(input.world) ?? null)
      return
    }
    pointerUp(input)
  }

  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 0) return
    const mode = interaction.getMode()
    if (mode === 'idle') return
    if (mode === 'connecting') {
      endConnect(null)
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
      containerSize,
      containerRef,
      screenToWorld: screenToWorldFn,
      worldToScreen: worldToScreenFn,
      zoomAtCursor,
      panByScreen,
      setViewport,
      nodeById,
      getPointerInput,
      hitTestNode,
      pointerDown,
      pointerMove,
      pointerUp,
      beginConnect,
      updateConnect,
      endConnect,
    }),
    [
      viewport,
      nodes,
      edges,
      selection,
      marquee,
      connecting,
      containerSize,
      screenToWorldFn,
      worldToScreenFn,
      zoomAtCursor,
      panByScreen,
      setViewport,
      nodeById,
      getPointerInput,
      hitTestNode,
      pointerDown,
      pointerMove,
      pointerUp,
      beginConnect,
      updateConnect,
      endConnect,
    ],
  )

  return (
    <CanvasContext.Provider value={value}>
      <div
        ref={containerRef}
        data-cnote-canvas="engine"
        className={[
          'relative h-full w-full overflow-hidden select-none',
          isViewportMoving ? 'canvas-viewport-moving' : '',
          spacePressed ? 'cursor-grab' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ background: 'var(--background)', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {children}
      </div>
    </CanvasContext.Provider>
  )
}

const EMPTY_NODES: NodeSpec[] = []
const EMPTY_EDGES: EdgeSpec[] = []
