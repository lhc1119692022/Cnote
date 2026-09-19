import { nanoid } from 'nanoid'
import type { ContentNodeSpec, FlowDocument, GenerationReferenceOverride, RequestNodeSpec } from '@/domain'
import { CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { resourceIdForAsset } from '@/storage/asset-store'
import type { GenerationReference } from '@/types/flow'

export function materializeVisibleMediaCopies(document: FlowDocument, request: RequestNodeSpec, references: GenerationReference[], inputOverrides: Record<string, GenerationReferenceOverride>): FlowDocument {
  const nodes = [...document.nodes]
  let edges = [...document.edges]
  const overrides = { ...inputOverrides }
  const promptMentions = { ...request.video.promptMentions }
  let localIds = request.video.referenceAssetIds
  const groups = new Map<string, GenerationReference[]>()
  for (const reference of references) {
    const copy = overrides[reference.id]?.compatibleCopy
    if (!copy || copy.sourceIdentity !== (reference.resourceId || reference.url)) continue
    const key = reference.upstreamNodeId || reference.id
    if (!groups.has(key)) groups.set(key, reference.upstreamNodeId ? references.filter((item) => item.upstreamNodeId === key) : [reference])
  }
  for (const [sourceId, group] of groups) {
    const source = nodes.find((node) => node.id === sourceId)
    const originalEdge = edges.find((edge) => edge.source === sourceId && edge.target === request.id)
    const size = source?.kind === 'content' && source.category === 'image' ? { ...source.size } : { ...CONTENT_NODE_DEFAULT_SIZE }
    const position = source ? { x: source.position.x, y: source.position.y + source.size.height + 64 } : { x: request.position.x - size.width - 88, y: request.position.y }
    while (nodes.some((node) => position.x < node.position.x + node.size.width + 24 && position.x + size.width + 24 > node.position.x && position.y < node.position.y + node.size.height + 48 && position.y + size.height + 48 > node.position.y)) position.y += size.height + 64
    const id = nanoid()
    const resources = group.map((reference) => {
      const previous = overrides[reference.id]
      const copy = previous?.compatibleCopy
      const resourceId = copy ? resourceIdForAsset(copy.assetId) : reference.resourceId
      const url = copy ? '' : reference.url || ''
      const identity = resourceId || url
      const referenceId = `upstream-${id}-${reference.type}-${identity}`
      overrides[referenceId] = { role: previous?.role || reference.role, order: previous?.order ?? reference.order, excluded: false }
      if (promptMentions[reference.id]) {
        promptMentions[referenceId] = promptMentions[reference.id]
        delete promptMentions[reference.id]
      }
      delete overrides[reference.id]
      localIds = localIds?.filter((localId) => localId !== reference.id)
      return { resource: { resourceId, url, mimeType: copy?.mimeType || reference.mimeType, fileName: copy?.fileName || reference.fileName }, label: copy?.fileName || reference.label }
    })
    const node: ContentNodeSpec = { id, kind: 'content', category: 'image', subtype: 'image', label: `${source?.label || group[0].fileName || '图片'} · 适配副本`, position, size, source: null, state: 'ready', payload: { kind: 'image', resources } }
    nodes.push(node)
    edges = edges.filter((edge) => edge !== originalEdge)
    edges.push({ ...originalEdge, id: nanoid(), source: id, target: request.id })
  }
  return { ...document, nodes: nodes.map((node) => node.id === request.id ? { ...request, video: { ...request.video, referenceAssetIds: localIds, referenceOverrides: overrides, promptMentions } } : node), edges, updatedAt: Date.now() }
}
