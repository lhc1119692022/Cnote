import { create } from 'zustand'
import type { Viewport } from '@/domain'
import { useGraphStore } from './graph-store'

interface CanvasViewportState {
  documentId: string | null
  view: Viewport
  setView: (view: Viewport) => void
}

let pendingViewport: { documentId: string | null; view: Viewport } | null = null

export function isValidCanvasViewport(view: Viewport): boolean {
  return [view.x, view.y, view.zoom].every(Number.isFinite) && view.zoom > 0
}

export function stageCanvasViewport(view: Viewport): boolean {
  if (!isValidCanvasViewport(view)) return false
  pendingViewport = { documentId: useGraphStore.getState().currentDocumentId, view }
  return true
}

export const useCanvasViewportStore = create<CanvasViewportState>((set, get) => ({
  documentId: useGraphStore.getState().currentDocumentId,
  view: useGraphStore.getState().view,
  setView(view) {
    if (!isValidCanvasViewport(view)) return
    pendingViewport = null
    const previous = get().view
    if (previous.x === view.x && previous.y === view.y && previous.zoom === view.zoom) return
    set({ view })
  },
}))

useGraphStore.subscribe((state, previous) => {
  if (state.currentDocumentId !== previous.currentDocumentId || state.view !== previous.view) {
    pendingViewport = null
    useCanvasViewportStore.setState({ documentId: state.currentDocumentId, view: state.view })
  }
})

export function currentCanvasViewport(): Viewport {
  const canvas = useCanvasViewportStore.getState()
  const graph = useGraphStore.getState()
  if (pendingViewport?.documentId === graph.currentDocumentId) return pendingViewport.view
  return canvas.documentId === graph.currentDocumentId ? canvas.view : graph.view
}

export function commitCanvasViewport() {
  const canvas = useCanvasViewportStore.getState()
  const graph = useGraphStore.getState()
  if (canvas.documentId === graph.currentDocumentId) {
    const view = currentCanvasViewport()
    canvas.setView(view)
    graph.setViewport(view)
  }
}
