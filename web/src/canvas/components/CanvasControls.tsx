/**
 * 画布控件：放大 / 缩小 / 适配 / 锁定。图标 + tooltip，胶囊条。
 */

import type { ReactNode } from 'react'
import { Lock, Maximize, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { fitBounds, nodeRect, unionRect } from '@/canvas'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvas } from './CanvasProvider'

export function CanvasControls() {
  const { viewport, nodes, containerSize, zoomAtCursor, setViewport } = useCanvas()
  const isLocked = useGraphStore((state) => state.isLocked)
  const toggleLock = useGraphStore((state) => state.toggleLock)

  const screenCenter = {
    x: containerSize.width / 2,
    y: containerSize.height / 2,
  }

  const handleFit = () => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 })
      return
    }
    const first = nodes[0]
    if (!first) return
    const bounds = nodes.reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
    setViewport(fitBounds(bounds, containerSize, 40))
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-6 left-6 z-40"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="cnote-toolbar-surface flex items-center gap-0.5 px-1.5 py-1"
        role="toolbar"
        aria-label="画布视图控制"
      >
        <ControlButton
          label="放大"
          onClick={() => zoomAtCursor(1.25, screenCenter)}
        >
          <ZoomIn className="h-4 w-4" />
        </ControlButton>
        <ControlButton
          label="缩小"
          onClick={() => zoomAtCursor(0.8, screenCenter)}
        >
          <ZoomOut className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="适配全部节点" onClick={handleFit}>
          <Maximize className="h-4 w-4" />
        </ControlButton>
        <ControlButton
          label={isLocked ? '解锁画布' : '锁定画布'}
          pressed={isLocked}
          onClick={toggleLock}
        >
          {isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </ControlButton>
        <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
          {Math.round(viewport.zoom * 100)}%
        </span>
      </div>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
