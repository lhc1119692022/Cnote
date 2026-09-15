/**
 * Hit-testing and axis-aligned geometry helpers for the canvas engine.
 * Pure functions over domain Point/Rect; not the domain primitive types themselves.
 */

import type { NodeSpec, Point, Rect } from '@/domain'

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  )
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

export function nodeRect(spec: Pick<NodeSpec, 'position' | 'size'>): Rect {
  return {
    x: spec.position.x,
    y: spec.position.y,
    width: spec.size.width,
    height: spec.size.height,
  }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Closest point on segment ab to p; degenerate ab collapses to a. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return { x: a.x + t * abx, y: a.y + t * aby }
}
