import type { ContentCategory, ContentNodeSpec, NodeSpec } from '@/domain'
import {
  detectAndParseContent,
  type ContentImportInput,
  type ParsedContent,
} from '@/lib/content-import'
import { retainLocalResource } from '@/lib/resource-storage'
import { contentCategoryVisuals } from '@/lib/content-visuals'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'

function categoryLabel(category: ContentCategory): string {
  return contentCategoryVisuals[category]?.label || '内容'
}

function applyParsedSource(parsed: ParsedContent): Pick<ContentNodeSpec, 'source' | 'assetId' | 'content'> {
  const source = parsed.source
  if (source.kind === 'text') {
    const text = parsed.payload.kind === 'text' ? parsed.payload.value : source.text
    return { source: { kind: 'text', mimeType: source.mimeType }, content: text, assetId: undefined }
  }
  if (source.kind === 'url') {
    return { source: { kind: 'url', url: source.normalizedUrl, provider: source.provider }, content: undefined, assetId: undefined }
  }
  const assetId = source.resourceId
  useRuntimeStore.getState().upsertAsset({
    id: assetId,
    hash: source.checksum.replace(/^sha256-/, ''),
    mimeType: source.mimeType,
    size: source.size,
  })
  if (source.kind === 'file') {
    return { source: { kind: 'file', assetId, mimeType: source.mimeType, fileName: source.fileName }, assetId, content: undefined }
  }
  return { source: { kind: 'clipboard-image', assetId, mimeType: source.mimeType }, assetId, content: undefined }
}

export function applyParsedContent(nodeId: string, parsed: ParsedContent): void {
  const stored = useGraphStore.getState().currentDocument?.nodes.find((node) => node.id === nodeId)
  if (!stored || stored.kind !== 'content') return
  const mapped = applyParsedSource(parsed)
  const patch: Partial<ContentNodeSpec> = {
    category: parsed.category,
    subtype: parsed.subtype,
    payload: parsed.payload,
    preview: parsed.preview,
    state: parsed.partial ? 'partial' : 'ready',
    parse: parsed.warnings?.length
      ? {
          requestId: nodeId,
          revision: Date.now(),
          completedAt: Date.now(),
          warnings: parsed.warnings,
        }
      : undefined,
    label: parsed.preview.title || stored.label || `${categoryLabel(parsed.category)}节点`,
    ...mapped,
  }
  useGraphStore.getState().updateNode(nodeId, patch as Partial<NodeSpec>)
  useGraphStore.getState().commitHistory()
}

export async function importContentIntoNode(
  nodeId: string,
  input: ContentImportInput,
  hint?: ContentCategory | null,
  options: { preserveOnFailure?: boolean } = {},
): Promise<ParsedContent> {
  const parsed = await detectAndParseContent(input, hint ?? undefined)
  const failure = parsed.partial && parsed.warnings?.find((warning) =>
    warning.code !== 'PREVIEW_ONLY' && warning.code !== 'REMOTE_PARSE_PARTIAL',
  )
  if (options.preserveOnFailure && failure) {
    throw new Error(failure.message)
  }
  if (parsed.source.kind === 'file' || parsed.source.kind === 'clipboard-image') {
    await retainLocalResource(parsed.source.resourceId)
  }
  applyParsedContent(nodeId, parsed)
  return parsed
}

export function chooseContentCategory(nodeId: string, category: ContentCategory): void {
  const stored = useGraphStore.getState().currentDocument?.nodes.find((node) => node.id === nodeId)
  if (!stored || stored.kind !== 'content') return
  useGraphStore.getState().updateNode(nodeId, {
    category,
    subtype: null,
    source: null,
    content: undefined,
    assetId: undefined,
    parse: undefined,
    payload: undefined,
    preview: undefined,
    state: 'empty',
    label: `${categoryLabel(category)}节点`,
  } as Partial<NodeSpec>)
  useGraphStore.getState().commitHistory()
}
