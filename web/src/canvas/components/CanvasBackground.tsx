import { canvasDotPattern } from '@/canvas/background'
import { useCanvasViewportStore } from '@/stores/canvas-viewport-store'

export function CanvasBackground() {
  const view = useCanvasViewportStore(state => state.view)
  return <div aria-hidden className="pointer-events-none absolute inset-0" style={canvasDotPattern(view)} />
}
