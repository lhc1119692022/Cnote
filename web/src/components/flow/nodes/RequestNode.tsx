import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { Check, ChevronDown, ChevronUp, Image as ImageIcon, LoaderCircle, Mic, Sparkles, Square, Upload, Video, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { generationAdapterForModel, generationChannelSupportsVariant, generationChannelUsesModelInference, generationSecretName, useGenerationStore, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { createGenerationReference, createRequestNodeData, normalizeGenerationReferences } from '@/lib/generation/defaults'
import { cancelGenerationTask, pollGenerationTask, pollIntervalForModel, submitGenerationTask } from '@/lib/generation/client'
import { appendGenerationResultContentData } from '@/lib/generation/results'
import { deleteLocalResource, loadLocalResourceUrl, revokeManagedObjectUrl, storeLocalResource } from '@/lib/resource-storage'
import { textForAIContextNode } from '@/lib/flow/ai-context'
import { getNodeMediaItems } from '@/lib/content-media'
import { REQUEST_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import type { GenerationCapability, GenerationReference, GenerationTaskState, RequestNodeData, RequestVariant } from '@/types/flow'
import { NodeDragGutters, NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

const CAPABILITY_LABELS: Record<GenerationCapability, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'reference-to-video': '多参考视频',
  'first-last-frame': '首尾帧',
  'video-reference': '视频参考',
  'audio-reference': '音频参考',
  'video-edit': '视频编辑',
  'generate-audio': '生成音频',
}

const TYPE_LABELS = { image: '图片', video: '视频', audio: '音频' } as const
const TYPE_ICONS = { image: ImageIcon, video: Video, audio: Mic } as const
const REFERENCE_DND_TYPE = 'application/x-cnote-generation-reference'

function imageCapabilityForReferences(references: GenerationReference[] = []): GenerationCapability {
  return references.some((reference) => reference.type === 'image') ? 'image-to-image' : 'text-to-image'
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`
}

function LocalReferencePreview({ reference }: { reference: GenerationReference }) {
  const [url, setUrl] = useState(reference.previewUrl || reference.url || '')

  useEffect(() => {
    let active = true
    let managedUrl = ''
    if (reference.previewUrl || reference.url || !reference.resourceId) return () => undefined
    void loadLocalResourceUrl(reference.resourceId).then((nextUrl) => {
      if (!active || !nextUrl) return
      managedUrl = nextUrl
      setUrl(nextUrl)
    })
    return () => {
      active = false
      revokeManagedObjectUrl(managedUrl)
    }
  }, [reference.previewUrl, reference.resourceId, reference.url])

  if (reference.type === 'audio') return <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Mic className="h-5 w-5" /></div>
  if (!url) return <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Upload className="h-5 w-5" /></div>
  if (reference.type === 'video') return <video src={url} muted className="h-14 w-14 rounded-lg bg-black object-cover" />
  return <img src={url} alt={reference.label || '参考图片'} className="h-14 w-14 rounded-lg bg-muted object-cover" />
}

function defaultRole(type: GenerationReference['type'], variant: RequestVariant): GenerationReference['role'] {
  if (type === 'audio') return variant === 'video' ? 'reference_voice' : 'reference_audio'
  return type === 'video' ? 'reference_video' : 'reference_image'
}

/** 把上游节点的文本并入提示词、图片/视频并入参考素材，与 Flow 执行器的行为保持一致。 */
function withUpstreamInputs<T extends { prompt?: string; references?: GenerationReference[] }>(nodeId: string, variant: RequestVariant, config: T): T {
  const { nodes, edges } = useFlowStore.getState()
  const upstreamNodes = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is NonNullable<typeof node> => Boolean(node && !(node.data as { disabled?: boolean } | undefined)?.disabled))
  if (!upstreamNodes.length) {
    return variant === 'image'
      ? { ...config, capability: imageCapabilityForReferences(config.references) }
      : config
  }

  const upstreamText = upstreamNodes
    .map((node) => textForAIContextNode(node).trim())
    .filter(Boolean)
    .join('\n\n')
  const existingKeys = new Set((config.references || []).map((reference) => reference.url || reference.resourceId).filter(Boolean))
  const upstreamKinds = variant === 'image' ? (['image'] as const) : (['image', 'video'] as const)
  const upstreamReferences = upstreamNodes.flatMap((node) => upstreamKinds.flatMap((kind) =>
    getNodeMediaItems(node, kind).map((item): GenerationReference => ({
      id: `upstream-${node.id}-${kind}-${item.resource.sourceUrl || item.resource.url || item.resource.resourceId}`,
      type: kind,
      role: defaultRole(kind, variant),
      label: item.label,
      source: (item.resource.sourceUrl || item.resource.url) && /^https?:\/\//i.test(item.resource.sourceUrl || item.resource.url) ? 'url' : 'local',
      url: item.resource.sourceUrl || item.resource.url || undefined,
      previewUrl: item.resource.url || undefined,
      resourceId: item.resource.resourceId,
      mimeType: item.resource.mimeType,
      order: 0,
      status: 'ready',
    })),
  )).filter((reference) => {
    const key = reference.url || reference.resourceId
    if (!key || existingKeys.has(key)) return false
    existingKeys.add(key)
    return true
  })

  const baseReferenceCount = config.references?.length || 0
  const references = normalizeGenerationReferences([
    ...(config.references || []),
    ...upstreamReferences.map((reference, index) => ({ ...reference, order: baseReferenceCount + index })),
  ])
  return {
    ...config,
    prompt: [config.prompt, upstreamText].filter(Boolean).join('\n\n'),
    ...(variant === 'image' ? { capability: imageCapabilityForReferences(references) } : {}),
    references,
  }
}

function formatResolutionLabel(value: string) {
  return value.replace(/^(\d+)k$/i, '$1K')
}

function formatAspectRatioLabel(value: string) {
  return value.toLowerCase() === 'auto' ? 'Auto' : value
}

function closeOpenMenus(root: ParentNode | null, except?: HTMLDetailsElement | null) {
  root?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
    if (menu !== except) menu.removeAttribute('open')
  })
}

type ChoiceOption = {
  value: string
  label: string
  disabled?: boolean
}

function ChoiceRow({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string
  value: string
  options: ChoiceOption[]
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return <div role="group" aria-label={ariaLabel} className="nodrag flex items-center justify-between gap-3 px-2 py-1.5">
    <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
    <div className="flex min-w-0 flex-wrap justify-end gap-1">
      {options.map((option) => <button
        key={option.value}
        type="button"
        disabled={option.disabled}
        aria-pressed={option.value === value}
        aria-label={`${ariaLabel}：${option.label}`}
        className="nodrag shrink-0 rounded-full border border-transparent px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 data-[selected=true]:bg-foreground data-[selected=true]:text-background"
        data-selected={option.value === value}
        onClick={() => { if (!option.disabled) onChange(option.value) }}
      >{option.label}</button>)}
    </div>
  </div>
}

function modelConfigUpdates(config: NonNullable<RequestNodeData['image']> | undefined, model: GenerationModel | undefined, variant: RequestVariant) {
  if (!config || !model || variant === 'body') return {}
  const updates: Partial<typeof config> = {}
  if (model.resolutions?.length && (!config.resolution || !model.resolutions.includes(config.resolution))) updates.resolution = model.resolutions[0]
  if (model.aspectRatios?.length && (!config.aspectRatio || !model.aspectRatios.includes(config.aspectRatio))) updates.aspectRatio = model.aspectRatios[0]
  if (variant === 'image' && model.thinkingLevels?.length && (!config.thinkingLevel || !model.thinkingLevels.includes(config.thinkingLevel))) updates.thinkingLevel = model.defaultThinkingLevel || model.thinkingLevels[0]
  if (variant === 'video') {
    const currentSeconds = config.seconds || 30
    if (model.minDuration && currentSeconds < model.minDuration) updates.seconds = model.minDuration
    if (model.maxDuration && currentSeconds > model.maxDuration) updates.seconds = model.maxDuration
    if (model.capabilities.length && !model.capabilities.includes('generate-audio')) updates.generateAudio = false
  }
  return updates
}

export const RequestNode = memo(({ id, data, selected }: NodeProps<RequestNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const addNode = useFlowStore((state) => state.addNode)
  const addEdge = useFlowStore((state) => state.addEdge)
  const upstreamCount = useFlowStore((state) => state.edges.filter((edge) => edge.target === id).length)
  const channels = useGenerationStore((state) => state.channels)
  const getModels = useGenerationStore((state) => state.getModels)
  const [now, setNow] = useState(Date.now())
  const nodeRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const unmountingRef = useRef(false)
  const draggedReferenceIdRef = useRef<string | null>(null)
  const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null)

  const variant = data.variant || 'body'
  const config = variant === 'body' ? undefined : data[variant]
  const selectedChannel = config?.channelId ? channels.find((channel) => channel.id === config.channelId) : undefined
  const allModels = useMemo(() => getModels(config?.channelId), [config?.channelId, getModels])
  const models = useMemo(() => {
    if (variant === 'body') return []
    if (!selectedChannel || !generationChannelUsesModelInference(selectedChannel)) return allModels
    const imageCapability = new Set<GenerationCapability>(['text-to-image', 'image-to-image'])
    const videoCapability = new Set<GenerationCapability>(['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio'])
    const accepted = variant === 'image' ? imageCapability : videoCapability
    return allModels.filter((model) => !model.capabilities.length || model.capabilities.some((capability) => accepted.has(capability)))
  }, [allModels, selectedChannel, variant])
  const selectedModel = models.find((model) => model.id === config?.model)
  const capabilities = useMemo(() => {
    // The two selectors constrain each other: once a model is selected, the
    // capability tab only shows capabilities that model can actually run.
    const sourceModels = selectedModel ? [selectedModel] : models
    const all = [...new Set(sourceModels.flatMap((model) => model.capabilities))]
    return all.length ? all : variant === 'image' ? ['text-to-image', 'image-to-image'] as GenerationCapability[] : ['text-to-video', 'image-to-video', 'reference-to-video'] as GenerationCapability[]
  }, [models, selectedModel, variant])
  const references = config?.references || []
  const orderedReferences = normalizeGenerationReferences(references)
  const effectiveCapability = variant === 'image'
    ? imageCapabilityForReferences(references)
    : config?.capability || capabilities[0]
  const timeoutMs = variant === 'image' ? 15 * 60 * 1000 : 60 * 60 * 1000
  const availableAspectRatios = useMemo(() => [...new Set((variant === 'image' ? ['auto', '1:1', '16:9', '9:16'] : ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']).concat(models.flatMap((model) => model.aspectRatios || [])))], [models, variant])
  const availableResolutions = useMemo(() => [...new Set((variant === 'image' ? ['auto', '1k', '2k', '3k', '4k'] : ['768', '720p', '1080p', '2K', '4K']).concat(models.flatMap((model) => model.resolutions || [])))], [models, variant])
  const selectedResolution = config?.resolution || (variant === 'image' ? 'auto' : '720p')
  const selectedAspectRatio = config?.aspectRatio || '16:9'
  const parameterSummary = `${formatResolutionLabel(selectedResolution)} · ${formatAspectRatioLabel(selectedAspectRatio)}`
  const task = useMemo(() => {
    if (variant === 'body') return { status: 'idle' as const }
    return data.tasks?.[variant] || (data.variant === variant ? data.task : undefined) || { status: 'idle' as const }
  }, [data.task, data.tasks, data.variant, variant])
  const elapsed = task.submittedAt ? Math.max(task.elapsedMs || 0, now - task.submittedAt) : task.elapsedMs || 0
  const waiting = task.status === 'validating' || task.status === 'submitting' || task.status === 'queued' || task.status === 'in_progress'

  const updateTask = useCallback((updates: Partial<GenerationTaskState>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = current.data as RequestNodeData
    if (variant === 'body') return
    const nextTask = { ...(currentData.tasks?.[variant] || currentData.task || { status: 'idle' as const }), ...updates }
    updateNode(id, {
      data: {
        ...currentData,
        tasks: { ...(currentData.tasks || {}), [variant]: nextTask },
        task: nextTask,
      },
    })
  }, [id, updateNode, variant])

  const createResultNodes = useCallback((urls: string[], resourceIds?: string[], mimeTypes?: string[], fileNames?: string[], batchIndex = 0, batchCount = urls.length) => {
    if (!urls.length || (variant !== 'image' && variant !== 'video')) return
    const state = useFlowStore.getState()
    const current = state.nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = current.data as RequestNodeData
    const resultLabel = `${currentData.label || (variant === 'image' ? '图片' : '视频')}结果`
    const connectedResultNodes = state.edges
      .filter((edge) => edge.source === id)
      .map((edge) => state.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => node?.type === 'content' && node.data?.category === variant)
    const storedIds = currentData.resultNodeIdsByVariant?.[variant] || []
    const legacyId = currentData.resultNodeIds?.[variant] || (currentData.variant === variant ? currentData.resultNodeId : undefined)
    const orderedNodes = [...connectedResultNodes].sort((left, right) => {
      const leftIndex = storedIds.indexOf(left.id)
      const rightIndex = storedIds.indexOf(right.id)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    })
    if (!orderedNodes.length && legacyId) {
      const legacyNode = state.nodes.find((node) => node.id === legacyId)
      if (
        legacyNode?.type === 'content'
        && legacyNode.data?.category === variant
        && state.edges.some((edge) => edge.source === id && edge.target === legacyNode.id)
      ) orderedNodes.push(legacyNode)
    }
    const useHistory = orderedNodes.length >= batchCount
    const resultNodeIds: string[] = []
    const width = Number(current.style?.width || 520)
    urls.forEach((url, index) => {
      const resultIndex = batchIndex + index
      const existingNode = orderedNodes[resultIndex]
      let resultNode = existingNode
      const resultData = useHistory && existingNode
        ? appendGenerationResultContentData(existingNode.data as any, variant, [url], resultLabel, resourceIds?.slice(index, index + 1), mimeTypes?.slice(index, index + 1), fileNames?.slice(index, index + 1))
        : appendGenerationResultContentData(undefined, variant, [url], resultLabel, resourceIds?.slice(index, index + 1), mimeTypes?.slice(index, index + 1), fileNames?.slice(index, index + 1))
      if (resultNode?.type === 'content') updateNode(resultNode.id, { data: resultData })
      else {
        resultNode = addNode({ type: 'content', position: { x: current.position.x + width + 90, y: current.position.y + index * 40 }, data: resultData })
        addEdge({ source: id, target: resultNode.id, sourceHandle: 'out', targetHandle: 'in', type: 'interactive' })
      }
      resultNodeIds.push(resultNode.id)
    })
    updateNode(id, {
      data: {
        ...currentData,
        resultNodeIds: { ...(currentData.resultNodeIds || {}), [variant]: resultNodeIds[0] },
        resultNodeIdsByVariant: { ...(currentData.resultNodeIdsByVariant || {}), [variant]: [...new Set([...orderedNodes.map((node) => node.id), ...resultNodeIds])] },
        resultNodeId: resultNodeIds[0],
        resultCreatedAt: Date.now(),
      },
    })
  }, [addEdge, addNode, id, updateNode, variant])

  const runTask = useCallback(async (resumeTaskId?: string) => {
    if (variant === 'body' || pollingRef.current) return
    const generationStore = useGenerationStore.getState()
    const previousNodeData = useFlowStore.getState().nodes.find((node) => node.id === id)?.data as RequestNodeData | undefined
    const previousTask = previousNodeData?.tasks?.[variant] || previousNodeData?.task
    const persisted = resumeTaskId ? previousTask?.requestSnapshot : undefined
    const liveChannel = config?.channelId ? generationStore.getChannel(config.channelId) : undefined
    const persistedLiveChannel = persisted ? generationStore.getChannel(persisted.channelId) : liveChannel
    const channel: GenerationChannel | undefined = persisted
      ? {
          id: persisted.channelId,
          providerId: persisted.providerId as GenerationChannel['providerId'],
          name: persistedLiveChannel?.name || '已提交渠道',
          baseURL: persisted.baseURL,
          apiKey: persistedLiveChannel ? generationStore.getAPIKey(persistedLiveChannel.id) || undefined : undefined,
          secretName: persisted.secretName || persistedLiveChannel?.secretName || generationSecretName(persisted.channelId),
          modelIds: persistedLiveChannel?.modelIds || [persisted.model],
          enabled: true,
          protocol: persisted.protocol as GenerationChannel['protocol'],
          mediaTransport: persisted.mediaTransport,
          mediaUploadPath: persisted.mediaUploadPath,
          mediaUploadURL: persisted.mediaUploadURL,
          mediaUploadSecretName: persisted.mediaUploadSecretName,
          adapters: persistedLiveChannel?.adapters,
        }
      : liveChannel
    const runConfig = persisted?.config || (config ? withUpstreamInputs(id, variant, config) : config)
    const model = persisted
        ? persistedLiveChannel?.id === persisted.channelId
          ? generationStore.getModels(persistedLiveChannel.id).find((item) => item.id === persisted.model) || { id: persisted.model, name: persisted.model, capabilities: [] }
        : { id: persisted.model, name: persisted.model, capabilities: [] }
      : config?.model ? generationStore.getModels(config.channelId).find((item) => item.id === config.model) : undefined
    if (!channel || !model || !runConfig) {
      updateTask({ status: 'failed', error: '请先选择生成渠道和模型' })
      return
    }
    if (!persisted && !runConfig.prompt?.trim() && !runConfig.references?.length) {
      updateTask({ status: 'failed', error: '缺少生成内容：请填写提示词，或让上游节点提供文本/媒体素材' })
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    pollingRef.current = true
    const elapsedOffset = resumeTaskId ? (previousTask?.elapsedMs || 0) : 0
    const submittedAt = Date.now()
    const timeoutAt = submittedAt + timeoutMs
    let timedOut = false
    const timeoutTimer = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const requestedCount = resumeTaskId || variant !== 'image'
        ? 1
        : Math.max(1, Math.min(10, Math.trunc(runConfig.outputCount || 1)))
      let taskId: string | undefined
      for (let generationIndex = 0; generationIndex < requestedCount; generationIndex += 1) {
        taskId = resumeTaskId
        const requestConfig = resumeTaskId ? runConfig : { ...runConfig, outputCount: 1 }
        if (!taskId) {
          updateTask({ status: 'validating', submittedAt, elapsedMs: 0, timeoutAt, error: undefined, resultUrls: undefined })
          updateTask({ status: 'submitting' })
          const submitted = await submitGenerationTask({ channel, model, config: requestConfig, variant }, controller.signal)
          taskId = submitted.taskId
          const preparedConfig = submitted.preparedConfig || requestConfig
          if (submitted.preparedConfig?.references && variant === 'video') {
            // Upstream media belongs to its source node. Persist only references
            // that were already owned by this request node; the full prepared
            // config remains in the immutable task snapshot for polling/resume.
            const ownedReferenceIds = new Set((config?.references || []).map((reference) => reference.id))
            const persistedReferences = submitted.preparedConfig.references.filter((reference) => ownedReferenceIds.has(reference.id))
            const current = useFlowStore.getState().nodes.find((node) => node.id === id)
            if (current && persistedReferences.length) updateNode(id, { data: { ...current.data, [variant]: { ...(current.data as RequestNodeData)[variant], references: persistedReferences } } })
          }
          updateTask({ taskId, provider: channel.providerId, channelId: channel.id, model: model.id, status: 'queued', submittedAt, elapsedMs: 0, timeoutAt, error: undefined, requestSnapshot: { variant, channelId: channel.id, providerId: channel.providerId, protocol: channel.protocol, baseURL: channel.baseURL, secretName: channel.secretName, mediaTransport: channel.mediaTransport, mediaUploadPath: channel.mediaUploadPath, mediaUploadURL: channel.mediaUploadURL, mediaUploadSecretName: channel.mediaUploadSecretName, model: model.id, config: preparedConfig } })
          if (submitted.resultUrls?.length) {
            updateTask({ status: 'completed', resultUrls: submitted.resultUrls, resultResourceIds: submitted.resultResourceIds, resultMimeTypes: submitted.resultMimeTypes, completedAt: Date.now(), elapsedMs: Date.now() - submittedAt })
            createResultNodes(submitted.resultUrls, submitted.resultResourceIds, submitted.resultMimeTypes, submitted.resultFileNames, generationIndex, requestedCount)
            resumeTaskId = undefined
            continue
          }
        } else {
        updateTask({ taskId, provider: channel.providerId, channelId: channel.id, model: model.id, status: 'in_progress', submittedAt, elapsedMs: elapsedOffset, timeoutAt, error: undefined, requestSnapshot: previousTask?.requestSnapshot })
        }

        const pollInterval = pollIntervalForModel(model)
        while (taskId) {
          if (Date.now() >= timeoutAt) {
            updateTask({ status: 'timeout', elapsedMs: elapsedOffset + Date.now() - submittedAt, timeoutAt })
            return
          }
          const polled = await pollGenerationTask({ channel, model, config: requestConfig, variant }, taskId, controller.signal)
          const elapsedMs = elapsedOffset + Date.now() - submittedAt
          updateTask({ ...polled.task, taskId, submittedAt, elapsedMs, timeoutAt })
          if (polled.task.status === 'completed') {
            if (polled.task.resultUrls?.length) createResultNodes(polled.task.resultUrls, polled.task.resultResourceIds, polled.task.resultMimeTypes, polled.task.resultFileNames, generationIndex, requestedCount)
            else { updateTask({ error: '任务已完成，但服务端没有返回可预览的结果地址' }); return }
            break
          }
          if (polled.task.status === 'failed') return
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, pollInterval)
            controller.signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('执行已停止', 'AbortError')) }, { once: true })
          })
        }
        resumeTaskId = undefined
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Leaving the Flow or closing the window only stops local polling.
        // Keep the persisted remote task resumable; explicit stop still cancels it.
        if (unmountingRef.current) return
        if (timedOut) updateTask({ status: 'timeout', elapsedMs: elapsedOffset + Date.now() - submittedAt, timeoutAt })
        else updateTask({ status: 'idle', error: '已停止生成', elapsedMs: elapsedOffset + Date.now() - submittedAt })
        return
      }
      updateTask({ status: 'failed', error: error instanceof Error ? error.message : '生成任务失败', elapsedMs: elapsedOffset + Date.now() - submittedAt, timeoutAt })
    } finally {
      window.clearTimeout(timeoutTimer)
      pollingRef.current = false
      abortRef.current = null
    }
  }, [config, createResultNodes, id, timeoutMs, updateNode, updateTask, variant])

  const runTaskRef = useRef(runTask)
  useEffect(() => { runTaskRef.current = runTask }, [runTask])

  useEffect(() => {
    if (!task.taskId || (task.status !== 'queued' && task.status !== 'in_progress')) return
    if (!pollingRef.current) void runTaskRef.current(task.taskId)
  }, [task.status, task.taskId])

  useEffect(() => () => {
    unmountingRef.current = true
    abortRef.current?.abort()
  }, [])

  const stopTask = () => {
    const taskId = task.taskId
    const channel = config?.channelId ? useGenerationStore.getState().getChannel(config.channelId) : undefined
    const model = channel && config?.model ? useGenerationStore.getState().getModels(channel.id).find((item) => item.id === config.model) : undefined
    if (taskId && channel && model && config && variant !== 'body') void cancelGenerationTask({ channel, model, config, variant }, taskId)
    abortRef.current?.abort()
  }

  useEffect(() => {
    if (!waiting) return () => undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting])

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      const node = nodeRef.current
      if (!node) return
      const target = event.target instanceof Element ? event.target : null
      const activeMenu = target?.closest('details') as HTMLDetailsElement | null
      closeOpenMenus(node, activeMenu && node.contains(activeMenu) ? activeMenu : null)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOpenMenus(nodeRef.current)
    }
    document.addEventListener('pointerdown', closeFromOutside, true)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [])

  const updateVariant = useCallback((updates: Partial<NonNullable<typeof config>>) => {
    if (variant === 'body') return
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = current.data as RequestNodeData
    const nextConfig = { ...currentData[variant], ...updates }
    const normalizedUpdates = variant === 'image'
      ? { ...updates, capability: imageCapabilityForReferences(nextConfig.references) }
      : updates
    updateNode(id, { data: { ...currentData, [variant]: { ...nextConfig, ...normalizedUpdates } } })
  }, [id, updateNode, variant])

  useEffect(() => {
    if (variant !== 'image' || !config || config.capability === effectiveCapability) return
    updateVariant({ capability: effectiveCapability })
  }, [config, effectiveCapability, updateVariant, variant])

  const moveReference = (referenceId: string, targetId: string, insertAfter = false) => {
    if (referenceId === targetId) return
    const source = orderedReferences.find((reference) => reference.id === referenceId)
    const target = orderedReferences.find((reference) => reference.id === targetId)
    if (!source || !target || source.type !== target.type) return
    const sameTypeReferences = orderedReferences.filter((reference) => reference.type === source.type)
    const sourceIndex = sameTypeReferences.findIndex((reference) => reference.id === referenceId)
    let targetIndex = sameTypeReferences.findIndex((reference) => reference.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = sameTypeReferences.splice(sourceIndex, 1)
    if (sourceIndex < targetIndex) targetIndex -= 1
    if (insertAfter) targetIndex += 1
    sameTypeReferences.splice(Math.max(0, Math.min(targetIndex, sameTypeReferences.length)), 0, moved)
    const reorderedById = new Map(sameTypeReferences.map((reference, index) => [reference.id, { ...reference, order: index }]))
    const nextReferences = orderedReferences.map((reference) => reorderedById.get(reference.id) || reference)
    updateVariant({ references: normalizeGenerationReferences(nextReferences) })
  }

  const switchVariant = (nextVariant: 'image' | 'video') => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = (current.data || {}) as Partial<RequestNodeData>
    const defaultLabels = new Set(['请求体', '图片生成', '视频生成'])
    const currentVariant = currentData.variant
    const currentTasks = { ...(currentData.tasks || {}) }
    const currentResultNodeIds = { ...(currentData.resultNodeIds || {}) }
    if (currentVariant === 'image' || currentVariant === 'video') {
      if (currentData.task) currentTasks[currentVariant] = currentData.task
      if (currentData.resultNodeId) currentResultNodeIds[currentVariant] = currentData.resultNodeId
    }
    const nextTask = currentTasks[nextVariant] || { status: 'idle' as const }
    const normalized = {
      ...createRequestNodeData(nextVariant),
      ...currentData,
      variant: nextVariant,
      label: currentData.label && !defaultLabels.has(currentData.label) ? currentData.label : '请求体',
      image: { ...createRequestNodeData('image').image, ...(currentData.image || {}) },
      video: { ...createRequestNodeData('video').video, ...(currentData.video || {}) },
      tasks: currentTasks,
      task: nextTask,
      resultNodeIds: currentResultNodeIds,
      resultNodeId: currentResultNodeIds[nextVariant],
    }
    updateNode(id, { data: normalized })
  }

  const addReference = (reference: GenerationReference) => {
    updateVariant({ references: normalizeGenerationReferences([...orderedReferences, { ...reference, order: orderedReferences.length }]) })
  }

  const validateReferenceFile = async (file: File, type: GenerationReference['type']) => {
    if (type === 'video') {
      const maxBytes = selectedModel?.id.startsWith('seedance-2.5') ? 200 : selectedModel?.id === 'wan-3' ? 100 : selectedModel?.id === 'gemini-omni-1.1' ? undefined : 50
      if (maxBytes && file.size > maxBytes * 1024 * 1024) throw new Error(`参考视频不能超过 ${maxBytes} MB`)
      const duration = await new Promise<number>((resolve, reject) => {
        const element = document.createElement('video')
        element.preload = 'metadata'
        element.onloadedmetadata = () => { URL.revokeObjectURL(element.src); resolve(element.duration) }
        element.onerror = () => { URL.revokeObjectURL(element.src); reject(new Error('无法读取参考视频时长')) }
        element.src = URL.createObjectURL(file)
      })
      const maxDuration = selectedModel?.id === 'gemini-omni-1.1' ? 10 : selectedModel?.id === 'wan-3' ? 15 : selectedModel?.id?.startsWith('seedance-2.5') ? 30 : 15
      if (!Number.isFinite(duration) || duration <= 0 || duration > maxDuration) throw new Error(`参考视频时长必须不超过 ${maxDuration} 秒`)
    }
    if (type === 'audio') {
      const maxBytes = selectedModel?.id === 'wan-3' || selectedModel?.id?.startsWith('seedance-') ? 15 : undefined
      if (maxBytes && file.size > maxBytes * 1024 * 1024) throw new Error(`参考音频不能超过 ${maxBytes} MB`)
      if (!/^(audio\/(mpeg|wav|x-wav|wave))$/i.test(file.type)) throw new Error('参考音频仅支持 MP3 或 WAV')
    }
  }

  const handleFile = async (file: File, type: GenerationReference['type']) => {
    if (variant === 'body') return
    try { await validateReferenceFile(file, type) } catch (error) { updateTask({ status: 'failed', error: error instanceof Error ? error.message : String(error) }); return }
    const stored = await storeLocalResource(file)
    const duplicate = orderedReferences.find((reference) => reference.type === type && reference.resourceId === stored.resourceId)
    if (duplicate) {
      // The same content already has a reference in this node. Keep one
      // storage lease per logical reference and leave role/order untouched.
      await deleteLocalResource(stored.resourceId)
      revokeManagedObjectUrl(stored.url)
      return
    }
    const selectedAdapter = selectedChannel && config ? generationAdapterForModel(selectedChannel, config.model || '', config.adapterId) : undefined
    // Images are sent as local multipart/inline inputs. Only video references
    // need a later public-URL conversion step.
    const providerNeedsUpload = variant === 'video' && selectedAdapter?.protocol !== 'google-images'
    addReference(createGenerationReference({
      type,
      role: defaultRole(type, variant),
      label: file.name,
      source: 'local',
      resourceId: stored.resourceId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      status: providerNeedsUpload ? 'pending-upload' : 'ready',
    }))
    // The preview component creates and owns its own managed URL. Each
    // reference still keeps the storage lease returned by storeLocalResource,
    // so same-content files share bytes while remaining independently removable.
    revokeManagedObjectUrl(stored.url)
  }

  const setImageFrameRole = (reference: GenerationReference, role: '' | 'first_frame' | 'last_frame') => {
    if (reference.type !== 'image') return
    const nextRole = role || undefined
    updateVariant({ references: normalizeGenerationReferences(orderedReferences.map((item) => {
      if (item.id === reference.id) return { ...item, role: nextRole }
      if (nextRole === 'first_frame' && item.role === 'first_frame') return { ...item, role: 'reference_image' as const }
      if (nextRole === 'last_frame' && item.role === 'last_frame') return { ...item, role: 'reference_image' as const }
      return item
    })) })
  }

  const removeReference = async (reference: GenerationReference) => {
    if (reference.resourceId) await deleteLocalResource(reference.resourceId)
    updateVariant({ references: normalizeGenerationReferences(orderedReferences.filter((item) => item.id !== reference.id)) })
  }

  const modelGroups = useMemo(() => channels
    .filter((channel) => channel.enabled && generationChannelSupportsVariant(channel, variant === 'video' ? 'video' : 'image'))
    .map((channel) => {
      const channelModels = getModels(channel.id)
      const visibleModels = effectiveCapability && generationChannelUsesModelInference(channel)
        ? channelModels.filter((model) => !model.capabilities.length || model.capabilities.includes(effectiveCapability))
        : channelModels
      return { channel, models: visibleModels }
    })
    .filter((group) => group.models.length > 0), [channels, effectiveCapability, getModels, variant])

  const selectModel = (channelId: string, model: GenerationModel) => {
    const nextChannel = channels.find((channel) => channel.id === channelId)
    if (!nextChannel) return
    updateVariant({
      channelId,
      model: model.id,
      adapterId: model.adapterId,
      capability: variant === 'image'
        ? effectiveCapability
        : model.capabilities.includes(config?.capability as GenerationCapability) ? config?.capability : model.capabilities[0],
      ...modelConfigUpdates(config, model, variant === 'video' ? 'video' : 'image'),
    })
  }

  const selectCapability = (capability: GenerationCapability) => {
    if (variant === 'image') return
    const currentModelSupportsCapability = selectedModel?.capabilities.includes(capability)
    const nextModel = currentModelSupportsCapability ? selectedModel : models.find((model) => model.capabilities.includes(capability))
    updateVariant({ capability, model: nextModel?.id || config?.model, adapterId: nextModel?.adapterId || config?.adapterId, ...modelConfigUpdates(config, nextModel, variant) })
  }

  const content = variant === 'body' ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-12 py-7">
      <div className="w-full">
        <h3 className="mb-4 text-center text-lg font-semibold text-foreground">选择生成类型</h3>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="nodrag flex h-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" onClick={() => switchVariant('image')}>
            <ImageIcon className="h-8 w-8 stroke-[1.8] text-cyan-500" />
            <span>图片生成</span>
          </button>
          <button type="button" className="nodrag flex h-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" onClick={() => switchVariant('video')}>
            <Video className="h-8 w-8 stroke-[1.8] text-red-500" />
            <span>视频生成</span>
          </button>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-orange-400" />
          <span>收纳上游资源；切换类型不会改变节点、位置或连线</span>
        </div>
        <div className="mt-2 text-center text-xs text-muted-foreground">已连接 {upstreamCount} 个上游输入</div>
      </div>
    </div>
  ) : (() => {
    const referenceTypes: Array<GenerationReference['type']> = variant === 'video' ? ['image', 'video', 'audio'] : ['image']
    const renderReferences = (type: GenerationReference['type']) => {
      const TypeIcon = TYPE_ICONS[type]
      const items = orderedReferences.filter((reference) => reference.type === type)
      const acceptsType = !selectedModel?.inputTypes || selectedModel.inputTypes.includes(type)
      return <div key={type} role="group" aria-label={`${TYPE_LABELS[type]}参考素材，共 ${items.length} 项`} className="flex min-w-0 items-center gap-1.5">
        {items.map((reference) => <div
          key={reference.id}
          draggable
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation()
            draggedReferenceIdRef.current = reference.id
            setDraggedReferenceId(reference.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(REFERENCE_DND_TYPE, reference.id)
            event.dataTransfer.setData('text/plain', reference.id)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(REFERENCE_DND_TYPE)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const sourceId = event.dataTransfer.getData(REFERENCE_DND_TYPE) || draggedReferenceIdRef.current
            if (sourceId) {
              const targetRect = event.currentTarget.getBoundingClientRect()
              moveReference(sourceId, reference.id, event.clientX >= targetRect.left + targetRect.width / 2)
            }
            draggedReferenceIdRef.current = null
            setDraggedReferenceId(null)
          }}
          onDragEnd={() => {
            draggedReferenceIdRef.current = null
            setDraggedReferenceId(null)
          }}
          className={`nodrag group relative shrink-0 cursor-grab active:cursor-grabbing ${draggedReferenceId === reference.id ? 'opacity-50' : ''}`}
          title={`${reference.label || TYPE_LABELS[type]}：拖动调整顺序`}
        >
          <LocalReferencePreview reference={reference} />
           {variant === 'video' && type === 'image' && <div className="absolute -bottom-1 left-0 flex gap-0.5 rounded bg-card px-0.5 shadow-sm">
             <button type="button" className={`nodrag px-1 text-[8px] ${reference.role === 'first_frame' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} onClick={() => setImageFrameRole(reference, reference.role === 'first_frame' ? '' : 'first_frame')} aria-label="设为首帧" title="设为首帧">首</button>
             <button type="button" className={`nodrag px-1 text-[8px] ${reference.role === 'last_frame' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} onClick={() => setImageFrameRole(reference, reference.role === 'last_frame' ? '' : 'last_frame')} aria-label="设为尾帧" title="设为尾帧">尾</button>
           </div>}
          <button type="button" className="nodrag absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100" onClick={() => void removeReference(reference)} aria-label={`删除${TYPE_LABELS[type]}素材`} title={`删除${TYPE_LABELS[type]}素材`}><X className="h-3 w-3" /></button>
        </div>)}
        <label className={`nodrag flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${acceptsType ? '' : 'pointer-events-none opacity-35'}`} aria-label={`上传${TYPE_LABELS[type]}素材`} title={acceptsType ? `上传${TYPE_LABELS[type]}素材` : `当前模型不支持${TYPE_LABELS[type]}输入`}>
          <TypeIcon className="h-4 w-4" aria-hidden="true" />
          <input type="file" className="hidden" accept={type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*'} disabled={!acceptsType} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleFile(file, type) }} />
        </label>
      </div>
    }

    return <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex max-h-[168px] flex-wrap items-center gap-x-3 gap-y-2 overflow-auto custom-scrollbar">
          {referenceTypes.map(renderReferences)}
        </div>
      </div>

      <div className="relative min-h-[156px] min-w-0 flex-1 px-3 pb-3 pt-1">
        <textarea value={config?.prompt || ''} onChange={(event) => updateVariant({ prompt: event.target.value })} placeholder={variant === 'image' ? '描述你想生成的图片…' : '描述镜头、动作、氛围，或上传图片生成动态视频…'} className="nodrag nowheel absolute inset-0 h-full w-full resize-none bg-transparent px-3 pb-3 pt-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/65" aria-label={variant === 'image' ? '图片生成提示词' : '视频生成提示词'} />
      </div>

      {(task.status === 'timeout' || task.status === 'unknown' || (task.status === 'failed' && Boolean(task.error)) || task.status === 'completed') && <div className="shrink-0 px-3 pb-2 text-[10px]">
        {task.status === 'timeout' && <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800"><div>任务已超时，任务 ID 已保留。</div>{task.taskId && <div className="mt-1 truncate font-mono" title={task.taskId}>{task.taskId}</div>}<button type="button" className="nodrag mt-1.5 font-semibold underline" onClick={() => void runTask(task.taskId)}>继续查询</button></div>}
        {(task.status === 'failed' || task.status === 'unknown') && task.error && <div className="rounded-lg bg-destructive/5 px-2.5 py-2 text-destructive">{task.error}</div>}
        {task.status === 'completed' && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-800">任务已完成{task.resultUrls?.length ? `，已收到 ${task.resultUrls.length} 个结果` : ''}，耗时 ${formatElapsed(task.elapsedMs || elapsed)}</div>}
      </div>}

      <div className="relative z-40 flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2.5" onPointerDown={(event) => event.stopPropagation()}>
        <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[190px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label="模型选择" title="模型选择"><span className="truncate">{selectedModel?.name || '模型'}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(420px,70vh)] min-w-[270px] max-w-[min(380px,calc(100vw-32px))] overflow-auto">
            {modelGroups.length ? modelGroups.map((group, groupIndex) => <div key={group.channel.id}>
              {groupIndex > 0 && <div className="my-1 h-px bg-border" />}
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">{group.channel.name}</div>
              {group.models.map((model) => <button key={`${group.channel.id}:${model.id}`} type="button" className="cnote-menu-item" data-active={group.channel.id === config?.channelId && model.id === config?.model} onClick={() => { selectModel(group.channel.id, model); closeOpenMenus(nodeRef.current) }}><span className="min-w-0 flex-1 truncate">{model.name}</span>{group.channel.id === config?.channelId && model.id === config?.model && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</button>)}
            </div>) : <p className="px-3 py-3 text-xs text-muted-foreground">暂无可用生成模型</p>}
          </div>
        </details>
        {variant === 'video' && <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[145px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label="生成模式" title="生成模式"><span className="truncate">{CAPABILITY_LABELS[effectiveCapability || 'text-to-video']}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(360px,70vh)] min-w-[190px] overflow-auto">
            {capabilities.map((capability) => <button key={capability} type="button" className="cnote-menu-item" data-active={effectiveCapability === capability} onClick={() => { selectCapability(capability); closeOpenMenus(nodeRef.current) }}><span className="flex-1">{CAPABILITY_LABELS[capability]}</span>{effectiveCapability === capability && <Check className="h-3.5 w-3.5 text-primary" />}</button>)}
          </div>
        </details>}
        <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[150px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label="生成参数" title="生成参数"><span className="truncate">{parameterSummary}</span><ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div className="cnote-menu-surface absolute bottom-[calc(100%+8px)] right-0 z-50 max-h-[min(440px,70vh)] min-w-[280px] max-w-[min(380px,calc(100vw-32px))] overflow-auto">
            <ChoiceRow
              label="分辨率"
              value={selectedResolution}
              options={availableResolutions.map((resolution) => ({ value: resolution, label: formatResolutionLabel(resolution), disabled: Boolean(selectedModel?.resolutions && !selectedModel.resolutions.includes(resolution)) }))}
              onChange={(value) => { updateVariant({ resolution: value }); closeOpenMenus(nodeRef.current) }}
              ariaLabel="分辨率"
            />
            <div className="h-px bg-border" />
            <ChoiceRow
              label="宽高比例"
              value={selectedAspectRatio}
              options={availableAspectRatios.map((ratio) => ({ value: ratio, label: formatAspectRatioLabel(ratio), disabled: Boolean(selectedModel?.aspectRatios && !selectedModel.aspectRatios.includes(ratio)) }))}
              onChange={(value) => { updateVariant({ aspectRatio: value }); closeOpenMenus(nodeRef.current) }}
              ariaLabel="宽高比例"
            />
            {variant === 'image' && <>
              <div className="h-px bg-border" />
              <ChoiceRow
                label="质量"
                value={config?.quality || selectedModel?.defaultQuality || 'medium'}
                options={(selectedModel?.qualities || ['auto', 'low', 'medium', 'high']).map((quality) => ({ value: quality, label: ({ auto: '自动', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' } as Record<string, string>)[quality] || quality }))}
                onChange={(value) => { updateVariant({ quality: value as NonNullable<typeof config>['quality'] }); closeOpenMenus(nodeRef.current) }}
                ariaLabel="质量"
              />
            </>}
            {variant === 'image' && selectedModel?.id.toLowerCase().startsWith('gpt-image-') && <>
              <div className="h-px bg-border" />
              <ChoiceRow label="背景" value={config?.background || 'auto'} options={[{ value: 'auto', label: '自动' }, { value: 'opaque', label: '不透明' }, { value: 'transparent', label: '透明' }]} onChange={(value) => { updateVariant({ background: value as NonNullable<typeof config>['background'] }); closeOpenMenus(nodeRef.current) }} ariaLabel="背景" />
              <ChoiceRow label="格式" value={config?.outputFormat || 'png'} options={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'jpeg', label: 'JPEG', disabled: config?.background === 'transparent' }]} onChange={(value) => { updateVariant({ outputFormat: value as NonNullable<typeof config>['outputFormat'], outputCompression: value === 'png' ? undefined : config?.outputCompression }); closeOpenMenus(nodeRef.current) }} ariaLabel="输出格式" />
              <div className="flex items-center justify-between gap-3 px-2 py-1.5"><span className="text-[10px] text-muted-foreground">图片数量</span><input type="number" min={1} max={10} value={config?.outputCount || 1} onChange={(event) => updateVariant({ outputCount: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })} className="nodrag h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" aria-label="图片数量" /></div>
              {config?.outputFormat && config.outputFormat !== 'png' && <div className="flex items-center justify-between gap-3 px-2 py-1.5"><span className="text-[10px] text-muted-foreground">压缩质量</span><input type="number" min={0} max={100} value={config?.outputCompression ?? 90} onChange={(event) => updateVariant({ outputCompression: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} className="nodrag h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" aria-label="压缩质量" /></div>}
            </>}
            {variant === 'image' && selectedModel?.thinkingLevels?.length && <>
              <div className="h-px bg-border" />
              <ChoiceRow
                label="思考级别"
                value={config?.thinkingLevel || selectedModel.defaultThinkingLevel || selectedModel.thinkingLevels[0]}
                options={selectedModel.thinkingLevels.map((level) => ({ value: level, label: level === 'minimal' ? '最小' : '高' }))}
                onChange={(value) => { updateVariant({ thinkingLevel: value as NonNullable<typeof config>['thinkingLevel'] }); closeOpenMenus(nodeRef.current) }}
                ariaLabel="思考级别"
              />
            </>}
            {variant === 'video' && <>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground">时长（秒）</span>
                <input type="number" min={selectedModel?.minDuration || 1} max={selectedModel?.maxDuration || 60} value={config?.seconds || 5} onChange={(event) => updateVariant({ seconds: Number(event.target.value) })} className="nodrag h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" aria-label="时长（秒）" />
              </div>
              <label className={`nodrag flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[11px] text-foreground hover:bg-muted/70 ${selectedModel && !selectedModel.capabilities.includes('generate-audio') ? 'opacity-45' : ''}`} title={selectedModel && !selectedModel.capabilities.includes('generate-audio') ? '当前模型不支持生成音频' : '生成音频'}>
                <span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 text-muted-foreground" />生成音频</span>
               {selectedModel?.id.startsWith('seedance-') && <label className="nodrag flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[11px] text-foreground hover:bg-muted/70" title="关闭音效和音乐">
                 <span>不要音乐</span>
                 <input type="checkbox" className="nodrag" checked={Boolean(config?.noMusic)} onChange={(event) => updateVariant({ noMusic: event.target.checked })} aria-label="不要音乐" />
               </label>}
                <input type="checkbox" className="nodrag" checked={Boolean(config?.generateAudio)} disabled={Boolean(selectedModel && !selectedModel.capabilities.includes('generate-audio'))} onChange={(event) => updateVariant({ generateAudio: event.target.checked })} aria-label="生成音频" />
              </label>
            </>}
          </div>
        </details>
        <span className="flex-1" />
        <button
          type="button"
          disabled={waiting ? false : !config?.channelId || !config?.model || (!config?.prompt?.trim() && !config?.references?.length && !upstreamCount)}
          className={`nodrag flex h-10 min-w-[112px] shrink-0 items-center justify-center gap-2 rounded-full px-4 text-xs font-medium transition-colors disabled:bg-muted disabled:text-muted-foreground ${waiting ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          onClick={() => { if (waiting) stopTask(); else void runTask() }}
          aria-busy={waiting}
          aria-label={waiting ? '终止生成任务' : '生成'}
          title={waiting ? '终止生成任务' : '生成'}
        >
          {waiting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span>{waiting ? `${task.status === 'queued' ? '排队中' : task.status === 'submitting' || task.status === 'validating' ? '提交中' : '生成中'} · ${formatElapsed(elapsed)}` : '生成'}</span>
          {waiting && <Square className="h-3.5 w-3.5 fill-current opacity-80" />}
        </button>
      </div>
    </div>
  })()

  return <div ref={nodeRef} className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-visible rounded-[24px] border bg-card ${selected ? 'node-selected' : 'border-border'}`} style={{ minWidth: REQUEST_NODE_MIN_SIZE.width, minHeight: REQUEST_NODE_MIN_SIZE.height }}>
    <NodeHandle type="target" position={Position.Left} id="in" />
    <NodeHandle type="source" position={Position.Right} id="out" />
    <NodeDragGutters />
    <NodeHoverToolbar nodeId={id} />
    <NodeResizeArc nodeId={id} minWidth={REQUEST_NODE_MIN_SIZE.width} minHeight={REQUEST_NODE_MIN_SIZE.height} />
    <div className="node-scroll-clip flex min-h-0 w-full flex-1 flex-col">{content}</div>
  </div>
})

RequestNode.displayName = 'RequestNode'


