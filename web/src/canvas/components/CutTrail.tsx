import { useCutEdges } from '@/canvas/cut-edges'

export function CutTrail() {
  const points = useCutEdges((state) => state.points)
  if (!points.length) return null
  return <svg data-cut-trail aria-hidden className="pointer-events-none absolute inset-0 z-[100] h-full w-full overflow-visible"><polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#e11d48" strokeWidth="2" strokeDasharray="8 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
