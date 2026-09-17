/**
 * Canvas viewport + coordinate transforms (pure functions, no DOM).
 *
 * Viewport { x, y, zoom } 语义：
 * - x / y：屏幕原点对应的世界偏移，等价于世界坐标原点在屏幕上的位置。
 * - zoom：世界 → 屏幕的均匀缩放。
 * 正向：screen = world * zoom + (viewport.x, viewport.y)
 * 逆向：world = (screen - (viewport.x, viewport.y)) / zoom
 */

import type { Point, Rect, Size, Viewport } from '@/domain'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** Normalize WheelEvent deltas without turning trackpad input into fixed steps. */
export function wheelDeltaToPixels(deltaY: number, deltaMode = 0, viewportHeight = 800): number {
  if (!Number.isFinite(deltaY)) return 0
  if (deltaMode === 1) return deltaY * 16
  if (deltaMode === 2) return deltaY * Math.max(1, viewportHeight)
  return deltaY
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  const zoom = viewport.zoom === 0 ? MIN_ZOOM : viewport.zoom
  return {
    x: (point.x - viewport.x) / zoom,
    y: (point.y - viewport.y) / zoom,
  }
}

export function worldRectToScreen(rect: Rect, viewport: Viewport): Rect {
  const origin = worldToScreen(rect, viewport)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  }
}

export function screenRectToWorld(rect: Rect, viewport: Viewport): Rect {
  const origin = screenToWorld(rect, viewport)
  const zoom = viewport.zoom === 0 ? MIN_ZOOM : viewport.zoom
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width / zoom,
    height: rect.height / zoom,
  }
}

/**
 * Zoom around a screen-space anchor so the world point under the cursor stays put.
 * offset' = anchor - world(anchor) * zoom'  （由 screen = world * zoom + offset 固定 screen 反解）
 */
export function zoomAt(viewport: Viewport, anchorScreen: Point, factor: number): Viewport {
  const zoom = clampZoom(viewport.zoom)
  const nextZoom = clampZoom(zoom * factor)
  const worldX = (anchorScreen.x - viewport.x) / zoom
  const worldY = (anchorScreen.y - viewport.y) / zoom
  return {
    x: anchorScreen.x - worldX * nextZoom,
    y: anchorScreen.y - worldY * nextZoom,
    zoom: nextZoom,
  }
}

export function panBy(viewport: Viewport, delta: Point): Viewport {
  return {
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
    zoom: viewport.zoom,
  }
}

export interface ViewportInsets {
  left?: number
  right?: number
  top?: number
  bottom?: number
}

export type ViewportPadding = number | ViewportInsets

export function normalizeViewportInsets(padding: ViewportPadding = 0): Required<ViewportInsets> {
  if (typeof padding === 'number') {
    const value = Number.isFinite(padding) && padding > 0 ? padding : 0
    return { left: value, right: value, top: value, bottom: value }
  }
  return {
    left: Math.max(0, padding.left || 0),
    right: Math.max(0, padding.right || 0),
    top: Math.max(0, padding.top || 0),
    bottom: Math.max(0, padding.bottom || 0),
  }
}

export function visibleScreenRect(screenSize: Size, padding: ViewportPadding = 0): Rect {
  const inset = normalizeViewportInsets(padding)
  return {
    x: inset.left,
    y: inset.top,
    width: Math.max(0, screenSize.width - inset.left - inset.right),
    height: Math.max(0, screenSize.height - inset.top - inset.bottom),
  }
}

export function visibleScreenCenter(screenSize: Size, padding: ViewportPadding = 0): Point {
  const visible = visibleScreenRect(screenSize, padding)
  return {
    x: visible.x + visible.width / 2,
    y: visible.y + visible.height / 2,
  }
}

/** Scale `bounds` to fit `screenSize` (centered in the padded area), then clamp zoom. */
export function fitBounds(bounds: Rect, screenSize: Size, padding: ViewportPadding = 0): Viewport {
  const visible = visibleScreenRect(screenSize, padding)
  const availW = visible.width
  const availH = visible.height
  const bw = bounds.width
  const bh = bounds.height

  let zoom = 1
  if (availW <= 0 || availH <= 0) {
    zoom = MIN_ZOOM
  } else if (bw <= 0 && bh <= 0) {
    zoom = 1
  } else if (bw <= 0) {
    zoom = availH / bh
  } else if (bh <= 0) {
    zoom = availW / bw
  } else {
    zoom = Math.min(availW / bw, availH / bh)
  }
  zoom = clampZoom(zoom)

  const boundsCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
  const screenCenter = visibleScreenCenter(screenSize, padding)

  return {
    x: screenCenter.x - boundsCenter.x * zoom,
    y: screenCenter.y - boundsCenter.y * zoom,
    zoom,
  }
}

/**
 * Keep `bounds` at least partially visible inside the padded screen.
 * Does not force a full fit; only pulls the camera back when content has left the view.
 */
export function clampViewport(
  viewport: Viewport,
  bounds: Rect,
  screenSize: Size,
  padding = 0,
): Viewport {
  const zoom = clampZoom(viewport.zoom)
  const next: Viewport = viewport.zoom === zoom ? viewport : { ...viewport, zoom }
  const visible: Rect = {
    x: padding,
    y: padding,
    width: screenSize.width - padding * 2,
    height: screenSize.height - padding * 2,
  }
  if (visible.width <= 0 || visible.height <= 0) return next

  const screenBounds = worldRectToScreen(bounds, next)
  const sbRight = screenBounds.x + screenBounds.width
  const sbBottom = screenBounds.y + screenBounds.height
  const visRight = visible.x + visible.width
  const visBottom = visible.y + visible.height

  let dx = 0
  let dy = 0
  if (sbRight < visible.x) dx = visible.x - sbRight
  else if (screenBounds.x > visRight) dx = visRight - screenBounds.x
  if (sbBottom < visible.y) dy = visible.y - sbBottom
  else if (screenBounds.y > visBottom) dy = visBottom - screenBounds.y

  if (dx === 0 && dy === 0) return next
  return panBy(next, { x: dx, y: dy })
}
