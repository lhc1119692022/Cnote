/**
 * 轻量节点壳：只负责定位、选中态、拖拽命中。
 * 不渲染 webview / iframe / 富文本 / 媒体 / 编辑器。
 *
 * 层级：壳 z-30 > 内容 z-15 > 边 z-10。壳整体透明，让下方内容透出；
 * 仅 header、边框热区与左右连接点 pointer-events-auto，内部点击穿透到内容层。
 *
 * 对齐不变式：本组件绝对定位在 WorldLayer（有 scale），
 * width = node.size.width、height = node.size.height，与内容层盒子
 * （size * zoom，只平移）共用同一节点原点，必须保持一致。
 */

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Globe, Layers3, Sparkles, StickyNote } from 'lucide-react'
import type { NodeKind, NodeSpec } from '@/domain'
import { useCanvas } from './CanvasProvider'

const KIND_ICONS: Record<NodeKind, LucideIcon> = {
  content: Layers3,
  ai: Sparkles,
  request: Sparkles,
  browser: Globe,
  sticky: StickyNote,
  group: Layers3,
}

const KIND_ICON_CLASS: Record<NodeKind, string> = {
  content: 'text-blue-500',
  ai: 'text-violet-500',
  request: 'text-primary',
  browser: 'text-cyan-600',
  sticky: 'text-amber-500',
  group: 'text-muted-foreground',
}

/** 边框拖拽热区宽度（世界像素）；内部留给内容层命中 */
const BORDER_HIT = 8

export function NodeShell({ node }: { node: NodeSpec }) {
  const { selection, getPointerInput, pointerDown, beginConnect, updateConnect, containerRef } =
    useCanvas()
  const selected = selection.includes(node.id)
  const Icon = KIND_ICONS[node.kind]

  const onNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.stopPropagation()
    event.preventDefault()
    // 节点拖拽入口：stopPropagation + 在画布根上 capture，后续 move/up 由 CanvasProvider 收。
    // CanvasProvider 根节点不再对已命中节点的按下做二次 hitTest / capture。
    containerRef.current?.setPointerCapture(event.pointerId)
    pointerDown(getPointerInput(event), node.id)
  }

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, side: 'source' | 'target') => {
    event.stopPropagation()
    event.preventDefault()
    if (event.button !== 0 || side !== 'source') return
    // 连线入口：capture 到画布根，move/up 由 CanvasProvider 的 connecting 分支收
    containerRef.current?.setPointerCapture(event.pointerId)
    beginConnect(node.id)
    updateConnect(getPointerInput(event).screen)
  }

  return (
    <div
      data-node-id={node.id}
      data-node-kind={node.kind}
      className={[
        'absolute box-border rounded-xl border bg-transparent pointer-events-none',
        selected ? 'shadow-[0_0_0_1px_var(--primary)]' : '',
        node.disabled ? 'opacity-50' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        zIndex: node.z ?? 0,
        borderColor: selected ? 'var(--primary)' : 'var(--border)',
      }}
      onPointerDown={onNodePointerDown}
    >
      <div className="pointer-events-auto flex h-9 cursor-grab items-center gap-1.5 border-b border-border bg-background/90 px-2.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${KIND_ICON_CLASS[node.kind]}`} aria-hidden />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {node.label || node.kind}
        </span>
      </div>
      <div
        className="pointer-events-auto absolute bottom-0 left-0 top-9 cursor-grab"
        style={{ width: BORDER_HIT }}
        aria-hidden
      />
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-9 cursor-grab"
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
        className="pointer-events-auto absolute z-10 flex h-3 w-3 items-center justify-center"
        style={{ left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
        onPointerDown={(event) => onHandlePointerDown(event, 'target')}
      >
        <span className="h-2.5 w-2.5 rounded-full border border-border bg-background" />
      </div>
      <div
        data-canvas-handle="source"
        title="输出连接点"
        aria-label="输出连接点"
        className="pointer-events-auto absolute z-10 flex h-3 w-3 cursor-crosshair items-center justify-center"
        style={{ right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
        onPointerDown={(event) => onHandlePointerDown(event, 'source')}
      >
        <span className="h-2.5 w-2.5 rounded-full border border-border bg-background" />
      </div>
    </div>
  )
}
