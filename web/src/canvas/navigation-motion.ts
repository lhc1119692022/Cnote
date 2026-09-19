import type { Viewport } from '@/domain'

export function interpolateViewport(start: Viewport, target: Viewport, progress: number): Viewport {
  const bounded = Math.max(0, Math.min(1, progress))
  const amount = 1 - (1 - bounded) ** 3
  return {
    x: start.x + (target.x - start.x) * amount,
    y: start.y + (target.y - start.y) * amount,
    zoom: start.zoom + (target.zoom - start.zoom) * amount,
  }
}
