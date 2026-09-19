import type { Viewport } from '@/domain'

export function canvasDotPattern(view: Viewport) {
  const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1
  const spacing = 60 * zoom
  const radius = 2 * zoom
  const offset = (value: number) => Number.isFinite(value) ? ((value % spacing) + spacing) % spacing : 0
  return {
    backgroundImage: spacing < 20 ? 'none' : `radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 32%, transparent) ${radius}px, transparent ${radius}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offset(view.x)}px ${offset(view.y)}px`,
  }
}
