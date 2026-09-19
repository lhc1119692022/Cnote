import { batchLayout } from '@/canvas/generation-batch'
import { placeNewestResult } from '@/canvas/result-placement'
/**
 * Request 节点的运行时素材派生与结果落盘。
 * GenerationReference 只在提交/预览时存在，不写入 FlowDocument。
 */

import { nanoid } from 'nanoid'
import { directUpstreamNodes, upstreamNodeInput, type UpstreamRuntime } from '@/lib/flow/upstream-inputs'
import type {
  ContentAsset,
  ContentGenerationProvenance,
  ContentNodeSpec,
  ContentSourceRef,
  EdgeSpec,
  FlowDocument,
  GenerationConfig,
  GenerationRun,
  NodeSpec,
  RequestNodeSpec,
} from '@/domain'
import { createGenerationReference, createGenerationVariantConfig, normalizeGenerationReferences } from '@/lib/generation/defaults'
import { isGenerationTaskResumable } from '@/lib/generation/resume-context'
import { CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { assetIdForResource, resourceIdForAsset } from '@/storage/asset-store'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import type { GenerationReference, GenerationVariantConfig } from '@/types/flow'

export const DOWNSTREAM_OFFSET_X = 88
export const RESULT_STACK_GAP = 24
export const REFERENCE_DND_TYPE = 'application/x-cnote-generation-reference'

export function ownedResultNodeIds(value: string | string[] | undefined): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).filter(Boolean)
}

export function collectOwnedResultNodeIds(
  request: RequestNodeSpec,
  nodes: NodeSpec[],
  variant: 'image' | 'video',
): string[] {
  const stored = ownedResultNodeIds(request.resultNodeIds?.[variant])
  const generated = nodes
    .filter((node): node is ContentNodeSpec => (
      node.kind === 'content'
      && !node.generatedBy?.detached
      && node.generatedBy?.requestNodeId === request.id
      && node.generatedBy.variant === variant
    ))
    .map((node) => node.id)
  return [...new Set([...stored, ...generated])].filter((id) => nodes.some((node) => node.id === id))
}

export function requestedGenerationCount(variant: 'image' | 'video', outputCount?: number): number {
  if (variant !== 'image') return 1
  return Math.max(1, Math.min(10, Math.trunc(outputCount || 1)))
}

export function pendingLocalReferenceAssetIds(
  assetIds: string[] | undefined,
  assets: Record<string, ContentAsset>,
): string[] {
  return (assetIds || []).filter((assetId) => !mimeToReferenceType(assets[assetId]?.mimeType))
}

export function isWritableGenerationTarget(options: {
  documentId: string
  requestNodeId: string
  variant?: 'image' | 'video'
  runId?: string
}): { document: FlowDocument; request: RequestNodeSpec } | null {
  const store = useGraphStore.getState()
  const document = store.currentDocument
  if (!document || document.id !== options.documentId) return null
  const request = document.nodes.find((node) => node.id === options.requestNodeId)
  if (!request || request.kind !== 'request') return null
  if (options.variant && request.variant !== options.variant) return null
  if (options.runId && request.latestRunId && request.latestRunId !== options.runId) return null
  return { document, request }
}

const PLATFORM_URL_PROVIDERS = new Set([
  'youtube',
  'bilibili',
  'vimeo',
  'podcast',
  'xiaohongshu',
  'weibo',
  'douyin',
  'instagram',
])

export function defaultReferenceRole(
  type: GenerationReference['type'],
  variant: 'image' | 'video',
): GenerationReference['role'] {
  if (type === 'audio') return variant === 'video' ? 'reference_voice' : 'reference_audio'
  return type === 'video' ? 'reference_video' : 'reference_image'
}

export function imageCapabilityForReferences(references: GenerationReference[] = []): 'image-to-image' | 'text-to-image' {
  return references.some((reference) => reference.type === 'image') ? 'image-to-image' : 'text-to-image'
}

export function isPersistableResultUrl(url?: string): url is string {
  return Boolean(url && /^https?:\/\//i.test(url))
}

export function mimeToReferenceType(mimeType?: string): GenerationReference['type'] | null {
  if (!mimeType) return null
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return null
}

function sourceAssetId(source: ContentSourceRef | null): string | undefined {
  if (source?.kind === 'file' || source?.kind === 'clipboard-image') return source.assetId
  return undefined
}

function sourceMimeType(source: ContentSourceRef | null): string | undefined {
  if (!source) return undefined
  if (source.kind === 'file' || source.kind === 'clipboard-image' || source.kind === 'text') return source.mimeType
  return undefined
}

function sourceFileName(source: ContentSourceRef | null): string | undefined {
  return source?.kind === 'file' ? source.fileName : undefined
}

function contentMediaType(node: ContentNodeSpec, mimeType?: string): GenerationReference['type'] | null {
  const fromMime = mimeToReferenceType(mimeType)
  if (fromMime) return fromMime
  if (node.category === 'image') return 'image'
  if (node.category === 'audio') return 'audio'
  if (node.category === 'video') return 'video'
  return null
}

export function collectUpstreamNodes(requestNodeId: string, nodes: NodeSpec[] | undefined, edges: EdgeSpec[] | undefined): NodeSpec[] {
  return directUpstreamNodes(requestNodeId, nodes, edges).map(entry => entry.node)
}

export function collectUpstreamText(upstreams: NodeSpec[], runtime: UpstreamRuntime = useRuntimeStore.getState()): string {
  return upstreams.map(node => upstreamNodeInput(node, runtime).text).filter(Boolean).join('\n\n')
}

function contentNodeReferences(node: ContentNodeSpec, assets: Record<string, ContentAsset>): GenerationReference[] {
  const payload = node.payload
  if (payload && (payload.kind === 'image' || payload.kind === 'video') && payload.resources?.length) {
    const resources = node.generationBatch ? [payload.resources[Math.max(0, Math.min(payload.resources.length - 1, payload.activeResourceIndex || 0))]] : payload.resources
    return resources.flatMap((item) => {
      const resource = item.resource
      const identity = resource.resourceId || resource.url
      if (!identity) return []
      const asset = resource.resourceId ? assets[assetIdForResource(resource.resourceId)] || assets[resource.resourceId] : undefined
      const mimeType = resource.mimeType || asset?.mimeType
      const type = mimeToReferenceType(mimeType) || payload.kind
      return [{
        ...createGenerationReference({
          id: `upstream-${node.id}-${type}-${identity}`,
          type,
          role: defaultReferenceRole(type, type === 'image' ? 'image' : 'video'),
          label: item.label || node.label || resource.fileName,
          source: resource.resourceId ? 'local' : /^https?:\/\//i.test(resource.url) ? 'url' : 'local',
          url: resource.url || undefined,
          previewUrl: resource.url || undefined,
          resourceId: resource.resourceId,
          mimeType,
          fileName: resource.fileName,
        }),
        upstreamNodeId: node.id,
      }]
    })
  }
  const assetId = node.assetId ?? sourceAssetId(node.source)
  const mimeType = sourceMimeType(node.source) ?? (assetId ? assets[assetId]?.mimeType : undefined)
  const type = contentMediaType(node, mimeType)
  const remoteUrl = node.source?.kind === 'url' ? node.source.url : undefined
  const provider = node.source?.kind === 'url' ? node.source.provider : undefined
  if (!type) return []
  if (remoteUrl && provider && PLATFORM_URL_PROVIDERS.has(provider)) return []
  if (!assetId && !remoteUrl) return []

  const resourceId = assetId ? resourceIdForAsset(assetId) : undefined
  const identity = resourceId || remoteUrl
  if (!identity) return []

  return [
    {
      ...createGenerationReference({
        id: `upstream-${node.id}-${type}-${identity}`,
        type,
        role: defaultReferenceRole(type, type === 'image' ? 'image' : 'video'),
        label: node.label || sourceFileName(node.source),
        source: remoteUrl && /^https?:\/\//i.test(remoteUrl) ? 'url' : 'local',
        url: remoteUrl,
        previewUrl: remoteUrl,
        resourceId,
        mimeType,
        fileName: sourceFileName(node.source),
      }),
      upstreamNodeId: node.id,
    },
  ]
}

function requestResultReferences(
  node: RequestNodeSpec,
  allNodes: NodeSpec[],
  assets: Record<string, ContentAsset>,
  runs: Record<string, GenerationRun>,
): GenerationReference[] {
  const variant = node.variant === 'image' || node.variant === 'video' ? node.variant : null
  if (!variant) return []
  const ownedIds = collectOwnedResultNodeIds(node, allNodes, variant)
  const fromNodes = ownedIds.flatMap((resultId) => {
    const content = allNodes.find((item) => item.id === resultId)
    return content?.kind === 'content' ? contentNodeReferences(content, assets) : []
  })
  if (fromNodes.length) return fromNodes
  const run = node.latestRunId ? runs[node.latestRunId] : undefined
  const resultAssetIds = run?.tasks[0]?.resultAssetIds || []
  return resultAssetIds.flatMap((assetId) => {
    const asset = assets[assetId]
    const type = mimeToReferenceType(asset?.mimeType) ?? variant
    return [
      {
        ...createGenerationReference({
          id: `upstream-${node.id}-${type}-${assetId}`,
          type,
          role: defaultReferenceRole(type, variant),
          label: node.label,
          source: 'local',
          resourceId: resourceIdForAsset(assetId),
          mimeType: asset?.mimeType,
          size: asset?.size,
        }),
        upstreamNodeId: node.id,
      },
    ]
  })
}

export function collectUpstreamReferences(
  variant: 'image' | 'video',
  upstreams: NodeSpec[],
  allNodes: NodeSpec[],
  assets: Record<string, ContentAsset>,
  runs: Record<string, GenerationRun>,
): GenerationReference[] {
  return upstreams.flatMap((node) => {
    if (node.kind === 'content') return contentNodeReferences(node, assets)
    if (node.kind === 'request') return requestResultReferences(node, allNodes, assets, runs)
    return []
  }).filter((reference) => variant === 'video' || reference.type === 'image')
}

export function localReferencesFromAssetIds(
  variant: 'image' | 'video',
  assetIds: string[] | undefined,
  assets: Record<string, ContentAsset>,
): GenerationReference[] {
  if (!assetIds?.length) return []
  return assetIds.flatMap((assetId, order) => {
    const asset = assets[assetId]
    const type = mimeToReferenceType(asset?.mimeType)
    if (!type) return []
    return [createGenerationReference({
      id: assetId,
      type,
      role: defaultReferenceRole(type, variant),
      label: assetId,
      source: 'local',
      resourceId: resourceIdForAsset(assetId),
      mimeType: asset.mimeType,
      size: asset.size,
      order,
    })]
  })
}

export function stalePromptMentionEntries(
  promptMentions: Record<string, string> | undefined,
  prompt: string,
  options: {
    referenceAssetIds?: string[]
    orderedReferenceIds: Iterable<string>
    pendingAssetIds?: Iterable<string>
  },
): Array<[string, string]> {
  if (!promptMentions) return []
  const kept = new Set([
    ...options.orderedReferenceIds,
    ...(options.referenceAssetIds || []),
    ...(options.pendingAssetIds || []),
  ])
  return Object.entries(promptMentions).filter(([referenceId, token]) => !kept.has(referenceId) && prompt.includes(token))
}

export function resolveRequestGenerationInputs(options: {
  requestNodeId: string
  variant: 'image' | 'video'
  config: GenerationConfig
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  assets: Record<string, ContentAsset>
  runs?: Record<string, GenerationRun>
}): { prompt: string; references: GenerationReference[]; capability?: GenerationConfig['capability'] } {
  const upstreams = collectUpstreamNodes(options.requestNodeId, options.nodes, options.edges)
  const references = mergeGenerationReferences(
    localReferencesFromAssetIds(options.variant, options.config.referenceAssetIds, options.assets),
    collectUpstreamReferences(options.variant, upstreams, options.nodes, options.assets, options.runs || {}),
    options.config.referenceOverrides,
  )
  const prompt = [options.config.prompt, collectUpstreamText(upstreams)].filter(Boolean).join('\n\n')
  return {
    prompt,
    references,
    capability: options.variant === 'image' ? imageCapabilityForReferences(references) : options.config.capability,
  }
}

export function mergeGenerationReferences(
  local: GenerationReference[],
  upstream: GenerationReference[],
  overrides: GenerationConfig['referenceOverrides'] | undefined,
): GenerationReference[] {
  const seen = new Set<string>()
  const merged = [...local, ...upstream].map((reference, index) => {
    const override = overrides?.[reference.id]
    return {
      ...reference,
      order: override?.order ?? index,
      role: override?.role ?? reference.role,
    }
  })
  return normalizeGenerationReferences(
    merged.filter((reference) => {
      if (reference.upstreamNodeId && overrides?.[reference.id]?.excluded) return false
      const keys = [reference.resourceId, reference.url].filter(Boolean).map((key) => `${reference.type}:${key}`)
      const duplicate = keys.some((key) => seen.has(key))
      keys.forEach((key) => seen.add(key))
      return keys.length > 0 && !duplicate
    }),
  )
}

export function ownedReferenceAssetIds(references: GenerationReference[]): string[] {
  return references
    .filter((reference) => !reference.upstreamNodeId && reference.id.startsWith('asset-'))
    .map((reference) => reference.id)
}

export function toLegacyVariantConfig(
  variant: 'image' | 'video',
  spec: GenerationConfig,
  references: GenerationReference[],
  prompt = spec.prompt,
): GenerationVariantConfig {
  const defaults = createGenerationVariantConfig(variant)
  return {
    ...defaults,
    channelId: spec.channelId,
    model: spec.model,
    adapterId: spec.adapterId,
    capability: spec.capability ?? defaults.capability,
    prompt,
    promptMentions: spec.promptMentions,
    negativePrompt: spec.negativePrompt,
    references,
    referenceOverrides: spec.referenceOverrides,
    generateAudio: spec.generateAudio ?? defaults.generateAudio,
    seconds: spec.seconds ?? defaults.seconds,
    resolution: spec.resolution ?? defaults.resolution,
    aspectRatio: spec.aspectRatio ?? defaults.aspectRatio,
    quality: spec.quality ?? defaults.quality,
    background: spec.background ?? defaults.background,
    outputFormat: spec.outputFormat ?? defaults.outputFormat,
    outputCompression: spec.outputCompression,
    thinkingLevel: spec.thinkingLevel ?? defaults.thinkingLevel,
    outputCount: spec.outputCount,
  }
}

export function resultAssetIdsFromResourceIds(resourceIds: string[] | undefined): string[] {
  return (resourceIds || []).filter(Boolean).map(assetIdForResource)
}

function uniqueIds(ids: Array<string | undefined> | undefined): string[] {
  return [...new Set((ids || []).filter((id): id is string => Boolean(id)))]
}

/** Stable input ids only — never copies URLs, tokens, secrets, or media. */
export function generationInputProvenanceIds(
  references: Array<{ id?: string; resourceId?: string; upstreamNodeId?: string }> | undefined,
): Pick<ContentGenerationProvenance, 'inputReferenceIds' | 'inputAssetIds' | 'inputNodeIds'> {
  const inputReferenceIds = uniqueIds((references || []).map((reference) => reference.id))
  const inputAssetIds = uniqueIds((references || []).map((reference) => {
    if (reference.id?.startsWith('asset-')) return reference.id
    return reference.resourceId ? assetIdForResource(reference.resourceId) : undefined
  }))
  const inputNodeIds = uniqueIds((references || []).map((reference) => reference.upstreamNodeId))
  return {
    ...(inputReferenceIds.length ? { inputReferenceIds } : {}),
    ...(inputAssetIds.length ? { inputAssetIds } : {}),
    ...(inputNodeIds.length ? { inputNodeIds } : {}),
  }
}

function contentGenerationProvenance(options: {
  requestNodeId: string
  variant: 'image' | 'video'
  runId?: string
  taskId?: string
  channelId?: string
  providerId?: string
  model?: string
  inputReferenceIds?: string[]
  inputAssetIds?: string[]
  inputNodeIds?: string[]
  createdAt?: number
}): ContentGenerationProvenance {
  const generatedBy: ContentGenerationProvenance = {
    requestNodeId: options.requestNodeId,
    variant: options.variant,
  }
  if (options.runId) generatedBy.runId = options.runId
  if (options.taskId) generatedBy.taskId = options.taskId
  if (options.channelId) generatedBy.channelId = options.channelId
  if (options.providerId) generatedBy.providerId = options.providerId
  if (options.model) generatedBy.model = options.model
  const inputReferenceIds = uniqueIds(options.inputReferenceIds)
  const inputAssetIds = uniqueIds(options.inputAssetIds)
  const inputNodeIds = uniqueIds(options.inputNodeIds)
  if (inputReferenceIds.length) generatedBy.inputReferenceIds = inputReferenceIds
  if (inputAssetIds.length) generatedBy.inputAssetIds = inputAssetIds
  if (inputNodeIds.length) generatedBy.inputNodeIds = inputNodeIds
  if (typeof options.createdAt === 'number' && Number.isFinite(options.createdAt)) {
    generatedBy.createdAt = options.createdAt
  }
  return generatedBy
}

export interface GenerationResultMedia {
  assetId?: string
  url?: string
  mimeType: string
  fileName?: string
}

export function upsertGenerationResultNodes(options: {
  requestNodeId: string
  variant: 'image' | 'video'
  results: GenerationResultMedia[]
  taskIndex?: number
  expectedCount?: number
  createIfMissing?: boolean
  documentId: string
  runId?: string
  taskId?: string
  channelId?: string
  providerId?: string
  model?: string
  inputReferenceIds?: string[]
  inputAssetIds?: string[]
  inputNodeIds?: string[]
  createdAt?: number
}): string[] {
  const target = isWritableGenerationTarget(options)
  if (!target) return []
  const { document: doc, request: current } = target
  const runId = options.runId || nanoid()
  const existing = doc.nodes.find((node): node is ContentNodeSpec => node.kind === 'content' && node.generationBatch?.runId === runId && node.generatedBy?.requestNodeId === current.id && ownedResultNodeIds(current.resultNodeIds?.[options.variant]).includes(node.id))
  if (!existing && options.createIfMissing === false) return []
  if (existing && !doc.edges.some(edge => edge.source === current.id && edge.target === existing.id)) return []
  const oldMedia = existing?.payload?.kind === options.variant ? existing.payload : undefined
  const oldResources = oldMedia && (oldMedia.kind === 'image' || oldMedia.kind === 'video') ? oldMedia.resources || [] : []
  const oldKeys = existing?.generationBatch?.resourceKeys || []
  const selectedKey = oldKeys[oldMedia && 'activeResourceIndex' in oldMedia ? oldMedia.activeResourceIndex || 0 : 0]
  const entries = new Map(oldResources.map((item, index) => [oldKeys[index], item]))
  options.results.forEach((result, index) => {
    if (!result.assetId && !isPersistableResultUrl(result.url)) return
    const key = String(options.taskIndex || 0).padStart(6, '0') + ':' + String(index).padStart(6, '0')
    entries.set(key, { resource: { ...entries.get(key)?.resource, resourceId: result.assetId ? resourceIdForAsset(result.assetId) : undefined, url: result.url && isPersistableResultUrl(result.url) ? result.url : '', mimeType: result.mimeType, fileName: result.fileName }, label: '' })
  })
  const resourceKeys = [...entries.keys()].sort()
  const resources = resourceKeys.map((key, index) => ({ ...entries.get(key)!, label: (options.variant === 'image' ? '图片 ' : '视频 ') + (index + 1) }))
  const activeResourceIndex = selectedKey ? Math.max(0, resourceKeys.indexOf(selectedKey)) : 0
  const active = resources[activeResourceIndex]?.resource
  const label = existing?.label || (current.label || (options.variant === 'image' ? '图片' : '视频')) + '结果'
  const id = existing?.id || nanoid()
  const size = existing?.size || { ...CONTENT_NODE_DEFAULT_SIZE }
  const placement = existing ? { position: existing.position, nodes: doc.nodes } : placeNewestResult(doc.nodes, current.id, { x: current.position.x + current.size.width + DOWNSTREAM_OFFSET_X, y: current.position.y }, size, RESULT_STACK_GAP)
  const position = placement.position
  const assetId = active?.resourceId ? assetIdForResource(active.resourceId) : undefined
  const next: ContentNodeSpec = {
    ...existing, id, kind: 'content', position, size, label, category: options.variant,
    subtype: options.variant === 'image' ? 'image' : 'remote-video',
    source: assetId ? { kind: 'file', assetId, mimeType: active?.mimeType || (options.variant === 'image' ? 'image/png' : 'video/mp4'), fileName: active?.fileName } : active?.url ? { kind: 'url', url: active.url } : null,
    assetId, content: undefined,
    payload: options.variant === 'image' ? { kind: 'image', resources, activeResourceIndex } : { kind: 'video', provider: 'direct', playback: 'video', resources, activeResourceIndex },
    generatedBy: existing?.generatedBy || contentGenerationProvenance({ ...options, runId }),
    generationBatch: { ...existing?.generationBatch, runId, expectedCount: existing?.generationBatch?.expectedCount || options.expectedCount || Math.max(1, resources.length), resourceKeys },
  }
  if (next.generationBatch?.expanded && next.generationBatch.collapsedSize) next.size = batchLayout(next).size
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return [id]
  const nodes = existing ? doc.nodes.map(node => node.id === id ? next : node) : [...placement.nodes, next]
  const requestIndex = nodes.findIndex(node => node.id === current.id)
  nodes[requestIndex] = { ...current, resultNodeIds: { ...current.resultNodeIds, [options.variant]: [...new Set([...ownedResultNodeIds(current.resultNodeIds?.[options.variant]), id])] } }
  const edges = existing ? doc.edges : [...doc.edges, { id: nanoid(), source: current.id, target: id, sourceHandle: 'out', targetHandle: 'in' }]
  useGraphStore.setState({ currentDocument: { ...doc, nodes, edges, updatedAt: Date.now() } })
  useGraphStore.getState().commitHistory()
  return [id]
}

export const RESUME_GENERATION_EVENT = 'cnote:resume-generation'

export function isGenerationRunResumable(run: GenerationRun): boolean {
  return run.status === 'waiting-for-user' && run.tasks.some((task) => isGenerationTaskResumable(task))
}

export function parkGenerationRunForResume(
  run: GenerationRun,
  reason = '离开画布或关闭应用后等待恢复确认',
): GenerationRun {
  if (
    run.status === 'completed'
    || run.status === 'cancelled'
    || run.status === 'failed'
    || run.status === 'waiting-for-user'
  ) {
    return run
  }
  const updatedAt = Date.now()
  return {
    ...run,
    status: 'waiting-for-user',
    tasks: run.tasks.map((task) => {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') return task
      const requestNodeId = task.requestNodeId || run.requestNodeId || task.recovery?.requestNodeId
      const variant = task.variant || run.variant || task.requestSnapshot?.variant || task.recovery?.variant
      const channelId = task.channelId || task.requestSnapshot?.channelId || task.recovery?.channelId
      const model = task.model || task.requestSnapshot?.model || task.recovery?.model
      const inputVersion = task.inputVersion || task.requestSnapshot?.inputVersion || task.recovery?.inputVersion
      if (!requestNodeId || !variant || !channelId || !model || !inputVersion) {
        if (!task.recovery) return task
        return {
          ...task,
          recovery: {
            ...task.recovery,
            state: 'waiting-for-user',
            updatedAt,
            reason,
          },
        }
      }
      return {
        ...task,
        recovery: {
          requestNodeId,
          variant,
          channelId,
          model,
          inputVersion,
          state: 'waiting-for-user',
          updatedAt,
          reason,
        },
      }
    }),
  }
}

const INFLIGHT_GENERATION_STATUSES = new Set<GenerationRun['status']>([
  'created',
  'validating',
  'queued',
  'running',
])

export function parkInflightGenerationRuns(
  reason = '离开画布或关闭应用后等待恢复确认',
): string[] {
  const runtime = useRuntimeStore.getState()
  const parked: string[] = []
  for (const run of Object.values(runtime.runs)) {
    if (!INFLIGHT_GENERATION_STATUSES.has(run.status)) continue
    runtime.putRun(parkGenerationRunForResume(run, reason))
    parked.push(run.id)
  }
  return parked
}

export function findWaitingGenerationRun(requestNodeId: string, preferredRunId?: string | null): GenerationRun | undefined {
  const runs = useRuntimeStore.getState().runs
  const preferred = preferredRunId ? runs[preferredRunId] : undefined
  if (
    preferred
    && preferred.status === 'waiting-for-user'
    && (!preferred.requestNodeId || preferred.requestNodeId === requestNodeId)
  ) {
    return preferred
  }
  return Object.values(runs).find((run) => run.requestNodeId === requestNodeId && run.status === 'waiting-for-user')
}

export function listResumableDocumentRuns(): GenerationRun[] {
  const document = useGraphStore.getState().currentDocument
  if (!document) return []
  const requestIds = new Set(
    document.nodes.filter((node) => node.kind === 'request').map((node) => node.id),
  )
  const latestRunIds = new Set(
    document.nodes
      .filter((node): node is RequestNodeSpec => node.kind === 'request')
      .map((node) => node.latestRunId)
      .filter((id): id is string => Boolean(id)),
  )
  return Object.values(useRuntimeStore.getState().runs).filter((run) => {
    const belongs = (run.requestNodeId && requestIds.has(run.requestNodeId)) || latestRunIds.has(run.id)
    return belongs && isGenerationRunResumable(run)
  })
}

export function requestResumeDocumentGeneration(): { count: number } {
  const runs = listResumableDocumentRuns()
  for (const run of runs) {
    window.dispatchEvent(new CustomEvent(RESUME_GENERATION_EVENT, {
      detail: { runId: run.id, requestNodeId: run.requestNodeId },
    }))
  }
  return { count: runs.length }
}
