/**
 * 世界坐标 SVG 边层：显示层与命中层拆开。
 * 单层 SVG 根设 pointer-events:none 时，子 path 即使 stroke 命中也会被整棵子树穿透。
 * 点击边只选中并高亮；选中边在曲线附近显示删除按钮。
 */

import { createPortal } from 'react-dom'
import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { Unplug } from 'lucide-react'
import { cubicBezierPoint, edgePathPoints, nodeRect } from '@/canvas'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { useCanvas } from './CanvasProvider'

export function EdgeLayer() {
  const { nodes, edges, worldToScreen, containerRef } = useCanvas()
  const selectedEdgeId = useUiStore((state) => state.selectedEdgeId)
  const isLocked = useGraphStore((state) => state.isLocked)
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  useEffect(() => {
    if (!selectedEdgeId) return
    if (edges.some((edge) => edge.id === selectedEdgeId)) return
    useUiStore.getState().setSelectedEdgeId(null)
  }, [edges, selectedEdgeId])

  const paths = edges.flatMap((edge) => {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) return []
    const pts = edgePathPoints(nodeRect(source), nodeRect(target))
    const screen = {
      source: worldToScreen(pts.source),
      controlA: worldToScreen(pts.controlA),
      controlB: worldToScreen(pts.controlB),
      target: worldToScreen(pts.target),
    }
    const d = `M ${screen.source.x} ${screen.source.y} C ${screen.controlA.x} ${screen.controlA.y}, ${screen.controlB.x} ${screen.controlB.y}, ${screen.target.x} ${screen.target.y}`
    return [{ id: edge.id, d, pts: screen }]
  })

  const selectedPath = paths.find((path) => path.id === selectedEdgeId)
  const selectedMid = selectedPath
    ? cubicBezierPoint(
        selectedPath.pts.source,
        selectedPath.pts.controlA,
        selectedPath.pts.controlB,
        selectedPath.pts.target,
        0.5,
      )
    : null

  const onEdgePointerDown = (event: ReactPointerEvent<SVGPathElement>, edgeId: string) => {
    event.stopPropagation()
    event.preventDefault()
    useGraphStore.getState().setSelection([])
    useUiStore.getState().setSelectedEdgeId(edgeId)
  }

  const onDeleteEdge = (edgeId: string) => {
    if (useGraphStore.getState().isLocked) return
    useGraphStore.getState().deleteEdge(edgeId)
    useUiStore.getState().setSelectedEdgeId(null)
  }

  return (
    <>
      {/* 显示层：根 none，不拦截空白；只画可见描边 */}
      <svg
        className="absolute left-0 top-0 overflow-visible"
        style={{ pointerEvents: 'none' }}
        width="100%"
        height="100%"
        overflow="visible"
        aria-hidden
      >
        {paths.map((path) => {
          const selected = path.id === selectedEdgeId
          return (
            <path
              key={path.id}
              d={path.d}
              fill="none"
              stroke={selected ? 'var(--primary)' : 'var(--border)'}
              strokeWidth={selected ? 2.25 : 1.5}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          )
        })}
      </svg>
      {/* 命中层：根默认 auto，仅含透明 stroke path（fill:none），空白不拦截 */}
      <svg
        className="absolute left-0 top-0 overflow-visible"
        width="100%"
        height="100%"
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
      {selectedPath && selectedMid && containerRef.current
        ? createPortal(
            (() => {
              const rect = containerRef.current!.getBoundingClientRect()
              return (
                <button
                  type="button"
                  className="pointer-events-auto fixed z-[100] flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    left: rect.left + selectedMid.x,
                    top: rect.top + selectedMid.y,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-label="删除连线"
                  title="删除连线"
                  disabled={isLocked}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDeleteEdge(selectedPath.id)
                  }}
                >
                  <Unplug className="h-4 w-4" aria-hidden />
                </button>
              )
            })(),
            document.body,
          )
        : null}
    </>
  )
}
