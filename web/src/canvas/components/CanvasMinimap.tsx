/**
 * 小地图：使用稳定的世界范围展示节点与当前视口，避免少量节点占满地图。
 * 点击地图区域把视口中心定位到对应世界坐标，保留当前 zoom。
 */

import { useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import { nodeRect, unionRect } from '@/canvas'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { minimapColor, minimapVisibleWorld, minimapWorldBounds } from '@/canvas/minimap'
import { useUiStore } from '@/stores/ui-store'
import { useCanvas } from './CanvasProvider'

const MAP_WIDTH = 280
const MAP_HEIGHT = 180
const MAP_PAD = 4

/** 世界矩形 → 小地图 CSS 盒。先减 bounds，再乘 scale，再加 MAP_PAD。 */
function toMapRect(
  worldX: number,
  worldY: number,
  worldW: number,
  worldH: number,
  bounds: { x: number; y: number },
  scale: number,
) {
  return {
    left: MAP_PAD + (worldX - bounds.x) * scale,
    top: MAP_PAD + (worldY - bounds.y) * scale,
    width: worldW * scale,
    height: worldH * scale,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

export function CanvasMinimap() {
  const showMinimap = useUiStore((state) => state.showMinimap)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const { nodes, viewport, containerSize, centerOnWorld, selection } = useCanvas()

  const bounds = useMemo(() => {
    const first = nodes[0]
    return first
      ? nodes.reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
      : { x: 0, y: 0, width: 1, height: 1 }
  }, [nodes])
  const selectedIds = useMemo(() => new Set(selection), [selection])
  const insets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth })

  if (!showMinimap) return null
  const visibleWorld = minimapVisibleWorld(viewport, containerSize, insets)
  const { bounds: safeBounds, scale } = minimapWorldBounds(nodes.length ? bounds : null, visibleWorld, { width: MAP_WIDTH - MAP_PAD * 2, height: MAP_HEIGHT - MAP_PAD * 2 })
  const rawViewRect = toMapRect(visibleWorld.x, visibleWorld.y, visibleWorld.width, visibleWorld.height, safeBounds, scale)
  const viewLeft = clamp(rawViewRect.left, MAP_PAD, MAP_WIDTH - MAP_PAD)
  const viewTop = clamp(rawViewRect.top, MAP_PAD, MAP_HEIGHT - MAP_PAD)
  const viewRight = clamp(rawViewRect.left + rawViewRect.width, MAP_PAD, MAP_WIDTH - MAP_PAD)
  const viewBottom = clamp(rawViewRect.top + rawViewRect.height, MAP_PAD, MAP_HEIGHT - MAP_PAD)
  const viewRect = {
    left: viewLeft,
    top: viewTop,
    width: Math.max(0, viewRight - viewLeft),
    height: Math.max(0, viewBottom - viewTop),
  }

  const locateFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!Number.isFinite(scale) || scale <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const mx = clamp(event.clientX - rect.left - event.currentTarget.clientLeft, MAP_PAD, MAP_WIDTH - MAP_PAD)
    const my = clamp(event.clientY - rect.top - event.currentTarget.clientTop, MAP_PAD, MAP_HEIGHT - MAP_PAD)
    centerOnWorld({
      x: safeBounds.x + (mx - MAP_PAD) / scale,
      y: safeBounds.y + (my - MAP_PAD) / scale,
    })
  }

  return (
    <div
      data-canvas-chrome="true"
      className="pointer-events-auto absolute bottom-6 z-40 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      style={{
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        right: 24 + insets.right,
      }}
      aria-label="画布小地图"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        locateFromEvent(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        locateFromEvent(event)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onWheel={(event) => {
        // The minimap is a navigation surface; its wheel must never zoom the canvas.
        event.stopPropagation()
      }}
    >
      {nodes.map((node) => {
        const box = toMapRect(
          node.position.x,
          node.position.y,
          node.size.width,
          node.size.height,
          safeBounds,
          scale,
        )
        return (
          <div
            key={node.id}
            data-minimap-node={node.id}
            data-node-kind={node.kind}
            className="absolute rounded-sm"
            style={{
              ...box,
              width: Math.max(box.width, 2),
              height: Math.max(box.height, 2),
              background: minimapColor(node.kind, Boolean(node.disabled), selectedIds.has(node.id)),
            }}
          />
        )
      })}
      {containerSize.width > 0 && containerSize.height > 0 ? (
        <div
          className="absolute box-border rounded-sm"
          style={{
            ...viewRect,
            border: '1px solid var(--primary)',
            background: 'color-mix(in oklab, var(--primary) 12%, transparent)',
          }}
        />
      ) : null}
    </div>
  )
}
