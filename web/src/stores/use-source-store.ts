import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { deleteLocalResource } from '@/lib/resource-storage'
import type { Source, ContentMode } from '@/types/flow'

const snapshotResourceId = (source?: Source) =>
  source?.metadata?.resourceOwnership === 'snapshot'
    ? source.metadata?.nodeData?.resourceId as string | undefined
    : undefined

interface SourceState {
  sources: Source[]

  // CRUD 操作
  createSource: (
    title: string,
    content: string,
    type: ContentMode,
    metadata?: Record<string, any>
  ) => Source
  getSource: (id: string) => Source | undefined
  updateSource: (id: string, updates: Partial<Source>) => void
  deleteSource: (id: string) => void
  duplicateSource: (id: string) => Source

  // 搜索和筛选
  searchSources: (query: string) => Source[]
  getSourcesByType: (type: ContentMode) => Source[]

  // 批量操作
  deleteSources: (ids: string[]) => void

  // 初始化
  initialize: () => Promise<void>
}

export const useSourceStore = create<SourceState>()(
  persist(
    (set, get) => ({
      sources: [],

      // 创建内容源
      createSource: (title, content, type, metadata) => {
        const source: Source = {
          id: nanoid(),
          title,
          content,
          type,
          metadata,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          sources: [...state.sources, source],
        }))

        return source
      },

      // 获取内容源
      getSource: (id) => {
        return get().sources.find((s) => s.id === id)
      },

      // 更新内容源
      updateSource: (id, updates) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id
              ? { ...s, ...updates, updatedAt: Date.now() }
              : s
          ),
        }))
      },

      // 删除内容源
      deleteSource: (id) => {
        set((state) => {
          const removed = state.sources.find((source) => source.id === id)
          const remaining = state.sources.filter((source) => source.id !== id)
          const resourceId = snapshotResourceId(removed)
          if (
            resourceId &&
            !remaining.some((source) => snapshotResourceId(source) === resourceId)
          ) void deleteLocalResource(resourceId)
          return { sources: remaining }
        })
      },

      // 复制内容源
      duplicateSource: (id) => {
        const source = get().sources.find((s) => s.id === id)
        if (!source) throw new Error('Source not found')

        const newSource: Source = {
          ...source,
          id: nanoid(),
          title: `${source.title} (副本)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        set((state) => ({
          sources: [...state.sources, newSource],
        }))

        return newSource
      },

      // 搜索内容源
      searchSources: (query) => {
        const lowerQuery = query.toLowerCase()
        return get().sources.filter(
          (s) =>
            s.title.toLowerCase().includes(lowerQuery) ||
            s.content.toLowerCase().includes(lowerQuery)
        )
      },

      // 按类型获取
      getSourcesByType: (type) => {
        return get().sources.filter((s) => s.type === type)
      },

      // 批量删除
      deleteSources: (ids) => {
        set((state) => {
          const idSet = new Set(ids)
          const removed = state.sources.filter((source) => idSet.has(source.id))
          const remaining = state.sources.filter((source) => !idSet.has(source.id))
          const resourceIds = new Set(
            removed.map(snapshotResourceId).filter(Boolean) as string[],
          )
          resourceIds.forEach((resourceId) => {
            if (!remaining.some((source) => snapshotResourceId(source) === resourceId))
              void deleteLocalResource(resourceId)
          })
          return { sources: remaining }
        })
      },

      // 初始化
      initialize: async () => {
        // 数据已通过 persist 加载
      },
    }),
    {
      name: 'cnote-sources',
      storage: createJSONStorage(() => localForageStorage),
    }
  )
)
