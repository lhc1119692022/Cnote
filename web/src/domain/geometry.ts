/**
 * Canvas geometry primitives.
 * Framework-agnostic — not bound to React Flow, DOM, or CSS pixels beyond numbers.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Axis-aligned rectangle: origin (`Point`) plus `Size`. */
export type Rect = Point & Size

export interface Viewport {
  x: number
  y: number
  zoom: number
}
