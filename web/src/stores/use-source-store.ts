import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { deleteLocalResource, retainLocalResource } from '@/lib/resource-storage'
import { cloneFlowValue } from '@/lib/flow/clone'
import type { ContentCategory, ContentNodeData, Source } from '@/types/flow'

function resourceIdOf(source?: Source) {
  const input = source?.nodeData.source
  return input?.kind === 'file' || input?.kind === 'clipboard-image' ? input.resourceId : undefined
}

interface SourceState {
  sources: Source[]
  createSource: (title: string, nodeData: ContentNodeData) => Source
  getSource: (id: string) => Source | undefined
  updateSource: (id: string, updates: Partial<Source>) => void
  deleteSource: (id: string) => void
  duplicateSource: (id: string) => Source
  searchSources: (query: string) => Source[]
  getSourcesByCategory: (category: ContentCategory) => Source[]
  deleteSources: (ids: string[]) => void
  initialize: () => Promise<void>
}

export const useSourceStore = create<SourceState>()(persist((set, get) => ({
  sources: [],
  createSource: (title, nodeData) => {
    const source: Source = { id: nanoid(), title, nodeData: cloneFlowValue(nodeData), createdAt: Date.now(), updatedAt: Date.now() }
    set((state) => ({ sources: [...state.sources, source] }))
    return source
  },
  getSource: (id) => get().sources.find((source) => source.id === id),
  updateSource: (id, updates) => {
    const current = get().sources.find((source) => source.id === id)
    if (!current) return
    const next = cloneFlowValue({ ...current, ...updates, updatedAt: Date.now() })
    const previousResourceId = resourceIdOf(current)
    const nextResourceId = resourceIdOf(next)
    if (previousResourceId !== nextResourceId) {
      void deleteLocalResource(previousResourceId)
      void retainLocalResource(nextResourceId)
    }
    set((state) => ({ sources: state.sources.map((source) => source.id === id ? next : source) }))
  },
  deleteSource: (id) => set((state) => {
    const removed = state.sources.find((source) => source.id === id)
    void deleteLocalResource(resourceIdOf(removed))
    return { sources: state.sources.filter((source) => source.id !== id) }
  }),
  duplicateSource: (id) => {
    const source = get().sources.find((item) => item.id === id)
    if (!source) throw new Error('Source not found')
    void retainLocalResource(resourceIdOf(source))
    const copiedData = cloneFlowValue(source.nodeData)
    const copy: Source = { ...cloneFlowValue(source), id: nanoid(), title: `${source.title} (副本)`, nodeData: { ...copiedData, sourceId: undefined }, createdAt: Date.now(), updatedAt: Date.now() }
    set((state) => ({ sources: [...state.sources, copy] }))
    return copy
  },
  searchSources: (query) => {
    const needle = query.toLowerCase()
    return get().sources.filter((source) => `${source.title} ${JSON.stringify(source.nodeData.payload || {})}`.toLowerCase().includes(needle))
  },
  getSourcesByCategory: (category) => get().sources.filter((source) => source.nodeData.category === category),
  deleteSources: (ids) => set((state) => {
    const idSet = new Set(ids)
    state.sources.filter((source) => idSet.has(source.id)).forEach((source) => void deleteLocalResource(resourceIdOf(source)))
    return { sources: state.sources.filter((source) => !idSet.has(source.id)) }
  }),
  initialize: async () => undefined,
}), { name: 'cnote-sources-v2', storage: createJSONStorage(() => localForageStorage) }))
