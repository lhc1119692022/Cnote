/**
 * AI / Request / Content 节点的过渡壳。
 * 阶段 6 先让新画布能打开含这些类型的文档，避免白屏。
 * 后续替换为真正的 AIContent / RequestContent / ContentNodeContent。
 *
 * 只在内容抬升层渲染：根节点 w-full h-full，不做 scale/transform。
 */

import { memo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Layers3, Sparkles } from 'lucide-react'
import type { AINodeSpec, ContentNodeSpec, RequestNodeSpec } from '@/domain'
export type PlaceholderNodeSpec = AINodeSpec | RequestNodeSpec | ContentNodeSpec

const KIND_ICON: Record<PlaceholderNodeSpec['kind'], LucideIcon> = {
  ai: Sparkles,
  request: Sparkles,
  content: Layers3,
}

const KIND_ICON_CLASS: Record<PlaceholderNodeSpec['kind'], string> = {
  ai: 'text-violet-500',
  request: 'text-primary',
  content: 'text-blue-500',
}

const KIND_LABEL: Record<PlaceholderNodeSpec['kind'], string> = {
  ai: 'AI',
  request: '生成',
  content: '内容',
}

export const ContentPlaceholder = memo(function ContentPlaceholder({
  node,
}: {
  node: PlaceholderNodeSpec
}) {
  const Icon = KIND_ICON[node.kind]

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <Icon className={`h-6 w-6 ${KIND_ICON_CLASS[node.kind]}`} aria-hidden />
        <div className="min-w-0 max-w-full truncate text-sm font-medium text-foreground">
          {node.label || KIND_LABEL[node.kind]}
        </div>
        <p className="text-xs text-muted-foreground">打开节点后可继续编辑</p>
      </div>
    </div>
  )
})
