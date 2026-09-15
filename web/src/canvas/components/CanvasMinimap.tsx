/**
 * 简单小地图：节点 bounds 等比缩放到 160×100，展示节点与当前视口。
 * 点击跳转（setCenter）暂不实现，仅展示。
 */

import { nodeRect, unionRect } from '@/canvas'
import { useUiStore } from '@/stores/ui-store'
import { useCanvas } from './CanvasProvider'

const MAP_WIDTH = 160
const MAP_HEIGHT = 100
const MAP_PAD = 8

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

export function CanvasMinimap() {
  const showMinimap = useUiStore((state) => state.showMinimap)
  const { nodes, viewport, containerSize } = useCanvas()

  if (!showMinimap) return null

  const first = nodes[0]
  const bounds = first
    ? nodes.reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
    : { x: 0, y: 0, width: 1, height: 1 }

  const innerW = MAP_WIDTH - MAP_PAD * 2
  const innerH = MAP_HEIGHT - MAP_PAD * 2
  const scale = Math.min(
    innerW / Math.max(bounds.width, 1),
    innerH / Math.max(bounds.height, 1),
  )

  const zoom = viewport.zoom === 0 ? 1 : viewport.zoom
  const worldX = -viewport.x / zoom
  const worldY = -viewport.y / zoom
  const worldW = containerSize.width / zoom
  const worldH = containerSize.height / zoom
  const viewRect = toMapRect(worldX, worldY, worldW, worldH, bounds, scale)

  return (
    <div
      className="pointer-events-auto absolute bottom-6 right-6 z-40 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
      aria-label="画布小地图"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {nodes.map((node) => {
        const box = toMapRect(
          node.position.x,
          node.position.y,
          node.size.width,
          node.size.height,
          bounds,
          scale,
        )
        return (
          <div
            key={node.id}
            className="absolute rounded-sm bg-muted-foreground/35"
            style={{
              ...box,
              width: Math.max(box.width, 2),
              height: Math.max(box.height, 2),
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
