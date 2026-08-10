import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { Node, Edge } from 'reactflow'
import { localForageStorage } from '@/lib/localforage-storage'
import type { Template } from '@/types/flow'

interface TemplateState {
  templates: Template[]

  // CRUD 操作
  createTemplate: (
    title: string,
    description: string,
    nodes: Node[],
    edges: Edge[],
    category?: string
  ) => Template
  getTemplate: (id: string) => Template | undefined
  updateTemplate: (id: string, updates: Partial<Template>) => void
  deleteTemplate: (id: string) => void
  duplicateTemplate: (id: string) => Template

  // 使用统计
  incrementUsage: (id: string) => void

  // 分类筛选
  getTemplatesByCategory: (category: string) => Template[]
  getAllCategories: () => string[]

  // 初始化
  initialize: () => Promise<void>
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set, get) => ({
      templates: [],

      // 创建模板
      createTemplate: (title, description, nodes, edges, category) => {
        const template: Template = {
          id: nanoid(),
          title,
          description,
          thumbnail: undefined,
          nodes: nodes.map((n) => ({ ...n, selected: false })),
          edges: edges.map((e) => ({ ...e, selected: false })),
          category,
          usageCount: 0,
          createdAt: Date.now(),
        }

        set((state) => ({
          templates: [...state.templates, template],
        }))

        return template
      },

      // 获取模板
      getTemplate: (id) => {
        return get().templates.find((t) => t.id === id)
      },

      // 更新模板
      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }))
      },

      // 删除模板
      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }))
      },

      // 复制模板
      duplicateTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id)
        if (!template) throw new Error('Template not found')

        const newTemplate: Template = {
          ...template,
          id: nanoid(),
          title: `${template.title} (副本)`,
          usageCount: 0,
          createdAt: Date.now(),
        }

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }))

        return newTemplate
      },

      // 增加使用次数
      incrementUsage: (id) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t
          ),
        }))
      },

      // 按分类获取
      getTemplatesByCategory: (category) => {
        return get().templates.filter((t) => t.category === category)
      },

      // 获取所有分类
      getAllCategories: () => {
        const categories = new Set(
          get().templates.map((t) => t.category).filter(Boolean)
        )
        return Array.from(categories) as string[]
      },

      // 初始化
      initialize: async () => {
        const { templates } = get()

        // 如果没有模板，创建一些默认模板
        if (templates.length === 0) {
          // 简单文本处理流程
          get().createTemplate(
            '简单文本处理',
            '基础的文本输入和 AI 处理流程',
            [
              {
                id: 'content-1',
                type: 'content',
                position: { x: 100, y: 100 },
                data: { label: '文本输入', mode: 'text' },
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                data: { label: 'AI 处理' },
              },
              {
                id: 'output-1',
                type: 'output',
                position: { x: 700, y: 100 },
                data: { label: '输出结果' },
              },
            ],
            [
              { id: 'e1', source: 'content-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'output-1', type: 'smoothstep' },
            ],
            '基础'
          )

          // YouTube 视频总结
          get().createTemplate(
            'YouTube 视频总结',
            '抓取 YouTube 视频转录并用 AI 总结',
            [
              {
                id: 'content-1',
                type: 'content',
                position: { x: 100, y: 100 },
                data: { label: 'YouTube 链接', mode: 'youtube' },
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                data: { label: 'AI 总结' },
              },
              {
                id: 'output-1',
                type: 'output',
                position: { x: 700, y: 100 },
                data: { label: '输出摘要' },
              },
            ],
            [
              { id: 'e1', source: 'content-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'output-1', type: 'smoothstep' },
            ],
            '内容处理'
          )

          // 网页内容分析
          get().createTemplate(
            '网页内容分析',
            '抓取网页内容并进行 AI 分析',
            [
              {
                id: 'browser-1',
                type: 'browser',
                position: { x: 100, y: 100 },
                data: { label: '网页抓取' },
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                data: { label: 'AI 分析' },
              },
              {
                id: 'output-1',
                type: 'output',
                position: { x: 700, y: 100 },
                data: { label: '分析报告' },
              },
            ],
            [
              { id: 'e1', source: 'browser-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'output-1', type: 'smoothstep' },
            ],
            '内容处理'
          )
        }
      },
    }),
    {
      name: 'cnote-templates',
      storage: createJSONStorage(() => localForageStorage),
    }
  )
)
