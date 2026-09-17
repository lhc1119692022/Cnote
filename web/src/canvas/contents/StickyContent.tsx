/**
 * 便签内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 */

import { memo } from 'react'
import type { StickyNodeSpec, NodeSpec } from '@/domain'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useGraphStore } from '@/stores/graph-store'
import { STICKY_PALETTE } from '@/canvas/sticky-palette'

function patchSticky(id: string, patch: Partial<StickyNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

export const StickyContent = memo(function StickyContent({ node }: { node: StickyNodeSpec }) {
  const theme = STICKY_PALETTE[node.color] ?? STICKY_PALETTE.yellow
  const fill = node.background === 'none' ? 'transparent' : theme.fill

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl"
      style={{
        backgroundColor: fill,
        border: `1px solid ${theme.border}`,
      }}
    >
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
        <RichTextEditor
          compactToolbar
          key={node.id}
          value={node.content}
          document={node.document}
          onChange={(value, document) => {
            patchSticky(node.id, { content: value, document })
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
