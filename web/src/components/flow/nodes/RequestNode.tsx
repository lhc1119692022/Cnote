import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowDown, ArrowUp, Image as ImageIcon, Link2, LoaderCircle, Mic, Sparkles, Upload, Video, X } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useGenerationStore, GENERATION_PROVIDER_LABELS, type GenerationModel } from '@/stores/use-generation-store'
import { createGenerationReference, createRequestNodeData } from '@/lib/generation/defaults'
import { pollGenerationTask, pollIntervalForModel, submitGenerationTask } from '@/lib/generation/client'
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

function previewRole(reference: GenerationReference) {
  if (reference.role === 'first_frame') return '首帧'
  if (reference.role === 'last_frame') return '尾帧'
  if (reference.role === 'reference_voice' || reference.role === 'reference_audio') return '参考音频'
  return TYPE_LABELS[reference.type]
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

const ROLE_LABELS: Record<NonNullable<GenerationReference['role']>, string> = {
  reference_image: '参考图',
  reference_video: '参考视频',
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_voice: '参考人声',
  reference_audio: '参考音频',
}

function roleOptions(reference: GenerationReference, variant: RequestVariant, model?: GenerationModel) {
  if (variant === 'image') return [{ value: 'reference_image' as const, disabled: false }]
  const supports = (capability: GenerationCapability) => Boolean(model && model.capabilities.includes(capability))
  const options: Array<{ value: NonNullable<GenerationReference['role']>; disabled: boolean }> = reference.type === 'image'
    ? [
        { value: 'reference_image', disabled: false },
        { value: 'first_frame', disabled: !supports('first-last-frame') },
        { value: 'last_frame', disabled: !supports('first-last-frame') },
      ]
    : reference.type === 'video'
      ? [{ value: 'reference_video', disabled: Boolean(model && !supports('video-reference') && !supports('reference-to-video')) }]
      : [
          { value: 'reference_voice', disabled: Boolean(model && !supports('audio-reference')) },
          { value: 'reference_audio', disabled: Boolean(model && !supports('audio-reference')) },
        ]
  const currentRole = reference.role
  if (currentRole && !options.some((option) => option.value === currentRole)) options.push({ value: currentRole, disabled: true })
  return options
}

function modelConfigUpdates(config: NonNullable<RequestNodeData['image']> | undefined, model: GenerationModel | undefined, variant: RequestVariant) {
  if (!config || !model || variant === 'body') return {}
  const updates: Partial<typeof config> = {}
  if (model.resolutions?.length && (!config.resolution || !model.resolutions.includes(config.resolution))) updates.resolution = model.resolutions[0]
  if (model.aspectRatios?.length && (!config.aspectRatio || !model.aspectRatios.includes(config.aspectRatio))) updates.aspectRatio = model.aspectRatios[0]
  if (variant === 'video') {
    const currentSeconds = config.seconds || 30
    if (model.minDuration && currentSeconds < model.minDuration) updates.seconds = model.minDuration
    if (model.maxDuration && currentSeconds > model.maxDuration) updates.seconds = model.maxDuration
    if (model.capabilities.length && !model.capabilities.includes('generate-audio')) updates.generateAudio = false
  }
  return updates
}

function isModelForVariant(model: GenerationModel, variant: RequestVariant) {
  if (variant === 'body' || !model.capabilities.length) return true
  const imageCapabilities = new Set<GenerationCapability>(['text-to-image', 'image-to-image'])
  return variant === 'image'
    ? model.capabilities.some((capability) => imageCapabilities.has(capability))
    : model.capabilities.some((capability) => !imageCapabilities.has(capability))
}

export const RequestNode = memo(({ id, data, selected }: NodeProps<RequestNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const addNode = useFlowStore((state) => state.addNode)
  const addEdge = useFlowStore((state) => state.addEdge)
  const upstreamCount = useFlowStore((state) => state.edges.filter((edge) => edge.target === id).length)
  const channels = useGenerationStore((state) => state.channels)
  const getModels = useGenerationStore((state) => state.getModels)
  const [selectionTab, setSelectionTab] = useState<'capability' | 'model'>('capability')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [referenceType, setReferenceType] = useState<GenerationReference['type']>('image')
  const [now, setNow] = useState(Date.now())
  const pollingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const variant = data.variant || 'body'
  const config = variant === 'body' ? undefined : data[variant]
  const selectedChannel = config?.channelId ? channels.find((channel) => channel.id === config.channelId) : undefined
  const allModels = useMemo(() => getModels(config?.channelId), [config?.channelId, getModels])
  const models = useMemo(() => {
    if (variant === 'body') return []
    const imageCapability = new Set<GenerationCapability>(['text-to-image', 'image-to-image'])
    const videoCapability = new Set<GenerationCapability>(['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio'])
    const accepted = variant === 'image' ? imageCapability : videoCapability
    return allModels.filter((model) => !model.capabilities.length || model.capabilities.some((capability) => accepted.has(capability)))
  }, [allModels, variant])
  const filteredModels = useMemo(
    () => config?.capability ? models.filter((model) => !model.capabilities.length || model.capabilities.includes(config.capability as GenerationCapability)) : models,
    [config?.capability, models],
  )
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
    const channel = config?.channelId ? generationStore.getChannel(config.channelId) : undefined
    const model = config?.model ? generationStore.getModels(config.channelId).find((item) => item.id === config.model) : undefined
    if (!channel || !model || !config) {
      updateTask({ status: 'failed', error: '请先选择生成渠道和模型' })
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    pollingRef.current = true
    const previousNodeData = useFlowStore.getState().nodes.find((node) => node.id === id)?.data as RequestNodeData | undefined
    const previousTask = previousNodeData?.tasks?.[variant] || previousNodeData?.task
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
        const submitted = await submitGenerationTask({ channel, model, config, variant }, controller.signal)
        taskId = submitted.taskId
        updateTask({ taskId, provider: channel.providerId, channelId: channel.id, model: model.id, status: 'queued', submittedAt, elapsedMs: 0, timeoutAt, error: undefined })
        if (submitted.resultUrls?.length) {
          updateTask({ status: 'completed', resultUrls: submitted.resultUrls, completedAt: Date.now(), elapsedMs: Date.now() - submittedAt })
          createResultNode(submitted.resultUrls, submitted.resultResourceIds, undefined)
          return
        }
      } else {
        updateTask({ taskId, provider: channel.providerId, channelId: channel.id, model: model.id, status: 'in_progress', submittedAt, elapsedMs: elapsedOffset, timeoutAt, error: undefined })
      }

      const pollInterval = pollIntervalForModel(model)
      while (taskId) {
        if (Date.now() >= timeoutAt) {
          updateTask({ status: 'timeout', elapsedMs: elapsedOffset + Date.now() - submittedAt, timeoutAt })
          return
        }
        const polled = await pollGenerationTask({ channel, model, config, variant }, taskId, controller.signal)
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

  useEffect(() => {
    if (!waiting) return () => undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting])

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

  const handleFile = async (file: File) => {
    if (variant === 'body') return
    const stored = await storeLocalResource(file)
    const providerNeedsUpload = selectedChannel?.providerId !== 'fmage'
    addReference(createGenerationReference({
      type: referenceType,
      role: defaultRole(referenceType, variant),
      label: file.name,
      source: 'local',
      resourceId: stored.resourceId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      status: providerNeedsUpload ? 'pending-upload' : 'ready',
    }))
  }

  const addUrlReference = () => {
    const url = referenceUrl.trim()
    if (!url || variant === 'body') return
    addReference(createGenerationReference({
      type: referenceType,
      role: defaultRole(referenceType, variant),
      label: url,
      source: 'url',
      url,
      previewUrl: referenceType === 'image' ? url : undefined,
      status: /^https:\/\//i.test(url) ? 'ready' : 'error',
      error: /^https:\/\//i.test(url) ? undefined : '需要 HTTPS 地址',
    }))
    setReferenceUrl('')
  }

  const removeReference = async (reference: GenerationReference) => {
    if (reference.resourceId) await deleteLocalResource(reference.resourceId)
    updateVariant({ references: references.filter((item) => item.id !== reference.id).map((item, index) => ({ ...item, order: index })) })
  }

  const moveReference = (reference: GenerationReference, direction: -1 | 1) => {
    const index = references.findIndex((item) => item.id === reference.id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= references.length) return
    const next = [...references]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    updateVariant({ references: next.map((entry, order) => ({ ...entry, order })) })
  }

  const updateReferenceRole = (reference: GenerationReference, role: NonNullable<GenerationReference['role']>) => {
    updateVariant({ references: references.map((item) => item.id === reference.id ? { ...item, role } : item) })
  }

  const selectChannel = (channelId: string) => {
    const nextModels = getModels(channelId).filter((model) => isModelForVariant(model, variant))
    const nextModel = nextModels[0]
    updateVariant({
      channelId: channelId || undefined,
      model: nextModel?.id,
      capability: nextModel?.capabilities[0] || config?.capability,
      ...modelConfigUpdates(config, nextModel, variant),
    })
  }

  const selectModel = (model: GenerationModel) => {
    updateVariant({
      model: model.id,
      capability: model.capabilities.includes(config?.capability as GenerationCapability) ? config?.capability : model.capabilities[0],
      ...modelConfigUpdates(config, model, variant),
    })
  }

  const selectCapability = (capability: GenerationCapability) => {
    const currentModelSupportsCapability = selectedModel?.capabilities.includes(capability)
    const nextModel = currentModelSupportsCapability ? selectedModel : models.find((model) => model.capabilities.includes(capability))
    updateVariant({ capability, model: nextModel?.id || config?.model, ...modelConfigUpdates(config, nextModel, variant) })
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
  ) : (
    <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <select value={config?.channelId || ''} onChange={(event) => selectChannel(event.target.value)} className="nodrag min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-ring">
          <option value="">选择生成渠道</option>
          {channels.filter((channel) => channel.enabled).map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {GENERATION_PROVIDER_LABELS[channel.providerId]}</option>)}
        </select>
        <button type="button" disabled={waiting} className="nodrag rounded-lg border border-border px-2 py-2 text-[11px] text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45" title={waiting ? '任务进行中，完成或超时后才能切换样式' : '返回请求体外壳'} onClick={() => updateNode(id, { data: { ...data, variant: 'body' } })}>外壳</button>
      </div>
      <div className="flex rounded-lg bg-muted/50 p-1 text-[11px] font-semibold">
        <button type="button" className={`nodrag flex-1 rounded-md px-2 py-1.5 ${selectionTab === 'capability' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setSelectionTab('capability')}>能力</button>
        <button type="button" className={`nodrag flex-1 rounded-md px-2 py-1.5 ${selectionTab === 'model' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setSelectionTab('model')}>模型名称</button>
      </div>
      {selectionTab === 'capability' ? (
        <div className="flex flex-wrap gap-1.5">
          {capabilities.map((capability) => <button key={capability} type="button" className={`nodrag rounded-full border px-2.5 py-1 text-[11px] ${config?.capability === capability ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`} onClick={() => selectCapability(capability)}>{CAPABILITY_LABELS[capability]}</button>)}
        </div>
      ) : (
        <select value={config?.model || ''} onChange={(event) => { const model = models.find((item) => item.id === event.target.value); if (model) selectModel(model) }} className="nodrag w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-ring">
          <option value="">选择模型名称</option>
          {filteredModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      )}
      {selectedModel && <div className="rounded-lg bg-muted/50 px-2.5 py-2 text-[10px] text-muted-foreground">支持能力：{selectedModel.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join('、')}</div>}
      <textarea value={config?.prompt || ''} onChange={(event) => updateVariant({ prompt: event.target.value })} placeholder={variant === 'image' ? '描述要生成的图片…' : '描述要生成的视频…'} className="nodrag min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-ring" />
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-2.5 text-[11px]">
        <label className="text-muted-foreground"><span className="mb-1 block">画面比例</span><select value={config?.aspectRatio || '16:9'} onChange={(event) => updateVariant({ aspectRatio: event.target.value })} className="nodrag h-8 w-full rounded-md border border-input bg-background px-2 text-[11px]">{availableAspectRatios.map((ratio) => <option key={ratio} value={ratio} disabled={Boolean(selectedModel?.aspectRatios && !selectedModel.aspectRatios.includes(ratio))}>{ratio}{selectedModel?.aspectRatios && !selectedModel.aspectRatios.includes(ratio) ? '（不支持）' : ''}</option>)}</select></label>
        <label className="text-muted-foreground"><span className="mb-1 block">分辨率</span><select value={config?.resolution || (variant === 'image' ? '1k' : '720p')} onChange={(event) => updateVariant({ resolution: event.target.value })} className="nodrag h-8 w-full rounded-md border border-input bg-background px-2 text-[11px]">{availableResolutions.map((resolution) => <option key={resolution} value={resolution} disabled={Boolean(selectedModel?.resolutions && !selectedModel.resolutions.includes(resolution))}>{resolution}{selectedModel?.resolutions && !selectedModel.resolutions.includes(resolution) ? '（不支持）' : ''}</option>)}</select></label>
        {variant === 'video' && <label className="text-muted-foreground"><span className="mb-1 block">时长（秒）</span><input type="number" min={selectedModel?.minDuration || 1} max={selectedModel?.maxDuration || 60} value={config?.seconds || 30} onChange={(event) => updateVariant({ seconds: Number(event.target.value) })} className="nodrag h-8 w-full rounded-md border border-input bg-background px-2 text-[11px]" /></label>}
        {variant === 'video' && <label className={`flex items-end ${selectedModel && !selectedModel.capabilities.includes('generate-audio') ? 'opacity-45' : ''}`} title={selectedModel && !selectedModel.capabilities.includes('generate-audio') ? '当前模型不支持生成音频' : undefined}><span className="flex h-8 w-full items-center gap-2 rounded-md border border-input px-2"><input type="checkbox" checked={Boolean(config?.generateAudio)} disabled={Boolean(selectedModel && !selectedModel.capabilities.includes('generate-audio'))} onChange={(event) => updateVariant({ generateAudio: event.target.checked })} />生成音频</span></label>}
      </div>
      <div className="rounded-xl border border-border p-2.5">
        <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold"><Link2 className="h-3.5 w-3.5 text-primary" />参考文件</div><span className="text-[10px] text-muted-foreground">{references.length} 个</span></div>
        <div className="mb-2 flex gap-1.5">
          <select value={referenceType} onChange={(event) => setReferenceType(event.target.value as GenerationReference['type'])} className="nodrag rounded-md border border-input bg-background px-2 py-1.5 text-[11px]">
            {(variant === 'image' ? ['image'] : ['image', 'video', 'audio']).map((type) => <option key={type} value={type} disabled={Boolean(selectedModel?.inputTypes && !selectedModel.inputTypes.includes(type as GenerationReference['type']))}>{TYPE_LABELS[type as GenerationReference['type']]}</option>)}
          </select>
          <label className="nodrag flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-muted"><Upload className="h-3 w-3" />添加文件<input type="file" className="hidden" accept={referenceType === 'image' ? 'image/*' : referenceType === 'video' ? 'video/*' : 'audio/*'} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleFile(file) }} /></label>
        </div>
        <div className="flex gap-1.5"><input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="或粘贴 HTTPS 地址" className="nodrag min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[11px] outline-none" /><button type="button" className="nodrag rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-muted" onClick={addUrlReference}>添加</button></div>
        {references.length > 0 && <div className={`mt-2 grid gap-2 ${variant === 'video' ? 'grid-cols-3' : 'grid-cols-1'}`}>{(['image', 'video', 'audio'] as const).filter((type) => variant === 'video' || type === 'image').map((type) => {
          const items = references.filter((reference) => reference.type === type)
          if (!items.length) return null
           return <div key={type} className="rounded-lg bg-muted/35 p-2"><div className="mb-1 text-[10px] font-semibold text-muted-foreground">{TYPE_LABELS[type]}</div><div className="space-y-1.5">{items.map((reference) => <div key={reference.id} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-1.5"><LocalReferencePreview reference={reference} /><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium" title={reference.label}>{reference.label || previewRole(reference)}</div><div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"><select value={reference.role || defaultRole(reference.type, variant)} onChange={(event) => updateReferenceRole(reference, event.target.value as NonNullable<GenerationReference['role']>)} className="nodrag max-w-[92px] rounded border border-transparent bg-transparent px-0 py-0 text-[10px] text-muted-foreground outline-none hover:border-input">{roleOptions(reference, variant, selectedModel).map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{ROLE_LABELS[option.value]}{option.disabled ? '（不支持）' : ''}</option>)}</select>{reference.status === 'pending-upload' && <span className="text-amber-600">待上传</span>}{reference.status === 'error' && <span className="text-destructive">{reference.error || '不可用'}</span>}</div></div><div className="flex shrink-0 items-center gap-0.5"><button type="button" className="nodrag rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => moveReference(reference, -1)} aria-label="上移"><ArrowUp className="h-3 w-3" /></button><button type="button" className="nodrag rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => moveReference(reference, 1)} aria-label="下移"><ArrowDown className="h-3 w-3" /></button><button type="button" className="nodrag rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => void removeReference(reference)} aria-label="删除参考文件"><X className="h-3 w-3" /></button></div></div>)}</div></div>
        })}</div>}
      </div>
      {selectedChannel?.providerId === '808' && references.some((reference) => reference.source === 'local') && <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">808 当前只接受公网 HTTPS 直链，本地参考文件需要先上传或替换为直链。</div>}
      {task.status === 'timeout' && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800"><p>任务已等待 {formatElapsed(elapsed)}，超过建议等待时间。任务 ID 已保留，后续可继续查询，不会自动重复提交。</p>{task.taskId && <p className="truncate font-mono text-[10px]" title={task.taskId}>task_id: {task.taskId}</p>}<button type="button" className="nodrag rounded-md border border-amber-400/70 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-200" onClick={() => void runTask(task.taskId)}>继续查询</button></div>}
      {task.status === 'failed' && task.error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] leading-4 text-destructive">{task.error}</div>}
      {task.status === 'completed' && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] leading-4 text-emerald-800">任务已完成{task.resultUrls?.length ? `，已收到 ${task.resultUrls.length} 个结果并创建下游节点` : '，等待结果地址'}</div>}
      {waiting && <div className="rounded-lg bg-primary/5 px-2.5 py-2 text-[11px] text-primary"><div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{task.status === 'queued' ? '排队中' : task.status === 'validating' || task.status === 'submitting' ? '提交中' : '生成中'}</span><span className="flex items-center gap-2">{typeof task.progress === 'number' && <span>{Math.round(task.progress)}%</span>}已等待 {formatElapsed(elapsed)}</span></div>{task.taskId && <p className="mt-1 truncate font-mono text-[10px] text-primary/70" title={task.taskId}>task_id: {task.taskId}</p>}</div>}
      <button type="button" disabled={waiting} className="nodrag flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60" onClick={() => void runTask()}><Sparkles className="h-3.5 w-3.5" />{waiting ? '任务进行中' : '提交生成任务'}</button>
    </div>
  )

  return <div className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-visible rounded-[24px] border bg-card ${selected ? 'node-selected' : 'border-border'}`} style={{ minWidth: REQUEST_NODE_MIN_SIZE.width, minHeight: REQUEST_NODE_MIN_SIZE.height }}>
    <NodeHandle type="target" position={Position.Left} id="in" />
    <NodeHandle type="source" position={Position.Right} id="out" />
    <NodeDragGutters />
    <NodeHoverToolbar nodeId={id} />
    <NodeResizeArc nodeId={id} minWidth={REQUEST_NODE_MIN_SIZE.width} minHeight={REQUEST_NODE_MIN_SIZE.height} />
    <div className="node-scroll-clip flex min-h-0 w-full flex-1 flex-col">{content}</div>
  </div>
})

RequestNode.displayName = 'RequestNode'
