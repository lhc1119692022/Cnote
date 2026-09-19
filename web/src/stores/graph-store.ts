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
import { scrubResources, currentResourcePolicy } from '@/storage/resource-policy'
import { nanoid } from 'nanoid'
import { assignNodesToOverlappingGroups, createGroupFromNodes, expandDragIds, membersOf, outlineGapOffset, syncGroupCounts, ungroupNode } from '@/canvas/grouping'
import type { EdgeSpec, FlowDocument, NodeSpec, Point, Viewport } from '@/domain'

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
  addConnectedNode: (sourceId: string, node: NodeSpec) => void
  splitMediaNode: (id: string) => boolean
  updateNode: (id: string, patch: Partial<NodeSpec>) => void
  updateNodes: (patches: ReadonlyMap<string, Partial<NodeSpec>>) => void
  finishNodeDrag: (ids: string[]) => void
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
  groupSelected: () => void
  ungroup: (groupId: string) => void
  ungroupSelected: () => void
  deleteSelected: () => void
  duplicateSelected: (options?: { offset?: Point; deferHistory?: boolean }) => string[]
  pasteNodes: (nodes: NodeSpec[], offset: Point, edges?: EdgeSpec[]) => void
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
    if (currentResourcePolicy().deletedFlows.includes(doc.id)) return
    doc = scrubResources(doc)
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
    const current = get().view
    if (current.x === view.x && current.y === view.y && current.zoom === view.zoom) return
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
      selection: [node.id],
    })
    get().commitHistory()
  },

  splitMediaNode: (id) => {
    const { currentDocument: doc, isLocked } = get()
    if (!doc || isLocked) return false
    const node = doc.nodes.find((candidate) => candidate.id === id)
    if (!node || node.kind !== 'content' || node.generationBatch || node.disabled) return false
    const payload = node.payload
    if (!payload || (payload.kind !== 'image' && payload.kind !== 'video')) return false
    const items = payload.resources
    if (!items || items.length < 2) return false
    const copies = items.slice(1).map((item, index): NodeSpec => ({
      ...structuredClone(node),
      generationBatch: undefined,
      generatedBy: node.generatedBy ? { ...node.generatedBy, detached: true } : undefined,
      id: nanoid(),
      label: item.label || `${node.label} ${index + 2}`,
      position: { x: node.position.x + node.size.width + 40, y: node.position.y + index * (node.size.height + 24) },
      payload: { ...structuredClone(payload), resources: [structuredClone(item)], activeResourceIndex: 0 },
      parentGroupId: undefined,
      sourceId: undefined,
      favorite: false,
    }))
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes.map((candidate) => candidate.id === id
          ? { ...node, payload: { ...payload, resources: [items[0]], activeResourceIndex: 0 } }
          : candidate), ...copies],
        updatedAt: Date.now(),
      },
      selection: [copies[copies.length - 1].id],
    })
    get().commitHistory()
    return true
  },

  addConnectedNode: (sourceId, node) => {
    const { currentDocument: doc, isLocked } = get()
    if (!doc || isLocked || node.disabled || doc.nodes.some((candidate) => candidate.id === node.id)) return
    const source = doc.nodes.find((candidate) => candidate.id === sourceId)
    if (!source || source.disabled) return
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes, node],
        edges: [...doc.edges, { id: nanoid(), source: sourceId, target: node.id }],
        updatedAt: Date.now(),
      },
      selection: [node.id],
    })
    get().commitHistory()
  },

  // Intentionally no commitHistory(): the canvas commits once per gesture.
  updateNode: (id, patch) => {
    get().updateNodes(new Map([[id, patch]]))
  },

  updateNodes: (patches) => {
    set((state) => {
      const doc = state.currentDocument
      if (!doc) return state
      let changed = false
      const nodes = doc.nodes.map((node) => {
        const patch = patches.get(node.id)
        if (!patch) return node
        const differs = Object.entries(patch).some(([key, value]) => {
          if (key === 'id') return false
          if (key === 'position') return value?.x !== node.position.x || value?.y !== node.position.y
          if (key === 'size') return value?.width !== node.size.width || value?.height !== node.size.height
          return value !== node[key as keyof NodeSpec]
        })
        if (!differs) return node
        changed = true
        return { ...node, ...patch, id: node.id } as NodeSpec
      })
      if (!changed) return state
      return {
        currentDocument: {
          ...doc,
          nodes,
          updatedAt: Math.max(Date.now(), doc.updatedAt + 1),
        },
      }
    })
  },

  finishNodeDrag: (ids) => {
    const { currentDocument, isLocked } = get()
    if (!currentDocument || isLocked || ids.length === 0) return
    set({ currentDocument: { ...currentDocument, nodes: assignNodesToOverlappingGroups(currentDocument.nodes, ids), updatedAt: Date.now() } })
    get().commitHistory()
  },

  deleteNode: (id) => {
    const doc = get().currentDocument
    if (!doc || get().isLocked || !doc.nodes.some((node) => node.id === id)) return
    const target = doc.nodes.find((node) => node.id === id)
    if (target?.kind === 'group') {
      get().ungroup(id)
      return
    }
    set((state) => {
      const current = state.currentDocument
      if (!current) return state
      const nodes = syncGroupCounts(current.nodes.filter((node) => node.id !== id))
      return {
        currentDocument: {
          ...current,
          nodes,
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
    if (!doc || get().isLocked) return
    const node = doc.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    const cloned = structuredClone(node)
    if (cloned.kind === 'content') { cloned.generationBatch = undefined; if (cloned.generatedBy) cloned.generatedBy = { ...cloned.generatedBy, detached: true } }
    const newId = nanoid()
    const offset = outlineGapOffset([node])
    const duplicate: NodeSpec = {
      ...cloned,
      id: newId,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
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
    if (!doc || get().isLocked || source === target) return
    const sourceNode = doc.nodes.find((node) => node.id === source)
    const targetNode = doc.nodes.find((node) => node.id === target)
    if (!sourceNode || !targetNode || sourceNode.disabled || targetNode.disabled) return
    const duplicate = doc.edges.some((edge) => (
      edge.source === source
      && edge.target === target
      && edge.sourceHandle === opts?.sourceHandle
      && edge.targetHandle === opts?.targetHandle
    ))
    if (duplicate) return
    if (targetNode.kind === 'request' && targetNode.variant === 'video') {
      void import('@/canvas/video-input-validation').then(({ connectVideoInput }) => connectVideoInput(source, target, opts))
      return
    }
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
    if (!doc || get().isLocked || !doc.edges.some((edge) => edge.id === id)) return
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

  groupSelected: () => {
    const { currentDocument, selection } = get()
    if (!currentDocument || get().isLocked) return
    const grouped = createGroupFromNodes(currentDocument.nodes, selection)
    if (!grouped) return
    set({
      currentDocument: {
        ...currentDocument,
        nodes: grouped.nodes,
        updatedAt: Date.now(),
      },
      selection: [grouped.groupId],
    })
    get().commitHistory()
  },

  ungroup: (groupId) => {
    const doc = get().currentDocument
    if (!doc || get().isLocked || !doc.nodes.some((node) => node.id === groupId && node.kind === 'group')) return
    const memberIds = membersOf(doc.nodes, groupId).map((node) => node.id)
    set({
      currentDocument: {
        ...doc,
        nodes: ungroupNode(doc.nodes, groupId),
        updatedAt: Date.now(),
      },
      selection: memberIds,
    })
    get().commitHistory()
  },

  ungroupSelected: () => {
    const { currentDocument, selection } = get()
    if (!currentDocument || get().isLocked) return
    const groupIds = currentDocument.nodes
      .filter((node) => node.kind === 'group' && selection.includes(node.id))
      .map((node) => node.id)
    if (groupIds.length === 0) return
    let nodes = currentDocument.nodes
    let nextSelection: string[] = []
    for (const groupId of groupIds) {
      nextSelection = [...nextSelection, ...membersOf(nodes, groupId).map((node) => node.id)]
      nodes = ungroupNode(nodes, groupId)
    }
    set({
      currentDocument: {
        ...currentDocument,
        nodes,
        updatedAt: Date.now(),
      },
      selection: nextSelection,
    })
    get().commitHistory()
  },

  deleteSelected: () => {
    const { currentDocument, selection } = get()
    if (!currentDocument || get().isLocked || selection.length === 0) return
    const selected = new Set(selection)
    const groupIds = currentDocument.nodes
      .filter((node) => node.kind === 'group' && selected.has(node.id))
      .map((node) => node.id)
    let nodes = currentDocument.nodes
    for (const groupId of groupIds) nodes = ungroupNode(nodes, groupId)
    const remainingSelected = new Set(selection.filter((id) => !groupIds.includes(id)))
    const removed = new Set(nodes.filter((node) => remainingSelected.has(node.id)).map((node) => node.id))
    nodes = syncGroupCounts(nodes.filter((node) => !removed.has(node.id)))
    set({
      currentDocument: {
        ...currentDocument,
        nodes,
        edges: currentDocument.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        updatedAt: Date.now(),
      },
      selection: [],
    })
    get().commitHistory()
  },

  duplicateSelected: (options) => {
    const doc = get().currentDocument
    if (!doc || get().isLocked || get().selection.length === 0) return []
    const idsToCopy = new Set(expandDragIds(doc.nodes, get().selection))
    const idMap = new Map<string, string>()
    idsToCopy.forEach((id) => idMap.set(id, nanoid()))
    const sourceNodes = doc.nodes.filter((node) => idsToCopy.has(node.id))
    const offset = options?.offset ?? outlineGapOffset(sourceNodes)
    const copies = sourceNodes.map((node) => {
      const copy = structuredClone(node)
      if (copy.kind === 'content') { copy.generationBatch = undefined; if (copy.generatedBy) copy.generatedBy = { ...copy.generatedBy, detached: true } }
      copy.id = idMap.get(node.id) as string
      copy.position = { x: node.position.x + offset.x, y: node.position.y + offset.y }
      copy.label = copyLabel(node.label)
      if (copy.parentGroupId) copy.parentGroupId = idMap.get(copy.parentGroupId)
      return copy
    })
    const copiedEdges = doc.edges
      .filter((edge) => idsToCopy.has(edge.source) && idsToCopy.has(edge.target))
      .map((edge) => ({
        ...structuredClone(edge),
        id: nanoid(),
        source: idMap.get(edge.source) as string,
        target: idMap.get(edge.target) as string,
      }))
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes, ...copies],
        edges: [...doc.edges, ...copiedEdges],
        updatedAt: Date.now(),
      },
      selection: copies.map((node) => node.id),
    })
    if (!options?.deferHistory) get().commitHistory()
    return copies.map((node) => node.id)
  },

  pasteNodes: (nodes, offset, edges = []) => {
    const doc = get().currentDocument
    if (!doc || get().isLocked || nodes.length === 0) return
    const idMap = new Map<string, string>()
    nodes.forEach((node) => idMap.set(node.id, nanoid()))
    const copies = nodes.map((node) => {
      const copy = structuredClone(node)
      if (copy.kind === 'content') { copy.generationBatch = undefined; if (copy.generatedBy) copy.generatedBy = { ...copy.generatedBy, detached: true } }
      copy.id = idMap.get(node.id) as string
      copy.position = { x: node.position.x + offset.x, y: node.position.y + offset.y }
      if (copy.parentGroupId) copy.parentGroupId = idMap.get(copy.parentGroupId)
      return copy
    })
    const copiedEdges = edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...structuredClone(edge),
        id: nanoid(),
        source: idMap.get(edge.source) as string,
        target: idMap.get(edge.target) as string,
      }))
    set({
      currentDocument: {
        ...doc,
        nodes: [...doc.nodes, ...copies],
        edges: [...doc.edges, ...copiedEdges],
        updatedAt: Date.now(),
      },
      selection: copies.map((node) => node.id),
    })
    get().commitHistory()
  },

  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const doc = scrubResources(history[nextIndex])
    if (!doc) return
    // Reuse the history snapshot by reference: entries are already deep-cloned
    // and store updates are immutable, so this alias is not mutated in place.
    set((state) => ({
      currentDocument: doc,
      currentDocumentId: doc.id,
      historyIndex: nextIndex,
      selection: restoreSelection(state.selection, doc),
    }))
  },

  redo: () => {
    const { history, historyIndex } = get()
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const doc = scrubResources(history[nextIndex])
    if (!doc) return
    // Same as undo: restore by reference; the next commitHistory clones again.
    set((state) => ({
      currentDocument: doc,
      currentDocumentId: doc.id,
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
