import type { FlowDocument } from '@/domain'
import { resourceIdentity, resourceReferences, isResourceDeleted } from './resource-policy'
export const GALLERY_PREFIX = 'gallery-index:v1:'
export interface GalleryEntry {
  id: string
  identity: string
  kind: 'image' | 'video'
  title: string
  createdAt: number
  locations: { flowId: string; flowName: string; nodeId: string; resourceIndex: number }[]
}
export interface GalleryDocumentIndex { version: 1; flowId: string; flowName: string; references: string[]; entries: GalleryEntry[] }
export function indexGalleryDocument(doc: FlowDocument): GalleryDocumentIndex {
  const entries: GalleryEntry[] = []
  for (const node of doc.nodes) {
    if (node.kind !== 'content' || !node.generatedBy || !['image', 'video'].includes(node.category || '')) continue
    const media = node.payload
    const resources = media && (media.kind === 'image' || media.kind === 'video') ? media.resources : undefined
    const items = resources?.length ? resources.map(item => ({ identity: resourceIdentity(item.resource), title: item.label })) : [{ identity: resourceIdentity(node.source) || (node.assetId ? 'sha256-' + node.assetId.replace(/^asset-/, '') : undefined), title: node.label }]
    items.forEach((item, resourceIndex) => {
      if (!item.identity || isResourceDeleted(item.identity)) return
      entries.push({ id: (node.generatedBy!.runId || node.generatedBy!.taskId || node.id) + ':' + item.identity, identity: item.identity, kind: node.category as 'image' | 'video', title: item.title || node.label, createdAt: node.generatedBy!.createdAt || doc.createdAt, locations: [{ flowId: doc.id, flowName: doc.name || doc.title || '未命名画布', nodeId: node.id, resourceIndex }] })
    })
  }
  return { version: 1, flowId: doc.id, flowName: doc.name || '未命名画布', references: [...resourceReferences(doc)].sort(), entries }
}
export function mergeGalleryEntries(indices: GalleryDocumentIndex[]): GalleryEntry[] {
  const entries = new Map<string, GalleryEntry>()
  for (const index of indices) for (const entry of index.entries) {
    if (isResourceDeleted(entry.identity)) continue
    const previous = entries.get(entry.id)
    if (previous) previous.locations.push(...entry.locations)
    else entries.set(entry.id, { ...entry, locations: [...entry.locations] })
  }
  return [...entries.values()]
}
