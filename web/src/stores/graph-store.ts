/**
 * Graph + viewport store.
 *
 * Persistence is the caller's job via `@/storage`. This store is in-memory only
 * (no zustand persist). Updates are immutable: map/filter/spread so unchanged
 * node/edge objects keep their references.
 *
 * History convention:
 * - Structural edits (addNode / deleteNode / duplicateNode / addEdge / deleteEdge)
 *   mutate the document, then call `commitHistory()`.
 * - `updateNode` does NOT auto-commit. Drag / resize is high-frequency; the
 *   canvas layer batches those patches and commits once on gesture end.
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { EdgeSpec, FlowDocument, NodeSpec, Viewport } from '@/domain'

const MAX_HISTORY = 50

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

function copyLabel(label: string): string {
  return `${label || '节点'} (副本)`
}

export interface GraphStoreState {
  currentDocument: FlowDocument | null
  currentDocumentId: string | null
  selection: string[]
  isLocked: boolean
  view: Viewport
  history: FlowDocument[]
  historyIndex: number
}

export interface GraphStoreActions {
  openDocument: (doc: FlowDocument) => void
  closeDocument: () => void
  setViewport: (view: Viewport) => void
  addNode: (spec: Omit<NodeSpec, 'id'> & { id?: string }) => void
  updateNode: (id: string, patch: Partial<NodeSpec>) => void
  deleteNode: (id: string) => void
  duplicateNode: (id: string) => void
  addEdge: (
    source: string,
    target: string,
    opts?: { sourceHandle?: string; targetHandle?: string },
  ) => void
  deleteEdge: (id: string) => void
  setSelection: (ids: string[]) => void
  toggleLock: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  commitHistory: () => void
}

export type GraphStore = GraphStoreState & GraphStoreActions

function restoreSelection(selection: string[], doc: FlowDocument): string[] {
  if (selection.length === 0) return selection
  const ids = new Set(doc.nodes.map((node) => node.id))
  const next = selection.filter((id) => ids.has(id))
  return next.length === selection.length ? selection : next
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  currentDocument: null,
  currentDocumentId: null,
  selection: [],
  isLocked: false,
  view: DEFAULT_VIEWPORT,
  history: [],
  historyIndex: -1,

  openDocument: (doc) => {
    set({
      currentDocument: doc,
      currentDocumentId: doc.id,
      selection: [],
      // Isolate history from the caller-owned doc; currentDocument keeps the original.
      history: [structuredClone(doc)],
      historyIndex: 0,
      view: doc.viewport,
    })
  },

  closeDocument: () => {
    set({
      currentDocument: null,
      currentDocumentId: null,
      selection: [],
      history: [],
      historyIndex: -1,
      view: DEFAULT_VIEWPORT,
    })
  },

  setViewport: (view) => {
    set({ view })
  },

  addNode: (spec) => {
    const doc = get().currentDocument
    if (!doc) return
    const node = { ...spec, id: spec.id ?? nanoid() } as NodeSpec
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes, node],
        updatedAt: Date.now(),
      },
    })
    get().commitHistory()
  },

  // Intentionally no commitHistory(): the canvas commits once per gesture.
  updateNode: (id, patch) => {
    set((state) => {
      const doc = state.currentDocument
      if (!doc) return state
      let changed = false
      const nodes = doc.nodes.map((node) => {
        if (node.id !== id) return node
        changed = true
        return { ...node, ...patch, id: node.id } as NodeSpec
      })
      if (!changed) return state
      return {
        currentDocument: {
          ...doc,
          nodes,
          updatedAt: Date.now(),
        },
      }
    })
  },

  deleteNode: (id) => {
    const doc = get().currentDocument
    if (!doc || !doc.nodes.some((node) => node.id === id)) return
    set((state) => {
      const current = state.currentDocument
      if (!current) return state
      return {
        currentDocument: {
          ...current,
          nodes: current.nodes.filter((node) => node.id !== id),
          edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
          updatedAt: Date.now(),
        },
        selection: state.selection.filter((selectedId) => selectedId !== id),
      }
    })
    get().commitHistory()
  },

  duplicateNode: (id) => {
    const doc = get().currentDocument
    if (!doc) return
    const node = doc.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    const cloned = structuredClone(node)
    const newId = nanoid()
    const duplicate: NodeSpec = {
      ...cloned,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      label: copyLabel(node.label),
    }
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes, duplicate],
        updatedAt: Date.now(),
      },
      selection: [newId],
    })
    get().commitHistory()
  },

  addEdge: (source, target, opts) => {
    const doc = get().currentDocument
    if (!doc) return
    const edge: EdgeSpec = {
      id: nanoid(),
      source,
      target,
      sourceHandle: opts?.sourceHandle,
      targetHandle: opts?.targetHandle,
    }
    set({
      currentDocument: {
        ...doc,
        edges: [...doc.edges, edge],
        updatedAt: Date.now(),
      },
    })
    get().commitHistory()
  },

  deleteEdge: (id) => {
    const doc = get().currentDocument
    if (!doc || !doc.edges.some((edge) => edge.id === id)) return
    set({
      currentDocument: {
        ...doc,
        edges: doc.edges.filter((edge) => edge.id !== id),
        updatedAt: Date.now(),
      },
    })
    get().commitHistory()
  },

  setSelection: (ids) => {
    set({ selection: ids })
  },

  toggleLock: () => {
    set((state) => ({ isLocked: !state.isLocked }))
  },

  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const doc = history[nextIndex]
    if (!doc) return
    // Reuse the history snapshot by reference: entries are already deep-cloned
    // and store updates are immutable, so this alias is not mutated in place.
    set((state) => ({
      currentDocument: doc,
      currentDocumentId: doc.id,
      view: doc.viewport,
      historyIndex: nextIndex,
      selection: restoreSelection(state.selection, doc),
    }))
  },

  redo: () => {
    const { history, historyIndex } = get()
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const doc = history[nextIndex]
    if (!doc) return
    // Same as undo: restore by reference; the next commitHistory clones again.
    set((state) => ({
      currentDocument: doc,
      currentDocumentId: doc.id,
      view: doc.viewport,
      historyIndex: nextIndex,
      selection: restoreSelection(state.selection, doc),
    }))
  },

  canUndo: () => get().historyIndex > 0,

  canRedo: () => {
    const { history, historyIndex } = get()
    return historyIndex >= 0 && historyIndex < history.length - 1
  },

  commitHistory: () => {
    const { currentDocument, history, historyIndex } = get()
    if (!currentDocument) return
    const nextHistory = history.slice(0, historyIndex + 1)
    // 快照必须深拷贝，避免历史条目与当前文档共享引用。
    nextHistory.push(structuredClone(currentDocument))
    if (nextHistory.length > MAX_HISTORY) {
      nextHistory.splice(0, nextHistory.length - MAX_HISTORY)
    }
    set({
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    })
  },
}))
