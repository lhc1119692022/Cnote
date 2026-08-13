import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { Node, Edge } from 'reactflow'
import { localForageStorage } from '@/lib/localforage-storage'
import type { Template } from '@/types/flow'
import { emptyContentData } from '@/lib/content-import'
import { deleteLocalResource, retainLocalResource } from '@/lib/resource-storage'
import { cloneFlowValue } from '@/lib/flow/clone'
import { AI_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'

function nodeResourceId(node?: Node) {
  const source = node?.data?.source
  return source?.kind === 'file' || source?.kind === 'clipboard-image'
    ? source.resourceId as string
    : undefined
}

function resourceCounts(nodes: Node[]) {
  const counts = new Map<string, number>()
  nodes.forEach((node) => {
    const resourceId = nodeResourceId(node)
    if (resourceId) counts.set(resourceId, (counts.get(resourceId) || 0) + 1)
  })
  return counts
}

async function adjustResourceReferences(fromNodes: Node[], toNodes: Node[]) {
  const from = resourceCounts(fromNodes)
  const to = resourceCounts(toNodes)
  const resourceIds = new Set([...from.keys(), ...to.keys()])
  await Promise.all([...resourceIds].map(async (resourceId) => {
    const delta = (to.get(resourceId) || 0) - (from.get(resourceId) || 0)
    if (delta > 0) {
      for (let index = 0; index < delta; index += 1) await retainLocalResource(resourceId)
    } else {
      for (let index = 0; index < Math.abs(delta); index += 1) await deleteLocalResource(resourceId)
    }
  }))
}

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
          nodes: nodes.map((node) => ({ ...cloneFlowValue(node), selected: false })),
          edges: edges.map((edge) => ({ ...cloneFlowValue(edge), selected: false })),
          category,
          usageCount: 0,
          createdAt: Date.now(),
        }

        set((state) => ({
          templates: [...state.templates, template],
        }))
        // 模板本身是独立快照；其本地 Blob 引用必须独立计数。
        template.nodes.forEach((node) => { void retainLocalResource(nodeResourceId(node)) })

        return template
      },

      // 获取模板
      getTemplate: (id) => {
        return get().templates.find((t) => t.id === id)
      },

      // 更新模板
      updateTemplate: (id, updates) => {
        const current = get().templates.find((template) => template.id === id)
        const nextUpdates = cloneFlowValue(updates)
        if (current && nextUpdates.nodes) void adjustResourceReferences(current.nodes, nextUpdates.nodes)
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...nextUpdates } : t
          ),
        }))
      },

      // 删除模板
      deleteTemplate: (id) => {
        const removed = get().templates.find((template) => template.id === id)
        removed?.nodes.forEach((node) => { void deleteLocalResource(nodeResourceId(node)) })
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }))
      },

      // 复制模板
      duplicateTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id)
        if (!template) throw new Error('Template not found')

        const newTemplate: Template = {
          ...cloneFlowValue(template),
          id: nanoid(),
          title: `${template.title} (副本)`,
          usageCount: 0,
          createdAt: Date.now(),
        }

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }))
        newTemplate.nodes.forEach((node) => { void retainLocalResource(nodeResourceId(node)) })

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
                data: emptyContentData('文本输入'),
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                style: AI_NODE_DEFAULT_SIZE,
                data: { label: 'AI 处理' },
              },
              {
                id: 'text-output-1',
                type: 'content',
                position: { x: 700, y: 100 },
                data: emptyContentData('输出结果'),
              },
            ],
            [
              { id: 'e1', source: 'content-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'text-output-1', type: 'smoothstep' },
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
                data: { ...emptyContentData('YouTube 链接'), category: 'video', subtype: 'youtube' },
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                style: AI_NODE_DEFAULT_SIZE,
                data: { label: 'AI 总结' },
              },
              {
                id: 'text-output-1',
                type: 'content',
                position: { x: 700, y: 100 },
                data: emptyContentData('输出摘要'),
              },
            ],
            [
              { id: 'e1', source: 'content-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'text-output-1', type: 'smoothstep' },
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
                data: {
                  label: '网页抓取',
                  url: 'https://www.baidu.com/',
                  confirmedUrl: 'https://www.baidu.com/',
                  outputMode: 'text',
                  syncStatus: 'synced',
                  status: 'loading',
                },
              },
              {
                id: 'ai-1',
                type: 'ai',
                position: { x: 400, y: 100 },
                style: AI_NODE_DEFAULT_SIZE,
                data: { label: 'AI 分析' },
              },
              {
                id: 'text-output-1',
                type: 'content',
                position: { x: 700, y: 100 },
                data: emptyContentData('分析报告'),
              },
            ],
            [
              { id: 'e1', source: 'browser-1', target: 'ai-1', type: 'smoothstep' },
              { id: 'e2', source: 'ai-1', target: 'text-output-1', type: 'smoothstep' },
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
