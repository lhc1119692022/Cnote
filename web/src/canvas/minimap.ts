/** Shared, render-free minimap decisions used by the canvas and regression checks. */

import type { Size, Viewport } from '@/domain'
import type { CanvasOverlayInsets } from './overlay-insets'
import { clampZoom } from './viewport'

export function minimapVisibleWorld(viewport: Viewport, size: Size, insets: CanvasOverlayInsets) {
  const zoom = clampZoom(viewport.zoom)
  const left = Math.min(Math.max(0, insets.left), Math.max(0, size.width))
  const right = Math.min(Math.max(0, insets.right), Math.max(0, size.width - left))
  return {
    x: (left - viewport.x) / zoom,
    y: -viewport.y / zoom,
    width: Math.max(0, size.width - left - right) / zoom,
    height: Math.max(0, size.height) / zoom,
  }
}

export function minimapWorldBounds(contentBounds: { x: number; y: number; width: number; height: number } | null, visibleWorld: { x: number; y: number; width: number; height: number }, mapSize: Size) {
  const source = contentBounds || visibleWorld
  const width = Number.isFinite(source.width) && source.width > 0 ? source.width : 1
  const height = Number.isFinite(source.height) && source.height > 0 ? source.height : 1
  const centerX = (Number.isFinite(source.x) ? source.x : 0) + width / 2
  const centerY = (Number.isFinite(source.y) ? source.y : 0) + height / 2
  const scale = Math.min(mapSize.width / Math.max(2400, width + 640), mapSize.height / Math.max(1600, height + 480))
  const worldWidth = mapSize.width / scale
  const worldHeight = mapSize.height / scale
  return { scale, bounds: { x: centerX - worldWidth / 2, y: centerY - worldHeight / 2, width: worldWidth, height: worldHeight } }
}

export function minimapColor(kind: string, disabled: boolean, selected: boolean): string {
  if (disabled) return 'color-mix(in srgb, var(--muted-foreground) 28%, transparent)'
  if (selected) return 'var(--primary)'
  switch (kind) {
    case 'ai':
      return 'color-mix(in srgb, #8b5cf6 70%, var(--card))'
    case 'request':
      return 'color-mix(in srgb, #0ea5e9 70%, var(--card))'
    case 'browser':
      return 'color-mix(in srgb, #06b6d4 70%, var(--card))'
    case 'content':
      return 'color-mix(in srgb, #3b82f6 70%, var(--card))'
    case 'sticky':
      return 'color-mix(in srgb, #f59e0b 70%, var(--card))'
    case 'group':
      return 'color-mix(in srgb, #64748b 54%, var(--card))'
    default:
      return 'var(--muted-foreground)'
  }
}
