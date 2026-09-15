/**
 * 世界坐标 SVG 边层：显示层与命中层拆开。
 * 单层 SVG 根设 pointer-events:none 时，子 path 即使 stroke 命中也会被整棵子树穿透。
 * 当前点边即删除，选中态后续加。
 */

import type { PointerEvent as ReactPointerEvent } from 'react'
import { edgePathPoints, nodeRect } from '@/canvas'
import { useGraphStore } from '@/stores/graph-store'
import { useCanvas } from './CanvasProvider'

export function EdgeLayer() {
  const { nodes, edges } = useCanvas()
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  const paths = edges.flatMap((edge) => {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) return []
    const pts = edgePathPoints(nodeRect(source), nodeRect(target))
    const d = `M ${pts.source.x} ${pts.source.y} C ${pts.controlA.x} ${pts.controlA.y}, ${pts.controlB.x} ${pts.controlB.y}, ${pts.target.x} ${pts.target.y}`
    return [{ id: edge.id, d }]
  })

  const onEdgePointerDown = (event: ReactPointerEvent<SVGPathElement>, edgeId: string) => {
    event.stopPropagation()
    event.preventDefault()
    const graph = useGraphStore.getState()
    if (graph.isLocked) return
    graph.deleteEdge(edgeId)
  }

  return (
    <>
      {/* 显示层：根 none，不拦截空白；只画可见描边 */}
      <svg
        className="absolute left-0 top-0 overflow-visible"
        style={{ pointerEvents: 'none' }}
        width={1}
        height={1}
        overflow="visible"
        aria-hidden
      >
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        ))}
      </svg>
      {/* 命中层：根默认 auto，仅含透明 stroke path（fill:none），空白不拦截 */}
      <svg
        className="absolute left-0 top-0 overflow-visible"
        width={1}
        height={1}
        overflow="visible"
        aria-hidden
      >
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(event) => onEdgePointerDown(event, path.id)}
          />
        ))}
      </svg>
    </>
  )
}
