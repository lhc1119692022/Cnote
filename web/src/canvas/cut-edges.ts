import { create } from 'zustand'
import type { Point } from '@/domain'
import { cubicBezierPoint } from '@/canvas'
import { createEdgePathCache } from './edge-path-cache'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvasViewportStore } from '@/stores/canvas-viewport-store'

export const useCutEdges = create<{ points: Point[]; ids: string[] }>(() => ({ points: [], ids: [] }))

export function segmentsCross(start: Point, end: Point, first: Point, last: Point) {
  const cross = (origin: Point, target: Point, point: Point) => (target.x - origin.x) * (point.y - origin.y) - (target.y - origin.y) * (point.x - origin.x)
  if (Math.max(start.x, end.x) < Math.min(first.x, last.x) || Math.max(first.x, last.x) < Math.min(start.x, end.x) || Math.max(start.y, end.y) < Math.min(first.y, last.y) || Math.max(first.y, last.y) < Math.min(start.y, end.y)) return false
  return cross(start, end, first) * cross(start, end, last) <= 0 && cross(first, last, start) * cross(first, last, end) <= 0
}

export function installEdgeCutting(root: HTMLElement) {
  let gesture: { pointerId: number; documentId: string; points: Point[]; ids: Set<string>; paths: Array<{ id: string; samples: Point[] }> } | undefined
  let frame = 0
  const publish = () => { frame = 0; if (gesture) useCutEdges.setState({ points: [...gesture.points], ids: [...gesture.ids] }) }
  const finish = (commit = false) => {
    if (!gesture) return
    const current = gesture
    gesture = undefined
    cancelAnimationFrame(frame)
    frame = 0
    root.classList.remove('canvas-cutting')
    if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId)
    useCutEdges.setState({ points: [], ids: [] })
    const graph = useGraphStore.getState()
    const document = graph.currentDocument
    if (commit && !graph.isLocked && document?.id === current.documentId && document.edges.some((edge) => current.ids.has(edge.id))) {
      useGraphStore.setState({ currentDocument: { ...document, edges: document.edges.filter((edge) => !current.ids.has(edge.id)), updatedAt: Date.now() } })
      graph.commitHistory()
    }
  }
  const point = (event: PointerEvent) => { const rect = root.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const addPoint = (event: PointerEvent) => {
    if (!gesture) return
    const next = point(event)
    const previous = gesture.points[gesture.points.length - 1]
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return
    for (const path of gesture.paths) {
      if (gesture.ids.has(path.id)) continue
      if (path.samples.some((sample, index) => index > 0 && segmentsCross(previous, next, path.samples[index - 1], sample))) gesture.ids.add(path.id)
    }
    gesture.points.push(next)
    if (!frame) frame = requestAnimationFrame(publish)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 2 || !(event.target instanceof Element) || !root.contains(event.target) || event.target.closest('input,textarea,[contenteditable="true"],[data-canvas-chrome]')) return
    event.preventDefault(); event.stopImmediatePropagation()
    const graph = useGraphStore.getState()
    if (graph.isLocked || !graph.currentDocument || gesture) return
    const view = useCanvasViewportStore.getState().view
    const paths = createEdgePathCache()(graph.currentDocument.nodes, graph.currentDocument.edges).map((path) => {
      const controls = [path.pts.source, path.pts.controlA, path.pts.controlB, path.pts.target]
      const length = controls.slice(1).reduce((sum, item, index) => sum + Math.hypot(item.x - controls[index].x, item.y - controls[index].y), 0)
      const count = Math.min(4096, Math.max(24, Math.ceil(length * view.zoom / 3)))
      return { id: path.id, samples: Array.from({ length: count + 1 }, (_, index) => { const world = cubicBezierPoint(...controls as [Point, Point, Point, Point], index / count); return { x: world.x * view.zoom + view.x, y: world.y * view.zoom + view.y } }) }
    })
    gesture = { pointerId: event.pointerId, documentId: graph.currentDocument.id, points: [point(event)], ids: new Set(), paths }
    root.classList.add('canvas-cutting')
    root.setPointerCapture(event.pointerId)
    publish()
  }
  const move = (event: PointerEvent) => { if (gesture?.pointerId !== event.pointerId) return; event.preventDefault(); event.stopImmediatePropagation(); if (!(event.buttons & 2)) { finish(); return }; const samples = event.getCoalescedEvents?.() || []; for (const sample of samples) addPoint(sample); addPoint(event) }
  const up = (event: PointerEvent) => { if (gesture?.pointerId !== event.pointerId || event.button !== 2) return; event.preventDefault(); event.stopImmediatePropagation(); addPoint(event); finish(true) }
  const cancel = () => finish()
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') finish() }
  const visibility = () => { if (document.hidden) finish() }
  const unsubscribe = useGraphStore.subscribe((state, previous) => { if (state.currentDocument !== previous.currentDocument || state.isLocked !== previous.isLocked) finish() })
  const unsubscribeView = useCanvasViewportStore.subscribe((state, previous) => { if (state.view !== previous.view) finish() })
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointermove', move, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', cancel, true)
  root.addEventListener('lostpointercapture', cancel)
  window.addEventListener('blur', cancel)
  window.addEventListener('keydown', key)
  document.addEventListener('visibilitychange', visibility)
  return () => {
    finish(); unsubscribe(); unsubscribeView()
    document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true)
    root.removeEventListener('lostpointercapture', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility)
  }
}
