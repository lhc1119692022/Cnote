import type { FlowNode, FlowEdge } from '@/types/flow'

/**
 * 拓扑排序 - 获取节点执行顺序
 * @param nodes 所有节点
 * @param edges 所有边
 * @returns 排序后的节点 ID 数组
 */
export function topologicalSort(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  // 构建邻接表和入度表
  const adjList = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  // 初始化
  nodes.forEach((node) => {
    adjList.set(node.id, [])
    inDegree.set(node.id, 0)
  })

  // 构建图
  edges.forEach((edge) => {
    const from = edge.source
    const to = edge.target

    adjList.get(from)?.push(to)
    inDegree.set(to, (inDegree.get(to) || 0) + 1)
  })

  // 找出所有入度为 0 的节点（起始节点）
  const queue: string[] = []
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId)
    }
  })

  // Kahn 算法
  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)

    const neighbors = adjList.get(current) || []
    neighbors.forEach((neighbor) => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, newDegree)

      if (newDegree === 0) {
        queue.push(neighbor)
      }
    })
  }

  // 检测环
  if (sorted.length !== nodes.length) {
    throw new Error('Flow contains cycles')
  }

  return sorted
}

/**
 * 检测是否存在环
 */
export function hasCycle(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  try {
    topologicalSort(nodes, edges)
    return false
  } catch {
    return true
  }
}

/**
 * 获取节点的所有前驱节点
 */
export function getPredecessors(nodeId: string, edges: FlowEdge[]): string[] {
  return edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)
}

/**
 * 获取节点的所有后继节点
 */
export function getSuccessors(nodeId: string, edges: FlowEdge[]): string[] {
  return edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target)
}

/**
 * 查找所有起始节点（没有输入的节点）
 */
export function findStartNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const targetIds = new Set(edges.map((edge) => edge.target))
  return nodes.filter((node) => !targetIds.has(node.id))
}

/**
 * 查找所有终止节点（没有输出的节点）
 */
export function findEndNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const sourceIds = new Set(edges.map((edge) => edge.source))
  return nodes.filter((node) => !sourceIds.has(node.id))
}

/**
 * 获取从起始节点到目标节点的所有路径
 */
export function findAllPaths(
  startId: string,
  endId: string,
  edges: FlowEdge[]
): string[][] {
  const paths: string[][] = []
  const visited = new Set<string>()

  function dfs(current: string, path: string[]) {
    if (current === endId) {
      paths.push([...path, current])
      return
    }

    if (visited.has(current)) return

    visited.add(current)
    path.push(current)

    const successors = getSuccessors(current, edges)
    successors.forEach((next) => {
      dfs(next, [...path])
    })

    visited.delete(current)
  }

  dfs(startId, [])
  return paths
}

/**
 * 计算节点的层级（用于可视化布局）
 */
export function calculateNodeLevels(
  nodes: FlowNode[],
  edges: FlowEdge[]
): Map<string, number> {
  const levels = new Map<string, number>()
  const sorted = topologicalSort(nodes, edges)

  sorted.forEach((nodeId) => {
    const predecessors = getPredecessors(nodeId, edges)
    if (predecessors.length === 0) {
      levels.set(nodeId, 0)
    } else {
      const maxPredLevel = Math.max(
        ...predecessors.map((predId) => levels.get(predId) || 0)
      )
      levels.set(nodeId, maxPredLevel + 1)
    }
  })

  return levels
}
