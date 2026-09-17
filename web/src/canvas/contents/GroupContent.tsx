import { memo } from 'react'
import type { GroupNodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvas } from '@/canvas/components/CanvasProvider'

export const GroupContent = memo(function GroupContent({ node }: { node: GroupNodeSpec }) {
  const selected = useGraphStore((state) => state.selection.includes(node.id))
  const { beginNodeDrag } = useCanvas()

  return (
    <div
      className={`group-node relative h-full w-full rounded-[14px] ${selected ? 'group-node-selected' : ''}`}
      onPointerDown={(event) => beginNodeDrag(event, node.id)}
    />
  )
})
