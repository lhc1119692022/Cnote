import type { Edge, Node } from 'reactflow'

export interface DisabledNodeState {
  disabled: boolean
  disabledByGraph: boolean
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isLegacyDisabledNode(node: Pick<Node, 'type' | 'data'>) {
  const data = (node.data || {}) as Record<string, unknown>
  if (data.disabledByUser === undefined && data.disabledByGraph !== true && node.type === 'ai' && (!data.channelId || !data.model)) return false
  return data.disabledByUser === undefined && data.disabledByGraph !== true && (data.disabled === true || data.enabled === false)
}

function hasIntrinsicDisabledState(node: Pick<Node, 'type' | 'data'>) {
  const data = (node.data || {}) as Record<string, unknown>
  if (data.resourceLost || data.state === 'missing') return true
  if (data.disabledByUser === true || data.hidden) return true
  return data.disabledByGraph === true
}

function isLegacyAiDisabledWithoutConfiguration(node: Pick<Node, 'type' | 'data'>) {
  const data = (node.data || {}) as Record<string, unknown>
  return node.type === 'ai' && data.disabledByUser === undefined && data.disabledByGraph !== true && (!data.channelId || !data.model) && (data.disabled === true || data.enabled === false)
}

function getLegacyUserDisabledIds(nodes: Node[], edges: Edge[]) {
  const legacyIds = new Set(nodes.filter(isLegacyDisabledNode).map((node) => node.id))
  return new Set(nodes
    .filter((node) => legacyIds.has(node.id))
    .filter((node) => !edges.some((edge) => {
      if (edge.target !== node.id) return false
      const source = nodes.find((item) => item.id === edge.source)
      return legacyIds.has(edge.source) || (source ? hasIntrinsicDisabledState(source) : false)
    }))
    .map((node) => node.id))
}

export function getNodeBaseDisabled(node: Pick<Node, 'type' | 'data'>, legacyUserDisabledIds?: ReadonlySet<string>) {
  const data = (node.data || {}) as Record<string, unknown>
  if (data.resourceLost || data.state === 'missing') return true
  if (isLegacyAiDisabledWithoutConfiguration(node)) return false
  if (typeof data.disabledByUser === 'boolean') return data.disabledByUser
  if (data.disabledByGraph) return false
  if (isLegacyDisabledNode(node)) return legacyUserDisabledIds ? legacyUserDisabledIds.has((node as Node).id) : true
  return Boolean(data.disabled || data.enabled === false || data.hidden)
}

export function getDisabledNodeStates(nodes: Node[], edges: Edge[]) {
  const states = new Map<string, DisabledNodeState>()
  const legacyUserDisabledIds = getLegacyUserDisabledIds(nodes, edges)

  nodes.forEach((node) => {
    states.set(node.id, {
      disabled: getNodeBaseDisabled(node, legacyUserDisabledIds),
      disabledByGraph: false,
    })
  })

  let changed = true
  while (changed) {
    changed = false
    nodes.forEach((node) => {
      const current = states.get(node.id)
      if (!current) return
      const disabledByGraph = edges.some((edge) =>
        edge.target === node.id && Boolean(states.get(edge.source)?.disabled),
      )
      const nextDisabled = getNodeBaseDisabled(node, legacyUserDisabledIds) || disabledByGraph
      if (current.disabled === nextDisabled && current.disabledByGraph === disabledByGraph) return
      states.set(node.id, { disabled: nextDisabled, disabledByGraph })
      changed = true
    })
  }

  return states
}

export function reconcileDisabledNodes(nodes: Node[], edges: Edge[]) {
  const states = getDisabledNodeStates(nodes, edges)

  return nodes.map((node) => {
    const state = states.get(node.id)
    if (!state) return node
    const data = (node.data || {}) as Record<string, unknown>
    const nextData = { ...data }
    let changed = false

    if (state.disabled || hasOwn(data, 'disabled') || hasOwn(data, 'disabledByGraph')) {
      if (data.disabled !== state.disabled) {
        nextData.disabled = state.disabled
        changed = true
      }
    }
    if (state.disabledByGraph || data.disabledByGraph) {
      const nextValue = state.disabledByGraph ? true : undefined
      if (data.disabledByGraph !== nextValue) {
        nextData.disabledByGraph = nextValue
        changed = true
      }
    }
    if (state.disabled || hasOwn(data, 'enabled')) {
      const nextValue = !state.disabled
      if (data.enabled !== nextValue) {
        nextData.enabled = nextValue
        changed = true
      }
    }

    return changed ? { ...node, data: nextData } : node
  })
}

export function hasNodeConnections(nodeId: string, edges: Edge[]) {
  return edges.some((edge) => edge.source === nodeId || edge.target === nodeId)
}