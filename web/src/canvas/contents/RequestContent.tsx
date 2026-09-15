/**
 * 生成节点内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * 声明（variant / image / video / latestRunId）写 graph-store；
 * 任务与 run 写 runtime-store，不属于图历史。
 *
 * 本组件把新 GenerationConfig 桥到现有 runGenerationTask。
 * 引用素材、resultUrl→ContentAsset、resultNodeIds 链接后续阶段补。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Image as ImageIcon, LoaderCircle, Sparkles, Square, Video } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCanvas } from '@/canvas/components'
import type {
  GenerationConfig,
  GenerationRun,
  GenerationRunStatus,
  GenerationTask,
  GenerationTaskStatus,
  NodeSpec,
  RequestNodeSpec,
  RequestVariant,
} from '@/domain'
import { runGenerationTask, type GenerationRequestContext } from '@/lib/generation/client'
import { createGenerationVariantConfig } from '@/lib/generation/defaults'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import {
  generationChannelSupportsVariant,
  useGenerationStore,
  type GenerationChannel,
  type GenerationModel,
} from '@/stores/use-generation-store'
import type { GenerationTaskState, GenerationVariantConfig } from '@/types/flow'

/** 与 NodeShell header `h-9` 对齐（世界像素） */
const SHELL_HEADER_WORLD_PX = 36
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000

type GenerationVariant = Exclude<RequestVariant, 'body'>

interface ModelGroup {
  channel: GenerationChannel
  models: GenerationModel[]
}

const VARIANT_TABS: Array<{ id: RequestVariant; label: string }> = [
  { id: 'body', label: '请求体' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
]

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

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')
}

/** 旧 GenerationTaskState.status → 领域 GenerationTaskStatus。timeout/unknown 视为失败。 */
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

function mapRunStatus(status: GenerationTaskStatus): GenerationRunStatus {
  return status === 'idle' ? 'created' : status
}

function formatProgress(progress: number | undefined): string | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  const percent = progress > 0 && progress <= 1 ? progress * 100 : progress
  return `${Math.round(percent)}%`
}

/**
 * 把节点声明里的 GenerationConfig 适配成旧 GenerationVariantConfig。
 * references 留空：引用素材后续阶段补。
 */
function toLegacyVariantConfig(variant: GenerationVariant, spec: GenerationConfig): GenerationVariantConfig {
  const defaults = createGenerationVariantConfig(variant)
  return {
    ...defaults,
    channelId: spec.channelId,
    model: spec.model,
    prompt: spec.prompt,
    negativePrompt: spec.negativePrompt,
    resolution: spec.resolution ?? defaults.resolution,
    aspectRatio: spec.aspectRatio ?? defaults.aspectRatio,
    outputCount: spec.outputCount,
    references: [],
  }
}

function toDomainTask(
  taskId: string,
  legacy: GenerationTaskState,
  fallback: Pick<GenerationTask, 'channelId' | 'model'>,
): GenerationTask {
  return {
    id: taskId,
    status: mapTaskStatus(legacy.status),
    progress: legacy.progress,
    channelId: legacy.channelId ?? fallback.channelId,
    model: legacy.model ?? fallback.model,
    // resultAssetIds 不映射：resultUrl → ContentAsset 后续阶段补。
    error: legacy.error,
    submittedAt: legacy.submittedAt,
    completedAt: legacy.completedAt,
  }
}

export const RequestContent = memo(function RequestContent({ node }: { node: RequestNodeSpec }) {
  const { viewport } = useCanvas()
  const headerOffset = SHELL_HEADER_WORLD_PX * viewport.zoom

  const channels = useGenerationStore((state) => state.channels)
  const getModels = useGenerationStore((state) => state.getModels)

  const generationVariant = isGenerationVariant(node.variant) ? node.variant : null
  const variantConfig = generationVariant ? node[generationVariant] : null

  const [prompt, setPrompt] = useState(variantConfig?.prompt ?? '')
  const [isRunning, setIsRunning] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [resultUrls, setResultUrls] = useState<string[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const runningRef = useRef(false)
  const promptDirtyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const run = useRuntimeStore((state) => {
    const runId = activeRunId || node.latestRunId
    return runId ? state.runs[runId] : undefined
  })
  const activeTask = run?.tasks[0]

  const modelGroups = useMemo<ModelGroup[]>(() => {
    if (!generationVariant) return []
    return channels
      .filter((channel) => channel.enabled && generationChannelSupportsVariant(channel, generationVariant))
      .map((channel) => ({
        channel,
        // GenerationChannel 用 modelIds + modelCatalog，没有 models 字段。
        models: getModels(channel.id),
      }))
      .filter((group) => group.models.length > 0)
  }, [channels, generationVariant, getModels])

  const selectedGroup = useMemo(() => {
    if (!generationVariant || !variantConfig) return modelGroups[0]
    return (
      modelGroups.find(
        (group) =>
          group.channel.id === variantConfig.channelId &&
          group.models.some((model) => model.id === variantConfig.model),
      ) ??
      modelGroups.find((group) => group.channel.id === variantConfig.channelId) ??
      modelGroups[0]
    )
  }, [generationVariant, modelGroups, variantConfig])

  const selectedChannel = selectedGroup?.channel
  const selectedModel =
    selectedGroup && variantConfig
      ? selectedGroup.models.find((model) => model.id === variantConfig.model) ?? selectedGroup.models[0]
      : selectedGroup?.models[0]
  // selectedChannel/selectedModel 是 store 对象，引用变化不应触发重复写回；只订阅 id 标量。
  const selectedChannelId = selectedChannel?.id
  const selectedModelId = selectedModel?.id

  const canRun =
    Boolean(generationVariant) &&
    Boolean(selectedChannel) &&
    Boolean(selectedModel) &&
    Boolean(prompt.trim()) &&
    !isRunning &&
    !node.disabled

  useEffect(() => {
    setPrompt(variantConfig?.prompt ?? '')
    promptDirtyRef.current = false
  }, [node.id, node.variant, variantConfig?.prompt])

  useEffect(() => {
    if (!generationVariant || !selectedChannelId || !selectedModelId) return
    const stored = readRequestSpec(node.id)
    if (!stored) return
    const current = stored[generationVariant]
    if (current.channelId === selectedChannelId && current.model === selectedModelId) return
    patchVariantConfig(node.id, generationVariant, {
      channelId: selectedChannelId,
      model: selectedModelId,
    })
  }, [generationVariant, node.id, selectedChannelId, selectedModelId])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const chooseVariant = useCallback(
    (next: RequestVariant) => {
      if (node.variant === next || isRunning) return
      patchRequest(node.id, { variant: next })
      useGraphStore.getState().commitHistory()
    },
    [isRunning, node.id, node.variant],
  )

  const chooseModel = useCallback(
    (channelId: string, modelId: string) => {
      if (!generationVariant) return
      const current = readRequestSpec(node.id)?.[generationVariant]
      if (current?.channelId === channelId && current.model === modelId) return
      // 渠道/模型是声明字段；不 commitHistory，避免选择操作污染图撤销栈。
      patchVariantConfig(node.id, generationVariant, { channelId, model: modelId })
    },
    [generationVariant, node.id],
  )

  const persistPrompt = useCallback(() => {
    if (!generationVariant || !promptDirtyRef.current) return
    promptDirtyRef.current = false
    // 提示词按键只 updateNode；blur 才进历史，避免每个字都入撤销栈。
    useGraphStore.getState().commitHistory()
  }, [generationVariant])

  const applyLegacyTask = useCallback(
    (
      runId: string,
      taskId: string,
      legacy: GenerationTaskState,
      fallback: Pick<GenerationTask, 'channelId' | 'model'>,
    ) => {
      const mapped = toDomainTask(taskId, legacy, fallback)
      const runtime = useRuntimeStore.getState()
      runtime.updateRun(runId, { status: mapRunStatus(mapped.status) })
      runtime.updateTask(runId, taskId, mapped)
      if (legacy.resultUrls?.length) setResultUrls(legacy.resultUrls)
    },
    [],
  )

  const runGeneration = useCallback(async () => {
    if (runningRef.current || node.disabled) return
    const stored = readRequestSpec(node.id)
    if (!stored || !isGenerationVariant(stored.variant)) return

    const variant = stored.variant
    const spec = stored[variant]
    const channel =
      (spec.channelId ? channels.find((item) => item.id === spec.channelId) : undefined) ?? selectedChannel
    const model = channel
      ? getModels(channel.id).find((item) => item.id === spec.model) ?? selectedModel
      : selectedModel

    if (!channel || !model) {
      setRequestError('请先选择生成渠道和模型')
      return
    }
    if (!spec.prompt.trim()) {
      setRequestError('请填写提示词')
      return
    }

    const runId = nanoid()
    const taskId = nanoid()
    const submittedAt = Date.now()
    const initialTask: GenerationTask = {
      id: taskId,
      status: 'validating',
      channelId: channel.id,
      model: model.id,
      submittedAt,
    }
    const initialRun: GenerationRun = {
      id: runId,
      status: 'running',
      tasks: [initialTask],
      createdAt: submittedAt,
    }

    const controller = new AbortController()
    abortRef.current = controller
    runningRef.current = true
    setIsRunning(true)
    setRequestError(null)
    setResultUrls([])
    setActiveRunId(runId)
    useRuntimeStore.getState().putRun(initialRun)
    patchRequest(node.id, { latestRunId: runId })

    const context: GenerationRequestContext = {
      channel,
      model,
      config: toLegacyVariantConfig(variant, spec),
      variant,
    }

    try {
      const finalTask = await runGenerationTask(context, {
        timeoutMs: GENERATION_TIMEOUT_MS,
        signal: controller.signal,
        onTaskUpdate: (legacy) => {
          applyLegacyTask(runId, taskId, legacy, { channelId: channel.id, model: model.id })
        },
      })
      applyLegacyTask(runId, taskId, finalTask, { channelId: channel.id, model: model.id })
      const mapped = mapTaskStatus(finalTask.status)
      useRuntimeStore.getState().updateRun(runId, { status: mapRunStatus(mapped) })
      if (finalTask.status === 'failed' || finalTask.status === 'timeout' || finalTask.status === 'unknown') {
        setRequestError(finalTask.error?.trim() || '生成失败，请稍后重试')
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        const runtime = useRuntimeStore.getState()
        runtime.updateTask(runId, taskId, { status: 'cancelled', completedAt: Date.now() })
        runtime.updateRun(runId, { status: 'cancelled' })
      } else {
        const message = errorText(error, '生成失败，请稍后重试')
        setRequestError(message)
        const runtime = useRuntimeStore.getState()
        runtime.updateTask(runId, taskId, { status: 'failed', error: message, completedAt: Date.now() })
        runtime.updateRun(runId, { status: 'failed' })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      runningRef.current = false
      setIsRunning(false)
    }
  }, [applyLegacyTask, channels, getModels, node.disabled, node.id, selectedChannel, selectedModel])

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const statusLabel = activeTask ? TASK_STATUS_LABELS[activeTask.status] : TASK_STATUS_LABELS.idle
  const progressLabel = formatProgress(activeTask?.progress)
  const modelTitle = selectedModel
    ? `${selectedChannel?.name || '渠道'} · ${selectedModel.name || selectedModel.id}`
    : '选择模型'

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
      style={{ paddingTop: headerOffset }}
      onPointerDown={stopNodeGesture}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5" role="toolbar" aria-label="生成节点操作">
        <div className="flex min-w-0 items-center gap-0.5" role="group" aria-label="生成变体">
          {VARIANT_TABS.map((tab) => {
            const active = node.variant === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                aria-label={tab.label}
                title={tab.label}
                disabled={isRunning && !active}
                className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 ${
                  active ? 'bg-muted text-foreground' : ''
                }`}
                onPointerDown={stopNodeGesture}
                onClick={() => chooseVariant(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

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
              className="cnote-menu-surface absolute left-0 top-[calc(100%+8px)] z-50 max-h-72 min-w-64 overflow-auto"
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
                            chooseModel(group.channel.id, model.id)
                            closeMenu(event.currentTarget)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{model.name || model.id}</span>
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

        <span className="min-w-0 flex-1" />

        {isRunning && (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="取消生成"
            title="取消生成"
            onPointerDown={stopNodeGesture}
            onClick={cancelGeneration}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!generationVariant ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          {/* HTTP body 请求暂不迁移，本变体只做占位。 */}
          <p className="text-center text-xs text-muted-foreground">该变体正在迁移中</p>
        </div>
      ) : (
        <>
          <div
            className="min-h-0 flex-1 overflow-auto px-3 py-2"
            onPointerDown={stopNodeGesture}
            onWheel={stopNodeGesture}
          >
            {isRunning && (
              <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                <span>{statusLabel}</span>
                {progressLabel && <span>{progressLabel}</span>}
              </div>
            )}
            {requestError && (
              <div role="alert" className="mb-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                {requestError}
              </div>
            )}
            {/* 完整结果节点链接（resultNodeIds）后续阶段接；这里只展示本次任务的 URL。 */}
            {resultUrls.length > 0 ? (
              <div className="space-y-2">
                {resultUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-border bg-muted/30"
                    title={url}
                    onPointerDown={stopNodeGesture}
                  >
                    {generationVariant === 'video' ? (
                      <video src={url} controls className="max-h-40 w-full bg-black object-contain" />
                    ) : (
                      <img src={url} alt="生成结果" className="max-h-40 w-full object-contain" />
                    )}
                    <span className="block truncate px-2 py-1 text-[10px] text-muted-foreground">{url}</span>
                  </a>
                ))}
              </div>
            ) : (
              !isRunning &&
              !requestError && (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {activeTask?.status === 'completed' ? '生成完成，但没有返回结果地址' : '还没有生成结果'}
                </p>
              )
            )}
          </div>

          <div className="shrink-0 p-2 pt-1">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
              {generationVariant === 'video' ? (
                <Video className="mb-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ImageIcon className="mb-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <textarea
                aria-label="输入提示词"
                rows={2}
                disabled={isRunning || node.disabled}
                value={prompt}
                placeholder={generationVariant === 'video' ? '描述要生成的视频' : '描述要生成的图片'}
                className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-1 text-xs leading-5 text-foreground outline-none disabled:opacity-60"
                onPointerDown={stopNodeGesture}
                onWheel={stopNodeGesture}
                onChange={(event) => {
                  const value = event.target.value
                  setPrompt(value)
                  promptDirtyRef.current = true
                  patchVariantConfig(node.id, generationVariant, { prompt: value })
                }}
                onBlur={persistPrompt}
              />
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
                disabled={!canRun}
                aria-label="开始生成"
                title="开始生成"
                onPointerDown={stopNodeGesture}
                onClick={() => {
                  void runGeneration()
                }}
              >
                {isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
})
