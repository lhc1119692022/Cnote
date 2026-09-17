import type { NodeSpec, Point } from '@/domain'
import { nodeRect, pointInRect } from './geometry'

export interface NodeStackInteraction {
  hoveredNodeId: string | null
  focusedNodeId: string | null
  resizingNodeId?: string
  draggingNodeIds: readonly string[]
}

export function nodeFrontOrder(nodes: readonly Pick<NodeSpec, 'z'>[]): number {
  return nodes.reduce((highest, node) => Math.max(highest, node.z ?? 0), 0) + 1
}

export function hitTestStackedNode(nodes: readonly NodeSpec[], world: Point, interaction: NodeStackInteraction, includeInputHandle = false): string | undefined {
  const frontZ = nodeFrontOrder(nodes)
  let found: NodeSpec | undefined
  for (const node of nodes) {
    const inputHandleHit = includeInputHandle && Math.hypot(
      world.x - node.position.x,
      world.y - node.position.y - node.size.height / 2,
    ) <= 32
    if (!pointInRect(world, nodeRect(node)) && !inputHandleHit) continue
    if (!found) {
      found = node
      continue
    }
    if ((node.kind === 'group') !== (found.kind === 'group')) {
      if (node.kind !== 'group') found = node
      continue
    }
    if (nodeStackOrder(node, frontZ, interaction) >= nodeStackOrder(found, frontZ, interaction)) found = node
  }
  return found?.id
}

export function nodeStackOrder(node: Pick<NodeSpec, 'id' | 'kind' | 'z'>, frontZ: number, interaction: NodeStackInteraction): number {
  const base = node.z ?? 0
  if (node.kind === 'group') return base
  if (interaction.resizingNodeId === node.id || interaction.draggingNodeIds.includes(node.id)) return frontZ + 2
  if (interaction.hoveredNodeId === node.id) return frontZ + 1
  if (interaction.focusedNodeId === node.id) return frontZ
  return base
}
