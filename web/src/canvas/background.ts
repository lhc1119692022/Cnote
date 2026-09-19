import type { Viewport } from '@/domain'

export function canvasDotPattern(view: Viewport) {
  const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1
  const factor = Math.max(0, Math.ceil(Math.log2(12 / (24 * zoom))))
  const spacing = 24 * 2 ** factor * zoom
  const offset = (value: number) => Number.isFinite(value) ? ((value % spacing) + spacing) % spacing : 0
  return {
    backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 32%, transparent) 1px, transparent 1px)',
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offset(view.x)}px ${offset(view.y)}px`,
  }
}
