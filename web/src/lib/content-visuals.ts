import { AlignLeft, FileText, Image, Presentation, Share2, Table2, Workflow, Youtube, type LucideIcon } from 'lucide-react'
import type { ContentCategory } from '@/types/flow'

export type ContentCategoryId = ContentCategory

export interface ContentCategoryVisual {
  id: ContentCategoryId
  label: string
  icon: LucideIcon
  iconClass: string
  iconSurfaceClass: string
  hoverClass: string
}

export const contentCategoryVisuals: Record<ContentCategoryId, ContentCategoryVisual> = {
  text: { id: 'text', label: '文本', icon: AlignLeft, iconClass: 'text-slate-500', iconSurfaceClass: 'bg-slate-50', hoverClass: 'hover:border-slate-200 hover:bg-slate-50/60' },
  video: { id: 'video', label: '视频', icon: Youtube, iconClass: 'text-red-500', iconSurfaceClass: 'bg-red-50', hoverClass: 'hover:border-red-200 hover:bg-red-50/60' },
  social: { id: 'social', label: '社媒', icon: Share2, iconClass: 'text-pink-500', iconSurfaceClass: 'bg-pink-50', hoverClass: 'hover:border-pink-200 hover:bg-pink-50/60' },
  document: { id: 'document', label: '文档', icon: FileText, iconClass: 'text-blue-500', iconSurfaceClass: 'bg-blue-50', hoverClass: 'hover:border-blue-200 hover:bg-blue-50/60' },
  data: { id: 'data', label: '数据', icon: Table2, iconClass: 'text-emerald-500', iconSurfaceClass: 'bg-emerald-50', hoverClass: 'hover:border-emerald-200 hover:bg-emerald-50/60' },
  presentation: { id: 'presentation', label: '演示文稿', icon: Presentation, iconClass: 'text-orange-500', iconSurfaceClass: 'bg-orange-50', hoverClass: 'hover:border-orange-200 hover:bg-orange-50/60' },
  mindmap: { id: 'mindmap', label: '思维导图', icon: Workflow, iconClass: 'text-violet-500', iconSurfaceClass: 'bg-violet-50', hoverClass: 'hover:border-violet-200 hover:bg-violet-50/60' },
  image: { id: 'image', label: '图片', icon: Image, iconClass: 'text-cyan-500', iconSurfaceClass: 'bg-cyan-50', hoverClass: 'hover:border-cyan-200 hover:bg-cyan-50/60' },
}

export const contentCategoryOptions = Object.values(contentCategoryVisuals)

export function inferContentCategory(mode?: string, explicitCategory?: ContentCategoryId | string): ContentCategoryId | undefined {
  if (explicitCategory && explicitCategory in contentCategoryVisuals) return explicitCategory as ContentCategoryId
  if (mode === 'youtube' || mode === 'video') return 'video'
  if (mode === 'table') return 'data'
  if (mode === 'image') return 'image'
  if (mode === 'text') return 'text'
  if (mode === 'pdf') return 'document'
  return undefined
}

export function getContentCategoryVisual(mode?: string, explicitCategory?: ContentCategoryId | string) {
  const category = inferContentCategory(mode, explicitCategory)
  return category ? contentCategoryVisuals[category] : undefined
}
