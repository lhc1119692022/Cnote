/**
 * 轻量节点壳：只负责定位、选中态、拖拽命中。
 * 不渲染 webview / iframe / 富文本 / 媒体 / 编辑器。
 *
 * 层级：节点内部壳 z-1 > 内容 z-0，共享节点层叠容器。壳整体透明，让下方内容透出；
 * 仅顶部拖拽带、边框热区与左右连接点 pointer-events-auto，内部点击穿透到内容层。
 *
 * 对齐不变式：本组件绝对定位在 WorldLayer（有 scale），
 * width = node.size.width、height = node.size.height，与内容层盒子
 * （size * zoom，只平移）共用同一节点原点，必须保持一致。
 */

import { memo, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus } from 'lucide-react'
import type { NodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvasInteraction } from './CanvasProvider'
import { NodeHoverToolbar } from './NodeHoverToolbar'

/** 边框拖拽热区宽度（世界像素）；内部留给内容层命中 */
const BORDER_HIT = 8

export const NodeShell = memo(function NodeShell({ node }: { node: NodeSpec }) {
  const {
    containerRef,
    selection,
    getPointerInput,
    updateConnect,
    beginConnect,
    beginResize,
    beginNodeDrag,
    setHoveredNode,
    hoveredNodeId,
    connectingTargetId,
    resizing,
  } = useCanvasInteraction()
  const isLocked = useGraphStore((state) => state.isLocked)
  const selected = selection.includes(node.id)
  const resizingThis = resizing?.nodeId === node.id
  const hovered = hoveredNodeId === node.id
  const expandedBatch = node.kind === 'content' && node.generationBatch?.expanded === true

  const keepNodeHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    const related = event.relatedTarget
    return related instanceof Element && (
      Boolean(related.closest(`[data-node-id="${node.id}"]`))
      || Boolean(related.closest(`[data-content-node="${node.id}"]`))
    )
  }

  const onNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    beginNodeDrag(event, node.id)
  }

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    if (event.button !== 0 || isLocked) return
    containerRef.current?.setPointerCapture(event.pointerId)
    beginResize(node.id, getPointerInput(event).screen)
  }

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, side: 'source' | 'target') => {
    event.stopPropagation()
    event.preventDefault()
    if (event.button !== 0 || side !== 'source') return
    containerRef.current?.setPointerCapture(event.pointerId)
    beginConnect(node.id)
    updateConnect(getPointerInput(event).screen)
  }

  return (
    <div
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-node-hovered={hovered ? 'true' : 'false'}
      data-node-selected={selected ? 'true' : 'false'}
      data-node-connection-target={connectingTargetId === node.id ? 'valid' : connectingTargetId === `invalid:${node.id}` ? 'invalid' : undefined}
      className={[
        'group absolute box-border rounded-[24px] border bg-transparent pointer-events-none [&:hover_.node-resize-arc]:opacity-100',
        selected && !expandedBatch ? 'shadow-[0_0_0_1px_var(--primary)]' : '',
        hovered && !selected && !expandedBatch ? 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent)]' : '',
        node.disabled ? 'opacity-50' : '',
        node.kind === 'group' || expandedBatch ? 'border-0 shadow-none' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        zIndex: node.z ?? 0,
        borderColor: node.kind === 'group' || expandedBatch ? 'transparent' : selected ? 'var(--primary)' : 'var(--border)',
      }}
      onPointerDown={onNodePointerDown}
      onPointerEnter={() => setHoveredNode(node.id)}
      onPointerLeave={(event) => {
        if (!keepNodeHover(event)) setHoveredNode(null)
      }}
    >
      <NodeHoverToolbar node={node} selected={selected} />
      <div
        className="pointer-events-auto absolute left-2 right-2 top-0 cursor-grab"
        style={{ height: BORDER_HIT }}
        aria-hidden
      />
      <div
        className="pointer-events-auto absolute bottom-0 left-0 top-0 cursor-grab"
        style={{ width: BORDER_HIT }}
        aria-hidden
      />
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-0 cursor-grab"
        style={{ width: BORDER_HIT }}
        aria-hidden
      />
      <div
        className="pointer-events-auto absolute bottom-0 left-0 w-full cursor-grab"
        style={{ height: BORDER_HIT }}
        aria-hidden
      />
      <div
        data-canvas-handle="target"
        title="输入连接点"
        aria-label="输入连接点"
        className="node-connection-handle pointer-events-auto absolute"
        onPointerDown={(event) => onHandlePointerDown(event, 'target')}
      >
        <span className="node-connection-handle-surface">
          <Plus className="h-5 w-5 stroke-[1.6]" />
        </span>
      </div>
      <div
        data-canvas-handle="source"
        title="输出连接点"
        aria-label="输出连接点"
        className="node-connection-handle pointer-events-auto absolute"
        onPointerDown={(event) => onHandlePointerDown(event, 'source')}
      >
        <span className="node-connection-handle-surface">
          <Plus className="h-5 w-5 stroke-[1.6]" />
        </span>
      </div>
      {isLocked ? null : (
        <div
          className={['node-resize-arc', selected || resizingThis ? 'is-resizing' : '']
            .filter(Boolean)
            .join(' ')}
          aria-label="调整节点大小"
          title="调整节点大小"
          onPointerDown={onResizePointerDown}
        >
          <svg viewBox="0 0 44 44" aria-hidden="true">
            <path d="M 8 36 C 27 36, 36 27, 36 8" />
          </svg>
        </div>
      )}
    </div>
  )
})
