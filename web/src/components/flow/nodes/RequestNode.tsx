import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { Check, ChevronDown, Image as ImageIcon, LoaderCircle, Mic, Sparkles, Square, Upload, Video, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { generationAdapterForModel, generationChannelSupportsVariant, generationChannelUsesModelInference, useGenerationStore, type GenerationChannel, type GenerationModel } from '@/stores/use-generation-store'
import { createGenerationReference, createRequestNodeData } from '@/lib/generation/defaults'
import { cancelGenerationTask, pollGenerationTask, pollIntervalForModel, submitGenerationTask } from '@/lib/generation/client'
import { createGenerationResultContentData } from '@/lib/generation/results'
import { deleteLocalResource, loadLocalResourceUrl, revokeManagedObjectUrl, storeLocalResource } from '@/lib/resource-storage'
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

function InlineChoice({
  value,
  options,
  onChange,
  ariaLabel,
  title,
}: {
  value: string
  options: ChoiceOption[]
  onChange: (value: string) => void
  ariaLabel: string
  title?: string
}) {
  return <div role="group" aria-label={ariaLabel} title={title || ariaLabel} className="nodrag flex min-w-0 items-center gap-1 rounded-full border border-border bg-background/75 p-0.5">
    {options.map((option) => <button
      key={option.value}
      type="button"
      disabled={option.disabled}
      aria-pressed={option.value === value}
      aria-label={`${ariaLabel}：${option.label}`}
      className="nodrag shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 data-[selected=true]:bg-foreground data-[selected=true]:text-background"
      data-selected={option.value === value}
      onClick={() => { if (!option.disabled) onChange(option.value) }}
    >{option.label}</button>)}
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
  const timeoutMs = variant === 'image' ? 15 * 60 * 1000 : 60 * 60 * 1000
  const availableAspectRatios = useMemo(() => [...new Set((variant === 'image' ? ['auto', '1:1', '16:9', '9:16'] : ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']).concat(models.flatMap((model) => model.aspectRatios || [])))], [models, variant])
  const availableResolutions = useMemo(() => [...new Set((variant === 'image' ? ['1k', '2k', '3k', '4k'] : ['768', '720p', '1080p', '2K', '4K']).concat(models.flatMap((model) => model.resolutions || [])))], [models, variant])
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

  const createResultNode = useCallback((urls: string[], resourceIds?: string[], mimeTypes?: string[]) => {
    if (!urls.length || (variant !== 'image' && variant !== 'video')) return
    const state = useFlowStore.getState()
    const current = state.nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = current.data as RequestNodeData
    const resultData = createGenerationResultContentData(variant, urls, `${currentData.label || (variant === 'image' ? '图片' : '视频')}结果`, resourceIds, mimeTypes)
    const resultNodeId = currentData.resultNodeIds?.[variant] || (currentData.variant === variant ? currentData.resultNodeId : undefined)
    let resultNode = resultNodeId ? state.nodes.find((node) => node.id === resultNodeId) : undefined
    if (resultNode?.type === 'content') {
      updateNode(resultNode.id, { data: resultData })
    } else {
      const width = Number(current.style?.width || 520)
      resultNode = addNode({
        type: 'content',
        position: { x: current.position.x + width + 90, y: current.position.y },
        data: resultData,
      })
    }
    if (!state.edges.some((edge) => edge.source === id && edge.target === resultNode?.id)) {
      addEdge({ source: id, target: resultNode.id, sourceHandle: 'out', targetHandle: 'in', type: 'interactive' })
    }
    updateNode(id, {
      data: {
        ...currentData,
        resultNodeIds: { ...(currentData.resultNodeIds || {}), [variant]: resultNode.id },
        resultNodeId: resultNode.id,
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
    const channel: GenerationChannel | undefined = persisted
      ? {
          id: persisted.channelId,
          providerId: persisted.providerId as GenerationChannel['providerId'],
          name: liveChannel?.name || '已提交渠道',
          baseURL: persisted.baseURL,
          secretName: persisted.secretName || liveChannel?.secretName,
          modelIds: liveChannel?.modelIds || [persisted.model],
          enabled: true,
          protocol: persisted.protocol as GenerationChannel['protocol'],
          adapters: liveChannel?.adapters,
        }
      : liveChannel
    const runConfig = persisted?.config || config
    const model = persisted
      ? liveChannel?.id === persisted.channelId
        ? generationStore.getModels(liveChannel.id).find((item) => item.id === persisted.model) || { id: persisted.model, name: persisted.model, capabilities: [] }
        : { id: persisted.model, name: persisted.model, capabilities: [] }
      : config?.model ? generationStore.getModels(config.channelId).find((item) => item.id === config.model) : undefined
    if (!channel || !model || !runConfig) {
      updateTask({ status: 'failed', error: '请先选择生成渠道和模型' })
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
      let taskId = resumeTaskId
      if (!taskId) {
        updateTask({ status: 'validating', submittedAt, elapsedMs: 0, timeoutAt, error: undefined, resultUrls: undefined })
        updateTask({ status: 'submitting' })
        const submitted = await submitGenerationTask({ channel, model, config: runConfig, variant }, controller.signal)
        taskId = submitted.taskId
        updateTask({ taskId, provider: channel.providerId, channelId: channel.id, model: model.id, status: 'queued', submittedAt, elapsedMs: 0, timeoutAt, error: undefined, requestSnapshot: { variant, channelId: channel.id, providerId: channel.providerId, protocol: channel.protocol, baseURL: channel.baseURL, secretName: channel.secretName, model: model.id, config: runConfig } })
        if (submitted.resultUrls?.length) {
          updateTask({ status: 'completed', resultUrls: submitted.resultUrls, resultResourceIds: submitted.resultResourceIds, resultMimeTypes: submitted.resultMimeTypes, completedAt: Date.now(), elapsedMs: Date.now() - submittedAt })
          createResultNode(submitted.resultUrls, submitted.resultResourceIds, submitted.resultMimeTypes)
          return
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
        const polled = await pollGenerationTask({ channel, model, config: runConfig, variant }, taskId, controller.signal)
        const elapsedMs = elapsedOffset + Date.now() - submittedAt
        updateTask({ ...polled.task, taskId, submittedAt, elapsedMs, timeoutAt })
        if (polled.task.status === 'completed') {
          if (polled.task.resultUrls?.length) createResultNode(polled.task.resultUrls, polled.task.resultResourceIds, polled.task.resultMimeTypes)
          else updateTask({ error: '任务已完成，但服务端没有返回可预览的结果地址' })
          return
        }
        if (polled.task.status === 'failed') return
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, pollInterval)
          controller.signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('执行已停止', 'AbortError')) }, { once: true })
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
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
  }, [config, createResultNode, id, timeoutMs, updateTask, variant])

  const runTaskRef = useRef(runTask)
  useEffect(() => { runTaskRef.current = runTask }, [runTask])

  useEffect(() => {
    if (!task.taskId || (task.status !== 'queued' && task.status !== 'in_progress')) return
    if (!pollingRef.current) void runTaskRef.current(task.taskId)
  }, [task.status, task.taskId])

  useEffect(() => () => { abortRef.current?.abort() }, [])

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

  const updateVariant = (updates: Partial<NonNullable<typeof config>>) => {
    if (variant === 'body') return
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    const currentData = current.data as RequestNodeData
    updateNode(id, { data: { ...currentData, [variant]: { ...currentData[variant], ...updates } } })
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
    updateVariant({ references: [...references, { ...reference, order: references.length }] })
  }

  const handleFile = async (file: File, type: GenerationReference['type']) => {
    if (variant === 'body') return
    const stored = await storeLocalResource(file)
    const selectedAdapter = selectedChannel && config ? generationAdapterForModel(selectedChannel, config.model || '', config.adapterId) : undefined
    const providerNeedsUpload = selectedAdapter?.protocol !== 'gemini-generate-content'
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
  }

  const removeReference = async (reference: GenerationReference) => {
    if (reference.resourceId) await deleteLocalResource(reference.resourceId)
    updateVariant({ references: references.filter((item) => item.id !== reference.id).map((item, index) => ({ ...item, order: index })) })
  }

  const modelGroups = useMemo(() => channels
    .filter((channel) => channel.enabled && generationChannelSupportsVariant(channel, variant === 'video' ? 'video' : 'image'))
    .map((channel) => {
      const channelModels = getModels(channel.id)
      const visibleModels = config?.capability && generationChannelUsesModelInference(channel)
        ? channelModels.filter((model) => !model.capabilities.length || model.capabilities.includes(config.capability as GenerationCapability))
        : channelModels
      return { channel, models: visibleModels }
    })
    .filter((group) => group.models.length > 0), [channels, config?.capability, getModels, variant])

  const selectModel = (channelId: string, model: GenerationModel) => {
    const nextChannel = channels.find((channel) => channel.id === channelId)
    if (!nextChannel) return
    updateVariant({
      channelId,
      model: model.id,
      adapterId: model.adapterId,
      capability: model.capabilities.includes(config?.capability as GenerationCapability) ? config?.capability : model.capabilities[0],
      ...modelConfigUpdates(config, model, variant === 'video' ? 'video' : 'image'),
    })
  }

  const selectCapability = (capability: GenerationCapability) => {
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
    const selectedCapability = config?.capability || capabilities[0]
    const renderReferences = (type: GenerationReference['type']) => {
      const items = references.filter((reference) => reference.type === type)
      const acceptsType = !selectedModel?.inputTypes || selectedModel.inputTypes.includes(type)
      return <div key={type} className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{TYPE_LABELS[type]}</span>
        <span className="text-[10px] text-muted-foreground/70">{items.length}</span>
        {items.map((reference) => <div key={reference.id} className="group relative shrink-0">
          <LocalReferencePreview reference={reference} />
          <button type="button" className="nodrag absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100" onClick={() => void removeReference(reference)} aria-label={`删除${TYPE_LABELS[type]}素材`} title={`删除${TYPE_LABELS[type]}素材`}><X className="h-3 w-3" /></button>
        </div>)}
        <label className={`nodrag flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${acceptsType ? '' : 'pointer-events-none opacity-35'}`} aria-label={`上传${TYPE_LABELS[type]}素材`} title={acceptsType ? `上传${TYPE_LABELS[type]}素材` : `当前模型不支持${TYPE_LABELS[type]}输入`}>
          <Upload className="h-4 w-4" />
          <input type="file" className="hidden" accept={type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*'} disabled={!acceptsType} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleFile(file, type) }} />
        </label>
      </div>
    }

    return <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[156px] shrink-0 px-3 pb-3 pt-3">
        <textarea value={config?.prompt || ''} onChange={(event) => updateVariant({ prompt: event.target.value })} placeholder={variant === 'image' ? '描述你想生成的图片…' : '描述镜头、动作、氛围，或上传图片生成动态视频…'} className="nodrag nowheel absolute inset-0 h-full w-full resize-none bg-transparent px-3 pb-3 pt-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/65" aria-label={variant === 'image' ? '图片生成提示词' : '视频生成提示词'} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-2 custom-scrollbar">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-2">
          {referenceTypes.map(renderReferences)}
        </div>
        {selectedChannel && ['openai-images-808', '808-video'].includes(selectedChannel.protocol || '') && references.some((reference) => reference.source === 'local') && <div className="mt-2 text-[10px] leading-4 text-amber-700">当前 808 端点只接受公网 HTTPS 直链，本地素材需要先上传或替换为直链。</div>}
      </div>

      {(task.status === 'timeout' || (task.status === 'failed' && Boolean(task.error)) || task.status === 'completed') && <div className="shrink-0 px-3 pb-2 text-[10px]">
        {task.status === 'timeout' && <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800"><div>任务已超时，任务 ID 已保留。</div>{task.taskId && <div className="mt-1 truncate font-mono" title={task.taskId}>{task.taskId}</div>}<button type="button" className="nodrag mt-1.5 font-semibold underline" onClick={() => void runTask(task.taskId)}>继续查询</button></div>}
        {task.status === 'failed' && task.error && <div className="rounded-lg bg-destructive/5 px-2.5 py-2 text-destructive">{task.error}</div>}
        {task.status === 'completed' && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-800">任务已完成{task.resultUrls?.length ? `，已收到 ${task.resultUrls.length} 个结果` : ''}</div>}
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
        <details className="group/menu relative min-w-0" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(nodeRef.current, event.currentTarget) }}>
          <summary className="nodrag flex h-8 max-w-[145px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground hover:bg-muted" aria-label={variant === 'video' ? '生成模式' : '生成能力'} title={variant === 'video' ? '生成模式' : '生成能力'}><span className="truncate">{variant === 'video' ? '生成模式' : '能力'} · {CAPABILITY_LABELS[selectedCapability]}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
          <div className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[min(360px,70vh)] min-w-[220px] overflow-auto">
            <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">{variant === 'video' ? '生成模式' : '能力'}</div>
            {capabilities.map((capability) => <button key={capability} type="button" className="cnote-menu-item" data-active={config?.capability === capability} onClick={() => { selectCapability(capability); closeOpenMenus(nodeRef.current) }}><span className="flex-1">{CAPABILITY_LABELS[capability]}</span>{config?.capability === capability && <Check className="h-3.5 w-3.5 text-primary" />}</button>)}
          </div>
        </details>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto custom-scrollbar pb-0.5" aria-label="生成参数">
          <InlineChoice
            value={config?.aspectRatio || '16:9'}
            options={availableAspectRatios.map((ratio) => ({ value: ratio, label: ratio, disabled: Boolean(selectedModel?.aspectRatios && !selectedModel.aspectRatios.includes(ratio)) }))}
            onChange={(value) => updateVariant({ aspectRatio: value })}
            ariaLabel="画面比例"
            title="画面比例"
          />
          <InlineChoice
            value={config?.resolution || (variant === 'image' ? '1k' : '720p')}
            options={availableResolutions.map((resolution) => ({ value: resolution, label: resolution, disabled: Boolean(selectedModel?.resolutions && !selectedModel.resolutions.includes(resolution)) }))}
            onChange={(value) => updateVariant({ resolution: value })}
            ariaLabel="分辨率"
            title="分辨率"
          />
          {variant === 'image' && <InlineChoice
            value={config?.quality || 'medium'}
            options={[{ value: 'auto', label: '自动' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}
            onChange={(value) => updateVariant({ quality: value as NonNullable<typeof config>['quality'] })}
            ariaLabel="质量"
            title="质量"
          />}
          {variant === 'image' && selectedModel?.thinkingLevels?.length && <InlineChoice
            value={config?.thinkingLevel || selectedModel.defaultThinkingLevel || selectedModel.thinkingLevels[0]}
            options={selectedModel.thinkingLevels.map((level) => ({ value: level, label: level === 'minimal' ? '最小' : '高' }))}
            onChange={(value) => updateVariant({ thinkingLevel: value as NonNullable<typeof config>['thinkingLevel'] })}
            ariaLabel="思考级别"
            title="思考级别"
          />}
          {variant === 'video' && <label className="nodrag flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/75 px-2.5 py-1 text-[10px] font-medium text-muted-foreground" title="时长（秒）"><span>时长</span><input type="number" min={selectedModel?.minDuration || 1} max={selectedModel?.maxDuration || 60} value={config?.seconds || 30} onChange={(event) => updateVariant({ seconds: Number(event.target.value) })} className="nodrag w-10 bg-transparent text-center text-[10px] text-foreground outline-none" aria-label="时长（秒）" /></label>}
          {variant === 'video' && <label className={`nodrag flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background/75 px-2.5 py-1 text-[10px] font-medium text-muted-foreground ${selectedModel && !selectedModel.capabilities.includes('generate-audio') ? 'opacity-45' : ''}`} title={selectedModel && !selectedModel.capabilities.includes('generate-audio') ? '当前模型不支持生成音频' : '生成音频'}><input type="checkbox" checked={Boolean(config?.generateAudio)} disabled={Boolean(selectedModel && !selectedModel.capabilities.includes('generate-audio'))} onChange={(event) => updateVariant({ generateAudio: event.target.checked })} />音频</label>}
        </div>
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
