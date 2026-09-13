import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Image as ImageIcon, Link2, LoaderCircle, Mic, RotateCcw, Sparkles, Square, Upload, Video, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { generationAdapterForModel, generationChannelSupportsVariant, generationChannelUsesModelInference, generationSecretName, useGenerationStore, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { createGenerationReference, createRequestNodeData, normalizeGenerationReferences } from '@/lib/generation/defaults'
import { cancelGenerationTask, runGenerationTask } from '@/lib/generation/client'
import { runGenerationBatch } from '@/lib/generation/batch'
import { appendGenerationResultContentData } from '@/lib/generation/results'
import { deleteLocalResource, loadLocalResourceUrl, revokeManagedObjectUrl, storeLocalResource } from '@/lib/resource-storage'
import { withGenerationUpstreamInputs } from '@/lib/generation/inputs'
import { normalizeVideoModeConfig, resolveVideoMode, videoInputTypes, videoModesForModel, videoReferenceError, VIDEO_MODE_LABELS, VIDEO_MODE_PLACEHOLDERS } from '@/lib/generation/video-mode'
import { REQUEST_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { filterPromptMentionReferences, getPromptMentionContext, getPromptMentionToken, removePromptMention, replacePromptMention, type PromptMentionContext } from '@/lib/generation/prompt-mentions'
import type { GenerationCapability, GenerationReference, GenerationTaskState, GenerationVariantConfig, RequestNodeData, RequestVariant } from '@/types/flow'
import { NodeDragGutters, NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

const CAPABILITY_LABELS = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  ...VIDEO_MODE_LABELS,
}

const TYPE_LABELS = { image: '图片', video: '视频', audio: '音频' } as const
const TYPE_ICONS = { image: ImageIcon, video: Video, audio: Mic } as const
const REFERENCE_DND_TYPE = 'application/x-cnote-generation-reference'

function imageCapabilityForReferences(references: GenerationReference[] = []): 'image-to-image' | 'text-to-image' {
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

function LocalReferencePreview({ reference, size = 'large' }: { reference: GenerationReference; size?: 'small' | 'large' }) {
  const [url, setUrl] = useState(reference.previewUrl || reference.url || '')
  const sizeClass = size === 'small' ? 'h-9 w-9 rounded-md' : 'h-14 w-14 rounded-lg'

  useEffect(() => {
    let active = true
    let managedUrl = ''
    setUrl(reference.previewUrl || reference.url || '')
    if (!reference.resourceId) return () => undefined
    void loadLocalResourceUrl(reference.resourceId).then((nextUrl) => {
      if (!nextUrl) return
      if (!active) { revokeManagedObjectUrl(nextUrl); return }
      managedUrl = nextUrl
      setUrl(nextUrl)
    }).catch(() => undefined)
    return () => {
      active = false
      revokeManagedObjectUrl(managedUrl)
    }
  }, [reference.previewUrl, reference.resourceId, reference.url])

  if (reference.type === 'audio') return <div className={`flex ${sizeClass} items-center justify-center bg-muted text-muted-foreground`}><Mic className={size === 'small' ? 'h-4 w-4' : 'h-5 w-5'} /></div>
  if (!url) return <div className={`flex ${sizeClass} items-center justify-center bg-muted text-muted-foreground`}><Upload className={size === 'small' ? 'h-4 w-4' : 'h-5 w-5'} /></div>
  if (reference.type === 'video') return <video src={url} muted className={`${sizeClass} bg-black object-cover`} />
  return <img src={url} alt={reference.label || '参考图片'} className={`${sizeClass} bg-muted object-cover`} />
}

function PromptMentionMenu({
  references,
  promptMentions,
  query,
  selectedIndex,
  onSelect,
}: {
  references: GenerationReference[]
  promptMentions?: Record<string, string>
  query: string
  selectedIndex: number
  onSelect: (reference: GenerationReference) => void
}) {
  const candidates = filterPromptMentionReferences(references, query, promptMentions)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const option = optionRefs.current[selectedIndex]
    if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!candidates.length) return null
  return <div id="request-node-prompt-mentions" role="listbox" aria-label="插入参考素材" className="cnote-menu-surface absolute bottom-[calc(100%-8px)] left-3 right-3 z-[70] max-h-[232px] overflow-auto">
    <div className="px-2 pb-1 pt-1 text-[10px] text-muted-foreground">选择参考素材 · ↑↓ 选择 · Enter 插入</div>
    {candidates.map((reference, index) => {
      const TypeIcon = TYPE_ICONS[reference.type]
      const token = getPromptMentionToken(reference, references, promptMentions)
      return <button
        key={reference.id}
        ref={(element) => { optionRefs.current[index] = element }}
        type="button"
        role="option"
        aria-selected={selectedIndex === index}
        data-active={selectedIndex === index}
        className="cnote-menu-item gap-2"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(reference)}
      >
        <LocalReferencePreview reference={reference} size="small" />
        <span className="min-w-0 flex-1 truncate">{reference.label || reference.fileName || TYPE_LABELS[reference.type]}</span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><TypeIcon className="h-3 w-3" aria-hidden="true" />{token}</span>
      </button>
    })}
  </div>
}

function defaultRole(type: GenerationReference['type'], variant: RequestVariant): GenerationReference['role'] {
  if (type === 'audio') return variant === 'video' ? 'reference_voice' : 'reference_audio'
  return type === 'video' ? 'reference_video' : 'reference_image'
}

function withUpstreamInputs(nodeId: string, variant: 'image' | 'video', config: GenerationVariantConfig) {
  const { nodes, edges } = useFlowStore.getState()
  return withGenerationUpstreamInputs(nodeId, variant, config, nodes, edges)
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
    const currentSeconds = config.seconds || model.defaultDuration || model.allowedDurations?.[0] || model.minDuration || 5
    if (model.allowedDurations?.length && !model.allowedDurations.includes(currentSeconds)) updates.seconds = model.defaultDuration || model.allowedDurations[0]
    else if (model.minDuration && currentSeconds < model.minDuration) updates.seconds = model.minDuration
    else if (model.maxDuration && currentSeconds > model.maxDuration) updates.seconds = model.maxDuration
    if (model.capabilities.length && !model.capabilities.includes('generate-audio')) updates.generateAudio = false
  }
  return updates
}

export const RequestNode = memo(({ id, data, selected }: NodeProps<RequestNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const addNode = useFlowStore((state) => state.addNode)
  const addEdge = useFlowStore((state) => state.addEdge)
  const nodes = useFlowStore(useShallow((state) => {
    const sourceIds = new Set(state.edges.filter((edge) => edge.target === id).map((edge) => edge.source))
    return state.nodes.filter((node) => sourceIds.has(node.id))
  }))
  const edges = useFlowStore(useShallow((state) => state.edges.filter((edge) => edge.target === id)))
  const upstreamCount = edges.length
  const channels = useGenerationStore((state) => state.channels)
  const getModels = useGenerationStore((state) => state.getModels)
  const [now, setNow] = useState(Date.now())
  const nodeRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const unmountingRef = useRef(false)
  const draggedReferenceIdRef = useRef<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null)
  const [mentionContext, setMentionContext] = useState<PromptMentionContext | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)

  const variant = data.variant || 'body'
  const config = variant === 'body' ? undefined : data[variant]
  const selectedChannel = config?.channelId ? channels.find((channel) => channel.id === config.channelId) : undefined
  const allModels = useMemo(() => selectedChannel ? getModels(selectedChannel.id) : [], [getModels, selectedChannel])
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
    return videoModesForModel(selectedModel)
  }, [selectedModel])
  const resolvedConfig = useMemo(() => {
    if (!config || variant === 'body') return undefined
    const merged = withGenerationUpstreamInputs(id, variant, config, nodes, edges)
    return variant === 'video' ? normalizeVideoModeConfig(merged, selectedModel) : merged
  }, [config, edges, id, nodes, selectedModel, variant])
  const references = resolvedConfig?.references || []
  const orderedReferences = normalizeGenerationReferences(references)
  const mentionCandidates = useMemo(() => filterPromptMentionReferences(orderedReferences, mentionContext?.query || '', config?.promptMentions), [config?.promptMentions, mentionContext?.query, orderedReferences])
  const videoMode = resolveVideoMode(resolvedConfig?.capability, references)
  const effectiveCapability = variant === 'image'
    ? imageCapabilityForReferences(references)
    : videoMode
  const referenceError = variant === 'video' && selectedModel && resolvedConfig ? videoReferenceError(selectedModel, resolvedConfig) : undefined
  const timeoutMs = variant === 'image' ? 15 * 60 * 1000 : 60 * 60 * 1000
  const availableAspectRatios = selectedModel?.aspectRatios || [config?.aspectRatio || '16:9']
  const availableResolutions = selectedModel?.resolutions || [config?.resolution || (variant === 'image' ? 'auto' : '720p')]
  const selectedResolution = config?.resolution || (variant === 'image' ? 'auto' : '720p')
  const selectedAspectRatio = config?.aspectRatio || '16:9'
  const parameterSummary = `${formatResolutionLabel(selectedResolution)} · ${formatAspectRatioLabel(selectedAspectRatio)}`
  const task = useMemo(() => {
    if (variant === 'body') return { status: 'idle' as const }
    return data.tasks?.[variant] || (data.variant === variant ? data.task : undefined) || { status: 'idle' as const }
  }, [data.task, data.tasks, data.variant, variant])
  const elapsed = task.submittedAt ? Math.max(task.elapsedMs || 0, now - task.submittedAt) : task.elapsedMs || 0
  const waiting = task.status === 'validating' || task.status === 'submitting' || task.status === 'queued' || task.status === 'in_progress'
  const resultCount = Math.max(task.resultUrls?.length || 0, task.resultResourceIds?.length || 0)
  const resumableTaskId = task.taskId || task.children?.find((child) => child.taskId && child.status !== 'completed')?.taskId

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
    const resumeChildren = resumeTaskId ? previousTask?.children : undefined
    const persisted = resumeTaskId ? previousTask?.requestSnapshot : undefined
    const liveChannel = config?.channelId ? generationStore.getChannel(config.channelId) : undefined
    const persistedLiveChannel = persisted ? generationStore.getChannel(persisted.channelId) : liveChannel
    const channel: GenerationChannel | undefined = persisted
      ? {
          id: persisted.channelId,
          presetId: persisted.presetId || persistedLiveChannel?.presetId,
          presetVersion: persisted.presetVersion || persistedLiveChannel?.presetVersion,
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
      const requestedCount = resumeChildren?.length || (resumeTaskId || variant !== 'image' ? 1 : Math.max(1, Math.min(10, Math.trunc(runConfig.outputCount || 1))))
      const result = await runGenerationBatch({
        count: requestedCount,
        submittedAt,
        elapsedOffset,
        initialTasks: resumeChildren || (resumeTaskId && previousTask ? [previousTask] : undefined),
        onTaskUpdate: (state) => {
          if (!unmountingRef.current) updateTask({ ...state, timeoutAt, status: timedOut ? 'timeout' : state.status })
        },
        run: async (generationIndex, update) => {
          const previousChild = resumeChildren?.[generationIndex]
          const taskId = previousChild?.taskId || (!resumeChildren ? resumeTaskId : undefined)
          const requestConfig = previousChild?.requestSnapshot?.config || { ...runConfig, outputCount: 1 }
          return runGenerationTask({ channel, model, config: requestConfig, variant }, {
            taskId,
            submittedAt,
            timeoutMs,
            signal: controller.signal,
            onTaskUpdate: update,
            onConfigPrepared: (preparedConfig) => {
              if (variant === 'video') {
                const ownedReferenceIds = new Set((config?.references || []).map((reference) => reference.id))
                const persistedReferences = preparedConfig.references.filter((reference) => ownedReferenceIds.has(reference.id))
                const current = useFlowStore.getState().nodes.find((node) => node.id === id)
                if (current && persistedReferences.length) updateNode(id, { data: { ...current.data, [variant]: { ...(current.data as RequestNodeData)[variant], references: persistedReferences } } })
              }
              update({ requestSnapshot: { variant, channelId: channel.id, presetId: channel.presetId, presetVersion: channel.presetVersion, providerId: channel.providerId, protocol: channel.protocol, adapterId: preparedConfig.adapterId, baseURL: channel.baseURL, secretName: channel.secretName, mediaTransport: channel.mediaTransport, mediaUploadPath: channel.mediaUploadPath, mediaUploadURL: channel.mediaUploadURL, mediaUploadSecretName: channel.mediaUploadSecretName, model: model.id, config: preparedConfig } })
            },
          })
        },
      })
      if (!unmountingRef.current && !controller.signal.aborted && result.status !== 'timeout' && result.resultUrls?.length) createResultNodes(result.resultUrls, result.resultResourceIds, result.resultMimeTypes, result.resultFileNames, 0, result.resultUrls.length)
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
    const resumableId = task.taskId || task.children?.find((child) => child.taskId && child.status !== 'completed')?.taskId
    if (!resumableId || (task.status !== 'queued' && task.status !== 'in_progress')) return
    if (!pollingRef.current) void runTaskRef.current(resumableId)
  }, [task.status, task.taskId, task.children])

  useEffect(() => () => {
    unmountingRef.current = true
    abortRef.current?.abort()
  }, [])

  const stopTask = () => {
    const channel = config?.channelId ? useGenerationStore.getState().getChannel(config.channelId) : undefined
    const model = channel && config?.model ? useGenerationStore.getState().getModels(channel.id).find((item) => item.id === config.model) : undefined
    if (channel && model && config && variant !== 'body') {
      for (const child of task.children || [task]) {
        if (child.taskId && child.status !== 'completed') void cancelGenerationTask({ channel, model, config: child.requestSnapshot?.config || config, variant }, child.taskId)
      }
    }
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
      if (target !== promptRef.current && !mentionMenuRef.current?.contains(target)) setMentionContext(null)
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
      ? { ...updates, capability: withUpstreamInputs(id, variant, nextConfig).capability }
      : updates
    updateNode(id, { data: { ...currentData, [variant]: { ...nextConfig, ...normalizedUpdates } } })
  }, [id, updateNode, variant])

  const updateMentionContext = useCallback((prompt: string, caret: number) => {
    const nextContext = getPromptMentionContext(prompt, caret)
    setMentionContext((currentContext) => {
      const unchanged = currentContext && nextContext
        && currentContext.start === nextContext.start
        && currentContext.end === nextContext.end
        && currentContext.query === nextContext.query
      if (!unchanged) setMentionSelectedIndex(0)
      return nextContext
    })
  }, [])

  const selectMention = useCallback((reference: GenerationReference) => {
    if (!mentionContext || !config) return
    const token = getPromptMentionToken(reference, orderedReferences, config.promptMentions)
    const nextPrompt = replacePromptMention(config.prompt, mentionContext, token)
    const promptMentions = { ...(config.promptMentions || {}), [reference.id]: token }
    const nextCaret = mentionContext.start + token.length
    updateVariant({ prompt: `${nextPrompt.slice(0, nextCaret)} ${nextPrompt.slice(nextCaret)}`, promptMentions })
    setMentionContext(null)
    setMentionSelectedIndex(0)
    requestAnimationFrame(() => {
      const textarea = promptRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(nextCaret + 1, nextCaret + 1)
    })
  }, [config, mentionContext, orderedReferences, updateVariant])

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionContext || !mentionCandidates.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setMentionSelectedIndex((index) => (index + 1) % mentionCandidates.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setMentionSelectedIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectMention(mentionCandidates[mentionSelectedIndex] || mentionCandidates[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setMentionContext(null)
    }
  }

  const handlePromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const prompt = event.target.value
    updateVariant({ prompt })
    if (variant !== 'video') {
      setMentionContext(null)
      return
    }
    updateMentionContext(prompt, event.target.selectionStart ?? prompt.length)
  }

  const handlePromptCaretChange = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent
    if (event.type === 'keyup' && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(nativeEvent.key)) return
    if (variant !== 'video') {
      setMentionContext(null)
      return
    }
    const textarea = event.currentTarget
    updateMentionContext(textarea.value, textarea.selectionStart ?? textarea.value.length)
  }

  useEffect(() => {
    if (variant !== 'video' || !config?.promptMentions) return
    const activeReferenceIds = new Set(orderedReferences.map((reference) => reference.id))
    const staleMentions = Object.entries(config.promptMentions).filter(([referenceId, token]) => !activeReferenceIds.has(referenceId) && config.prompt.includes(token))
    if (!staleMentions.length) return
    const prompt = staleMentions.reduce((value, [, token]) => removePromptMention(value, token, '[已移除素材]'), config.prompt)
    const promptMentions = { ...config.promptMentions }
    staleMentions.forEach(([referenceId]) => { delete promptMentions[referenceId] })
    updateVariant({ prompt, promptMentions })
  }, [config, orderedReferences, updateVariant, variant])

  useEffect(() => {
    if (variant !== 'image' || !config || config.capability === effectiveCapability) return
    updateVariant({ capability: effectiveCapability })
  }, [config, effectiveCapability, updateVariant, variant])

  const updateReferences = (nextReferences: GenerationReference[], extraUpdates: Partial<NonNullable<typeof config>> = {}) => {
    const normalized = nextReferences.map((reference, order) => ({ ...reference, order }))
    const referenceOverrides = { ...config?.referenceOverrides }
    for (const reference of normalized) {
      if (reference.upstreamNodeId) referenceOverrides[reference.id] = { ...referenceOverrides[reference.id], role: reference.role, order: reference.order }
    }
    updateVariant({ references: normalized.filter((reference) => !reference.upstreamNodeId), referenceOverrides, ...extraUpdates })
  }

  const moveReference = (referenceId: string, targetId: string, insertAfter = false) => {
    if (referenceId === targetId) return
    const source = orderedReferences.find((reference) => reference.id === referenceId)
    const target = orderedReferences.find((reference) => reference.id === targetId)
    if (!source || !target || source.type !== target.type) return
    const sameTypeReferences = [...orderedReferences]
    const sourceIndex = sameTypeReferences.findIndex((reference) => reference.id === referenceId)
    let targetIndex = sameTypeReferences.findIndex((reference) => reference.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = sameTypeReferences.splice(sourceIndex, 1)
    if (sourceIndex < targetIndex) targetIndex -= 1
    if (insertAfter) targetIndex += 1
    sameTypeReferences.splice(Math.max(0, Math.min(targetIndex, sameTypeReferences.length)), 0, moved)
    updateReferences(sameTypeReferences)
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
    updateReferences([...orderedReferences, { ...reference, order: orderedReferences.length }])
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

  const handleFile = async (file: File, type: GenerationReference['type'], role?: GenerationReference['role']) => {
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
      role: role || defaultRole(type, variant),
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
    updateReferences(orderedReferences.map((item) => {
      if (item.id === reference.id) return { ...item, role: nextRole }
      if (nextRole && item.role === nextRole) return { ...item, role: reference.role }
      return item
    }))
  }

  const removeReference = async (reference: GenerationReference) => {
    const token = getPromptMentionToken(reference, orderedReferences, config?.promptMentions)
    const prompt = config?.prompt ? removePromptMention(config.prompt, token, `[已移除${TYPE_LABELS[reference.type]}]`) : config?.prompt
    const promptMentions = { ...(config?.promptMentions || {}) }
    delete promptMentions[reference.id]
    if (reference.upstreamNodeId) {
      updateVariant({
        prompt,
        promptMentions,
        referenceOverrides: { ...config?.referenceOverrides, [reference.id]: { ...config?.referenceOverrides?.[reference.id], excluded: true } },
      })
      return
    }
    if (reference.resourceId) await deleteLocalResource(reference.resourceId)
    updateReferences(orderedReferences.filter((item) => item.id !== reference.id), { prompt, promptMentions })
  }

  const modelGroups = useMemo(() => channels
    .filter((channel) => channel.enabled && generationChannelSupportsVariant(channel, variant === 'video' ? 'video' : 'image'))
    .map((channel) => {
      const channelModels = getModels(channel.id)
      const visibleModels = effectiveCapability && generationChannelUsesModelInference(channel)
        ? channelModels.filter((model) => {
          if (!model.capabilities.length) return true
          if (variant !== 'video') return model.capabilities.includes(effectiveCapability)
          if (model.capabilitySource === 'inferred' && !model.capabilities.includes('text-to-video')) return false
          return videoModesForModel(model).includes(videoMode)
        })
        : channelModels
      return { channel, models: visibleModels }
    })
    .filter((group) => group.models.length > 0), [channels, effectiveCapability, getModels, variant, videoMode])

  const selectModel = (channelId: string, model: GenerationModel) => {
    const nextChannel = channels.find((channel) => channel.id === channelId)
    if (!nextChannel) return
    updateVariant({
      channelId,
      model: model.id,
      adapterId: model.adapterId,
      capability: variant === 'image'
        ? effectiveCapability
        : !config?.capability ? undefined : videoModesForModel(model).includes(videoMode) ? videoMode : videoModesForModel(model)[0],
      ...modelConfigUpdates(config, model, variant === 'video' ? 'video' : 'image'),
    })
  }

  const selectCapability = (capability: GenerationCapability) => {
    if (variant === 'image') return
    updateVariant({ capability })
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
    const allowedReferenceTypes: Array<GenerationReference['type']> = variant === 'video' ? videoInputTypes(selectedModel, videoMode) : ['image']
    const referenceTypes = [...new Set([...allowedReferenceTypes, ...orderedReferences.map((reference) => reference.type)])]
    const frameRoles: Array<'first_frame' | 'last_frame'> = variant === 'video' && videoMode === 'first-last-frame' ? ['first_frame', 'last_frame'] : []
    const renderReferences = (type: GenerationReference['type'], frameRole?: 'first_frame' | 'last_frame') => {
      const TypeIcon = TYPE_ICONS[type]
      const items = orderedReferences.filter((reference) => reference.type === type && (frameRole ? reference.role === frameRole : !(type === 'image' && frameRoles.includes(reference.role as 'first_frame' | 'last_frame'))))
      const slotLabel = frameRole === 'first_frame' ? '首帧' : frameRole === 'last_frame' ? '尾帧' : TYPE_LABELS[type]
      const limit = frameRole ? 1 : type === 'image' ? selectedModel?.maxImages : type === 'video' ? selectedModel?.maxVideos : selectedModel?.maxAudios
      const acceptsType = allowedReferenceTypes.includes(type) && (!selectedModel?.inputTypes || selectedModel.inputTypes.includes(type)) && !(type === 'image' && frameRoles.length && !frameRole)
      const canUpload = acceptsType && (limit === undefined || items.length < limit)
      if (!items.length && !acceptsType) return null
      return <div key={frameRole || type} role="group" aria-label={`${slotLabel}参考素材，共 ${items.length} 项`} className="flex min-w-0 items-center gap-1.5">
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
          title={`${reference.upstreamNodeId ? '上游引用 · ' : ''}${reference.label || TYPE_LABELS[type]}：拖动调整顺序`}
        >
          <LocalReferencePreview reference={reference} />
          {reference.upstreamNodeId && <span className="absolute left-0 top-0 rounded bg-card/90 p-0.5" title="上游引用：移除不会删除源文件" aria-label="上游引用"><Link2 className="h-3 w-3 text-muted-foreground" /></span>}
          {frameRole && <span className="pointer-events-none absolute bottom-0 left-0 rounded bg-card/90 px-1 text-[9px]">{slotLabel}</span>}
          {variant === 'video' && videoMode === 'first-last-frame' && type === 'image' && <button type="button" className="nodrag absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded bg-card/90 text-muted-foreground hover:text-foreground" onClick={() => setImageFrameRole(reference, reference.role === 'first_frame' ? 'last_frame' : 'first_frame')} aria-label={reference.role === 'first_frame' ? '设为尾帧' : '设为首帧'} title="交换首尾帧"><ArrowLeftRight className="h-3 w-3" /></button>}
          <button type="button" className="nodrag absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => void removeReference(reference)} aria-label={reference.upstreamNodeId ? `移除上游${TYPE_LABELS[type]}引用` : `删除${TYPE_LABELS[type]}素材`} title={reference.upstreamNodeId ? '移除引用，不删除上游素材' : `删除${TYPE_LABELS[type]}素材`}><X className="h-3 w-3" /></button>
        </div>)}
        {canUpload && <label className="nodrag flex h-14 w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`上传${slotLabel}素材`} title={`上传${slotLabel}素材`}>
          <TypeIcon className="h-4 w-4" aria-hidden="true" />
          {frameRole && <span className="text-[9px]">{slotLabel}</span>}
          <input type="file" className="hidden" accept={type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*'} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleFile(file, type, frameRole) }} />
        </label>}
      </div>
    }

    return <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex max-h-[168px] flex-wrap items-center gap-x-3 gap-y-2 overflow-auto px-1.5 py-2 custom-scrollbar">
          {frameRoles.map((role) => renderReferences('image', role))}
          {referenceTypes.map((type) => renderReferences(type))}
          {Object.values(config?.referenceOverrides || {}).some((override) => override.excluded) && <button type="button" className="nodrag flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" title="恢复已移除的上游引用" aria-label="恢复已移除的上游引用" onClick={() => updateVariant({ referenceOverrides: Object.fromEntries(Object.entries(config?.referenceOverrides || {}).map(([key, override]) => [key, { ...override, excluded: false }])) })}><RotateCcw className="h-3.5 w-3.5" /></button>}
        </div>
        {referenceError && <div role="status" className="mt-2 text-[10px] text-muted-foreground">{referenceError}</div>}
      </div>

      <div className="relative min-h-[156px] min-w-0 flex-1 px-3 pb-3 pt-1">
        {variant === 'video' && mentionContext && mentionCandidates.length > 0 && <div ref={mentionMenuRef} onPointerDown={(event) => event.stopPropagation()}>
          <PromptMentionMenu
            references={orderedReferences}
            promptMentions={config?.promptMentions}
            query={mentionContext.query}
            selectedIndex={Math.min(mentionSelectedIndex, mentionCandidates.length - 1)}
            onSelect={selectMention}
          />
        </div>}
        <textarea
          ref={promptRef}
          value={config?.prompt || ''}
          onChange={handlePromptChange}
          onKeyDown={handlePromptKeyDown}
          onClick={handlePromptCaretChange}
          onKeyUp={handlePromptCaretChange}
          placeholder={variant === 'image' ? '描述你想生成的图片…' : VIDEO_MODE_PLACEHOLDERS[videoMode]}
          className="nodrag nowheel absolute inset-0 h-full w-full resize-none bg-transparent px-3 pb-3 pt-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/65"
          aria-label={variant === 'image' ? '图片生成提示词' : '视频生成提示词'}
          aria-autocomplete="list"
          aria-controls={variant === 'video' && mentionContext && mentionCandidates.length ? 'request-node-prompt-mentions' : undefined}
          aria-expanded={variant === 'video' && Boolean(mentionContext && mentionCandidates.length)}
        />
      </div>

      {(task.status === 'timeout' || task.status === 'unknown' || (task.status === 'failed' && Boolean(task.error)) || task.status === 'completed') && <div className="shrink-0 px-3 pb-2 text-[10px]">
        {task.status === 'timeout' && <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800"><div>任务已超时，任务 ID 已保留。</div>{task.taskId && <div className="mt-1 truncate font-mono" title={task.taskId}>{task.taskId}</div>}{resumableTaskId && <button type="button" className="nodrag mt-1.5 font-semibold underline" onClick={() => void runTask(resumableTaskId)}>继续查询</button>}</div>}
        {(task.status === 'failed' || task.status === 'unknown') && task.error && <div className="rounded-lg bg-destructive/5 px-2.5 py-2 text-destructive">{task.error}</div>}
        {task.status === 'completed' && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-800">任务已完成，{variant === 'image' ? `已生成 ${resultCount} 张图片` : `已收到 ${resultCount} 个结果`}，耗时 {formatElapsed(task.elapsedMs ?? elapsed)}</div>}
      </div>}

      <div className="relative z-40 flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2.5" onPointerDown={(event) => event.stopPropagation()}>
        <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[190px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label="模型选择" title="模型选择"><span className="truncate">{selectedModel?.name || '模型'}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(420px,70vh)] min-w-[270px] max-w-[min(380px,calc(100vw-32px))] overflow-auto">
            {modelGroups.length ? modelGroups.map((group, groupIndex) => <div key={group.channel.id}>
              {groupIndex > 0 && <div className="my-1 h-px bg-border" />}
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">{group.channel.name}</div>
              {group.models.map((model) => <button key={`${group.channel.id}:${model.id}`} type="button" className="cnote-menu-item" title={model.name === model.id ? model.id : `${model.name} · ${model.id}`} data-active={group.channel.id === config?.channelId && model.id === config?.model} onClick={() => { selectModel(group.channel.id, model); closeOpenMenus(nodeRef.current) }}><span className="min-w-0 flex-1 truncate">{model.name}</span>{group.channel.id === config?.channelId && model.id === config?.model && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</button>)}
            </div>) : <p className="px-3 py-3 text-xs text-muted-foreground">暂无可用生成模型</p>}
          </div>
        </details>
        {variant === 'video' && capabilities.length > 0 && <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[145px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label="生成模式" title="生成模式"><span className="truncate">{CAPABILITY_LABELS[effectiveCapability || 'text-to-video']}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div role="listbox" aria-label="生成模式选项" className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(360px,70vh)] min-w-[190px] overflow-auto">
            {capabilities.map((capability) => <button key={capability} type="button" role="option" aria-selected={effectiveCapability === capability} className="cnote-menu-item" data-active={effectiveCapability === capability} onClick={() => { selectCapability(capability); closeOpenMenus(nodeRef.current) }}><span className="flex-1">{CAPABILITY_LABELS[capability]}</span>{effectiveCapability === capability && <Check className="h-3.5 w-3.5 text-primary" />}</button>)}
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
                {selectedModel?.allowedDurations?.length ? <ChoiceRow
                  label="时长（秒）"
                  value={String(config?.seconds || selectedModel.defaultDuration || selectedModel.allowedDurations[0])}
                  options={selectedModel.allowedDurations.map((seconds) => ({ value: String(seconds), label: String(seconds) }))}
                  onChange={(value) => updateVariant({ seconds: Number(value) })}
                  ariaLabel="时长（秒）"
                /> : <><span className="text-[10px] text-muted-foreground">时长（秒）</span>
                  <input type="number" min={selectedModel?.minDuration || 1} max={selectedModel?.maxDuration || 60} value={config?.seconds || selectedModel?.defaultDuration || 5} onChange={(event) => updateVariant({ seconds: Number(event.target.value) })} className="nodrag h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" aria-label="时长（秒）" /></>}
              </div>
              {selectedModel?.capabilities.includes('generate-audio') && <label className="nodrag flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[11px] text-foreground hover:bg-muted/70" title="生成视频音轨">
                <span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5 text-muted-foreground" />生成音频</span>
                <input type="checkbox" className="nodrag" checked={Boolean(resolvedConfig?.generateAudio)} onChange={(event) => updateVariant({ generateAudio: event.target.checked, noMusic: undefined })} aria-label="生成音频" />
              </label>}
            </>}
          </div>
        </details>
        <span className="flex-1" />
        <button
          type="button"
          disabled={waiting ? false : Boolean(referenceError) || !config?.channelId || !config?.model || (!resolvedConfig?.prompt?.trim() && !references.length)}
          title={referenceError || (waiting ? '终止生成任务' : '生成')}
          className={`nodrag flex h-10 min-w-[112px] shrink-0 items-center justify-center gap-2 rounded-full px-4 text-xs font-medium transition-colors disabled:bg-muted disabled:text-muted-foreground ${waiting ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          onClick={() => { if (waiting) stopTask(); else void runTask() }}
          aria-busy={waiting}
          aria-label={waiting ? '终止生成任务' : '生成'}
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


