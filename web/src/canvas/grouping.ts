/**
 * Group membership helpers. Member positions stay in absolute world coordinates.
 * parentGroupId is membership only — never a React Flow parent transform.
 */

import { nanoid } from 'nanoid'
import type { GroupNodeSpec, NodeSpec, Point } from '@/domain'
import { GROUP_NODE_PADDING } from '@/lib/flow/node-dimensions'
import { nodeRect, pointInRect, unionRect } from './geometry'

export const NODE_OUTLINE_GAP = 40

const GROUP_MIN_SIZE = { width: 160, height: 120 }

export function membersOf(nodes: readonly NodeSpec[], groupId: string): NodeSpec[] {
  return nodes.filter((node) => node.parentGroupId === groupId)
}

export function unionNodeBounds(nodes: readonly NodeSpec[]): ReturnType<typeof nodeRect> | null {
  const first = nodes[0]
  if (!first) return null
  return nodes.slice(1).reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
}

/** Offset so copied outlines sit `gap` world-pixels to the right of the originals. */
export function outlineGapOffset(nodes: readonly NodeSpec[], gap = NODE_OUTLINE_GAP): Point {
  const bounds = unionNodeBounds(nodes)
  if (!bounds) return { x: gap, y: 0 }
  return { x: bounds.width + gap, y: 0 }
}

export function expandDragIds(nodes: readonly NodeSpec[], ids: readonly string[]): string[] {
  const set = new Set(ids)
  for (const id of ids) {
    const node = nodes.find((candidate) => candidate.id === id)
    if (node?.kind !== 'group') continue
    for (const member of membersOf(nodes, id)) set.add(member.id)
  }
  return [...set]
}

export function movableDragIds(nodes: readonly NodeSpec[], ids: readonly string[]): string[] {
  const expanded = new Set(expandDragIds(nodes, ids))
  return nodes.filter((node) => expanded.has(node.id) && !(node.kind === 'sticky' && node.pinned)).map((node) => node.id)
}

export function createGroupFromNodes(
  nodes: readonly NodeSpec[],
  memberIds: readonly string[],
): { nodes: NodeSpec[]; groupId: string } | null {
  const selected = new Set(memberIds)
  const members = nodes.filter((node) => selected.has(node.id) && node.kind !== 'group')
  if (members.length < 2) return null

  const first = members[0]
  if (!first) return null
  const bounds = members.slice(1).reduce((acc, node) => unionRect(acc, nodeRect(node)), nodeRect(first))
  const padding = GROUP_NODE_PADDING
  const groupId = nanoid()
  const groupCount = nodes.filter((node) => node.kind === 'group').length + 1
  const group: GroupNodeSpec = {
    id: groupId,
    kind: 'group',
    position: { x: bounds.x - padding, y: bounds.y - padding },
    size: {
      width: Math.max(GROUP_MIN_SIZE.width, bounds.width + padding * 2),
      height: Math.max(GROUP_MIN_SIZE.height, bounds.height + padding * 2),
    },
    label: groupCount === 1 ? '编组' : `编组 ${groupCount}`,
    memberCount: members.length,
    padding,
    z: 0,
  }

  const memberIdSet = new Set(members.map((member) => member.id))
  return {
    groupId,
    nodes: [
      group,
      ...nodes.map((node) => {
        if (!memberIdSet.has(node.id)) return node
        return {
          ...node,
          parentGroupId: groupId,
          z: Math.max(node.z ?? 1, 1),
        }
      }),
    ],
  }
}

export function ungroupNode(nodes: readonly NodeSpec[], groupId: string): NodeSpec[] {
  return nodes
    .filter((node) => node.id !== groupId)
    .map((node) => (node.parentGroupId === groupId ? { ...node, parentGroupId: undefined } : node))
}

export function expandGroupsToMembers(nodes: readonly NodeSpec[]): NodeSpec[] {
  return nodes.map((node) => {
    if (node.kind !== 'group') return node
    const members = membersOf(nodes, node.id)
    if (members.length === 0) return node
    const bounds = unionNodeBounds(members)
    if (!bounds) return node
    const padding = node.padding ?? GROUP_NODE_PADDING
    const next = {
      ...node,
      position: { x: bounds.x - padding, y: bounds.y - padding },
      size: {
        width: Math.max(GROUP_MIN_SIZE.width, bounds.width + padding * 2),
        height: Math.max(GROUP_MIN_SIZE.height, bounds.height + padding * 2),
      },
      memberCount: members.length,
    }
    if (
      next.position.x === node.position.x
      && next.position.y === node.position.y
      && next.size.width === node.size.width
      && next.size.height === node.size.height
      && next.memberCount === node.memberCount
    ) return node
    return next
  })
}

export function assignNodeToOverlappingGroup(nodes: readonly NodeSpec[], nodeId: string): NodeSpec[] {
  return assignNodesToOverlappingGroups(nodes, [nodeId])
}

export function assignNodesToOverlappingGroups(nodes: readonly NodeSpec[], nodeIds: readonly string[]): NodeSpec[] {
  const moved = new Set(nodeIds)
  const groups = nodes.filter((node) => node.kind === 'group')
  const next = nodes.map((node) => {
    if (!moved.has(node.id) || node.kind === 'group' || (node.kind === 'sticky' && node.pinned)) return node
    if (node.parentGroupId && moved.has(node.parentGroupId)) return node
    const center = { x: node.position.x + node.size.width / 2, y: node.position.y + node.size.height / 2 }
    let target: NodeSpec | undefined
    for (const group of groups) {
      if (!pointInRect(center, nodeRect(group))) continue
      if (!target || (group.z ?? 0) >= (target.z ?? 0)) target = group
    }
    if (target?.id === node.parentGroupId) return node
    return { ...node, parentGroupId: target?.id, z: target ? Math.max(node.z ?? 1, 1) : node.z }
  })
  return expandGroupsToMembers(syncGroupCounts(next))
}

export function syncGroupCounts(nodes: readonly NodeSpec[]): NodeSpec[] {
  let emptied: string[] = []
  const counted = nodes.map((node) => {
    if (node.kind !== 'group') return node
    const memberCount = membersOf(nodes, node.id).length
    if (memberCount < 2) emptied = [...emptied, node.id]
    if (memberCount === node.memberCount) return node
    return { ...node, memberCount }
  })
  return emptied.reduce((next, groupId) => ungroupNode(next, groupId), counted)
}
