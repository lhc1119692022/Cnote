import type { NodeSpec, Point, Size } from '@/domain'

export function placeNewestResult(nodes: NodeSpec[], ownerId: string, position: Point, size: Size, gap: number) {
  const movable = nodes.filter((node) => node.kind === 'content' && node.generatedBy?.requestNodeId === ownerId && !node.generatedBy.detached)
  const fixed = nodes.filter((node) => !movable.includes(node) && node.kind !== 'group')
  const overlaps = (point: Point, dimensions: Size, node: Pick<NodeSpec, 'position' | 'size'>) => point.x < node.position.x + node.size.width + gap && point.x + dimensions.width + gap > node.position.x && point.y < node.position.y + node.size.height + gap && point.y + dimensions.height + gap > node.position.y
  const freePosition = (start: Point, dimensions: Size, obstacles: Pick<NodeSpec, 'position' | 'size'>[]) => {
    const next = { ...start }
    let collisions = obstacles.filter((node) => overlaps(next, dimensions, node))
    while (collisions.length) {
      next.y = Math.max(...collisions.map((node) => node.position.y + node.size.height + gap))
      collisions = obstacles.filter((node) => overlaps(next, dimensions, node))
    }
    return next
  }
  const newest = freePosition(position, size, fixed)
  const occupied: Pick<NodeSpec, 'position' | 'size'>[] = [...fixed, { position: newest, size }]
  const relocated = new Map<string, Point>()
  for (const node of movable.sort((left, right) => left.position.y - right.position.y)) {
    const next = freePosition(node.position, node.size, occupied)
    relocated.set(node.id, next)
    occupied.push({ position: next, size: node.size })
  }
  return { position: newest, nodes: nodes.map((node) => relocated.has(node.id) ? { ...node, position: relocated.get(node.id)! } : node) }
}
