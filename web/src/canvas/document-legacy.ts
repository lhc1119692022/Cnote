import type { FlowDocument, NodeSpec } from '@/domain'
import { cloneFlowValue } from '@/lib/flow/clone'
import type { ContentNodeData, ContentSource, Flow, FlowEdge, FlowNode } from '@/types/flow'

function specToLegacyData(node: NodeSpec): Record<string, unknown> {
  const base = {
    label: node.label,
    disabled: node.disabled,
  }
  switch (node.kind) {
    case 'sticky':
      return { ...base, content: node.content, document: node.document, color: node.color, background: node.background, pinned: node.pinned }
    case 'browser':
      return { ...base, url: node.url, confirmedUrl: node.url, outputMode: node.outputMode, linkedContentNodeId: node.linkedContentNodeId }
    case 'ai':
      return {
        ...base,
        channelId: node.channelId,
        model: node.model,
        systemPrompt: node.systemPrompt,
        prompt: node.prompt,
        userPrompt: node.prompt,
        temperature: node.temperature,
        maxOutputTokens: node.maxOutputTokens,
        webSearch: node.webSearch,
        reasoningLevel: node.reasoningLevel,
        activeSessionId: node.activeSessionId,
      }
    case 'request':
      return {
        ...base,
        variant: node.variant,
        image: node.image,
        video: node.video,
        latestRunId: node.latestRunId,
        resultNodeIds: node.resultNodeIds,
      }
    case 'group':
      return { ...base, memberCount: node.memberCount, padding: node.padding }
    case 'content': {
      let source: ContentSource | null = null
      if (node.source?.kind === 'text') {
        source = { kind: 'text', text: node.content || '', mimeType: node.source.mimeType, checksum: '' }
      } else if (node.source?.kind === 'url') {
        source = { kind: 'url', originalUrl: node.source.url, normalizedUrl: node.source.url, provider: node.source.provider }
      } else if (node.source?.kind === 'file') {
        source = {
          kind: 'file',
          resourceId: node.source.assetId,
          checksum: '',
          fileName: node.source.fileName || 'file',
          mimeType: node.source.mimeType,
          size: 0,
        }
      } else if (node.source?.kind === 'clipboard-image') {
        source = {
          kind: 'clipboard-image',
          resourceId: node.source.assetId,
          checksum: '',
          mimeType: node.source.mimeType,
          size: 0,
        }
      }
      const data: ContentNodeData = {
        schemaVersion: 2,
        label: node.label,
        category: node.category,
        subtype: node.subtype,
        state: node.state || (node.category ? 'ready' : 'empty'),
        source,
        payload: node.payload,
        preview: node.preview,
        parse: node.parse,
        sourceId: node.sourceId,
        disabled: node.disabled,
      }
      return data as unknown as Record<string, unknown>
    }
  }
}

export function documentToLegacyFlow(doc: FlowDocument): Flow {
  const nodes: FlowNode[] = doc.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { ...node.position },
    width: node.size.width,
    height: node.size.height,
    style: { width: node.size.width, height: node.size.height },
    parentNode: node.parentGroupId,
    zIndex: node.z,
    data: specToLegacyData(node),
  }))
  const edges: FlowEdge[] = doc.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  }))
  return cloneFlowValue({
    id: doc.id,
    name: doc.name,
    title: doc.title,
    description: doc.description,
    nodes,
    edges,
    viewport: doc.viewport,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }) as Flow
}
