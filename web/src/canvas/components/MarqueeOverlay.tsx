/**
 * 框选矩形：世界坐标 → 屏幕矩形。无 marquee 时不渲染。
 */

import { rectFromPoints, worldRectToScreen } from '@/canvas'
import { useCanvas } from './CanvasProvider'

export function MarqueeOverlay() {
  const { marquee, viewport } = useCanvas()
  if (!marquee) return null

  const rect = worldRectToScreen(rectFromPoints(marquee.start, marquee.current), viewport)
  if (rect.width < 1 && rect.height < 1) return null

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: '1px solid var(--primary)',
        background: 'rgba(59,109,255,0.08)',
      }}
      aria-hidden
    />
  )
}
