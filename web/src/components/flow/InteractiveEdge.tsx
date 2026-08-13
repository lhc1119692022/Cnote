import { memo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, EdgeProps, Position, getBezierPath } from 'reactflow'
import { Eye, Unplug } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'

export const InteractiveEdge = memo(({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) => {
  const [isHovered, setIsHovered] = useState(false)
  // Extend the rendered path beneath the enlarged 64px hit target so the
  // visible line still meets the card edge instead of stopping at the handle.
  const handleRadius = 32
  const visibleSourceX = sourcePosition === Position.Right ? sourceX - handleRadius : sourcePosition === Position.Left ? sourceX + handleRadius : sourceX
  const visibleTargetX = targetPosition === Position.Left ? targetX + handleRadius : targetPosition === Position.Right ? targetX - handleRadius : targetX
  const [path, labelX, labelY] = getBezierPath({ sourceX: visibleSourceX, sourceY, sourcePosition, targetX: visibleTargetX, targetY, targetPosition })
  const endpointSelected = useFlowStore((state) => state.nodes.some((node) => (node.id === source || node.id === target) && node.selected))
  const updateNode = useFlowStore((state) => state.updateNode)
  const deleteEdge = useFlowStore((state) => state.deleteEdge)
  const actionsVisible = Boolean(selected || endpointSelected || isHovered)

  const toggleDownstream = () => {
    const { nodes, edges } = useFlowStore.getState()
    const targetNode = nodes.find((node) => node.id === target)
    const nextDisabled = !Boolean(targetNode?.data?.disabled)
    const queue = [target]
    const visited = new Set<string>()
    while (queue.length) {
      const nodeId = queue.shift() as string
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
      if (node) updateNode(nodeId, { data: { ...node.data, disabled: nextDisabled, enabled: !nextDisabled } })
      edges.filter((edge) => edge.source === nodeId).forEach((edge) => queue.push(edge.target))
    }
  }

  return (
    <>
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <BaseEdge
          id={id}
          path={path}
          interactionWidth={32}
          style={{
            stroke: selected ? 'var(--primary)' : 'var(--border)',
            strokeWidth: selected ? 2.25 : 1.5,
          }}
        />
      </g>
      <EdgeLabelRenderer>
        <div data-edge-actions aria-hidden={!actionsVisible} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} className={`nodrag nopan absolute left-0 top-0 flex items-center rounded-full border border-border bg-card p-0.5 shadow-sm transition-opacity duration-150 ${actionsVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>
          <button type="button" tabIndex={actionsVisible ? 0 : -1} className="group relative flex h-[42px] w-[42px] items-center justify-center text-muted-foreground transition-colors hover:text-foreground" aria-label="切换下游节点状态" title="切换下游节点状态" onClick={toggleDownstream}><span className="absolute inset-1 rounded-full bg-transparent transition-colors group-hover:bg-muted" /><Eye className="relative z-10 h-5 w-5 stroke-[2]" /></button>
          <span className="h-6 w-px bg-border" />
          <button type="button" tabIndex={actionsVisible ? 0 : -1} className="group relative flex h-[42px] w-[42px] items-center justify-center text-muted-foreground transition-colors hover:text-destructive" aria-label="断开连接" title="断开连接" onClick={() => deleteEdge(id)}><span className="absolute inset-1 rounded-full bg-transparent transition-colors group-hover:bg-muted" /><Unplug className="relative z-10 h-5 w-5 stroke-[2]" /></button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

InteractiveEdge.displayName = 'InteractiveEdge'
