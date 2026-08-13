import { memo } from 'react'
import { Link2Off, Layers3 } from 'lucide-react'
import type { NodeProps } from 'reactflow'
import type { GroupNodeData } from '@/types/flow'
import { useFlowStore } from '@/stores/use-flow-store'
import { NodeResizeArc } from './NodeChrome'

export const GroupNode = memo(({ id, data, selected }: NodeProps<GroupNodeData>) => {
  const deleteNode = useFlowStore((state) => state.deleteNode)
  return (
    <div className={`group-node relative h-full w-full rounded-[14px] ${selected ? 'group-node-selected' : ''}`}>
      <NodeResizeArc nodeId={id} minWidth={160} minHeight={120} />
      {selected && (
        <div className="absolute -top-12 left-0 z-30 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
          <Layers3 className="h-3.5 w-3.5 text-slate-500" />
          <span className="max-w-40 truncate font-medium text-foreground">{data.label || '编组'}</span>
          <span className="h-4 w-px bg-border" />
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={(event) => { event.stopPropagation(); deleteNode(id) }} title="解绑">
            <Link2Off className="h-3.5 w-3.5" />解绑
          </button>
        </div>
      )}
    </div>
  )
})

GroupNode.displayName = 'GroupNode'
