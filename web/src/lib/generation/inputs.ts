import type { ContentMediaItem, ContentNodeData, ContentPayload, FlowEdge, FlowNode, GenerationReference, GenerationVariantConfig, RequestNodeData } from '@/types/flow'
import { getNodeMediaItems } from '@/lib/content-media'
import { textForAIContextNode } from '@/lib/flow/ai-context'
import { normalizeGenerationReferences } from './defaults'

function nodeWithOutput(node: FlowNode, output?: unknown): FlowNode {
  if (node.type !== 'content' || !output || typeof output !== 'object' || !('kind' in output)) return node
  if (!['text', 'document', 'social', 'video', 'image', 'data', 'mindmap', 'presentation'].includes(String(output.kind))) return node
  return { ...node, data: { ...node.data, payload: output as ContentPayload } }
}

function nodeReferences(node: FlowNode, output?: unknown): GenerationReference[] {
  const items: Array<ContentMediaItem & { type: GenerationReference['type'] }> = (['image', 'video'] as const).flatMap((type) => getNodeMediaItems(node, type).map((item) => ({ ...item, type })))
  if (node.type === 'content') {
    const data = node.data as ContentNodeData
    const source = data.source
    const payload = data.payload
    if (source?.kind === 'file' && source.mimeType.startsWith('audio/')) {
      items.push({ resource: { resourceId: source.resourceId, url: '', mimeType: source.mimeType }, label: data.label, type: 'audio' })
    } else if (payload?.kind === 'video' && payload.playback === 'audio' && payload.url) {
      items.push({ resource: { url: payload.url }, label: payload.title, type: 'audio' })
    }
  }
  if (node.type === 'request') {
    const data = node.data as RequestNodeData
    const variant = data.variant === 'image' ? 'image' : 'video'
    const result = output && typeof output === 'object'
      ? ('task' in output ? output.task : output) as RequestNodeData['task']
      : data.tasks?.[variant] || data.task
    const count = Math.max(result?.resultUrls?.length || 0, result?.resultResourceIds?.length || 0)
    for (let index = 0; index < count; index += 1) {
      items.push({ type: variant, label: data.label, resource: { url: result?.resultUrls?.[index] || '', resourceId: result?.resultResourceIds?.[index], mimeType: result?.resultMimeTypes?.[index] } })
    }
  }
  return items.map(({ type, resource, label }, order) => ({
    id: `upstream-${node.id}-${type}-${resource.resourceId || resource.sourceUrl || resource.url}`,
    upstreamNodeId: node.id,
    type,
    role: type === 'image' ? 'reference_image' : type === 'video' ? 'reference_video' : 'reference_audio',
    label: label || node.data.label,
    source: /^https?:\/\//i.test(resource.sourceUrl || resource.url) ? 'url' : 'local',
    url: resource.sourceUrl || resource.url || undefined,
    previewUrl: resource.url || undefined,
    resourceId: resource.resourceId,
    mimeType: resource.mimeType,
    fileName: resource.fileName,
    order,
    status: 'ready',
  }))
}

export function withGenerationUpstreamInputs(nodeId: string, variant: 'image' | 'video', config: GenerationVariantConfig, nodes: FlowNode[], edges: FlowEdge[], outputs?: Record<string, unknown>): GenerationVariantConfig {
  const sourceIds = new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))
  const upstreamNodes = [...sourceIds].map((sourceId) => nodes.find((node) => node.id === sourceId)).filter((node): node is FlowNode => Boolean(node && !node.data?.disabled)).map((node) => nodeWithOutput(node, outputs?.[node.id]))
  const text = upstreamNodes.map((node) => {
    const output = outputs?.[node.id]
    if (typeof output === 'string' && (output.trim() || node.type !== 'content')) return output.trim()
    if (output && typeof output === 'object' && node.type !== 'content') {
      const record = output as Record<string, unknown>
      const text = ['text', 'content', 'plainText', 'bodyText', 'transcript', 'value', 'url'].map((field) => record[field]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).join('\n\n')
      if (text) return text
    }
    return textForAIContextNode(node).trim()
  }).filter(Boolean).join('\n\n')
  const localReferences = (config.references || []).filter((reference) => !reference.upstreamNodeId)
  const upstreamReferences = upstreamNodes.flatMap((node) => nodeReferences(node, outputs?.[node.id])).filter((reference) => variant === 'video' || reference.type === 'image')
  const seen = new Set<string>()
  const references = normalizeGenerationReferences([...localReferences, ...upstreamReferences.map((reference, index) => ({ ...reference, order: localReferences.length + index, ...config.referenceOverrides?.[reference.id] }))].filter((reference) => {
    if (reference.upstreamNodeId && config.referenceOverrides?.[reference.id]?.excluded) return false
    const keys = [reference.resourceId, reference.url].filter(Boolean).map((key) => `${reference.type}:${key}`)
    const duplicate = keys.some((key) => seen.has(key))
    keys.forEach((key) => seen.add(key))
    return keys.length > 0 && !duplicate
  }))
  return {
    ...config,
    prompt: [config.prompt, text].filter(Boolean).join('\n\n'),
    references,
    ...(variant === 'image' ? { capability: references.some((reference) => reference.type === 'image') ? 'image-to-image' as const : 'text-to-image' as const } : {}),
  }
}
