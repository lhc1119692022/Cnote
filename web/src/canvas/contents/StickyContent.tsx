/**
 * 便签内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 * 壳 header 在世界坐标，内容层只平移不缩放，因此用 zoom 把 header 高度换成屏幕像素，避免色点落到壳的点击热区下。
 */

import { memo, useEffect, useState } from 'react'
import type { StickyColor, StickyNodeSpec, NodeSpec } from '@/domain'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvas } from '@/canvas/components'

/** 与 NodeShell header `h-9` 对齐（世界像素） */
const SHELL_HEADER_WORLD_PX = 36

const STICKY_PALETTE: Record<StickyColor, { fill: string; border: string; label: string }> = {
  yellow: { fill: '#fef3c7', border: '#fbbf24', label: '黄色' },
  pink: { fill: '#fce7f3', border: '#ec4899', label: '粉色' },
  blue: { fill: '#dbeafe', border: '#3b82f6', label: '蓝色' },
  green: { fill: '#d1fae5', border: '#10b981', label: '绿色' },
  purple: { fill: '#e9d5ff', border: '#a855f7', label: '紫色' },
}

const STICKY_COLOR_ORDER: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple']

function patchSticky(id: string, patch: Partial<StickyNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

export const StickyContent = memo(function StickyContent({ node }: { node: StickyNodeSpec }) {
  const { viewport } = useCanvas()
  const [content, setContent] = useState(node.content)
  const theme = STICKY_PALETTE[node.color] ?? STICKY_PALETTE.yellow
  const headerOffset = SHELL_HEADER_WORLD_PX * viewport.zoom
  const fill = node.background === 'none' ? 'transparent' : theme.fill

  useEffect(() => {
    setContent(node.content)
  }, [node.content])

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl"
      style={{
        backgroundColor: fill,
        border: `1px solid ${theme.border}`,
        paddingTop: headerOffset,
      }}
    >
      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5" role="group" aria-label="便签颜色">
        {STICKY_COLOR_ORDER.map((color) => {
          const swatch = STICKY_PALETTE[color]
          const active = color === node.color
          return (
            <button
              key={color}
              type="button"
              title={swatch.label}
              aria-label={`切换为${swatch.label}便签`}
              aria-pressed={active}
              className="h-4 w-4 shrink-0 rounded-full border border-black/10 transition-transform hover:scale-110"
              style={{
                backgroundColor: swatch.fill,
                boxShadow: active ? `0 0 0 2px ${swatch.border}` : undefined,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                if (color === node.color) return
                patchSticky(node.id, { color })
                useGraphStore.getState().commitHistory()
              }}
            />
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
        <RichTextEditor
          key={node.id}
          value={content}
          onChange={(value, document) => {
            // 富文本文档后续走 ContentAsset / 独立存储，现阶段只把纯文本 content 写回声明。
            void document
            setContent(value)
            patchSticky(node.id, { content: value })
          }}
          onCommit={() => {
            useGraphStore.getState().commitHistory()
          }}
          placeholder="添加备注..."
          className="h-full text-[#1d1d1f]"
        />
      </div>
    </div>
  )
})
