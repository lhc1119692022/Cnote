/**
 * Graph autosave session.
 *
 * The in-memory graph store does not persist. This module is the single write
 * path for FlowDocument envelopes: 450ms debounce while editing, immediate
 * flush when switching canvases, leaving the editor, or hiding the window.
 */

import type { FlowDocument, Viewport } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { appendDocumentIndex, saveDocument } from './graph-store'

export const GRAPH_AUTOSAVE_DELAY_MS = 450

export interface GraphPersistSource {
  doc: FlowDocument | null
  view: Viewport
}

export interface GraphPersistSnapshot {
  id: string
  updatedAt: number
  viewport: Viewport
}

let persistChain: Promise<unknown> = Promise.resolve()
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let lastSnapshot: GraphPersistSnapshot | null = null

export function graphPersistSnapshot(doc: FlowDocument, view: Viewport): GraphPersistSnapshot {
  return {
    id: doc.id,
    updatedAt: doc.updatedAt,
    viewport: { x: view.x, y: view.y, zoom: view.zoom },
  }
}

export function isGraphDirty(
  doc: FlowDocument | null,
  view: Viewport,
  last: GraphPersistSnapshot | null = lastSnapshot,
): boolean {
  if (!doc) return false
  if (!last || last.id !== doc.id) return true
  if (last.updatedAt !== doc.updatedAt) return true
  return last.viewport.x !== view.x || last.viewport.y !== view.y || last.viewport.zoom !== view.zoom
}

export function withCurrentViewport(doc: FlowDocument, view: Viewport): FlowDocument {
  if (doc.viewport.x === view.x && doc.viewport.y === view.y && doc.viewport.zoom === view.zoom) return doc
  return { ...doc, viewport: { x: view.x, y: view.y, zoom: view.zoom } }
}

export function rememberOpenedGraph(doc: FlowDocument, view: Viewport = doc.viewport) {
  lastSnapshot = graphPersistSnapshot(doc, view)
}

export function getLastGraphSnapshot() {
  return lastSnapshot
}

export async function persistGraphDocument(doc: FlowDocument): Promise<void> {
  await saveDocument(doc)
  await appendDocumentIndex(doc.id)
}

function enqueuePersist(run: () => Promise<GraphPersistSnapshot | null>) {
  const next = persistChain.then(run, run)
  persistChain = next.catch(() => undefined)
  return next
}

export function persistCurrentGraph(getSource: () => GraphPersistSource): Promise<GraphPersistSnapshot | null> {
  return enqueuePersist(async () => {
    const { doc, view } = getSource()
    if (!doc) return lastSnapshot
    if (!isGraphDirty(doc, view, lastSnapshot)) return lastSnapshot
    const next = withCurrentViewport(doc, view)
    await persistGraphDocument(next)
    lastSnapshot = graphPersistSnapshot(next, next.viewport)
    return lastSnapshot
  })
}

export function scheduleGraphPersist(
  getSource: () => GraphPersistSource,
  delay = GRAPH_AUTOSAVE_DELAY_MS,
  handlers: { onSaved?: (snapshot: GraphPersistSnapshot) => void; onError?: (error: unknown) => void } = {},
) {
  if (pendingTimer != null) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void persistCurrentGraph(getSource).then((snapshot) => {
      if (snapshot) handlers.onSaved?.(snapshot)
    }).catch((error) => {
      handlers.onError?.(error)
    })
  }, delay)
}

export function cancelScheduledGraphPersist() {
  if (pendingTimer == null) return
  clearTimeout(pendingTimer)
  pendingTimer = null
}

export function flushGraphPersist(getSource: () => GraphPersistSource) {
  cancelScheduledGraphPersist()
  return persistCurrentGraph(getSource)
}

export function currentGraphSource(): GraphPersistSource {
  const { currentDocument, view } = useGraphStore.getState()
  return { doc: currentDocument, view }
}

export function flushOpenGraphIfAny() {
  return flushGraphPersist(currentGraphSource)
}

export function resetGraphSessionForTests() {
  if (pendingTimer != null) clearTimeout(pendingTimer)
  pendingTimer = null
  persistChain = Promise.resolve()
  lastSnapshot = null
}
