import { GenerationActionButton } from '@/canvas/components/GenerationActionButton'
/**
 * 生成节点内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * 声明（variant / image / video / latestRunId / resultNodeIds / referenceAssetIds）写 graph-store;
 * 任务与 run 写 runtime-store。GenerationReference 只在提交与预览时派生，不写入 FlowDocument。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Mic,
  Pause,
  RotateCcw,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  collectUpstreamNodes,
  collectUpstreamReferences,
  collectUpstreamText,
  defaultReferenceRole,
  findWaitingGenerationRun,
  generationInputProvenanceIds,
  imageCapabilityForReferences,
  isWritableGenerationTarget,
  localReferencesFromAssetIds,
  mergeGenerationReferences,
  ownedReferenceAssetIds,
  parkGenerationRunForResume,
  pendingLocalReferenceAssetIds,
  REFERENCE_DND_TYPE,
  requestedGenerationCount,
  RESUME_GENERATION_EVENT,
  resolveRequestGenerationInputs,
  resultAssetIdsFromResourceIds,
  stalePromptMentionEntries,
  toLegacyVariantConfig,
  upsertGenerationResultNodes,
} from '@/canvas/contents/request-generation'
import type {
  GenerationConfig,
  GenerationReferenceOverride,
  GenerationRun,
  GenerationTask,
  GenerationTaskRecoveryMetadata,
  GenerationTaskRecoveryState,
  GenerationTaskStatus,
  NodeSpec,
  RequestNodeSpec,
  RequestVariant,
} from '@/domain'
import { runGenerationBatch } from '@/lib/generation/batch'
import { runGenerationTask, type GenerationRequestContext } from '@/lib/generation/client'
import {
  generationRequestContextFromSnapshot,
  generationRunStatusFromTasks,
  generationTaskResumeBlockReason,
  isGenerationTaskResumable,
} from '@/lib/generation/resume-context'
import {
  filterPromptMentionReferences,
  getPromptMentionContext,
  getPromptMentionToken,
  removePromptMention,
  replacePromptMention,
  type PromptMentionContext,
} from '@/lib/generation/prompt-mentions'
import {
  normalizeVideoModeConfig,
  resolveVideoMode,
  videoInputTypes,
  videoModesForModel,
  videoReferenceError,
  VIDEO_MODE_PLACEHOLDERS,
  type VideoMode,
} from '@/lib/generation/video-mode'
import { AssetManager } from '@/runtime'
import { loadAssetUrl } from '@/storage/asset-store'
import { flushRuntimePersistence } from '@/storage/runtime-persistence'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { bindNodeMenus } from '@/canvas/node-menu-placement'
import { useRuntimeStore } from '@/stores/runtime-store'
import {
  generationChannelUsesModelInference,
  generationChannelSupportsVariant,
  useGenerationStore,
  type GenerationChannel,
  type GenerationModel,
} from '@/stores/use-generation-store'
import type { GenerationReference, GenerationTaskRequestSnapshot, GenerationTaskState, GenerationVariantConfig } from '@/types/flow'

const IMAGE_TIMEOUT_MS = 15 * 60 * 1000
const VIDEO_TIMEOUT_MS = 60 * 60 * 1000

type GenerationVariant = Exclude<RequestVariant, 'body'>

interface ModelGroup {
  channel: GenerationChannel
  models: GenerationModel[]
}

const assetManager = new AssetManager()

const CAPABILITY_LABELS: Record<'text-to-image' | 'image-to-image' | VideoMode, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'reference-to-video': '多模态',
  'first-last-frame': '首尾帧',
}

const TYPE_LABELS = { image: '图片', video: '视频', audio: '音频' } as const
const TYPE_ICONS = { image: ImageIcon, video: Video, audio: Mic } as const
const QUALITY_LABELS: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
  standard: '标准',
}

const TASK_STATUS_LABELS: Record<GenerationTaskStatus, string> = {
  idle: '待生成',
  validating: '校验中',
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function isGenerationVariant(variant: RequestVariant): variant is GenerationVariant {
  return variant === 'image' || variant === 'video'
}

function patchRequest(id: string, patch: Partial<RequestNodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

function readRequestSpec(nodeId: string): RequestNodeSpec | undefined {
  const stored = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === nodeId)
  return stored && stored.kind === 'request' ? stored : undefined
}

function patchVariantConfig(nodeId: string, variant: GenerationVariant, patch: Partial<GenerationConfig>): void {
  const stored = readRequestSpec(nodeId)
  if (!stored) return
  patchRequest(nodeId, { [variant]: { ...stored[variant], ...patch } })
}

function stopNodeGesture(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function closeMenu(target: EventTarget | null): void {
  if (target instanceof HTMLElement) target.closest('details')?.removeAttribute('open')
}

function closeOpenMenus(root: ParentNode | null, except?: HTMLDetailsElement | null): void {
  root?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
    if (menu !== except) menu.removeAttribute('open')
  })
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')
}

function mapTaskStatus(status: GenerationTaskState['status'] | 'cancelled'): GenerationTaskStatus {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'validating':
      return 'validating'
    case 'submitting':
    case 'queued':
      return 'queued'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'timeout':
    case 'unknown':
    default:
      return 'failed'
  }
}

function formatProgress(progress: number | undefined): string | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  const percent = progress > 0 && progress <= 1 ? progress * 100 : progress
  return `${Math.round(percent)}%`
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatResolutionLabel(value: string): string {
  return value.replace(/^(\d+)k$/i, '$1K')
}

function formatAspectRatioLabel(value: string): string {
  return value.toLowerCase() === 'auto' ? 'Auto' : value
}

function modelConfigUpdates(
  config: GenerationConfig | undefined,
  model: GenerationModel | undefined,
  variant: GenerationVariant,
): Partial<GenerationConfig> {
  if (!config || !model) return {}
  const updates: Partial<GenerationConfig> = {}
  if (model.resolutions?.length && (!config.resolution || !model.resolutions.includes(config.resolution))) {
    updates.resolution = model.resolutions[0]
  }
  if (model.aspectRatios?.length && (!config.aspectRatio || !model.aspectRatios.includes(config.aspectRatio))) {
    updates.aspectRatio = model.aspectRatios[0]
  }
  if (variant === 'image' && model.thinkingLevels?.length && (!config.thinkingLevel || !model.thinkingLevels.includes(config.thinkingLevel))) {
    updates.thinkingLevel = model.defaultThinkingLevel || model.thinkingLevels[0]
  }
  if (variant === 'video') {
    const currentSeconds = config.seconds || model.defaultDuration || model.allowedDurations?.[0] || model.minDuration || 5
    if (model.allowedDurations?.length && !model.allowedDurations.includes(currentSeconds)) {
      updates.seconds = model.defaultDuration || model.allowedDurations[0]
    } else if (model.minDuration && currentSeconds < model.minDuration) {
      updates.seconds = model.minDuration
    } else if (model.maxDuration && currentSeconds > model.maxDuration) {
      updates.seconds = model.maxDuration
    }
    if (model.capabilities.length && !model.capabilities.includes('generate-audio')) updates.generateAudio = false
  }
  return updates
}

function remoteTaskIdFromLegacy(legacy: GenerationTaskState): string | undefined {
  if (typeof legacy.taskId === 'string' && legacy.taskId) return legacy.taskId
  const child = legacy.children?.find((item) => typeof item.taskId === 'string' && item.taskId)
  return child?.taskId
}

function buildRequestSnapshot(
  variant: GenerationVariant,
  channel: GenerationChannel,
  model: GenerationModel,
  runConfig: GenerationVariantConfig,
  inputVersion: string,
): GenerationTaskRequestSnapshot {
  const adapterId = runConfig.adapterId || model.adapterId
  const adapter = adapterId ? channel.adapters?.find((item) => item.id === adapterId) : undefined
  const snapshot: GenerationTaskRequestSnapshot = {
    variant,
    inputVersion,
    channelId: channel.id,
    providerId: channel.providerId,
    baseURL: channel.baseURL,
    model: model.id,
    config: {
      ...runConfig,
      channelId: runConfig.channelId || channel.id,
      model: runConfig.model || model.id,
      ...(adapterId ? { adapterId } : {}),
      references: runConfig.references.map((reference) => ({ ...reference })),
    },
  }
  if (channel.presetId) snapshot.presetId = channel.presetId
  if (channel.presetVersion) snapshot.presetVersion = channel.presetVersion
  const protocol = adapter?.protocol || channel.protocol
  if (protocol) snapshot.protocol = protocol
  if (adapterId) snapshot.adapterId = adapterId
  if (channel.secretName) snapshot.secretName = channel.secretName
  const mediaTransport = adapter?.mediaTransport || channel.mediaTransport
  if (mediaTransport) snapshot.mediaTransport = mediaTransport
  const mediaUploadPath = adapter?.mediaUploadPath || channel.mediaUploadPath
  if (mediaUploadPath) snapshot.mediaUploadPath = mediaUploadPath
  const mediaUploadURL = adapter?.mediaUploadURL || channel.mediaUploadURL
  if (mediaUploadURL) snapshot.mediaUploadURL = mediaUploadURL
  if (channel.mediaUploadSecretName) snapshot.mediaUploadSecretName = channel.mediaUploadSecretName
  return snapshot
}

type GenerationTaskIdentity = Pick<
  GenerationTask,
  'requestNodeId' | 'variant' | 'channelId' | 'model' | 'inputVersion' | 'requestSnapshot' | 'remoteTaskId' | 'recovery'
>

function recoveryStateForTask(status: GenerationTaskStatus, remoteTaskId?: string): GenerationTaskRecoveryState {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return remoteTaskId ? 'submitted' : 'pending'
}

function recoveryMetadataForTask(
  identity: GenerationTaskIdentity,
  status: GenerationTaskStatus,
  previous?: GenerationTaskRecoveryMetadata,
  reason?: string,
): GenerationTaskRecoveryMetadata | undefined {
  const requestNodeId = identity.requestNodeId || previous?.requestNodeId
  const variant = identity.variant || previous?.variant || identity.requestSnapshot?.variant
  const channelId = identity.channelId || previous?.channelId || identity.requestSnapshot?.channelId
  const model = identity.model || previous?.model || identity.requestSnapshot?.model
  const inputVersion = identity.inputVersion || previous?.inputVersion || identity.requestSnapshot?.inputVersion
  if (!requestNodeId || !variant || !channelId || !model || !inputVersion) return previous
  return {
    requestNodeId,
    variant,
    channelId,
    model,
    inputVersion,
    state: recoveryStateForTask(status, identity.remoteTaskId),
    updatedAt: Date.now(),
    ...(reason ? { reason } : {}),
  }
}

function toDomainTask(
  taskId: string,
  legacy: GenerationTaskState,
  fallback: GenerationTaskIdentity,
  resultAssetIds?: string[],
): GenerationTask {
  const task: GenerationTask = {
    id: taskId,
    status: mapTaskStatus(legacy.status),
    progress: legacy.progress,
    channelId: legacy.channelId ?? fallback.channelId,
    model: legacy.model ?? fallback.model,
    resultAssetIds,
    error: legacy.error,
    submittedAt: legacy.submittedAt,
    completedAt: legacy.completedAt,
  }
  if (fallback.requestNodeId) task.requestNodeId = fallback.requestNodeId
  if (fallback.variant) task.variant = fallback.variant
  if (fallback.inputVersion) task.inputVersion = fallback.inputVersion
  const remoteTaskId = fallback.remoteTaskId ?? remoteTaskIdFromLegacy(legacy)
  if (remoteTaskId) task.remoteTaskId = remoteTaskId
  const requestSnapshot = fallback.requestSnapshot ?? legacy.requestSnapshot
  if (requestSnapshot) task.requestSnapshot = requestSnapshot
  const recovery = recoveryMetadataForTask(
    { ...fallback, remoteTaskId, requestSnapshot },
    task.status,
    fallback.recovery,
    legacy.error,
  )
  if (recovery) task.recovery = recovery
  return task
}

function currentChannelForSnapshot(
  channels: GenerationChannel[],
  snapshot: GenerationTaskRequestSnapshot,
): GenerationChannel | undefined {
  return channels.find((channel) => channel.id === snapshot.channelId)
}

function syncGenerationRunStatus(runId: string): void {
  const runtime = useRuntimeStore.getState()
  const run = runtime.runs[runId]
  if (!run) return
  const status = generationRunStatusFromTasks(run.tasks)
  if (status !== run.status) runtime.updateRun(runId, { status })
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
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center justify-between gap-3 px-2 py-1.5">
      <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap justify-end gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={option.value === value}
            aria-label={`${ariaLabel}：${option.label}`}
            title={option.label}
            className="shrink-0 rounded-full border border-transparent px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 data-[selected=true]:bg-foreground data-[selected=true]:text-background"
            data-selected={option.value === value}
            onPointerDown={stopNodeGesture}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function LocalReferencePreview({ reference, size = 'large' }: { reference: GenerationReference; size?: 'small' | 'large' }) {
  const [url, setUrl] = useState(reference.previewUrl || reference.url || '')
  const sizeClass = size === 'small' ? 'h-9 w-9 rounded-md' : 'h-14 w-14 rounded-lg'
  const assetId = reference.id.startsWith('asset-')
    ? reference.id
    : reference.resourceId?.startsWith('sha256-')
      ? `asset-${reference.resourceId.slice('sha256-'.length)}`
      : undefined

  useEffect(() => {
    let cancelled = false
    const fallback = reference.previewUrl || reference.url || ''
    setUrl(fallback)
    const id = assetId
    if (!id && !reference.resourceId) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const resolved = id ? await loadAssetUrl(id) : null
        if (cancelled) return
        if (resolved) {
          setUrl(resolved)
          return
        }
        if (id) await assetManager.getAsset(id)
        const retry = id ? await assetManager.resolveAssetUrl(id) : null
        if (!cancelled && retry) setUrl(retry)
      } catch {
        if (!cancelled) setUrl(fallback)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assetId, reference.previewUrl, reference.resourceId, reference.url])

  if (reference.type === 'audio') {
    return (
      <div className={`flex ${sizeClass} items-center justify-center bg-muted text-muted-foreground`} title={reference.label || TYPE_LABELS.audio}>
        <Mic className={size === 'small' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
      </div>
    )
  }
  if (!url) {
    return (
      <div className={`flex ${sizeClass} items-center justify-center bg-muted text-muted-foreground`} title={reference.label || TYPE_LABELS[reference.type]}>
        <Upload className={size === 'small' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
      </div>
    )
  }
  if (reference.type === 'video') {
    return <video src={url} muted playsInline preload="metadata" className={`${sizeClass} bg-black object-cover`} />
  }
  return <img src={url} alt={reference.label || TYPE_LABELS.image} className={`${sizeClass} bg-muted object-cover`} draggable={false} />
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
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!candidates.length) return null
  return (
    <div
      id="request-node-prompt-mentions"
      role="listbox"
      aria-label="插入参考素材"
      className="cnote-menu-surface absolute bottom-[calc(100%+8px)] left-2 right-2 z-50 max-h-[232px] overflow-auto"
      onPointerDown={stopNodeGesture}
    >
      <div className="px-2 pb-1 pt-1 text-[10px] text-muted-foreground">选择参考素材</div>
      {candidates.map((reference, index) => {
        const TypeIcon = TYPE_ICONS[reference.type]
        const token = getPromptMentionToken(reference, references, promptMentions)
        return (
          <button
            key={reference.id}
            ref={(element) => {
              optionRefs.current[index] = element
            }}
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
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <TypeIcon className="h-3 w-3" aria-hidden />
              {token}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export const RequestContent = memo(function RequestContent({ node }: { node: RequestNodeSpec }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const draggedReferenceIdRef = useRef<string | null>(null)
  const runningRef = useRef(false)
  const promptDirtyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const unmountParkRef = useRef(false)
  const activeRunIdRef = useRef<string | null>(null)

  const channels = useGenerationStore((state) => state.channels)
  const getModels = useGenerationStore((state) => state.getModels)
  const documentNodes = useGraphStore((state) => state.currentDocument?.nodes)
  const documentEdges = useGraphStore((state) => state.currentDocument?.edges)
  const assets = useRuntimeStore((state) => state.assets)
  const runs = useRuntimeStore((state) => state.runs)

  const generationVariant = isGenerationVariant(node.variant) ? node.variant : null
  const variantConfig = generationVariant ? node[generationVariant] : null

  const [prompt, setPrompt] = useState(variantConfig?.prompt ?? '')
  const [isRunning, setIsRunning] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  activeRunIdRef.current = activeRunId
  const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null)
  const [mentionContext, setMentionContext] = useState<PromptMentionContext | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [completedCount, setCompletedCount] = useState(0)

  const run = useRuntimeStore((state) => {
    const runId = activeRunId || node.latestRunId
    return runId ? state.runs[runId] : undefined
  })
  const activeTask = run?.tasks[0]

  const upstreamNodes = useMemo(
    () => collectUpstreamNodes(node.id, documentNodes, documentEdges),
    [documentEdges, documentNodes, node.id],
  )
  const upstreamText = useMemo(() => collectUpstreamText(upstreamNodes), [upstreamNodes])
  const localReferences = useMemo(
    () => (generationVariant ? localReferencesFromAssetIds(generationVariant, variantConfig?.referenceAssetIds, assets) : []),
    [assets, generationVariant, variantConfig?.referenceAssetIds],
  )
  const upstreamReferences = useMemo(
    () => (generationVariant ? collectUpstreamReferences(generationVariant, upstreamNodes, documentNodes || [], assets, runs) : []),
    [assets, documentNodes, generationVariant, runs, upstreamNodes],
  )
  const orderedReferences = useMemo(
    () => mergeGenerationReferences(localReferences, upstreamReferences, variantConfig?.referenceOverrides),
    [localReferences, upstreamReferences, variantConfig?.referenceOverrides],
  )
  const videoMode = resolveVideoMode(variantConfig?.capability, orderedReferences)
  const effectiveCapability = generationVariant === 'image'
    ? imageCapabilityForReferences(orderedReferences)
    : videoMode

  const modelGroups = useMemo<ModelGroup[]>(() => {
    if (!generationVariant) return []
    return channels
      .filter((channel) => channel.enabled && generationChannelSupportsVariant(channel, generationVariant))
      .map((channel) => {
        const channelModels = getModels(channel.id)
        const visibleModels = generationChannelUsesModelInference(channel)
          ? channelModels.filter((model) => {
            if (!model.capabilities.length) return true
            if (generationVariant !== 'video') return model.capabilities.includes(effectiveCapability)
            if (model.capabilitySource === 'inferred' && !model.capabilities.includes('text-to-video')) return false
            return videoModesForModel(model).includes(videoMode)
          })
          : channelModels
        return { channel, models: visibleModels }
      })
      .filter((group) => group.models.length > 0)
  }, [channels, effectiveCapability, generationVariant, getModels, videoMode])

  const selectedGroup = useMemo(() => {
    if (!generationVariant || !variantConfig) return modelGroups[0]
    const storedChannel = variantConfig.channelId
      ? channels.find((channel) => channel.id === variantConfig.channelId)
      : undefined
    if (storedChannel) {
      const storedModels = getModels(storedChannel.id)
      if (storedModels.length) return { channel: storedChannel, models: storedModels }
    }
    return (
      modelGroups.find(
        (group) =>
          group.channel.id === variantConfig.channelId &&
          group.models.some((model) => model.id === variantConfig.model),
      ) ??
      modelGroups.find((group) => group.channel.id === variantConfig.channelId) ??
      modelGroups[0]
    )
  }, [channels, generationVariant, getModels, modelGroups, variantConfig])

  const selectedChannel = selectedGroup?.channel
  const selectedModel =
    selectedGroup && variantConfig
      ? selectedGroup.models.find((model) => model.id === variantConfig.model) ?? selectedGroup.models[0]
      : selectedGroup?.models[0]
  const selectedChannelId = selectedChannel?.id
  const selectedModelId = selectedModel?.id
  const videoModes = useMemo(() => videoModesForModel(selectedModel), [selectedModel])
  const resolvedLegacy = useMemo(() => {
    if (!generationVariant || !variantConfig) return undefined
    const legacy = toLegacyVariantConfig(generationVariant, variantConfig, orderedReferences, prompt)
    return generationVariant === 'video' ? normalizeVideoModeConfig(legacy, selectedModel) : legacy
  }, [generationVariant, orderedReferences, prompt, selectedModel, variantConfig])
  const referenceError = generationVariant === 'video' && selectedModel && resolvedLegacy
    ? videoReferenceError(selectedModel, resolvedLegacy)
    : undefined
  const mentionCandidates = useMemo(
    () => filterPromptMentionReferences(orderedReferences, mentionContext?.query || '', variantConfig?.promptMentions),
    [mentionContext?.query, orderedReferences, variantConfig?.promptMentions],
  )

  const canRun =
    Boolean(generationVariant) &&
    Boolean(selectedChannel?.enabled) &&
    Boolean(selectedChannel && generationVariant && generationChannelSupportsVariant(selectedChannel, generationVariant)) &&
    Boolean(selectedModel) &&
    Boolean(prompt.trim() || orderedReferences.length || upstreamText.trim()) &&
    !referenceError &&
    !isRunning &&
    !node.disabled

  useEffect(() => {
    setPrompt(variantConfig?.prompt ?? '')
    promptDirtyRef.current = false
  }, [node.id, node.variant, variantConfig?.prompt])

  useEffect(() => {
    const ids = variantConfig?.referenceAssetIds || []
    ids.forEach((assetId) => {
      void assetManager.getAsset(assetId).catch(() => undefined)
    })
  }, [variantConfig?.referenceAssetIds])

  useEffect(() => {
    if (!generationVariant || !selectedChannelId || !selectedModelId) return
    const stored = readRequestSpec(node.id)
    if (!stored) return
    const current = stored[generationVariant]
    if (current.channelId || current.model) return
    patchVariantConfig(node.id, generationVariant, {
      channelId: selectedChannelId,
      model: selectedModelId,
      adapterId: selectedModel?.adapterId,
      ...modelConfigUpdates(current, selectedModel, generationVariant),
    })
  }, [generationVariant, node.id, selectedChannelId, selectedModel, selectedModelId])

  useEffect(() => {
    if (generationVariant !== 'image' || !variantConfig || variantConfig.capability === effectiveCapability) return
    patchVariantConfig(node.id, 'image', { capability: effectiveCapability })
  }, [effectiveCapability, generationVariant, node.id, variantConfig])

  useEffect(() => {
    if (generationVariant !== 'video' || !variantConfig?.promptMentions) return
    const pendingAssetIds = pendingLocalReferenceAssetIds(variantConfig.referenceAssetIds, assets)
    const stale = stalePromptMentionEntries(variantConfig.promptMentions, variantConfig.prompt, {
      referenceAssetIds: variantConfig.referenceAssetIds,
      orderedReferenceIds: orderedReferences.map((reference) => reference.id),
      pendingAssetIds,
    })
    if (!stale.length) return
    const nextPrompt = stale.reduce((value, [, token]) => removePromptMention(value, token, '[已移除素材]'), variantConfig.prompt)
    const promptMentions = { ...variantConfig.promptMentions }
    stale.forEach(([referenceId]) => {
      delete promptMentions[referenceId]
    })
    patchVariantConfig(node.id, 'video', { prompt: nextPrompt, promptMentions })
    setPrompt(nextPrompt)
  }, [assets, generationVariant, node.id, orderedReferences, variantConfig])

  useEffect(() => {
    return () => {
      const runId = activeRunIdRef.current
      const current = runId ? useRuntimeStore.getState().runs[runId] : undefined
      if (current && (current.status === 'running' || current.status === 'queued' || current.status === 'validating')) {
        unmountParkRef.current = true
        useRuntimeStore.getState().putRun(parkGenerationRunForResume(current))
        void flushRuntimePersistence()
      }
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isRunning) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      const target = event.target instanceof Element ? event.target : null
      const activeMenu = target?.closest('details') as HTMLDetailsElement | null
      closeOpenMenus(root, activeMenu && root.contains(activeMenu) ? activeMenu : null)
      if (target !== promptRef.current && !mentionMenuRef.current?.contains(target)) setMentionContext(null)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeOpenMenus(rootRef.current)
    }
    document.addEventListener('pointerdown', closeFromOutside, true)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [])

  useEffect(() => {
    if (!rootRef.current) return
    return bindNodeMenus(rootRef.current, () => {
      const insets = canvasOverlayInsets(useUiStore.getState())
      return { zoom: useGraphStore.getState().view.zoom, leftInset: insets.left, rightInset: insets.right }
    })
  }, [])

  const chooseVariant = useCallback(
    (next: RequestVariant) => {
      if (node.variant !== 'body' || next === 'body' || isRunning) return
      patchRequest(node.id, { variant: next, label: !node.label || node.label === '请求体' ? (next === 'image' ? '图片生成' : '视频生成') : node.label })
      useGraphStore.getState().commitHistory()
    },
    [isRunning, node.id, node.label, node.variant],
  )

  const updateVariant = useCallback(
    (patch: Partial<GenerationConfig>) => {
      if (!generationVariant) return
      patchVariantConfig(node.id, generationVariant, patch)
    },
    [generationVariant, node.id],
  )

  const chooseModel = useCallback(
    (channelId: string, model: GenerationModel) => {
      if (!generationVariant) return
      const stored = readRequestSpec(node.id)
      const current = stored?.[generationVariant]
      const nextVideoMode = generationVariant === 'video'
        ? (!current?.capability ? undefined : videoModesForModel(model).includes(videoMode) ? videoMode : videoModesForModel(model)[0])
        : effectiveCapability
      updateVariant({
        channelId,
        model: model.id,
        adapterId: model.adapterId,
        capability: nextVideoMode,
        ...modelConfigUpdates(current, model, generationVariant),
      })
    },
    [effectiveCapability, generationVariant, node.id, updateVariant, videoMode],
  )

  const persistPrompt = useCallback(() => {
    if (!generationVariant || !promptDirtyRef.current) return
    promptDirtyRef.current = false
    useGraphStore.getState().commitHistory()
  }, [generationVariant])

  const persistReferences = useCallback(
    (nextReferences: GenerationReference[], extra: Partial<GenerationConfig> = {}) => {
      if (!generationVariant) return
      const stored = readRequestSpec(node.id)
      if (!stored) return
      const normalized = nextReferences.map((reference, order) => ({ ...reference, order }))
      const referenceOverrides: Record<string, GenerationReferenceOverride> = { ...(stored[generationVariant].referenceOverrides || {}) }
      for (const reference of normalized) {
        referenceOverrides[reference.id] = { ...referenceOverrides[reference.id], role: reference.role, order: reference.order }
      }
      updateVariant({
        referenceAssetIds: ownedReferenceAssetIds(normalized),
        referenceOverrides,
        ...extra,
      })
      useGraphStore.getState().commitHistory()
    },
    [generationVariant, node.id, updateVariant],
  )

  const applyLegacyTask = useCallback(
    (
      runId: string,
      taskId: string,
      legacy: GenerationTaskState,
      fallback: GenerationTaskIdentity,
    ) => {
      const resultAssetIds = resultAssetIdsFromResourceIds(legacy.resultResourceIds)
      resultAssetIds.forEach((assetId) => {
        void assetManager.getAsset(assetId).catch(() => undefined)
      })
      const existing = useRuntimeStore.getState().runs[runId]?.tasks.find((task) => task.id === taskId)
      const effectiveFallback: GenerationTaskIdentity = {
        requestNodeId: existing?.requestNodeId ?? fallback.requestNodeId,
        variant: existing?.variant ?? fallback.variant,
        channelId: existing?.channelId ?? fallback.channelId,
        model: existing?.model ?? fallback.model,
        inputVersion: existing?.inputVersion ?? fallback.inputVersion,
        remoteTaskId: existing?.remoteTaskId ?? fallback.remoteTaskId,
        requestSnapshot: existing?.requestSnapshot ?? fallback.requestSnapshot,
        recovery: existing?.recovery ?? fallback.recovery,
      }
      const mapped = toDomainTask(
        taskId,
        legacy,
        effectiveFallback,
        resultAssetIds,
      )
      if (existing?.submittedAt) mapped.submittedAt = existing.submittedAt
      useRuntimeStore.getState().updateTask(runId, taskId, mapped)
      syncGenerationRunStatus(runId)
    },
    [],
  )

  const beginLocalRun = useCallback((runId: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    runningRef.current = true
    setIsRunning(true)
    setNow(Date.now())
    setRequestError(null)
    setCompletedCount(0)
    setActiveRunId(runId)
    return controller
  }, [])

  const endLocalRun = useCallback((controller: AbortController) => {
    if (abortRef.current === controller) abortRef.current = null
    runningRef.current = false
    setIsRunning(false)
  }, [])

  const markRunCancelled = useCallback((runId: string) => {
    const runtime = useRuntimeStore.getState()
    const run = runtime.runs[runId]
    if (!run) return
    const completedAt = Date.now()
    run.tasks.forEach((task) => {
      if (task.status === 'completed' || task.status === 'cancelled') return
      const recovery = recoveryMetadataForTask(task, 'cancelled', task.recovery, '用户取消生成')
      runtime.updateTask(runId, task.id, {
        status: 'cancelled',
        completedAt,
        ...(recovery ? { recovery } : {}),
      })
    })
    runtime.updateRun(runId, { status: 'cancelled' })
  }, [])

  const markRunFailed = useCallback((runId: string, message: string) => {
    setRequestError(message)
    const runtime = useRuntimeStore.getState()
    const run = runtime.runs[runId]
    if (!run) return
    const completedAt = Date.now()
    run.tasks.forEach((task) => {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') return
      const recovery = recoveryMetadataForTask(task, 'failed', task.recovery, message)
      runtime.updateTask(runId, task.id, {
        status: 'failed',
        error: message,
        completedAt,
        ...(recovery ? { recovery } : {}),
      })
    })
    runtime.updateRun(runId, { status: 'failed' })
  }, [])

  const materializeGenerationResults = useCallback(
    async (options: {
      documentId: string
      runId: string
      taskId: string
      variant: GenerationVariant
      channel: GenerationChannel
      model: GenerationModel
      requestSnapshot: GenerationTaskRequestSnapshot
      finalTask: GenerationTaskState
      signal: AbortSignal
    }) => {
      const writeAllowed = () => Boolean(isWritableGenerationTarget({
        documentId: options.documentId,
        requestNodeId: node.id,
        variant: options.variant,
        runId: options.runId,
      }))
      if (options.signal.aborted || !writeAllowed()) return
      const resultAssetIds = resultAssetIdsFromResourceIds(options.finalTask.resultResourceIds)
      const results = await Promise.all(
        Array.from({ length: Math.max(resultAssetIds.length, options.finalTask.resultUrls?.length || 0) }, async (_, index) => {
          const assetId = resultAssetIds[index]
          if (assetId) {
            try {
              await assetManager.getAsset(assetId)
            } catch {
              // Preview/meta load is best-effort; persist still uses the resource id.
            }
          }
          return {
            assetId,
            url: options.finalTask.resultUrls?.[index],
            mimeType: options.finalTask.resultMimeTypes?.[index] || (options.variant === 'image' ? 'image/png' : 'video/mp4'),
            fileName: options.finalTask.resultFileNames?.[index],
          }
        }),
      )
      if (options.signal.aborted || !writeAllowed()) return
      const created = upsertGenerationResultNodes({
        requestNodeId: node.id,
        variant: options.variant,
        results,
        documentId: options.documentId,
        runId: options.runId,
        taskId: remoteTaskIdFromLegacy(options.finalTask) ?? options.taskId,
        channelId: options.channel.id,
        providerId: options.channel.providerId,
        model: options.model.id,
        createdAt: options.finalTask.completedAt ?? Date.now(),
        ...generationInputProvenanceIds(options.requestSnapshot.config.references),
      })
      setCompletedCount(created.length || results.length)
      if (!created.length && results.length) {
        setRequestError('生成完成，但结果无法落成内容节点（缺少可持久化资源）')
      }
    },
    [node.id],
  )

  const applyFinalGenerationTask = useCallback((runId: string, finalTask: GenerationTaskState) => {
    syncGenerationRunStatus(runId)
    const mapped = mapTaskStatus(finalTask.status === 'idle' ? 'cancelled' : finalTask.status)
    if (finalTask.status === 'failed' || finalTask.status === 'timeout' || finalTask.status === 'unknown') {
      setRequestError(finalTask.error?.trim() || (finalTask.status === 'timeout' ? '任务已超时' : '生成失败，请稍后重试'))
    }
    return mapped
  }, [])

  const runGeneration = useCallback(async () => {
    if (runningRef.current || node.disabled) return
    const documentId = useGraphStore.getState().currentDocumentId
    const stored = readRequestSpec(node.id)
    if (!documentId || !stored || !isGenerationVariant(stored.variant)) return

    const variant = stored.variant
    const spec = stored[variant]
    const channel = spec.channelId ? channels.find((item) => item.id === spec.channelId) : undefined
    const model = channel ? getModels(channel.id).find((item) => item.id === spec.model) : undefined

    if (!channel || !channel.enabled || !generationChannelSupportsVariant(channel, variant) || !model) {
      setRequestError('请先选择生成渠道和模型')
      return
    }

    const liveDoc = useGraphStore.getState().currentDocument
    const liveAssets = useRuntimeStore.getState().assets
    const liveRuns = useRuntimeStore.getState().runs
    const resolved = liveDoc
      ? resolveRequestGenerationInputs({
        requestNodeId: node.id,
        variant,
        config: spec,
        nodes: liveDoc.nodes,
        edges: liveDoc.edges,
        assets: liveAssets,
        runs: liveRuns,
      })
      : undefined
    if (!resolved) {
      setRequestError('请填写提示词，或连接上游文本/媒体素材')
      return
    }
    let runConfig: GenerationVariantConfig = toLegacyVariantConfig(variant, spec, resolved.references, resolved.prompt)
    if (variant === 'video') runConfig = normalizeVideoModeConfig(runConfig, model)
    const liveReferenceError = variant === 'video' ? videoReferenceError(model, runConfig) : undefined

    if (liveReferenceError) {
      setRequestError(liveReferenceError)
      return
    }
    if (!runConfig.prompt.trim() && !runConfig.references.length) {
      setRequestError('请填写提示词，或连接上游文本/媒体素材')
      return
    }

    const runId = nanoid()
    const submittedAt = Date.now()
    const timeoutMs = variant === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS
    const inputVersion = `${node.id}:${runId}:v1`
    const requestSnapshot = buildRequestSnapshot(variant, channel, model, runConfig, inputVersion)
    const count = requestedGenerationCount(variant, runConfig.outputCount)
    const initialTasks: GenerationTask[] = Array.from({ length: count }, () => ({
      id: nanoid(),
      status: 'validating',
      channelId: channel.id,
      model: model.id,
      submittedAt,
      requestNodeId: node.id,
      variant,
      inputVersion,
      requestSnapshot,
      recovery: {
        requestNodeId: node.id,
        variant,
        channelId: channel.id,
        model: model.id,
        inputVersion,
        state: 'pending',
        updatedAt: submittedAt,
      },
    }))
    const initialRun: GenerationRun = {
      id: runId,
      status: 'running',
      tasks: initialTasks,
      createdAt: submittedAt,
      requestNodeId: node.id,
      variant,
    }

    const controller = beginLocalRun(runId)
    useRuntimeStore.getState().putRun(initialRun)
    patchRequest(node.id, { latestRunId: runId })
    try {
      await flushRuntimePersistence()
    } catch (error) {
      markRunFailed(runId, `无法保存生成任务，未提交远端：${errorText(error, '运行时状态持久化失败')}`)
      endLocalRun(controller)
      return
    }
    if (controller.signal.aborted) {
      if (!unmountParkRef.current) markRunCancelled(runId)
      endLocalRun(controller)
      return
    }

    const writeAllowed = () => Boolean(isWritableGenerationTarget({
      documentId,
      requestNodeId: node.id,
      variant,
      runId,
    }))
    const identity: GenerationTaskIdentity = {
      requestNodeId: node.id,
      variant,
      channelId: channel.id,
      model: model.id,
      inputVersion,
      requestSnapshot,
    }
    const persistRemoteTaskId = async (taskId: string, remoteTaskId: string | undefined) => {
      if (!remoteTaskId) return
      const runtime = useRuntimeStore.getState()
      const existing = runtime.runs[runId]?.tasks.find((task) => task.id === taskId)
      if (!existing || existing.remoteTaskId) return
      const recovery = recoveryMetadataForTask(
        {
          ...identity,
          ...existing,
          remoteTaskId,
          requestSnapshot: existing.requestSnapshot || requestSnapshot,
        },
        existing.status,
        existing.recovery,
      )
      runtime.updateTask(runId, taskId, {
        remoteTaskId,
        ...(recovery ? { recovery } : {}),
      })
      await flushRuntimePersistence()
    }

    try {
      const finalTask = await runGenerationBatch({
        count,
        submittedAt,
        onTaskUpdate: () => undefined,
        run: async (index, update) => {
          const domainTask = initialTasks[index]
          const context: GenerationRequestContext = {
            channel,
            model,
            config: { ...runConfig, outputCount: 1 },
            variant,
          }
          return runGenerationTask(context, {
            timeoutMs,
            signal: controller.signal,
            onTaskUpdate: (legacy) => {
              update(legacy)
              if (controller.signal.aborted) return
              if (!writeAllowed()) return
              applyLegacyTask(runId, domainTask.id, legacy, identity)
            },
            onRemoteTaskId: (remoteTaskId) => persistRemoteTaskId(domainTask.id, remoteTaskId),
          })
        },
      })

      if (controller.signal.aborted) {
        if (!unmountParkRef.current) markRunCancelled(runId)
        return
      }

      const childStates = finalTask.children?.length ? finalTask.children : [finalTask]
      childStates.forEach((child, index) => {
        const domainTask = initialTasks[index]
        if (domainTask) applyLegacyTask(runId, domainTask.id, child, identity)
      })
      applyFinalGenerationTask(runId, finalTask)
      if (finalTask.status !== 'completed') return
      if (!writeAllowed()) return
      await materializeGenerationResults({
        documentId,
        runId,
        taskId: initialTasks[0]?.id || runId,
        variant,
        channel,
        model,
        requestSnapshot,
        finalTask,
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        if (!unmountParkRef.current) markRunCancelled(runId)
      } else markRunFailed(runId, errorText(error, '生成失败，请稍后重试'))
    } finally {
      endLocalRun(controller)
    }
  }, [applyFinalGenerationTask, applyLegacyTask, beginLocalRun, channels, endLocalRun, getModels, markRunCancelled, markRunFailed, materializeGenerationResults, node.disabled, node.id])

  const resumeWaitingGeneration = useCallback(async () => {
    if (runningRef.current) return
    const documentId = useGraphStore.getState().currentDocumentId
    const currentRun = findWaitingGenerationRun(node.id, activeRunId || readRequestSpec(node.id)?.latestRunId)
    if (!documentId || !currentRun || currentRun.status !== 'waiting-for-user') return

    const domainTasks = currentRun.tasks
    const sharedSnapshot = domainTasks.find((task) => task.requestSnapshot)?.requestSnapshot
    const resumable = domainTasks.filter((task) => isGenerationTaskResumable(task))
    if (!resumable.length) {
      setRequestError('缺少远程任务或请求快照，无法继续查询')
      const runtime = useRuntimeStore.getState()
      domainTasks.forEach((task) => {
        const message = generationTaskResumeBlockReason(task)
        if (message) runtime.updateTask(currentRun.id, task.id, { error: message })
      })
      return
    }

    const snapshot = resumable[0].requestSnapshot || sharedSnapshot
    if (!snapshot) {
      setRequestError('缺少请求快照，无法继续查询')
      return
    }

    const currentChannel = currentChannelForSnapshot(channels, snapshot)
    const currentModel = currentChannel ? getModels(currentChannel.id).find((item) => item.id === snapshot.model) : undefined
    const variant = snapshot.variant
    const timeoutMs = variant === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS
    const submittedAt = Date.now()
    const controller = beginLocalRun(currentRun.id)
    useRuntimeStore.getState().updateRun(currentRun.id, {
      status: 'running',
      tasks: domainTasks.map((task) => {
        if (!isGenerationTaskResumable(task)) return task
        const recovery = recoveryMetadataForTask(task, 'running', task.recovery)
        return {
          ...task,
          status: 'running',
          ...(recovery ? { recovery: { ...recovery, state: 'resuming', updatedAt: Date.now() } } : {}),
        }
      }),
    })

    try {
      const finalTask = await runGenerationBatch({
        count: domainTasks.length,
        submittedAt,
        elapsedOffset: 0,
        initialTasks: domainTasks.map((task) => ({
          status: task.status === 'completed' ? 'completed' : 'in_progress',
          taskId: task.remoteTaskId,
          requestSnapshot: task.requestSnapshot,
        })),
        onTaskUpdate: () => undefined,
        run: async (index, update) => {
          const domainTask = domainTasks[index]
          const taskSnapshot = domainTask.requestSnapshot || sharedSnapshot
          const remoteTaskId = domainTask.remoteTaskId
          const blockReason = generationTaskResumeBlockReason(domainTask)
          if (blockReason || !taskSnapshot || !remoteTaskId) {
            const failed = {
              status: 'failed' as const,
              error: blockReason || '缺少远程任务或请求快照，无法继续查询',
              taskId: remoteTaskId,
              requestSnapshot: taskSnapshot,
            }
            update(failed)
            applyLegacyTask(currentRun.id, domainTask.id, failed, {
              requestNodeId: currentRun.requestNodeId,
              variant,
              channelId: taskSnapshot?.channelId,
              model: taskSnapshot?.model,
              inputVersion: taskSnapshot?.inputVersion,
              remoteTaskId,
              requestSnapshot: taskSnapshot,
              recovery: domainTask.recovery,
            })
            return failed
          }
          const context = generationRequestContextFromSnapshot(taskSnapshot, {
            channel: currentChannelForSnapshot(channels, taskSnapshot) || currentChannel,
            model: currentModel,
          })
          const identity = {
            requestNodeId: currentRun.requestNodeId,
            variant,
            channelId: taskSnapshot.channelId,
            model: taskSnapshot.model,
            inputVersion: taskSnapshot.inputVersion,
            remoteTaskId,
            requestSnapshot: taskSnapshot,
            recovery: domainTask.recovery,
          }
          return runGenerationTask(context, {
            taskId: remoteTaskId,
            submittedAt,
            timeoutMs,
            signal: controller.signal,
            onTaskUpdate: (legacy) => {
              update(legacy)
              if (controller.signal.aborted) return
              applyLegacyTask(currentRun.id, domainTask.id, legacy, identity)
            },
          })
        },
      })

      if (controller.signal.aborted) {
        if (!unmountParkRef.current) markRunCancelled(currentRun.id)
        return
      }

      const childStates = finalTask.children?.length ? finalTask.children : [finalTask]
      childStates.forEach((child, index) => {
        const domainTask = domainTasks[index]
        if (!domainTask || domainTask.status === 'completed') return
        const taskSnapshot = domainTask.requestSnapshot || sharedSnapshot
        applyLegacyTask(currentRun.id, domainTask.id, child, {
          requestNodeId: currentRun.requestNodeId,
          variant,
          channelId: taskSnapshot?.channelId,
          model: taskSnapshot?.model,
          inputVersion: taskSnapshot?.inputVersion,
          remoteTaskId: domainTask.remoteTaskId,
          requestSnapshot: taskSnapshot,
          recovery: domainTask.recovery,
        })
      })
      applyFinalGenerationTask(currentRun.id, finalTask)
      if (finalTask.status !== 'completed') return
      const resumeContext = generationRequestContextFromSnapshot(snapshot, { channel: currentChannel, model: currentModel })
      await materializeGenerationResults({
        documentId,
        runId: currentRun.id,
        taskId: resumable[0].id,
        variant,
        channel: resumeContext.channel,
        model: resumeContext.model,
        requestSnapshot: snapshot,
        finalTask,
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        if (!unmountParkRef.current) markRunCancelled(currentRun.id)
      } else markRunFailed(currentRun.id, errorText(error, '继续查询失败，请稍后重试'))
    } finally {
      endLocalRun(controller)
    }
  }, [activeRunId, applyFinalGenerationTask, applyLegacyTask, beginLocalRun, channels, endLocalRun, getModels, markRunCancelled, markRunFailed, materializeGenerationResults, node.id])

  useEffect(() => {
    const onResume = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; requestNodeId?: string }>).detail
      if (detail?.requestNodeId && detail.requestNodeId !== node.id) return
      const waiting = findWaitingGenerationRun(node.id, activeRunId || readRequestSpec(node.id)?.latestRunId)
      if (detail?.runId && waiting && detail.runId !== waiting.id) return
      void resumeWaitingGeneration()
    }
    window.addEventListener(RESUME_GENERATION_EVENT, onResume)
    return () => window.removeEventListener(RESUME_GENERATION_EVENT, onResume)
  }, [activeRunId, node.id, resumeWaitingGeneration])

  const abandonWaitingGeneration = useCallback(() => {
    if (runningRef.current) return
    const currentRun = findWaitingGenerationRun(node.id, activeRunId || readRequestSpec(node.id)?.latestRunId)
    if (!currentRun || currentRun.status !== 'waiting-for-user') return
    const completedAt = Date.now()
    const runtime = useRuntimeStore.getState()
    currentRun.tasks.forEach((task) => {
      if (task.status === 'completed') return
      const recovery = recoveryMetadataForTask(task, 'cancelled', task.recovery, '用户放弃恢复')
      runtime.updateTask(currentRun.id, task.id, {
        status: 'cancelled',
        completedAt,
        ...(recovery ? { recovery } : {}),
      })
    })
    runtime.updateRun(currentRun.id, { status: 'cancelled' })
    setRequestError(null)
  }, [activeRunId, node.id])

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const updateMentionContext = useCallback((value: string, caret: number) => {
    const nextContext = getPromptMentionContext(value, caret)
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
    if (!mentionContext || !generationVariant) return
    const token = getPromptMentionToken(reference, orderedReferences, variantConfig?.promptMentions)
    const nextPrompt = replacePromptMention(prompt, mentionContext, token)
    const promptMentions = { ...(variantConfig?.promptMentions || {}), [reference.id]: token }
    const nextCaret = mentionContext.start + token.length
    const withSpace = `${nextPrompt.slice(0, nextCaret)} ${nextPrompt.slice(nextCaret)}`
    setPrompt(withSpace)
    promptDirtyRef.current = true
    updateVariant({ prompt: withSpace, promptMentions })
    setMentionContext(null)
    setMentionSelectedIndex(0)
    requestAnimationFrame(() => {
      const textarea = promptRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(nextCaret + 1, nextCaret + 1)
    })
  }, [generationVariant, mentionContext, orderedReferences, prompt, updateVariant, variantConfig?.promptMentions])

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const handlePromptCaretChange = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent
    if (event.type === 'keyup' && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(nativeEvent.key)) return
    if (generationVariant !== 'video') {
      setMentionContext(null)
      return
    }
    const textarea = event.currentTarget
    updateMentionContext(textarea.value, textarea.selectionStart ?? textarea.value.length)
  }

  const moveReference = (referenceId: string, targetId: string, insertAfter = false) => {
    if (referenceId === targetId) return
    const source = orderedReferences.find((reference) => reference.id === referenceId)
    const target = orderedReferences.find((reference) => reference.id === targetId)
    if (!source || !target || source.type !== target.type) return
    const next = [...orderedReferences]
    const sourceIndex = next.findIndex((reference) => reference.id === referenceId)
    let targetIndex = next.findIndex((reference) => reference.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = next.splice(sourceIndex, 1)
    if (sourceIndex < targetIndex) targetIndex -= 1
    if (insertAfter) targetIndex += 1
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, moved)
    persistReferences(next)
  }

  const handleFile = async (file: File, type: GenerationReference['type'], role?: GenerationReference['role']) => {
    if (!generationVariant) return
    const documentId = useGraphStore.getState().currentDocumentId
    const variant = generationVariant
    if (!documentId) return
    if (type === 'audio' && !/^(audio\/(mpeg|wav|x-wav|wave))$/i.test(file.type)) {
      setRequestError('参考音频仅支持 MP3 或 WAV')
      return
    }
    let importedId: string | undefined
    try {
      const asset = await assetManager.importAsset(file, file.name)
      importedId = asset.id
      const target = isWritableGenerationTarget({ documentId, requestNodeId: node.id, variant })
      if (!target) {
        await assetManager.releaseAsset(asset.id)
        return
      }
      const liveAssets = useRuntimeStore.getState().assets
      const live = resolveRequestGenerationInputs({
        requestNodeId: node.id,
        variant,
        config: target.request[variant],
        nodes: target.document.nodes,
        edges: target.document.edges,
        assets: liveAssets,
        runs: useRuntimeStore.getState().runs,
      })
      const duplicate = live.references.some((reference) => (
        reference.resourceId === `sha256-${asset.hash}` || reference.id === asset.id
      ))
      if (duplicate) {
        await assetManager.releaseAsset(asset.id)
        return
      }
      persistReferences([
        ...live.references,
        {
          id: asset.id,
          type,
          role: role || defaultReferenceRole(type, variant),
          label: file.name,
          source: 'local',
          resourceId: `sha256-${asset.hash}`,
          fileName: file.name,
          mimeType: asset.mimeType || file.type,
          size: asset.size,
          order: live.references.length,
          status: 'ready',
        },
      ])
    } catch (error) {
      if (importedId) {
        try {
          await assetManager.releaseAsset(importedId)
        } catch {
          // Keep the original import error.
        }
      }
      setRequestError(errorText(error, '导入参考素材失败'))
    }
  }

  const setImageFrameRole = (reference: GenerationReference, role: 'first_frame' | 'last_frame') => {
    persistReferences(orderedReferences.map((item) => {
      if (item.id === reference.id) return { ...item, role }
      if (item.role === role) return { ...item, role: reference.role }
      return item
    }))
  }

  const removeReference = async (reference: GenerationReference) => {
    if (!generationVariant) return
    const documentId = useGraphStore.getState().currentDocumentId
    const variant = generationVariant
    if (!documentId) return
    const token = getPromptMentionToken(reference, orderedReferences, variantConfig?.promptMentions)
    const nextPrompt = prompt ? removePromptMention(prompt, token, `[已移除${TYPE_LABELS[reference.type]}]`) : prompt
    const promptMentions = { ...(variantConfig?.promptMentions || {}) }
    delete promptMentions[reference.id]
    setPrompt(nextPrompt)
    promptDirtyRef.current = true
    if (reference.upstreamNodeId) {
      const stored = readRequestSpec(node.id)
      if (!stored || stored.variant !== variant) return
      updateVariant({
        prompt: nextPrompt,
        promptMentions,
        referenceOverrides: {
          ...stored[variant].referenceOverrides,
          [reference.id]: { ...stored[variant].referenceOverrides?.[reference.id], excluded: true },
        },
      })
      useGraphStore.getState().commitHistory()
      return
    }
    try {
      if (reference.id.startsWith('asset-')) await assetManager.releaseAsset(reference.id)
      const target = isWritableGenerationTarget({ documentId, requestNodeId: node.id, variant })
      if (!target) return
      const liveAssets = useRuntimeStore.getState().assets
      const live = resolveRequestGenerationInputs({
        requestNodeId: node.id,
        variant,
        config: target.request[variant],
        nodes: target.document.nodes,
        edges: target.document.edges,
        assets: liveAssets,
        runs: useRuntimeStore.getState().runs,
      })
      persistReferences(live.references.filter((item) => item.id !== reference.id), { prompt: nextPrompt, promptMentions })
    } catch (error) {
      setRequestError(errorText(error, '删除参考素材失败'))
    }
  }

  const restoreExcluded = () => {
    const next = Object.fromEntries(
      Object.entries(variantConfig?.referenceOverrides || {}).map(([key, override]) => [key, { ...override, excluded: false }]),
    )
    updateVariant({ referenceOverrides: next })
    useGraphStore.getState().commitHistory()
  }

  const isWaitingForUser = run?.status === 'waiting-for-user' && !isRunning
  const statusLabel = activeTask ? TASK_STATUS_LABELS[activeTask.status] : TASK_STATUS_LABELS.idle
  const progressLabel = formatProgress(activeTask?.progress)
  const elapsedStart = activeTask?.submittedAt ?? run?.createdAt
  const elapsed = elapsedStart ? Math.max(0, now - elapsedStart) : 0
  const modelTitle = selectedModel
    ? `${selectedChannel?.name || '渠道'} · ${selectedModel.name || selectedModel.id}`
    : '选择模型'
  const selectedResolution = variantConfig?.resolution || (generationVariant === 'image' ? 'auto' : '720p')
  const selectedAspectRatio = variantConfig?.aspectRatio || '16:9'
  const availableResolutions = selectedModel?.resolutions || [selectedResolution]
  const availableAspectRatios = selectedModel?.aspectRatios || [selectedAspectRatio]
  const parameterSummary = `${formatResolutionLabel(selectedResolution)} · ${formatAspectRatioLabel(selectedAspectRatio)}`
  const allowedReferenceTypes: Array<GenerationReference['type']> = generationVariant === 'video'
    ? videoInputTypes(selectedModel, videoMode)
    : ['image']
  const referenceTypes = [...new Set([...allowedReferenceTypes, ...orderedReferences.map((reference) => reference.type)])]
  const frameRoles: Array<'first_frame' | 'last_frame'> = generationVariant === 'video' && videoMode === 'first-last-frame'
    ? ['first_frame', 'last_frame']
    : []
  const hasExcluded = Object.values(variantConfig?.referenceOverrides || {}).some((override) => override.excluded)
  const isGptImage = Boolean(selectedModel?.id.toLowerCase().startsWith('gpt-image-'))
  const showAudioToggle = generationVariant === 'video' && Boolean(selectedModel?.capabilities.includes('generate-audio'))

  const renderReferences = (type: GenerationReference['type'], frameRole?: 'first_frame' | 'last_frame') => {
    const TypeIcon = TYPE_ICONS[type]
    const items = orderedReferences.filter((reference) => (
      reference.type === type
      && (frameRole ? reference.role === frameRole : !(type === 'image' && frameRoles.includes(reference.role as 'first_frame' | 'last_frame')))
    ))
    const slotLabel = frameRole === 'first_frame' ? '首帧' : frameRole === 'last_frame' ? '尾帧' : TYPE_LABELS[type]
    const limit = frameRole ? 1 : type === 'image' ? selectedModel?.maxImages : type === 'video' ? selectedModel?.maxVideos : selectedModel?.maxAudios
    const acceptsType = allowedReferenceTypes.includes(type)
      && (!selectedModel?.inputTypes || selectedModel.inputTypes.includes(type))
      && !(type === 'image' && frameRoles.length && !frameRole)
    const canUpload = Boolean(generationVariant) && acceptsType && (limit === undefined || items.length < limit)
    if (!items.length && !acceptsType) return null

    return (
      <div key={frameRole || type} role="group" aria-label={`${slotLabel}参考素材，共 ${items.length} 项`} className="flex min-w-0 items-center gap-1.5">
        {items.map((reference) => (
          <div
            key={reference.id}
            draggable
            onPointerDown={stopNodeGesture}
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
            className={`group relative shrink-0 cursor-grab active:cursor-grabbing ${draggedReferenceId === reference.id ? 'opacity-50' : ''}`}
            title={`${reference.upstreamNodeId ? '上游引用 · ' : ''}${reference.label || TYPE_LABELS[type]}：拖动调整顺序`}
          >
            <LocalReferencePreview reference={reference} />
            {reference.upstreamNodeId && (
              <span className="absolute left-0 top-0 rounded bg-card/90 p-0.5" title="上游引用：移除不会删除源文件" aria-label="上游引用">
                <Link2 className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
            {frameRole && <span className="pointer-events-none absolute bottom-0 left-0 rounded bg-card/90 px-1 text-[9px]">{slotLabel}</span>}
            {generationVariant === 'video' && videoMode === 'first-last-frame' && type === 'image' && (
              <button
                type="button"
                className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded bg-card/90 text-muted-foreground hover:text-foreground"
                onClick={() => setImageFrameRole(reference, reference.role === 'first_frame' ? 'last_frame' : 'first_frame')}
                aria-label={reference.role === 'first_frame' ? '设为尾帧' : '设为首帧'}
                title="交换首尾帧"
              >
                <ArrowLeftRight className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              onClick={() => void removeReference(reference)}
              aria-label={reference.upstreamNodeId ? `移除上游${TYPE_LABELS[type]}引用` : `删除${TYPE_LABELS[type]}素材`}
              title={reference.upstreamNodeId ? '移除引用，不删除上游素材' : `删除${TYPE_LABELS[type]}素材`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {canUpload && (
          <label
            className="flex h-14 w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`上传${slotLabel}素材`}
            title={`上传${slotLabel}素材`}
          >
            <TypeIcon className="h-4 w-4" aria-hidden />
            {frameRole && <span className="text-[9px]">{slotLabel}</span>}
            <input
              type="file"
              className="hidden"
              accept={type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*'}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleFile(file, type, frameRole)
              }}
            />
          </label>
        )}
      </div>
    )
  }

  const generationControls = <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="toolbar" aria-label="生成参数">
        {generationVariant && (
          <details className="group/menu relative min-w-0">
            <summary
              className="flex h-8 max-w-[180px] cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
              aria-label="选择模型"
              title={modelTitle}
              onPointerDown={stopNodeGesture}
            >
              <span className="truncate">{selectedModel?.name || selectedModel?.id || '选择模型'}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </summary>
            <div
              role="listbox"
              aria-label="模型列表"
              data-node-menu="left" data-menu-width="256" data-menu-height="288"
              className="cnote-menu-surface absolute left-0 top-[calc(100%+8px)] z-50 max-h-72 min-w-64 overflow-auto overscroll-contain"
              onPointerDown={stopNodeGesture}
              onWheel={stopNodeGesture}
            >
              {modelGroups.length ? (
                modelGroups.map((group, groupIndex) => (
                  <div key={group.channel.id}>
                    {groupIndex > 0 && <div className="my-1 h-px bg-border" />}
                    <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">{group.channel.name}</div>
                    {group.models.map((model) => {
                      const active = group.channel.id === selectedChannel?.id && model.id === selectedModel?.id
                      return (
                        <button
                          key={`${group.channel.id}:${model.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className="cnote-menu-item"
                          data-active={active}
                          onClick={(event) => {
                            chooseModel(group.channel.id, model)
                            closeMenu(event.currentTarget)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{model.name || model.id}</span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                ))
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">暂无可用模型</p>
              )}
            </div>
          </details>
        )}

        {generationVariant === 'video' && videoModes.length > 0 && (
          <details className="group/menu relative min-w-0">
            <summary
              className="flex h-8 max-w-[120px] cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
              aria-label="生成模式"
              title="生成模式"
              onPointerDown={stopNodeGesture}
            >
              <span className="truncate">{CAPABILITY_LABELS[videoMode]}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </summary>
            <div
              role="listbox"
              aria-label="生成模式选项"
              data-node-menu="left" data-menu-width="160" data-menu-height="288"
              className="cnote-menu-surface absolute left-0 top-[calc(100%+8px)] z-50 min-w-40 overflow-auto overscroll-contain"
              onPointerDown={stopNodeGesture}
            >
              {videoModes.map((capability) => (
                <button
                  key={capability}
                  type="button"
                  role="option"
                  aria-selected={videoMode === capability}
                  className="cnote-menu-item"
                  data-active={videoMode === capability}
                  onClick={(event) => {
                    updateVariant({ capability })
                    closeMenu(event.currentTarget)
                  }}
                >
                  <span className="flex-1">{CAPABILITY_LABELS[capability]}</span>
                  {videoMode === capability && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          </details>
        )}

        {generationVariant && (
          <details className="group/menu relative min-w-0">
            <summary
              className="flex h-8 max-w-[150px] cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
              aria-label="生成参数"
              title="生成参数"
              onPointerDown={stopNodeGesture}
            >
              <span className="truncate">{parameterSummary}</span>
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            </summary>
            <div
              data-node-menu="right" data-menu-width="280" data-menu-height="440"
              className="cnote-menu-surface absolute right-0 top-[calc(100%+8px)] z-50 max-h-[min(440px,70vh)] min-w-[280px] overflow-auto overscroll-contain"
              onPointerDown={stopNodeGesture}
              onWheel={stopNodeGesture}
            >
              <ChoiceRow
                label="分辨率"
                value={selectedResolution}
                options={availableResolutions.map((resolution) => ({
                  value: resolution,
                  label: formatResolutionLabel(resolution),
                  disabled: Boolean(selectedModel?.resolutions && !selectedModel.resolutions.includes(resolution)),
                }))}
                onChange={(value) => updateVariant({ resolution: value })}
                ariaLabel="分辨率"
              />
              <div className="h-px bg-border" />
              <ChoiceRow
                label="宽高比例"
                value={selectedAspectRatio}
                options={availableAspectRatios.map((ratio) => ({
                  value: ratio,
                  label: formatAspectRatioLabel(ratio),
                  disabled: Boolean(selectedModel?.aspectRatios && !selectedModel.aspectRatios.includes(ratio)),
                }))}
                onChange={(value) => updateVariant({ aspectRatio: value })}
                ariaLabel="宽高比例"
              />
              {generationVariant === 'image' && (
                <>
                  <div className="h-px bg-border" />
                  <ChoiceRow
                    label="质量"
                    value={variantConfig?.quality || selectedModel?.defaultQuality || 'medium'}
                    options={(selectedModel?.qualities || ['auto', 'low', 'medium', 'high']).map((quality) => ({
                      value: quality,
                      label: QUALITY_LABELS[quality] || quality,
                    }))}
                    onChange={(value) => updateVariant({ quality: value })}
                    ariaLabel="质量"
                  />
                </>
              )}
              {generationVariant === 'image' && isGptImage && (
                <>
                  <div className="h-px bg-border" />
                  <ChoiceRow
                    label="背景"
                    value={variantConfig?.background || 'auto'}
                    options={[
                      { value: 'auto', label: '自动' },
                      { value: 'opaque', label: '不透明' },
                      { value: 'transparent', label: '透明' },
                    ]}
                    onChange={(value) => updateVariant({ background: value as GenerationConfig['background'] })}
                    ariaLabel="背景"
                  />
                  <ChoiceRow
                    label="格式"
                    value={variantConfig?.outputFormat || 'png'}
                    options={[
                      { value: 'png', label: 'PNG' },
                      { value: 'webp', label: 'WebP' },
                      { value: 'jpeg', label: 'JPEG', disabled: variantConfig?.background === 'transparent' },
                    ]}
                    onChange={(value) => updateVariant({
                      outputFormat: value as GenerationConfig['outputFormat'],
                      outputCompression: value === 'png' ? undefined : variantConfig?.outputCompression,
                    })}
                    ariaLabel="输出格式"
                  />
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                    <span className="text-[10px] text-muted-foreground">图片数量</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={variantConfig?.outputCount || 1}
                      aria-label="图片数量"
                      className="h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                      onPointerDown={stopNodeGesture}
                      onChange={(event) => updateVariant({ outputCount: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })}
                    />
                  </div>
                </>
              )}
              {generationVariant === 'image' && selectedModel?.thinkingLevels?.length ? (
                <>
                  <div className="h-px bg-border" />
                  <ChoiceRow
                    label="思考级别"
                    value={variantConfig?.thinkingLevel || selectedModel.defaultThinkingLevel || selectedModel.thinkingLevels[0]}
                    options={selectedModel.thinkingLevels.map((level) => ({ value: level, label: level === 'minimal' ? '最小' : '高' }))}
                    onChange={(value) => updateVariant({ thinkingLevel: value as GenerationConfig['thinkingLevel'] })}
                    ariaLabel="思考级别"
                  />
                </>
              ) : null}
              {generationVariant === 'video' && (
                <>
                  <div className="h-px bg-border" />
                  {selectedModel?.allowedDurations?.length ? (
                    <ChoiceRow
                      label="时长（秒）"
                      value={String(variantConfig?.seconds || selectedModel.defaultDuration || selectedModel.allowedDurations[0])}
                      options={selectedModel.allowedDurations.map((seconds) => ({ value: String(seconds), label: String(seconds) }))}
                      onChange={(value) => updateVariant({ seconds: Number(value) })}
                      ariaLabel="时长（秒）"
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground">时长（秒）</span>
                      <input
                        type="number"
                        min={selectedModel?.minDuration || 1}
                        max={selectedModel?.maxDuration || 60}
                        value={variantConfig?.seconds || selectedModel?.defaultDuration || 5}
                        aria-label="时长（秒）"
                        className="h-7 w-16 rounded-full border border-border bg-background/75 px-2 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                        onPointerDown={stopNodeGesture}
                        onChange={(event) => updateVariant({ seconds: Number(event.target.value) })}
                      />
                    </div>
                  )}
                  {showAudioToggle && (
                    <label className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[11px] text-foreground hover:bg-muted/70" title="生成视频音轨">
                      <span className="flex items-center gap-2">
                        <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                        生成音频
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(resolvedLegacy?.generateAudio)}
                        aria-label="生成音频"
                        onChange={(event) => updateVariant({ generateAudio: event.target.checked })}
                      />
                    </label>
                  )}
                </>
              )}
              {isWaitingForUser && (
                <button type="button" className="cnote-menu-item text-destructive" onClick={abandonWaitingGeneration}>
                  <X className="h-3.5 w-3.5" aria-hidden />放弃暂停任务
                </button>
              )}
            </div>
          </details>
        )}
  </div>

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-visible rounded-xl border border-border bg-card"
      onPointerDown={stopNodeGesture}
    >

      {!generationVariant ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-12 py-7">
          <div className="w-full">
            <h3 className="mb-4 text-center text-lg font-semibold text-foreground">选择生成类型</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="flex h-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                onClick={() => chooseVariant('image')}
              >
                <ImageIcon className="h-8 w-8 stroke-[1.8] text-cyan-500" />
                <span>图片生成</span>
              </button>
              <button
                type="button"
                className="flex h-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                onClick={() => chooseVariant('video')}
              >
                <Video className="h-8 w-8 stroke-[1.8] text-red-500" />
                <span>视频生成</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 pb-1 pt-1" onPointerDown={stopNodeGesture} onWheel={stopNodeGesture}>
            <div className="flex max-h-[168px] flex-wrap items-center gap-x-3 gap-y-2 overflow-auto px-0.5 py-1">
              {frameRoles.map((role) => renderReferences('image', role))}
              {referenceTypes.map((type) => renderReferences(type))}
              {hasExcluded && (
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  title="恢复已移除的上游引用"
                  aria-label="恢复已移除的上游引用"
                  onClick={restoreExcluded}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {referenceError && (
              <div role="status" className="mt-1 text-[10px] text-muted-foreground">{referenceError}</div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-1" onPointerDown={stopNodeGesture} onWheel={stopNodeGesture}>
            {isRunning && (
              <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                <span>{statusLabel}</span>
                {progressLabel && <span>{progressLabel}</span>}
              </div>
            )}
            {isWaitingForUser && (
              <div role="status" className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Pause className="h-3.5 w-3.5" aria-hidden />
                <span>已暂停</span>
              </div>
            )}
            {requestError && (
              <div role="alert" className="mb-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                {requestError}
              </div>
            )}
            {!isRunning && !isWaitingForUser && !requestError && activeTask?.status === 'completed' && (
              <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-800">
                任务已完成{completedCount > 0 ? `，已生成 ${completedCount} 个${generationVariant === 'image' ? '图片' : '视频'}结果` : ''}
              </div>
            )}
            {!isRunning && !isWaitingForUser && !requestError && activeTask?.status !== 'completed' && (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                {upstreamText ? '已连接上游文本，生成时会一并提交' : '还没有生成结果'}
              </p>
            )}
          </div>

          <div className="relative shrink-0 p-2 pt-1">
            {generationVariant === 'video' && mentionContext && mentionCandidates.length > 0 && (
              <div ref={mentionMenuRef}>
                <PromptMentionMenu
                  references={orderedReferences}
                  promptMentions={variantConfig?.promptMentions}
                  query={mentionContext.query}
                  selectedIndex={Math.min(mentionSelectedIndex, mentionCandidates.length - 1)}
                  onSelect={selectMention}
                />
              </div>
            )}
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
              <textarea
                ref={promptRef}
                aria-label="输入提示词"
                aria-autocomplete={generationVariant === 'video' ? 'list' : undefined}
                aria-controls={generationVariant === 'video' && mentionContext && mentionCandidates.length ? 'request-node-prompt-mentions' : undefined}
                aria-expanded={generationVariant === 'video' && Boolean(mentionContext && mentionCandidates.length)}
                rows={2}
                disabled={isRunning || node.disabled}
                value={prompt}
                placeholder={generationVariant === 'video' ? VIDEO_MODE_PLACEHOLDERS[videoMode] : '描述要生成的图片'}
                className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-1 text-xs leading-5 text-foreground outline-none disabled:opacity-60"
                onPointerDown={stopNodeGesture}
                onWheel={stopNodeGesture}
                onChange={(event) => {
                  const value = event.target.value
                  setPrompt(value)
                  promptDirtyRef.current = true
                  patchVariantConfig(node.id, generationVariant, { prompt: value })
                  if (generationVariant === 'video') updateMentionContext(value, event.target.selectionStart ?? value.length)
                  else setMentionContext(null)
                }}
                onKeyDown={handlePromptKeyDown}
                onKeyUp={handlePromptCaretChange}
                onClick={handlePromptCaretChange}
                onBlur={persistPrompt}
              />
              <div className="flex items-end gap-2">
                {generationControls}
                <GenerationActionButton
                  running={isRunning}
                  waiting={isWaitingForUser}
                  elapsed={formatElapsed(elapsed)}
                  disabled={!isRunning && (Boolean(node.disabled) || (!isWaitingForUser && !canRun))}
                  reason={referenceError || undefined}
                  onStart={() => void runGeneration()}
                  onCancel={cancelGeneration}
                  onResume={() => void resumeWaitingGeneration()}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
})
