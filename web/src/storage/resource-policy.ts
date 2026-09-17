export const RESOURCE_POLICY_KEY = 'cnote:resource-policy:v1'
export async function thumbnailKey(identity: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return 'gallery-thumb:' + Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}
export interface ResourcePolicy { deleted: string[]; deletedFlows: string[]; pending: string[]; pendingFlows?: string[]; pendingFlowNodes?: string[] }
let policy: ResourcePolicy = { deleted: [], deletedFlows: [], pending: [] }
let revoked = new Set<string>()
export function currentResourcePolicy() { return policy }
export function installResourcePolicy(value: ResourcePolicy) {
  if (!Array.isArray(value.deleted) || !Array.isArray(value.deletedFlows) || !Array.isArray(value.pending)) throw new Error('资源清理记录损坏，停止清理以保护数据')
  for (const items of [value.deleted, value.deletedFlows, value.pending, value.pendingFlows || [], value.pendingFlowNodes || []]) {
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string')) throw new Error('资源清理记录格式无效')
  }
  policy = value
  revoked = new Set(value.deleted.flatMap(identityAliases))
}
export function identityAliases(value: string): string[] {
  if (value.startsWith('sha256-')) return [value, 'asset-' + value.slice(7)]
  if (value.startsWith('asset-')) return [value, 'sha256-' + value.slice(6)]
  return [value]
}
export function resourceIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  for (const field of ['resourceId', 'assetId']) if (typeof item[field] === 'string') return identityAliases(item[field] as string).find(id => id.startsWith('sha256-')) || item[field] as string
  return typeof item.url === 'string' && !item.url.startsWith('blob:') ? item.url : undefined
}
export function isResourceDeleted(value: string) { return revoked.has(value) }
export function resourceReferences(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/^(sha256-|asset-)[a-f0-9]{64}$/i.test(value)) found.add(value.startsWith('asset-') ? 'sha256-' + value.slice(6) : value)
  } else if (Array.isArray(value)) value.forEach(item => resourceReferences(item, found))
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    if (key === 'generatedBy') return
    if (key === 'url' && typeof item === 'string' && /^https?:/.test(item)) found.add(item)
    resourceReferences(item, found)
  })
  return found
}
export function scrubResources<T>(input: T, only?: string[]): T {
  const revoked = new Set((only || currentResourcePolicy().deleted).flatMap(identityAliases))
  if (!revoked.size) return input
  function visit(value: unknown): unknown {
    if (typeof value === 'string') return revoked.has(value) ? undefined : value
    if (Array.isArray(value)) return value.map(visit).filter(item => item !== undefined)
    if (!value || typeof value !== 'object') return value
    const original = value as Record<string, any>
    let record = original
    const media = record.payload
    if (record.kind === 'content' || record.type === 'content' || record.category && record.source !== undefined) {
      if (media && ['image', 'video'].includes(media.kind) && Array.isArray(media.resources) && media.resources.length) {
        const kept = media.resources.map((item: unknown, index: number) => ({ item, index })).filter(({ item }: { item: any }) => !revoked.has(resourceIdentity(item.resource) || ''))
        if (!kept.length) return undefined
        if (kept.length !== media.resources.length) {
          const active = Math.max(0, kept.findIndex(({ index }: { index: number }) => index === (media.activeResourceIndex || 0)))
          const resource = kept[active].item.resource
          const assetId = resource.resourceId ? 'asset-' + resource.resourceId.replace(/^sha256-/, '') : undefined
          record = { ...record, assetId, source: assetId ? { kind: 'file', assetId, mimeType: resource.mimeType } : { kind: 'url', url: resource.url }, payload: { ...media, resources: kept.map(({ item }: { item: unknown }) => item), activeResourceIndex: active }, generationBatch: record.generationBatch ? { ...record.generationBatch, expanded: false, resourceKeys: kept.map(({ index }: { index: number }) => record.generationBatch.resourceKeys[index]) } : undefined, size: record.generationBatch?.collapsedSize || record.size }
        }
      } else if (revoked.has(record.assetId) || revoked.has(resourceIdentity(record.source) || '')) return undefined
    } else if (typeof record.resourceId === 'string' && revoked.has(record.resourceId)) return undefined
    else if (typeof record.assetId === 'string' && revoked.has(record.assetId)) return undefined
    else if (typeof record.id === 'string' && revoked.has(record.id)) return undefined
    else if (!record.resourceId && typeof record.url === 'string' && revoked.has(record.url)) return undefined
    if (Array.isArray(record.resultAssetIds)) {
      const indices = record.resultAssetIds.map((_: unknown, index: number) => index).filter((index: number) => !revoked.has(record.resultAssetIds[index]) && !revoked.has(record.resultUrls?.[index]))
      record = { ...record, resultAssetIds: indices.map((index: number) => record.resultAssetIds[index]), ...(record.resultUrls ? { resultUrls: indices.map((index: number) => record.resultUrls[index]) } : {}) }
    }
    const next = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, visit(item)]).filter(([, item]) => item !== undefined)) as Record<string, any>
    if (original.nodeData && !next.nodeData) return undefined
    if (original.data && !next.data) return undefined
    if (Array.isArray(next.nodes) && Array.isArray(next.edges)) {
      const ids = new Set(next.nodes.map((node: any) => node.id))
      next.nodes = next.nodes.map((node: any) => node.kind === 'group' ? { ...node, childCount: next.nodes.filter((member: any) => member.parentGroupId === node.id).length } : node.kind === 'request' && node.resultNodeIds ? { ...node, resultNodeIds: Object.fromEntries(Object.entries(node.resultNodeIds).map(([kind, values]) => [kind, (Array.isArray(values) ? values : [values]).filter(id => ids.has(id))])) } : node)
      next.edges = next.edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target))
      next.nodes = next.nodes.map((node: any) => ({ ...node, ...(node.parentGroupId && !ids.has(node.parentGroupId) ? { parentGroupId: undefined } : {}) }))
    }
    return next
  }
  const output = visit(input)
  return JSON.stringify(output) === JSON.stringify(input) ? input : output as T
}
export function guardStoredValue(key: string, value: string): string {
  if (!/^(doc:flow:|runtime:|cnote-sources|cnote-templates|flows)/.test(key)) return value
  const parsed = JSON.parse(value)
  const cleaned = scrubResources(parsed)
  return JSON.stringify(cleaned ?? null)
}
