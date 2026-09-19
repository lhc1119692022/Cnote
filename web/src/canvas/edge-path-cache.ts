import type { EdgeSpec, NodeSpec } from '@/domain'
import { nodeRect } from './geometry'
import { edgePathPoints } from './edges'

export function createEdgePathCache() {
  type Path = { id: string; d: string; pts: ReturnType<typeof edgePathPoints> }
  let cache = new Map<string, { signature: string; path: Path }>()
  return (nodes: readonly NodeSpec[], edges: readonly EdgeSpec[]) => {
    const nodeMap = new Map(nodes.map(node => [node.id, node]))
    const next = new Map<string, { signature: string; path: Path }>()
    const paths: Path[] = []
    for (const edge of edges) {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (!source || !target) continue
      const signature = [source.position.x, source.position.y, source.size.width, source.size.height,
        target.position.x, target.position.y, target.size.width, target.size.height].join(',')
      let entry = cache.get(edge.id)
      if (!entry || entry.signature !== signature) {
        const pts = edgePathPoints(nodeRect(source), nodeRect(target))
        const path = { id: edge.id, pts, d: `M ${pts.source.x} ${pts.source.y} C ${pts.controlA.x} ${pts.controlA.y}, ${pts.controlB.x} ${pts.controlB.y}, ${pts.target.x} ${pts.target.y}` }
        entry = { signature, path }
      }
      next.set(edge.id, entry)
      paths.push(entry.path)
    }
    cache = next
    return paths
  }
}
