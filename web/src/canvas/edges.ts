/**
 * Edge geometry for the canvas engine: cubic bezier paths and hit distance.
 * No SVG / DOM / React — sample the curve as a polyline when a length or hit is needed.
 */

import type { Point, Rect } from '@/domain'
import { closestPointOnSegment, distance } from './geometry'

const MIN_CONTROL_OFFSET = 40
const BEZIER_SAMPLES = 32

export interface EdgePathPoints {
  source: Point
  target: Point
  controlA: Point
  controlB: Point
}

/** Source right-mid → target left-mid; control offset = max(40, |dx| / 2). */
export function edgePathPoints(source: Rect, target: Rect): EdgePathPoints {
  const start: Point = {
    x: source.x + source.width,
    y: source.y + source.height / 2,
  }
  const end: Point = {
    x: target.x,
    y: target.y + target.height / 2,
  }
  const offset = Math.max(MIN_CONTROL_OFFSET, Math.abs(end.x - start.x) / 2)
  return {
    source: start,
    target: end,
    controlA: { x: start.x + offset, y: start.y },
    controlB: { x: end.x - offset, y: end.y },
  }
}

/** B(t) = (1-t)³p0 + 3(1-t)²t p1 + 3(1-t)t² p2 + t³ p3 */
export function cubicBezierPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const u = 1 - t
  const uu = u * u
  const uuu = uu * u
  const tt = t * t
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  }
}

function sampleEdge(pts: EdgePathPoints): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= BEZIER_SAMPLES; i += 1) {
    const t = i / BEZIER_SAMPLES
    points.push(cubicBezierPoint(pts.source, pts.controlA, pts.controlB, pts.target, t))
  }
  return points
}

export function cubicBezierLength(pts: EdgePathPoints): number {
  const samples = sampleEdge(pts)
  let length = 0
  for (let i = 1; i < samples.length; i += 1) {
    length += distance(samples[i - 1]!, samples[i]!)
  }
  return length
}

export function pointToEdgeDistance(p: Point, pts: EdgePathPoints): number {
  const samples = sampleEdge(pts)
  let min = Number.POSITIVE_INFINITY
  for (let i = 1; i < samples.length; i += 1) {
    const closest = closestPointOnSegment(p, samples[i - 1]!, samples[i]!)
    const d = distance(p, closest)
    if (d < min) min = d
  }
  return min
}
