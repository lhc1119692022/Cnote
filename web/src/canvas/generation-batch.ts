import { fitMediaSize } from '@/canvas/media-dimensions'
import { nanoid } from 'nanoid'
import type { ContentNodeSpec, Point, Size } from '@/domain'
import type { ContentMediaItem } from '@/types/flow'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { syncGroupCounts } from '@/canvas/grouping'
import { assetIdForResource } from '@/storage/asset-store'

export function batchGrid(size: Size, count: number, itemSizes: Size[] = []) {
  const columns = count <= 3 ? Math.max(1, count) : count === 4 ? 2 : count <= 6 ? 3 : 4
  const rows = Math.max(1, Math.ceil(count / columns))
  const gap = 24
  const padding = 0
  const width = size.width
  const height = size.height
  const sizes = Array.from({ length: count }, (_, index) => itemSizes[index] || size)
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...sizes.filter((_, index) => index % columns === column).map(item => item.width), 1))
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...sizes.slice(row * columns, (row + 1) * columns).map(item => item.height), 1))
  const cells = sizes.map((item, index) => ({ ...item, x: columnWidths.slice(0, index % columns).reduce((sum, width) => sum + width + gap, 0), y: rowHeights.slice(0, Math.floor(index / columns)).reduce((sum, height) => sum + height + gap, 0) }))
  return { columns, rows, gap, padding, width, height, cells, size: { width: columnWidths.reduce((sum, width) => sum + width, 0) + (columns - 1) * gap, height: rowHeights.reduce((sum, height) => sum + height, 0) + (rows - 1) * gap } }
}

export function batchLayout(node: ContentNodeSpec) {
  const media = node.payload
  const items = media && (media.kind === 'image' || media.kind === 'video') ? media.resources || [] : []
  const size = node.generationBatch?.collapsedSize || node.size
  return batchGrid(size, items.length, items.map(item => fitMediaSize(item.resource.width, item.resource.height) || size))
}

export function batchSlots(node: ContentNodeSpec): { resourceIndex?: number; taskIndex: number }[] {
  const batch = node.generationBatch
  if (!batch) return []
  const slots: { resourceIndex?: number; taskIndex: number }[] = []
  for (let taskIndex = 0; taskIndex < batch.expectedCount; taskIndex++) {
    const indexes = batch.resourceKeys.flatMap((key, resourceIndex) => Number(key.split(':')[0]) === taskIndex ? [resourceIndex] : [])
    if (indexes.length) slots.push(...indexes.map(resourceIndex => ({ taskIndex, resourceIndex })))
    else slots.push({ taskIndex })
  }
  return slots
}

export function batchCanDetach(node: ContentNodeSpec): boolean {
  if (!node.generationBatch) return false
  const run = useRuntimeStore.getState().runs[node.generationBatch.runId]
  return Boolean(run && ['completed', 'failed', 'cancelled'].includes(run.status))
}

export function mediaItemNode(node: ContentNodeSpec, item: ContentMediaItem): ContentNodeSpec {
  const assetId = item.resource.resourceId ? assetIdForResource(item.resource.resourceId) : undefined
  return {
    ...node,
    generationBatch: undefined,
    assetId,
    content: undefined,
    source: assetId ? { kind: 'file', assetId, mimeType: item.resource.mimeType || (node.category === 'image' ? 'image/png' : 'video/mp4'), fileName: item.resource.fileName } : { kind: 'url', url: item.resource.url },
    payload: node.payload?.kind === 'image' || node.payload?.kind === 'video' ? { ...node.payload, resources: [item], activeResourceIndex: 0 } : undefined,
  }
}

export function toggleBatchExpanded(id: string): void {
  const graph = useGraphStore.getState()
  const node = graph.currentDocument?.nodes.find(node => node.id === id)
  if (graph.isLocked || node?.kind !== 'content' || node.disabled || !node.generationBatch) return
  const media = node.payload
  if (!media || (media.kind !== 'image' && media.kind !== 'video')) return
  const batch = node.generationBatch
  const expanded = !batch.expanded
  const active = media.resources?.[media.activeResourceIndex || 0]?.resource
  const fitted = !node.manualSize && active ? fitMediaSize(active.width, active.height) : null
  const collapsedSize = batch.expanded ? fitted || batch.collapsedSize || node.size : { ...node.size }
  if (!batch.expanded && (!batchCanDetach(node) || (media.resources?.length || 0) < 2)) return
  graph.updateNode(id, { size: expanded ? batchLayout({ ...node, generationBatch: { ...batch, collapsedSize } }).size : collapsedSize, generationBatch: { ...batch, expanded, collapsedSize } })
  graph.commitHistory()
}

export function detachGenerationBatch(id: string): boolean {
  const graph = useGraphStore.getState()
  const doc = graph.currentDocument
  const node = doc?.nodes.find(node => node.id === id)
  if (!doc || graph.isLocked || node?.kind !== 'content' || node.disabled || !batchCanDetach(node)) return false
  const media = node.payload
  if (!media || (media.kind !== 'image' && media.kind !== 'video') || !media.resources?.length) return false
  const grid = batchLayout(node)
  const active = Math.min(media.resources.length - 1, Math.max(0, media.activeResourceIndex || 0))
  const copies = media.resources.map((item, index): ContentNodeSpec => ({
    ...mediaItemNode(node, structuredClone(item)),
    id: nanoid(),
    generatedBy: node.generatedBy ? { ...node.generatedBy, detached: true } : undefined,
    label: item.label || node.label,
    position: { x: node.position.x + grid.cells[index].x * node.size.width / grid.size.width, y: node.position.y + grid.cells[index].y * node.size.height / grid.size.height },
    size: { width: grid.cells[index].width * node.size.width / grid.size.width, height: grid.cells[index].height * node.size.height / grid.size.height },
    sourceId: undefined,
    favorite: false,
  }))
  const nodes = doc.nodes.filter(candidate => candidate.id !== id).map(candidate => candidate.kind === 'request' ? {
    ...candidate,
    resultNodeIds: candidate.resultNodeIds ? Object.fromEntries(Object.entries(candidate.resultNodeIds).map(([variant, value]) => [variant, (Array.isArray(value) ? value : value ? [value] : []).filter(resultId => resultId !== id)])) : undefined,
  } : candidate)
  useGraphStore.setState({ currentDocument: { ...doc, nodes: syncGroupCounts([...nodes, ...copies]), edges: doc.edges.filter(edge => edge.target !== id).map(edge => edge.source === id ? { ...edge, source: copies[active].id } : edge), updatedAt: Date.now() }, selection: copies.map(copy => copy.id) })
  graph.commitHistory()
  return true
}

export function mediaIdentity(node: ContentNodeSpec): string {
  const payload = node.payload
  if (payload && (payload.kind === 'image' || payload.kind === 'video') && payload.resources?.length) {
    const item = payload.resources[Math.min(payload.resources.length - 1, Math.max(0, payload.activeResourceIndex || 0))].resource
    return item.resourceId || item.url
  }
  return node.assetId || (node.source?.kind === 'file' ? node.source.assetId : node.source?.kind === 'url' ? node.source.url : '')
}

export function recordMediaDimensions(id: string, identity: string, width: number, height: number): void {
  const size = fitMediaSize(width, height)
  const graph = useGraphStore.getState()
  const node = graph.currentDocument?.nodes.find(node => node.id === id)
  if (!size || !identity || node?.kind !== 'content' || !['image', 'video'].includes(node.category || '')) return
  const media = node.payload
  if (media && media.kind !== 'image' && media.kind !== 'video') return
  const resources = media?.resources
  const index = resources?.findIndex(item => (item.resource.resourceId || item.resource.url) === identity) ?? -1
  if (resources?.length && index < 0 || !resources?.length && mediaIdentity(node) !== identity) return
  const active = mediaIdentity(node) === identity
  const payload = media ? { ...media } : node.category === 'image' ? { kind: 'image' as const } : { kind: 'video' as const, provider: 'direct' as const, playback: 'video' as const }
  if (resources && index >= 0) payload.resources = resources.map((item, itemIndex) => itemIndex === index ? { ...item, resource: { ...item.resource, width, height } } : item)
  if (active) { payload.width = width; payload.height = height }
  const next = { ...node, payload }
  if (!graph.isLocked && !node.disabled && !node.manualSize) {
    if (node.generationBatch?.expanded) next.size = batchLayout(next).size
    else if (active) next.size = size
  }
  if (JSON.stringify(next) !== JSON.stringify(node)) graph.updateNode(id, next)
}

export function copyMediaResource(id: string, index: number, point: Point): string | null {
  const graph = useGraphStore.getState()
  const node = graph.currentDocument?.nodes.find(node => node.id === id)
  if (graph.isLocked || node?.kind !== 'content' || node.disabled || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const media = node.payload
  if (!media || (media.kind !== 'image' && media.kind !== 'video')) return null
  const item = media.resources?.[index]
  if (!item) return null
  const copyId = nanoid()
  const size = fitMediaSize(item.resource.width, item.resource.height) || node.generationBatch?.collapsedSize || node.size
  const copy: ContentNodeSpec = { ...mediaItemNode(node, structuredClone(item)), id: copyId, label: item.label || node.label, position: { x: point.x - size.width / 2, y: point.y - size.height / 2 }, size, manualSize: false, parentGroupId: undefined, sourceId: undefined, favorite: false, generatedBy: node.generatedBy ? { ...node.generatedBy, detached: true } : undefined }
  graph.addNode(copy)
  graph.setSelection([copyId])
  return copyId
}
