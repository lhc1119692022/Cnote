import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import type { Output } from '@/types/flow'

interface OutputState {
  outputs: Output[]

  // CRUD 操作
  createOutput: (
    title: string,
    content: string,
    format: 'html' | 'markdown' | 'text',
    flowId?: string,
    nodeId?: string
  ) => Output
  getOutput: (id: string) => Output | undefined
  updateOutput: (id: string, updates: Partial<Output>) => void
  deleteOutput: (id: string) => void

  // 搜索和筛选
  searchOutputs: (query: string) => Output[]
  getOutputsByFlow: (flowId: string) => Output[]
  getOutputsByFormat: (format: 'html' | 'markdown' | 'text') => Output[]

  // 批量操作
  deleteOutputs: (ids: string[]) => void

  // 统计
  getTotalWordCount: () => number
  getOutputCount: () => number

  // 初始化
  initialize: () => Promise<void>
}

export const useOutputStore = create<OutputState>()(
  persist(
    (set, get) => ({
      outputs: [],

      // 创建输出
      createOutput: (title, content, format, flowId, nodeId) => {
        // 计算字数
        const wordCount = content.length

        const output: Output = {
          id: nanoid(),
          title,
          content,
          format,
          flowId,
          nodeId,
          wordCount,
          createdAt: Date.now(),
        }

        set((state) => ({
          outputs: [output, ...state.outputs], // 新的放在最前面
        }))

        return output
      },

      // 获取输出
      getOutput: (id) => {
        return get().outputs.find((o) => o.id === id)
      },

      // 更新输出
      updateOutput: (id, updates) => {
        set((state) => ({
          outputs: state.outputs.map((o) => {
            if (o.id === id) {
              const updatedOutput = { ...o, ...updates }
              // 如果内容更新了，重新计算字数
              if (updates.content) {
                updatedOutput.wordCount = updates.content.length
              }
              return updatedOutput
            }
            return o
          }),
        }))
      },

      // 删除输出
      deleteOutput: (id) => {
        set((state) => ({
          outputs: state.outputs.filter((o) => o.id !== id),
        }))
      },

      // 搜索输出
      searchOutputs: (query) => {
        const lowerQuery = query.toLowerCase()
        return get().outputs.filter(
          (o) =>
            o.title.toLowerCase().includes(lowerQuery) ||
            o.content.toLowerCase().includes(lowerQuery)
        )
      },

      // 按 Flow 获取
      getOutputsByFlow: (flowId) => {
        return get().outputs.filter((o) => o.flowId === flowId)
      },

      // 按格式获取
      getOutputsByFormat: (format) => {
        return get().outputs.filter((o) => o.format === format)
      },

      // 批量删除
      deleteOutputs: (ids) => {
        set((state) => ({
          outputs: state.outputs.filter((o) => !ids.includes(o.id)),
        }))
      },

      // 获取总字数
      getTotalWordCount: () => {
        return get().outputs.reduce((sum, o) => sum + o.wordCount, 0)
      },

      // 获取输出数量
      getOutputCount: () => {
        return get().outputs.length
      },

      // 初始化
      initialize: async () => {
        // 数据已通过 persist 加载
      },
    }),
    {
      name: 'cnote-outputs',
      storage: localForageStorage as any,
    }
  )
)
