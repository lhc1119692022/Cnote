import type { CanvasOverlayInsets } from './overlay-insets'
import { clampZoom } from './viewport'

export function nodeToolbarScaleStyle(zoom: number, placement: 'top' | 'bottom') {
  return {
    transformOrigin: '0 0',
    transition: 'opacity 140ms ease',
    transform: `scale(${1 / clampZoom(zoom)}) translateY(${placement === 'top' ? '-100%' : '0'})`,
  }
}

export function nodeToolbarHorizontalPlacement(
  nodeLeft: number,
  nodeRight: number,
  toolbarWidth: number,
  viewportWidth: number,
  insets: CanvasOverlayInsets,
) {
  const left = insets.left + 80
  const right = Math.max(left + 1, viewportWidth - insets.right - 8)
  const maxWidth = right - left
  const width = Math.min(toolbarWidth, maxWidth)
  const centered = (nodeLeft + nodeRight - width) / 2
  return { left: Math.max(left, Math.min(right - width, centered)), maxWidth }
}

export function selectionToolbarTop(selectionTop: number, viewportHeight: number) {
  return Math.max(72, Math.min(viewportHeight - 104, selectionTop - 100))
}

export function nodeToolbarPlacement(nodeTop: number, nodeBottom: number, toolbarHeight: number, viewportHeight: number, safeTop = 72) {
  const lastTop = Math.max(safeTop, viewportHeight - 8 - toolbarHeight)
  const placement: 'top' | 'bottom' = nodeTop - toolbarHeight >= safeTop ? 'top' : 'bottom'
  const preferredTop = placement === 'top' ? nodeTop - toolbarHeight : nodeBottom
  const top = Math.max(safeTop, Math.min(lastTop, preferredTop))
  return { placement, anchor: placement === 'top' ? top + toolbarHeight : top }
}
