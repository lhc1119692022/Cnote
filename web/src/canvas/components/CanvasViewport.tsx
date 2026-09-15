/**
 * 画布组装：world 层（壳 + 边，参与 scale）与屏幕层（内容抬升 / 框选 / 控件）。
 *
 * 内容层只平移、不缩放 DOM；缩放只发生在 world 层的壳/边。
 * 重内容（webview / iframe / 富文本）永远不进入 world 层的 scale transform。
 *
 * 层级（壳 > 内容 > 边）：
 * - 边：WorldLayer z-10；显示 SVG pointer-events:none，命中 SVG 仅 stroke 可点（点边即删）
 * - 连线预览：屏幕层 CanvasConnector z-20，内容之上、marquee/控件之下
 * - 内容抬升：z-15，边之上、壳之下
 * - 壳：WorldLayer z-30；透明背景让内容透出，header / 边框 / 连接点作为交互区
 *
 * 对齐不变式：壳在世界层（有 scale），width = node.size.width、height = node.size.height；
 * 内容层盒子是 size * zoom 且只平移。二者与同一节点原点对齐，不在此打破。
 */

import type { ReactNode } from 'react'
import type { NodeSpec } from '@/domain'
import { worldToScreen } from '@/canvas'
import { CanvasProvider, useCanvas } from './CanvasProvider'
import { CanvasControls } from './CanvasControls'
import { CanvasMinimap } from './CanvasMinimap'
import { CanvasConnector } from './CanvasConnector'
import { EdgeLayer } from './EdgeLayer'
import { MarqueeOverlay } from './MarqueeOverlay'
import { NodeShell } from './NodeShell'

export interface CanvasViewportProps {
  /** 内容抬升：为每个节点渲染重内容，不进 world scale */
  children?: (node: NodeSpec) => ReactNode | null
  contentMap?: Record<string, ReactNode>
  className?: string
}

export function CanvasContentOverlay({
  renderNode,
}: {
  renderNode: (node: NodeSpec) => ReactNode | null
}) {
  const { nodes, viewport } = useCanvas()

  return (
    // z-15：边(10)之上、壳(30)之下。壳与内容必须精确对齐（见文件头不变式）。
    <div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
      {nodes.map((node) => {
        const content = renderNode(node)
        if (!content) return null
        const origin = worldToScreen(node.position, viewport)
        const width = node.size.width * viewport.zoom
        const height = node.size.height * viewport.zoom
        return (
          <div
            key={node.id}
            data-content-node={node.id}
            className="pointer-events-auto absolute overflow-hidden"
            style={{
              // 只平移到屏幕位置，不用 scale()，避免重内容进 transform 树
              transform: `translate(${origin.x}px, ${origin.y}px)`,
              transformOrigin: '0 0',
              width,
              height,
              zIndex: node.z ?? 0,
            }}
          >
            {content}
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
  const { nodes } = useCanvas()
  return (
    <>
      {/* 边 z-10：视觉在内容与壳之下。不设 pointer-events-none，避免命中 SVG 继承 none */}
      <WorldLayer className="z-10">
        <EdgeLayer />
      </WorldLayer>
      {/*
        壳 z-30 > 内容 z-15 > 边 z-10。
        边必须单独一层：若与壳同处 z-30，SVG 会画在内容之上。
        壳与内容对齐不变式：壳有 scale、用世界尺寸；内容层 size*zoom 只平移。
      */}
      <WorldLayer className="z-30">
        {nodes.map((node) => (
          <NodeShell key={node.id} node={node} />
        ))}
      </WorldLayer>
    </>
  )
}

export function CanvasViewport({ children, contentMap, className }: CanvasViewportProps) {
  const renderNode =
    children ?? ((node: NodeSpec) => (contentMap ? (contentMap[node.id] ?? null) : null))

  return (
    <CanvasProvider className={className}>
      <CanvasWorld />
      <CanvasContentOverlay renderNode={renderNode} />
      {/* z-20：内容(15)之上、marquee(30)/控件(40)之下；pointer-events-none 不挡手势 */}
      <CanvasConnector />
      <MarqueeOverlay />
      <CanvasControls />
      <CanvasMinimap />
    </CanvasProvider>
  )
}

export default CanvasViewport
