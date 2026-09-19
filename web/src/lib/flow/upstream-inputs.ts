import { contentNodeText } from '@/domain/content-text'
import type { AISession, Capture, NodeSpec } from '@/domain'

export interface UpstreamRuntime {
  captures?: Record<string, Capture>
  aiSessions?: Record<string, AISession>
}

export interface UpstreamInput {
  nodeId: string
  edgeIds: string[]
  label: string
  kind: NodeSpec['kind']
  text: string
  availability: 'ready' | 'url-only' | 'empty' | 'unsupported'
  resources: { assetId?: string; resourceId?: string; url?: string }[]
  node: NodeSpec
}

export function directUpstreamNodes(targetId: string, nodes: readonly NodeSpec[] = [], edges: readonly { id?: string; source: string; target: string }[] = []) {
  const index = new Map(nodes.map(node => [node.id, node]))
  const entries = new Map<string, { node: NodeSpec; edgeIds: string[] }>()
  for (const edge of edges) {
    if (edge.target !== targetId || edge.source === targetId) continue
    const node = index.get(edge.source)
    if (!node || node.disabled) continue
    let entry = entries.get(node.id)
    if (!entry) { entry = { node, edgeIds: [] }; entries.set(node.id, entry) }
    if (edge.id && !entry.edgeIds.includes(edge.id)) entry.edgeIds.push(edge.id)
  }
  return [...entries.values()]
}

export function upstreamNodeInput(node: NodeSpec, runtime: UpstreamRuntime = {}): Omit<UpstreamInput, 'edgeIds'> {
  let text = ''
  let availability: UpstreamInput['availability'] = 'empty'
  const resources: UpstreamInput['resources'] = []
  if (node.kind === 'content') {
    text = contentNodeText(node)?.trim() || ''
    if (node.assetId) resources.push({ assetId: node.assetId })
    if (node.source?.kind === 'file' || node.source?.kind === 'clipboard-image') resources.push({ assetId: node.source.assetId })
    if (node.source?.kind === 'url') resources.push({ url: node.source.url })
    if (node.payload?.kind === 'image' || node.payload?.kind === 'video') {
      for (const item of node.payload.resources ?? []) resources.push({ resourceId: item.resource.resourceId, url: item.resource.url })
    }
  } else if (node.kind === 'sticky') text = node.content.trim()
  else if (node.kind === 'browser') {
    text = (node.latestCaptureId ? runtime.captures?.[node.latestCaptureId]?.text?.trim() : '') || ''
    if (!text && node.url.trim()) { text = node.url.trim(); availability = 'url-only' }
  } else if (node.kind === 'ai') {
    const session = node.activeSessionId ? runtime.aiSessions?.[node.activeSessionId] : undefined
    text = session?.messages.filter(message => message.role === 'assistant').slice(-1)[0]?.content.trim() || ''
  } else availability = 'unsupported'
  if ((text || resources.length) && availability !== 'url-only') availability = 'ready'
  return { nodeId: node.id, label: node.label || '上游节点', kind: node.kind, text, availability, resources, node }
}

export function collectUpstreamInputs(targetId: string, nodes: readonly NodeSpec[] = [], edges: readonly { id?: string; source: string; target: string }[] = [], runtime: UpstreamRuntime = {}): UpstreamInput[] {
  return directUpstreamNodes(targetId, nodes, edges).map(({ node, edgeIds }) => ({ ...upstreamNodeInput(node, runtime), edgeIds }))
}
