/**
 * AI 节点内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * 声明（channel / model / systemPrompt / webSearch / reasoningLevel / activeSessionId）
 * 写 graph-store；会话与消息写 runtime-store，不属于图历史。
 *
 * 变量引用以普通文本 token `{{node:id}}` 输入，不做富文本 chip 编辑器。
 * 上游上下文抽取是简化版：只从当前文档的上游 content/browser/sticky/ai 抽纯文本，
 * 完整图文抽取后续再接入 lib/flow/ai-context。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  ChevronDown,
  FileCog,
  LoaderCircle,
  MessageSquarePlus,
  Search,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCanvas } from '@/canvas/components'
import type {
  AIMessage,
  AINodeSpec,
  AIReasoningLevel,
  AISession,
  AIWebSearchMode,
  NodeSpec,
} from '@/domain'
import {
  adaptReasoningLevel,
  getAIModelCapabilities,
  getProvider,
  type ChatCompletionRequest,
  type ChatMessage,
} from '@/lib/api'
import {
  compileAiPromptParts,
  promptHasUsableContent,
  type AIContextEntry,
} from '@/lib/flow/ai-prompt'
import { useAIStore } from '@/stores/use-ai-store'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'

/** 与 NodeShell header `h-9` 对齐（世界像素） */
const SHELL_HEADER_WORLD_PX = 36
const DEFAULT_SYSTEM_PROMPT = '你是一个有用的助手。'
const DEFAULT_MAX_OUTPUT_TOKENS = 8192

const WEB_SEARCH_MODES: AIWebSearchMode[] = ['auto', 'on', 'off']
const WEB_SEARCH_LABELS: Record<AIWebSearchMode, string> = {
  auto: '自动',
  on: '开启',
  off: '关闭',
}
const REASONING_LEVELS: AIReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const REASONING_LABELS: Record<AIReasoningLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

interface ModelOption {
  channelId: string
  channelName: string
  model: string
}

interface ModelGroup {
  channelId: string
  channelName: string
  models: string[]
}

function patchAI(id: string, patch: Partial<AINodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch as Partial<NodeSpec>)
}

function stopNodeGesture(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function readAISpec(nodeId: string, fallback: Pick<AINodeSpec, 'id' | 'activeSessionId'>): Pick<AINodeSpec, 'id' | 'activeSessionId'> {
  const stored = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === nodeId)
  return stored && stored.kind === 'ai'
    ? { id: stored.id, activeSessionId: stored.activeSessionId }
    : fallback
}

/**
 * 幂等：优先读 graph / runtime store，避免 Strict Mode 双 mount 重复建会话。
 */
function ensureActiveSession(fields: Pick<AINodeSpec, 'id' | 'activeSessionId'>): string {
  const spec = readAISpec(fields.id, fields)
  const runtime = useRuntimeStore.getState()
  const declaredId = spec.activeSessionId

  if (declaredId) {
    if (!runtime.aiSessions[declaredId]) {
      const now = Date.now()
      runtime.putAISession({
        id: declaredId,
        title: '新会话 1',
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    }
    return declaredId
  }

  const now = Date.now()
  const session: AISession = {
    id: nanoid(),
    title: '新会话 1',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  runtime.putAISession(session)
  patchAI(fields.id, { activeSessionId: session.id })
  return session.id
}

/**
 * 简化抽取：只取声明里的纯文本。
 * 后续接入完整 ai-context（解析正文、截图、会话回复、多模态图片）。
 */
function textFromUpstreamNode(node: NodeSpec): string {
  switch (node.kind) {
    case 'content':
      return node.content?.trim() ? node.content : node.label
    case 'browser':
      return node.url
    case 'sticky':
      return node.content
    case 'ai':
    case 'request':
    case 'group':
      return node.label
  }
}

function collectUpstreamEntries(nodeId: string): AIContextEntry[] {
  const doc = useGraphStore.getState().currentDocument
  if (!doc) return []
  const sourceIds = [...new Set(doc.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))]
  const entries: AIContextEntry[] = []
  for (const sourceId of sourceIds) {
    const source = doc.nodes.find((item) => item.id === sourceId)
    if (!source) continue
    const text = textFromUpstreamNode(source).trim()
    if (!text) continue
    entries.push({
      nodeId: source.id,
      label: source.label || '上游节点',
      text,
    })
  }
  return entries
}

function toChatContent(parts: ReturnType<typeof compileAiPromptParts>): ChatMessage['content'] {
  if (parts.length === 0) return ''
  if (parts.every((part) => part.type === 'text')) {
    return parts.map((part) => part.text).join('')
  }
  return parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image' as const, source: part.image },
  )
}

function closeMenu(target: EventTarget | null): void {
  if (target instanceof HTMLElement) target.closest('details')?.removeAttribute('open')
}

export const AIContent = memo(function AIContent({ node }: { node: AINodeSpec }) {
  const { viewport } = useCanvas()
  const headerOffset = SHELL_HEADER_WORLD_PX * viewport.zoom

  const apiKeys = useAIStore((state) => state.apiKeys)
  const getAPIKey = useAIStore((state) => state.getAPIKey)
  const createClientForChannel = useAIStore((state) => state.createClientForChannel)

  const session = useRuntimeStore((state) =>
    node.activeSessionId ? state.aiSessions[node.activeSessionId] : undefined,
  )
  const messages = session?.messages ?? []

  const [prompt, setPrompt] = useState(node.prompt || '')
  const [systemPromptDraft, setSystemPromptDraft] = useState(node.systemPrompt || '')
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)

  const sendingRef = useRef(false)
  const requestControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const modelGroups = useMemo<ModelGroup[]>(
    () =>
      apiKeys
        .filter((channel) => Boolean(getAPIKey(channel.id)) && Boolean(channel.modelIds?.length))
        .map((channel) => ({
          channelId: channel.id,
          channelName: channel.name,
          models: channel.modelIds || [],
        })),
    [apiKeys, getAPIKey],
  )
  const modelOptions = useMemo<ModelOption[]>(
    () =>
      modelGroups.flatMap((group) =>
        group.models.map((model) => ({
          channelId: group.channelId,
          channelName: group.channelName,
          model,
        })),
      ),
    [modelGroups],
  )
  const matchedOption = modelOptions.find(
    (option) => option.channelId === node.channelId && option.model === node.model,
  )
  const selectedOption = matchedOption ?? modelOptions[0]
  const selectedChannel = selectedOption
    ? apiKeys.find((channel) => channel.id === selectedOption.channelId)
    : undefined
  const selectedProvider = selectedChannel ? getProvider(selectedChannel.providerId) : undefined
  const modelCapabilities = selectedOption && selectedChannel
    ? getAIModelCapabilities(
        selectedChannel.providerId,
        selectedChannel.protocol || selectedProvider?.protocol || 'chatCompletions',
        selectedOption.model,
        selectedChannel.baseURL,
      )
    : getAIModelCapabilities('custom', 'chatCompletions', '')

  const webSearch = node.webSearch || 'auto'
  const reasoningLevel = node.reasoningLevel || 'medium'
  const reasoningOptions = modelCapabilities.reasoningLevels.length
    ? REASONING_LEVELS.filter((level) => modelCapabilities.reasoningLevels.includes(level))
    : REASONING_LEVELS
  const effectiveReasoningLevel = adaptReasoningLevel(modelCapabilities, reasoningLevel)
  const canSend =
    promptHasUsableContent(prompt) &&
    Boolean(selectedOption) &&
    !isSending &&
    !node.disabled

  // selectedOption 由 find 得到，对象引用不稳定；只订阅标量，避免 effect 每帧写回 graph。
  const selectedOptionChannelId = selectedOption?.channelId
  const selectedOptionModel = selectedOption?.model

  useEffect(() => {
    ensureActiveSession({ id: node.id, activeSessionId: node.activeSessionId })
  }, [node.id, node.activeSessionId])

  useEffect(() => {
    if (!selectedOptionChannelId || !selectedOptionModel) return
    const stored = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === node.id)
    if (
      stored &&
      stored.kind === 'ai' &&
      stored.channelId === selectedOptionChannelId &&
      stored.model === selectedOptionModel
    ) {
      return
    }
    patchAI(node.id, { channelId: selectedOptionChannelId, model: selectedOptionModel })
  }, [node.id, selectedOptionChannelId, selectedOptionModel])

  useEffect(() => {
    setPrompt(node.prompt || '')
  }, [node.prompt])

  useEffect(() => {
    setSystemPromptDraft(node.systemPrompt || '')
  }, [node.systemPrompt])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, isSending])

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort()
    }
  }, [])

  const chooseModel = useCallback(
    (channelId: string, model: string) => {
      if (node.channelId === channelId && node.model === model) return
      // 渠道/模型是声明字段；不 commitHistory，避免选择操作污染图撤销栈。
      patchAI(node.id, { channelId, model })
    },
    [node.channelId, node.id, node.model],
  )

  const startNewSession = useCallback(() => {
    const count = Object.keys(useRuntimeStore.getState().aiSessions).length
    const now = Date.now()
    const next: AISession = {
      id: nanoid(),
      title: `新会话 ${count + 1}`,
      messages: [],
      model: selectedOption?.model,
      createdAt: now,
      updatedAt: now,
    }
    useRuntimeStore.getState().putAISession(next)
    patchAI(node.id, { activeSessionId: next.id })
    setRequestError(null)
  }, [node.id, selectedOption?.model])

  const persistSystemPrompt = useCallback(() => {
    if ((node.systemPrompt || '') === systemPromptDraft) return
    // 系统提示写回声明但不 commit：blur-commit 后续再接到手势结束约定上。
    patchAI(node.id, { systemPrompt: systemPromptDraft })
  }, [node.id, node.systemPrompt, systemPromptDraft])

  const sendMessage = useCallback(async () => {
    const displayContent = prompt.trim()
    if (!promptHasUsableContent(displayContent) || sendingRef.current || node.disabled) return

    const sessionId = ensureActiveSession({ id: node.id, activeSessionId: node.activeSessionId })
    const active = useRuntimeStore.getState().aiSessions[sessionId]
    if (!active) {
      setRequestError('当前没有可用的会话')
      return
    }
    if (!selectedOption) {
      setRequestError('请先选择一个已配置的模型')
      return
    }
    const client = createClientForChannel(selectedOption.channelId)
    if (!client) {
      setRequestError('当前模型渠道尚未正确配置，请检查 API Key、服务地址和模型列表')
      return
    }

    const userMessage: AIMessage = {
      role: 'user',
      content: displayContent,
      channelId: selectedOption.channelId,
      model: selectedOption.model,
      createdAt: Date.now(),
    }
    useRuntimeStore.getState().appendMessage(sessionId, userMessage)
    setPrompt('')
    setRequestError(null)
    setIsSending(true)
    sendingRef.current = true

    const controller = new AbortController()
    requestControllerRef.current = controller

    try {
      const entries = collectUpstreamEntries(node.id)
      const compiled = toChatContent(compileAiPromptParts(displayContent, entries))
      const history = useRuntimeStore.getState().aiSessions[sessionId]?.messages ?? []
      const prior = history.slice(0, -1)
      const request: ChatCompletionRequest = {
        model: selectedOption.model,
        messages: [
          { role: 'system', content: systemPromptDraft.trim() || DEFAULT_SYSTEM_PROMPT },
          ...prior.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: 'user', content: compiled },
        ],
        temperature: node.temperature ?? 1,
        max_tokens: node.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS,
        web_search: modelCapabilities.webSearch === 'unsupported' ? 'off' : webSearch,
        reasoning_effort: effectiveReasoningLevel,
      }
      const response = (await client.complete(request, controller.signal)).trim()
      if (!response) throw new Error('模型返回了空响应')
      useRuntimeStore.getState().appendMessage(sessionId, {
        role: 'assistant',
        content: response,
        channelId: selectedOption.channelId,
        model: selectedOption.model,
        createdAt: Date.now(),
      })
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setRequestError(null)
      } else {
        setRequestError(errorText(error, 'AI 请求失败，请稍后重试'))
      }
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null
      sendingRef.current = false
      setIsSending(false)
    }
  }, [
    createClientForChannel,
    effectiveReasoningLevel,
    modelCapabilities.webSearch,
    node.activeSessionId,
    node.disabled,
    node.id,
    node.maxOutputTokens,
    node.temperature,
    prompt,
    selectedOption,
    systemPromptDraft,
    webSearch,
  ])

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
      style={{ paddingTop: headerOffset }}
      onPointerDown={stopNodeGesture}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5" role="toolbar" aria-label="AI 节点操作">
        <details className="group/menu relative min-w-0">
          <summary
            className="flex h-8 max-w-[180px] cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
            aria-label="选择模型"
            title={selectedOption ? `${selectedOption.channelName} · ${selectedOption.model}` : '选择模型'}
            onPointerDown={stopNodeGesture}
          >
            <span className="truncate">{selectedOption?.model || '选择模型'}</span>
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
                <div key={group.channelId}>
                  {groupIndex > 0 && <div className="my-1 h-px bg-border" />}
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">{group.channelName}</div>
                  {group.models.map((model) => {
                    const active = group.channelId === selectedOption?.channelId && model === selectedOption?.model
                    return (
                      <button
                        key={`${group.channelId}:${model}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className="cnote-menu-item"
                        data-active={active}
                        onClick={(event) => {
                          chooseModel(group.channelId, model)
                          closeMenu(event.currentTarget)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{model}</span>
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

        <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground" title={session?.title || '新会话'}>
          {session?.title || '新会话'}
        </span>

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="新建会话"
          title="新建会话"
          onPointerDown={stopNodeGesture}
          onClick={startNewSession}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${showSystemPrompt ? 'bg-muted text-foreground' : ''}`}
          aria-label="系统提示词"
          title="系统提示词"
          aria-pressed={showSystemPrompt}
          onPointerDown={stopNodeGesture}
          onClick={() => {
            if (showSystemPrompt) persistSystemPrompt()
            setShowSystemPrompt((open) => !open)
          }}
        >
          <FileCog className="h-4 w-4" />
        </button>
      </div>

      {showSystemPrompt && (
        <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2">
          <label className="mb-1 block text-[10px] font-medium text-muted-foreground" htmlFor={`ai-system-${node.id}`}>
            系统提示词
          </label>
          <textarea
            id={`ai-system-${node.id}`}
            value={systemPromptDraft}
            rows={3}
            placeholder="为这个 AI 节点设置独立的系统提示词"
            className="block w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs leading-5 outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10"
            onPointerDown={stopNodeGesture}
            onWheel={stopNodeGesture}
            onChange={(event) => setSystemPromptDraft(event.target.value)}
            onBlur={persistSystemPrompt}
          />
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5">
        <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Search className="h-3 w-3 shrink-0" aria-hidden />
          <select
            aria-label="联网搜索"
            title="联网搜索"
            className="h-7 max-w-[88px] rounded-full border border-border bg-card px-2 text-[11px] text-foreground outline-none disabled:opacity-50"
            value={webSearch}
            disabled={modelCapabilities.webSearch === 'unsupported' || modelCapabilities.webSearch === 'always'}
            onPointerDown={stopNodeGesture}
            onChange={(event) => {
              patchAI(node.id, { webSearch: event.target.value as AIWebSearchMode })
            }}
          >
            {WEB_SEARCH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {WEB_SEARCH_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Brain className="h-3 w-3 shrink-0" aria-hidden />
          <select
            aria-label="推理级别"
            title="推理级别"
            className="h-7 max-w-[88px] rounded-full border border-border bg-card px-2 text-[11px] text-foreground outline-none disabled:opacity-50"
            value={effectiveReasoningLevel || reasoningOptions[0] || 'medium'}
            disabled={!modelCapabilities.reasoningLevels.length}
            onPointerDown={stopNodeGesture}
            onChange={(event) => {
              patchAI(node.id, { reasoningLevel: event.target.value as AIReasoningLevel })
            }}
          >
            {reasoningOptions.map((level) => (
              <option key={level} value={level}>
                {REASONING_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
        onPointerDown={stopNodeGesture}
        onWheel={stopNodeGesture}
      >
        {messages.length === 0 && !isSending && !requestError && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">还没有消息</p>
        )}
        {messages.length > 0 && (
          <div className="space-y-2">
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <div
                  key={`${message.createdAt ?? index}-${index}`}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-5 ${
                      isUser ? 'bg-muted text-foreground' : 'bg-transparent text-foreground'
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {isSending && (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            正在请求模型…
          </div>
        )}
        {requestError && (
          <div role="alert" className="mt-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
            {requestError}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 p-2 pt-1">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
          <textarea
            aria-label="输入提示词"
            rows={2}
            disabled={isSending || node.disabled}
            value={prompt}
            placeholder="输入提示词，可用 {{node:id}} 引用上游"
            className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-1 text-xs leading-5 text-foreground outline-none disabled:opacity-60"
            onPointerDown={stopNodeGesture}
            onWheel={stopNodeGesture}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
            disabled={!canSend}
            aria-label="发送消息"
            title="发送消息"
            onPointerDown={stopNodeGesture}
            onClick={() => {
              void sendMessage()
            }}
          >
            {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
})
