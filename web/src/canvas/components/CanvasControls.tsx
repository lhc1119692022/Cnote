/**
 * 画布控件：放大 / 缩小 / 适配 / 锁定。图标 + tooltip，胶囊条。
 */

import type { ReactNode } from 'react'
import { LayoutGrid, LocateFixed, Lock, Map, Moon, Redo2, Sun, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { arrangeDocumentNodes } from '@/canvas/node-factory'
import { CANVAS_CONTROLS_OCCUPIED_WIDTH, canvasOverlayInsets } from '@/canvas/overlay-insets'
import { fitBounds, nodeRect, unionRect, visibleScreenCenter } from '@/canvas'
import { useTheme } from '@/hooks/use-theme'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { useCanvas } from './CanvasProvider'

export function CanvasControls() {
  const { viewport, nodes, containerSize, zoomAtCursor, setViewport } = useCanvas()
  const canUndo = useGraphStore((state) => state.canUndo())
  const canRedo = useGraphStore((state) => state.canRedo())
  const isLocked = useGraphStore((state) => state.isLocked)
  const showMinimap = useUiStore((state) => state.showMinimap)
  const toggleMinimap = useUiStore((state) => state.toggleMinimap)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const { theme, toggleTheme } = useTheme()
  const overlayInsets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth })
  const screenCenter = visibleScreenCenter(containerSize, overlayInsets)

  const handleFit = () => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 })
      return
    }
    const first = nodes[0]
    if (!first) return
    const bounds = nodes.reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
    setViewport(fitBounds(bounds, containerSize, {
      left: overlayInsets.left + CANVAS_CONTROLS_OCCUPIED_WIDTH + 40,
      right: overlayInsets.right + 40,
      top: 40,
      bottom: 40,
    }))
  }

  return (
    <div
      data-canvas-chrome="true"
      className="pointer-events-auto absolute bottom-6 z-40 transition-[left]"
      style={{ left: overlayInsets.left + 24 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex w-12 flex-col items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-lg"
        role="toolbar"
        aria-label="画布视图控制"
      >
        <ControlButton label="撤销" disabled={!canUndo} onClick={() => useGraphStore.getState().undo()}>
          <Undo2 className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="重做" disabled={!canRedo} onClick={() => useGraphStore.getState().redo()}>
          <Redo2 className="h-4 w-4" />
        </ControlButton>
        <div className="my-1 h-px w-7 bg-border" aria-hidden />
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
        <ControlButton label="聚焦节点 / 适应视图" onClick={handleFit}>
          <LocateFixed className="h-4 w-4" />
        </ControlButton>
        <div className="my-1 h-px w-7 bg-border" aria-hidden />
        <ControlButton
          label={showMinimap ? '隐藏小地图' : '显示小地图'}
          pressed={showMinimap}
          onClick={toggleMinimap}
        >
          <Map className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="整理节点" disabled={isLocked} onClick={arrangeDocumentNodes}>
          <LayoutGrid className="h-4 w-4" />
        </ControlButton>
        <ControlButton label={isLocked ? '解锁画布' : '锁定画布'} pressed={isLocked} onClick={() => useGraphStore.getState().toggleLock()}>
          {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" /> }
        </ControlButton>
        <div className="my-1 h-px w-7 bg-border" aria-hidden />
        <ControlButton label="切换主题" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
