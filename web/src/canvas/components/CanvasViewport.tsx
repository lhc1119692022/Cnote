/**
 * 画布组装：world 层（壳 + 边，参与 scale）与屏幕层（内容抬升 / 框选 / 控件）。
 *
 * 内容外框只平移；普通内容用布局 zoom 保持世界尺寸排版，浏览器 guest 单独处理。
 * 重内容（webview / iframe / 富文本）永远不进入 world 层的 scale transform。
 *
 * 层级（普通节点 > 边 > 编组）：每个节点的壳和内容共享一个不缩放的层叠容器。
 * - 边：屏幕坐标覆盖层 z-10；显示 SVG pointer-events:none，命中 SVG 仅 stroke 可点（点边选中）
 * - 连线预览：屏幕层 CanvasConnector z-20，内容之上、marquee/控件之下
 * - 内容抬升：普通节点 z-15，编组 z-5，内容与缩放壳互为兄弟元素
 * - 壳：节点内部 WorldLayer z-1，不能越过前景节点内容
 *
 * 对齐不变式：壳在世界层（有 scale），width = node.size.width、height = node.size.height；
 * 内容层盒子是 size * zoom 且只平移。二者与同一节点原点对齐，不在此打破。
 *
 * 内容虚拟化：仅对可见世界矩形（含 overscan）及挂载例外调用 renderNode。
 * 壳 / 边 / 命中仍遍历完整 nodes。
 */

import type { ReactNode } from 'react'
import { Layers3 } from 'lucide-react'
import { nodeRect, unionRect } from '@/canvas'
import { isAINodeSendInflight } from '@/canvas/contents/AIContent'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { nodeToolbarHorizontalPlacement, selectionToolbarTop } from '@/canvas/toolbar-placement'
import { nodeFrontOrder, nodeStackOrder } from '@/canvas/node-stacking'
import type { NodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useUiStore } from '@/stores/ui-store'
import { CanvasProvider, useCanvas } from './CanvasProvider'
import { CanvasControls } from './CanvasControls'
import { CanvasExtensionPanel } from './CanvasExtensionPanel'
import { CanvasMinimap } from './CanvasMinimap'
import { CanvasNodePanel } from './CanvasNodePanel'
import { CanvasConnector } from './CanvasConnector'
import { EdgeLayer } from './EdgeLayer'
import { MarqueeOverlay } from './MarqueeOverlay'
import { NodeShell } from './NodeShell'
import {
  collectContentMountPinIds,
  contentLayerStyle,
  contentPresentationStyle,
  shouldMountNodeContent,
  visibleWorldRect,
} from './content-visibility'

export interface CanvasViewportProps {
  /** 内容抬升：为每个节点渲染重内容，不进 world scale */
  children?: (node: NodeSpec) => ReactNode | null
  contentMap?: Record<string, ReactNode>
  className?: string
}

export function CanvasContentOverlay({
  renderNode,
  groups = false,
}: {
  renderNode: (node: NodeSpec) => ReactNode | null
  groups?: boolean
}) {
  const { nodes, viewport, containerSize, selection, connecting, resizing, draggingNodeIds, hoveredNodeId, setHoveredNode, focusedNodeId, setFocusedNodeId } = useCanvas()
  const runs = useRuntimeStore((state) => state.runs)
  const sessions = useRuntimeStore((state) => state.sessions)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const overlayInsets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth })
  const visibleWorld = visibleWorldRect(viewport, containerSize, undefined, overlayInsets)
  const frontZ = nodeFrontOrder(nodes)
  const pinnedIds = collectContentMountPinIds(nodes, {
    selection: [...selection, ...draggingNodeIds, ...(focusedNodeId ? [focusedNodeId] : [])],
    resizingNodeId: resizing?.nodeId,
    connectingSourceId: connecting?.sourceId,
    runs,
    sessions,
    inflightAINodeIds: nodes.filter((node) => node.kind === 'ai' && isAINodeSendInflight(node.id)).map((node) => node.id),
  })

  return (
    <div
      data-canvas-content-layer={groups ? 'groups' : 'nodes'}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: groups ? 5 : 15 }}
    >
      {nodes.filter((node) => (node.kind === 'group') === groups).map((node) => {
        const content = shouldMountNodeContent(node, visibleWorld, pinnedIds) ? renderNode(node) : null
        const style = contentLayerStyle(node, viewport)
        return (
          <div
            key={node.id}
            data-canvas-node-stack={node.id}
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: nodeStackOrder(node, frontZ, { hoveredNodeId, focusedNodeId, resizingNodeId: resizing?.nodeId, draggingNodeIds }) }}
            onFocusCapture={() => setFocusedNodeId(node.id)}
            onBlurCapture={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                if (focusedNodeId === node.id) setFocusedNodeId(null)
              }
            }}
          >
            <WorldLayer className="z-[1]">
              <NodeShell node={node} />
            </WorldLayer>
            {content ? (
              <div
                data-content-node={node.id}
                data-canvas-content="true"
                className="pointer-events-auto absolute overflow-visible"
                style={{ ...style, zIndex: 'var(--canvas-content-order, 0)' }}
                onPointerEnter={() => setHoveredNode(node.id)}
                onPointerLeave={(event) => {
                  const related = event.relatedTarget
                  const staysOnNode = related instanceof Element && (
                    Boolean(related.closest(`[data-node-id="${node.id}"]`))
                    || Boolean(related.closest(`[data-content-node="${node.id}"]`))
                  )
                  if (!staysOnNode) setHoveredNode(null)
                }}
              >
                <div data-canvas-content-presentation={node.kind} style={contentPresentationStyle(node, viewport)}>
                  {content}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function WorldLayer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { viewport } = useCanvas()
  return (
    <div
      className={['absolute left-0 top-0', className].filter(Boolean).join(' ')}
      style={{
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        transformOrigin: '0 0',
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  )
}

function CanvasWorld() {
  return (
    <>
      <div data-canvas-edge-layer="true" className="pointer-events-none absolute inset-0 z-10">
        <EdgeLayer />
      </div>
    </>
  )
}

function GroupSelectionBar() {
  const { nodes, selection, worldToScreen, containerSize, draggingNodeIds, resizing } = useCanvas()
  const isLocked = useGraphStore((state) => state.isLocked)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const members = nodes.filter((node) => selection.includes(node.id) && node.kind !== 'group')
  if (members.length < 2 || draggingNodeIds.length > 0 || resizing) return null
  const first = members[0]
  if (!first) return null
  const bounds = members.slice(1).reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
  const anchor = worldToScreen({ x: bounds.x, y: bounds.y })
  const end = worldToScreen({ x: bounds.x + bounds.width, y: bounds.y })
  const horizontal = nodeToolbarHorizontalPlacement(anchor.x, end.x, 200, containerSize.width, canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth }))
  return (
    <div
      data-canvas-chrome="true"
      data-selection-toolbar="true"
      role="toolbar"
      aria-label="多选节点操作"
      className="cnote-toolbar-surface pointer-events-auto absolute z-40 flex h-10 items-center overflow-x-auto rounded-full text-xs"
      style={{ left: horizontal.left, top: selectionToolbarTop(anchor.y, containerSize.height), width: 200, maxWidth: horizontal.maxWidth }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="whitespace-nowrap px-3 font-medium text-muted-foreground">已选择 {members.length} 个</span>
      <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
      <button
        type="button"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        disabled={isLocked}
        title="编组"
        aria-label="编组"
        onClick={() => useGraphStore.getState().groupSelected()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Layers3 className="h-3.5 w-3.5" />
        编组
      </button>
    </div>
  )
}

export function CanvasViewport({ children, contentMap, className }: CanvasViewportProps) {
  const renderNode =
    children ?? ((node: NodeSpec) => (contentMap ? (contentMap[node.id] ?? null) : null))

  return (
    <CanvasProvider className={className}>
      <CanvasWorld />
      <CanvasContentOverlay renderNode={renderNode} groups />
      <CanvasContentOverlay renderNode={renderNode} />
      {/* z-20：内容(15)之上、marquee(30)/控件(40)之下；pointer-events-none 不挡手势 */}
      <CanvasConnector />
      <MarqueeOverlay />
      <GroupSelectionBar />
      <CanvasControls />
      <CanvasNodePanel />
      <CanvasExtensionPanel />
      <CanvasMinimap />
    </CanvasProvider>
  )
}

export default CanvasViewport
