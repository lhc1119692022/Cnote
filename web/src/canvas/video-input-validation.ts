import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { EdgeSpec, FlowDocument, GenerationConfig, GenerationReferenceOverride, RequestNodeSpec } from '@/domain'
import { AssetManager } from '@/runtime/asset-manager'
import { checksumBlob, loadLocalResourceBlob } from '@/lib/resource-storage'
import { resourceIdForAsset } from '@/storage/asset-store'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useGenerationStore } from '@/stores/use-generation-store'
import { loadReferenceForInspection, prepareOfficialMediaInput } from '@/lib/generation/media-inspection'
import { mediaProfileForModel, officialMediaProfile, validateMediaCollection, type MediaMetadata } from '@/lib/generation/official-media-rules'
import { normalizeVideoModeConfig } from '@/lib/generation/video-mode'
import type { GenerationReference } from '@/types/flow'
import { resolveRequestGenerationInputs, toLegacyVariantConfig } from './contents/request-generation'
import { materializeVisibleMediaCopies } from './visible-media-copies'

interface InputFeedback {
  pending: boolean
  message?: string
}

export const useVideoInputFeedback = create<{ nodes: Record<string, InputFeedback> }>(() => ({ nodes: {} }))
const assets = new AssetManager()
const queues = new Map<string, Promise<unknown>>()
const active = new Map<string, AbortController>()
const copies = new Map<string, string>()

function feedback(nodeId: string, value: InputFeedback) {
  useVideoInputFeedback.setState((state) => ({ nodes: { ...state.nodes, [nodeId]: value } }))
}

export function cancelVideoInputValidation(nodeId: string) {
  active.get(nodeId)?.abort()
}

function liveTarget(nodeId: string): { document: FlowDocument; request: RequestNodeSpec } | undefined {
  const document = useGraphStore.getState().currentDocument
  const request = document?.nodes.find((node) => node.id === nodeId)
  return document && request?.kind === 'request' && request.variant === 'video' ? { document, request } : undefined
}

function referencesFor(document: FlowDocument, request: RequestNodeSpec, config = request.video) {
  const runtime = useRuntimeStore.getState()
  const resolved = resolveRequestGenerationInputs({ requestNodeId: request.id, variant: 'video', config, nodes: document.nodes, edges: document.edges, assets: runtime.assets, runs: runtime.runs })
  const model = useGenerationStore.getState().getModels(config.channelId).find((candidate) => candidate.id === config.model)
  return normalizeVideoModeConfig(toLegacyVariantConfig('video', config, resolved.references, resolved.prompt), model).references
}

function hasOfficialMediaProfile(request: RequestNodeSpec) {
  return Boolean(officialMediaProfile(request.video.model))
}

function inputIdentity(document: FlowDocument, request: RequestNodeSpec) {
  return JSON.stringify([
    document.id, request.video.channelId, request.video.model, request.video.capability,
    request.video.referenceAssetIds, request.video.referenceOverrides,
    document.edges.filter((edge) => edge.target === request.id).map((edge) => [edge.id, edge.source]),
    referencesFor(document, request).map((reference) => [reference.id, reference.resourceId, reference.url, reference.role, reference.type]),
  ])
}

function serial<T>(nodeId: string, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const run = async () => {
    const controller = new AbortController()
    active.set(nodeId, controller)
    try { return await execute(controller.signal) }
    finally { if (active.get(nodeId) === controller) active.delete(nodeId) }
  }
  const result = (queues.get(nodeId) || Promise.resolve()).then(run, run)
  queues.set(nodeId, result)
  void result.finally(() => { if (queues.get(nodeId) === result) queues.delete(nodeId) }).catch(() => undefined)
  return result
}

async function hydrate(request: RequestNodeSpec) {
  for (const id of request.video.referenceAssetIds || []) await assets.getAsset(id)
}

async function inspectInputs(options: {
  references: GenerationReference[]
  request: RequestNodeSpec
  adaptIds: Set<string>
  signal: AbortSignal
}): Promise<{ rejected: Set<string>; errors: string[]; overrides: Record<string, GenerationReferenceOverride>; imported: string[] }> {
  const { request, references, adaptIds, signal } = options
  const model = useGenerationStore.getState().getModels(request.video.channelId).find((candidate) => candidate.id === request.video.model)
  const profile = mediaProfileForModel(request.video.model, model)
  const overrides = { ...request.video.referenceOverrides }
  const rejected = new Set<string>()
  const errors: string[] = []
  const imported: string[] = []
  if (!profile) return { rejected, errors, overrides, imported }
  const metadata = new Map<string, MediaMetadata>()
  const accepted: GenerationReference[] = []
  const rejectedSources = new Set<string>()
  const importedByReference = new Map<string, string>()
  const rejectSource = async (reference: GenerationReference) => {
    if (!reference.upstreamNodeId) return
    rejectedSources.add(reference.upstreamNodeId)
    for (let index = accepted.length - 1; index >= 0; index--) {
      const earlier = accepted[index]
      if (earlier.upstreamNodeId !== reference.upstreamNodeId) continue
      accepted.splice(index, 1)
      rejected.add(earlier.id)
      metadata.delete(earlier.id)
      const importedId = importedByReference.get(earlier.id)
      if (importedId) {
        await assets.releaseAsset(importedId)
        imported.splice(imported.indexOf(importedId), 1)
        importedByReference.delete(earlier.id)
        delete overrides[earlier.id]
      }
    }
  }
  try {
    for (const reference of references) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError')
      if (reference.upstreamNodeId && rejectedSources.has(reference.upstreamNodeId)) {
        rejected.add(reference.id)
        continue
      }
      const canAdapt = Boolean(request.video.autoAdaptImages && adaptIds.has(reference.id))
      let originalBlob: Blob | undefined
      let contentKey = reference.resourceId || reference.url || reference.id
      if (canAdapt && reference.type === 'image') {
        try {
          originalBlob = await loadReferenceForInspection(reference, signal)
          contentKey = await checksumBlob(originalBlob)
        } catch (error) {
          if (signal.aborted) throw error
          rejected.add(reference.id)
          errors.push(`${reference.fileName || reference.label || reference.id}：无法读取素材；${error instanceof Error ? error.message : String(error)}`)
          await rejectSource(reference)
          continue
        }
      }
      const processingKey = `${contentKey}:${profile.id}:${profile.revision}:webp:100:${reference.role || ''}`
      const cachedId = canAdapt && copies.get(processingKey)
      const cachedBlob = cachedId ? await loadLocalResourceBlob(resourceIdForAsset(cachedId)) : undefined
      const result = await prepareOfficialMediaInput({ modelId: model?.id || request.video.model || profile.id, model, reference, capability: request.video.capability, adaptImages: canAdapt && !cachedBlob, blob: cachedBlob || originalBlob, signal })
      const issues = [...result.violations]
      if (result.metadata) metadata.set(reference.id, result.metadata)
      if (!issues.length) issues.push(...validateMediaCollection(profile, [...accepted, reference], metadata))
      if (request.video.capability === 'first-last-frame' && (reference.type !== 'image' || !['first_frame', 'last_frame'].includes(reference.role || ''))) {
        errors.push(`${reference.fileName || reference.label || reference.id}：首尾帧入口仅接受一张首帧和可选的一张尾帧`)
        rejected.add(reference.id)
      } else if (issues.length) {
        errors.push(...issues.map((item) => item.message))
        rejected.add(reference.id)
      } else {
        accepted.push(reference)
        if ((result.adapted || cachedBlob) && result.blob) {
          const fileName = `${(reference.fileName || reference.label || '图片').replace(/\.[^.]+$/, '')}-兼容.webp`
          const asset = await assets.importAsset(result.blob, fileName)
          imported.push(asset.id)
          importedByReference.set(reference.id, asset.id)
          overrides[reference.id] = {
            ...overrides[reference.id],
            compatibleCopy: { sourceIdentity: reference.resourceId || reference.url || '', assetId: asset.id, fileName, mimeType: 'image/webp', size: asset.size, processingKey },
          }
          copies.set(processingKey, asset.id)
          if (copies.size > 128) copies.delete(copies.keys().next().value!)
        }
      }
      if (rejected.has(reference.id) && reference.upstreamNodeId) {
        await rejectSource(reference)
      }
    }
    return { rejected, errors, overrides, imported }
  } catch (error) {
    await Promise.all(imported.map((id) => assets.releaseAsset(id)))
    throw error
  }
}

function assertCurrent(nodeId: string, documentId: string, identity: string, signal: AbortSignal) {
  const target = liveTarget(nodeId)
  if (signal.aborted || !target || target.document.id !== documentId || inputIdentity(target.document, target.request) !== identity || useGraphStore.getState().isLocked) {
    throw new DOMException('输入已变化，已取消本次检查，请重新连接', 'AbortError')
  }
  return target
}

export async function connectVideoInput(sourceId: string, targetId: string, opts?: { sourceHandle?: string; targetHandle?: string }): Promise<void> {
  const queuedTarget = liveTarget(targetId)
  if (!queuedTarget) return
  const queuedModel = queuedTarget.request.video.model
  const documentId = queuedTarget.document.id
  await serial(targetId, async (signal) => {
    let imported: string[] = []
    try {
      let target = liveTarget(targetId)
      if (!target || target.document.id !== documentId || target.request.video.model !== queuedModel || useGraphStore.getState().isLocked) return
      await hydrate(target.request)
      target = liveTarget(targetId)!
      const source = target.document.nodes.find((node) => node.id === sourceId)
      if (!source || source.disabled || target.request.disabled || target.document.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) return
      const identity = inputIdentity(target.document, target.request)
      const edge: EdgeSpec = { id: nanoid(), source: sourceId, target: targetId, ...opts }
      const candidate = { ...target.document, edges: [...target.document.edges, edge] }
      const candidateOverrides = { ...target.request.video.referenceOverrides }
      const rawReferences = referencesFor(candidate, { ...target.request, video: { ...target.request.video, referenceOverrides: undefined } })
      for (const reference of rawReferences.filter((item) => item.upstreamNodeId === sourceId)) {
        candidateOverrides[reference.id] = { ...candidateOverrides[reference.id], excluded: false, compatibleCopy: undefined }
      }
      const candidateRequest = { ...target.request, video: { ...target.request.video, referenceOverrides: candidateOverrides } }
      const references = referencesFor(candidate, candidateRequest)
      const beforeIds = new Set(referencesFor(target.document, target.request).map((reference) => reference.id))
      feedback(targetId, { pending: true, message: '正在检查素材…' })
      const result = await inspectInputs({ references, request: candidateRequest, adaptIds: new Set(references.filter((reference) => !beforeIds.has(reference.id)).map((reference) => reference.id)), signal })
      imported = result.imported
      const current = assertCurrent(targetId, documentId, identity, signal)
      if (result.errors.length) throw new Error(`无法连接：${result.errors.join('\n')}`)
      useGraphStore.setState({ currentDocument: materializeVisibleMediaCopies({ ...current.document, edges: [...current.document.edges, edge] }, current.request, references, result.overrides) })
      imported = []
      useGraphStore.getState().commitHistory()
      feedback(targetId, { pending: false, message: hasOfficialMediaProfile(target.request) ? undefined : '未配置官方规格，未验证模型素材限制' })
    } catch (error) {
      feedback(targetId, { pending: false, message: error instanceof Error ? error.message : String(error) })
    } finally { await Promise.all(imported.map((id) => assets.releaseAsset(id))) }
  })
}

export async function addVideoInputFile(nodeId: string, file: File, type: GenerationReference['type'], role?: GenerationReference['role']): Promise<void> {
  const queued = liveTarget(nodeId)
  if (!queued) return
  const documentId = queued.document.id
  const modelId = queued.request.video.model
  await serial(nodeId, async (signal) => {
    const imported: string[] = []
    try {
      let target = liveTarget(nodeId)
      if (!target || target.document.id !== documentId || target.request.video.model !== modelId || useGraphStore.getState().isLocked) return
      await hydrate(target.request)
      target = liveTarget(nodeId)!
      const identity = inputIdentity(target.document, target.request)
      feedback(nodeId, { pending: true, message: '正在检查素材…' })
      const asset = await assets.importAsset(file, file.name)
      imported.push(asset.id)
      const existing = referencesFor(target.document, target.request)
      if (existing.some((reference) => reference.id === asset.id)) { feedback(nodeId, { pending: false }); return }
      const config: GenerationConfig = {
        ...target.request.video,
        referenceAssetIds: [...(target.request.video.referenceAssetIds || []), asset.id],
        referenceOverrides: { ...target.request.video.referenceOverrides, [asset.id]: { role: role || (type === 'image' ? 'reference_image' : type === 'video' ? 'reference_video' : 'reference_audio'), order: existing.length } },
      }
      const candidate = { ...target.request, video: config }
      const references = referencesFor(target.document, candidate)
      const result = await inspectInputs({ references, request: candidate, adaptIds: new Set([asset.id]), signal })
      imported.push(...result.imported)
      assertCurrent(nodeId, documentId, identity, signal)
      if (result.errors.length) throw new Error(`添加失败：${result.errors.join('\n')}`)
      const current = liveTarget(nodeId)!
      useGraphStore.setState({ currentDocument: materializeVisibleMediaCopies(current.document, { ...current.request, video: config }, references, result.overrides) })
      imported.length = 0
      useGraphStore.getState().commitHistory()
      feedback(nodeId, { pending: false, message: hasOfficialMediaProfile(current.request) ? undefined : '未配置官方规格，未验证模型素材限制' })
    } catch (error) {
      feedback(nodeId, { pending: false, message: error instanceof Error ? error.message : String(error) })
    } finally { await Promise.all(imported.map((id) => assets.releaseAsset(id))) }
  })
}

async function revalidateVideoInputs(nodeId: string) {
  await serial(nodeId, async (signal) => {
    try {
      let target = liveTarget(nodeId)
      if (!target || useGraphStore.getState().isLocked) return
      await hydrate(target.request)
      target = liveTarget(nodeId)
      if (!target) return
      const raw = referencesFor(target.document, target.request, { ...target.request.video, referenceOverrides: undefined })
      if (raw.some((reference) => target!.request.video.referenceOverrides?.[reference.id]?.compatibleCopy?.sourceIdentity === (reference.resourceId || reference.url) && target!.request.video.referenceOverrides?.[reference.id]?.compatibleCopy)) {
        useGraphStore.setState({ currentDocument: materializeVisibleMediaCopies(target.document, target.request, raw, target.request.video.referenceOverrides || {}) })
        useGraphStore.getState().commitHistory()
        return
      }
      const rawById = new Map(raw.map((reference) => [reference.id, reference]))
      const pruned = { ...target.request.video.referenceOverrides }
      let changed = false
      for (const [id, override] of Object.entries(pruned)) {
        const original = rawById.get(id)
        if (!original) { delete pruned[id]; changed = true }
        else if (override.compatibleCopy && override.compatibleCopy.sourceIdentity !== (original.resourceId || original.url)) {
          pruned[id] = { ...override, compatibleCopy: undefined }; changed = true
        }
      }
      if (changed) {
        useGraphStore.getState().updateNode(nodeId, { video: { ...target.request.video, referenceOverrides: pruned } })
        return
      }
      const identity = inputIdentity(target.document, target.request)
      const references = referencesFor(target.document, target.request)
      if (!references.length) {
        const previous = useVideoInputFeedback.getState().nodes[nodeId]
        feedback(nodeId, { ...previous, pending: false })
        return
      }
      const previousMessage = useVideoInputFeedback.getState().nodes[nodeId]?.message
      feedback(nodeId, { pending: true, message: previousMessage?.startsWith('已断开') ? previousMessage : '正在复检素材…' })
      const result = await inspectInputs({ references, request: target.request, adaptIds: new Set(), signal })
      const current = assertCurrent(nodeId, target.document.id, identity, signal)
      if (result.rejected.size) {
        const sourceIds = new Set(references.filter((reference) => result.rejected.has(reference.id)).map((reference) => reference.upstreamNodeId).filter(Boolean))
        const removed = references.filter((reference) => result.rejected.has(reference.id) || (reference.upstreamNodeId && sourceIds.has(reference.upstreamNodeId)))
        const overrides = { ...current.request.video.referenceOverrides }
        for (const reference of removed) delete overrides[reference.id]
        const removedIds = new Set(removed.map((reference) => reference.id))
        useGraphStore.setState({ currentDocument: {
          ...current.document,
          nodes: current.document.nodes.map((node) => node.id === nodeId ? { ...current.request, video: { ...current.request.video, referenceAssetIds: current.request.video.referenceAssetIds?.filter((id) => !removedIds.has(id)), referenceOverrides: overrides } } : node),
          edges: current.document.edges.filter((edge) => edge.target !== nodeId || !sourceIds.has(edge.source)),
          updatedAt: Date.now(),
        } })
        useGraphStore.getState().commitHistory()
        feedback(nodeId, { pending: false, message: `已断开或移除不兼容输入：${result.errors.join('\n')}。其他合规连接已保留，请重新连接后再适配。` })
      } else {
        const previous = useVideoInputFeedback.getState().nodes[nodeId]?.message
        feedback(nodeId, { pending: false, message: hasOfficialMediaProfile(target.request) ? (previous?.startsWith('已断开') ? previous : undefined) : '未配置官方规格，未验证模型素材限制' })
      }
    } catch (error) {
      feedback(nodeId, { pending: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}

export function installVideoInputValidation(): () => void {
  const identities = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const refresh = () => {
    const document = useGraphStore.getState().currentDocument
    const alive = new Set<string>()
    for (const node of document?.nodes || []) {
      if (node.kind !== 'request' || node.variant !== 'video') continue
      alive.add(node.id)
      const identity = inputIdentity(document!, node)
      const copiesById = node.video.referenceOverrides || {}
      for (const override of Object.values(copiesById)) {
        if (override.compatibleCopy) copies.set(override.compatibleCopy.processingKey, override.compatibleCopy.assetId)
      }
      if (copies.size > 128) copies.delete(copies.keys().next().value!)
      if (identities.get(node.id) === identity) continue
      identities.set(node.id, identity)
      active.get(node.id)?.abort()
      clearTimeout(timers.get(node.id))
      timers.set(node.id, setTimeout(() => { timers.delete(node.id); void revalidateVideoInputs(node.id) }, 100))
    }
    for (const id of identities.keys()) {
      if (alive.has(id)) continue
      active.get(id)?.abort()
      clearTimeout(timers.get(id))
      timers.delete(id)
      identities.delete(id)
    }
  }
  const unsubscribeGraph = useGraphStore.subscribe((state, previous) => {
    if (state.isLocked !== previous.isLocked) identities.clear()
    if (state.currentDocument !== previous.currentDocument || state.isLocked !== previous.isLocked) refresh()
  })
  const unsubscribeRuntime = useRuntimeStore.subscribe((state, previous) => {
    if (state.assets !== previous.assets || state.runs !== previous.runs) refresh()
  })
  refresh()
  return () => {
    unsubscribeGraph(); unsubscribeRuntime()
    for (const timer of timers.values()) clearTimeout(timer)
    for (const controller of active.values()) controller.abort()
    useVideoInputFeedback.setState({ nodes: {} })
  }
}
