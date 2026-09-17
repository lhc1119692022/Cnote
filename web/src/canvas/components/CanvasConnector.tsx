/**
 * 连线预览：屏幕层 SVG，source 右中点 → 指针世界坐标。
 * 用 edgePathPoints 画三次贝塞尔，与正式边几何一致。
 */

import { edgePathPoints, nodeRect } from '@/canvas'
import { useCanvas } from './CanvasProvider'

export function CanvasConnector() {
  const { connecting, nodeById, worldToScreen } = useCanvas()
  if (!connecting) return null

  const source = nodeById(connecting.sourceId)
  if (!source) return null

  const pts = edgePathPoints(nodeRect(source), {
    x: connecting.current.x,
    y: connecting.current.y,
    width: 0,
    height: 0,
  })
  const start = worldToScreen(pts.source)
  const controlA = worldToScreen(pts.controlA)
  const controlB = worldToScreen(pts.controlB)
  const end = worldToScreen(pts.target)
  const d = `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`

  return (
    <svg
      data-canvas-chrome="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-visible"
      width="100%"
      height="100%"
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
    </svg>
  )
}
