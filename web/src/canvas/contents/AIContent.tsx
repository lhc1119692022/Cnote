/**
 * AI 节点内容：只在 CanvasViewport 内容抬升层渲染。
 * 根节点填满父盒（w-full h-full），不做 scale/transform 定位。
 *
 * 声明（channel / model / systemPrompt / prompt / webSearch / reasoningLevel / activeSessionId）
 * 写 graph-store；会话与消息写 runtime-store，不属于图历史。
 *
 * 变量引用以 `{{node:id}}` 持久化，输入框内与可视 chip 双向转换。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import {
  ArrowUp,
  Brain,
  ChevronDown,
  Copy,
  FileCog,
  GitBranch,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Search,
  Settings2,
  SquarePen,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { resolveAIContextEntries } from '@/lib/flow/ai-context'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { contentNodeText } from '@/domain/content-text'
import type {
  AIMessage,
  AINodeSpec,
  AIReasoningLevel,
  AISession,
  AIWebSearchMode,
  ContentCategory,
  ContentNodeSpec,
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
  aiVariableToken,
  compileAiPromptParts,
  promptHasUsableContent,
  type AIContextEntry,
} from '@/lib/flow/ai-prompt'
import { AI_NODE_DEFAULT_SIZE, CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { useAIStore } from '@/stores/use-ai-store'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { bindNodeMenus } from '@/canvas/node-menu-placement'
import { useRuntimeStore } from '@/stores/runtime-store'

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
const VARIABLE_MIME = 'application/x-cnote-ai-variable'
const DOWNSTREAM_OFFSET_X = 88
const EMPTY_MESSAGES: AIMessage[] = []
const sendingAINodeIds = new Set<string>()
const sendingListeners = new Set<() => void>()
function subscribeSending(listener: () => void) {
  sendingListeners.add(listener)
  return () => { sendingListeners.delete(listener) }
}
function setNodeSending(nodeId: string, sending: boolean) {
  if (sending) sendingAINodeIds.add(nodeId)
  else sendingAINodeIds.delete(nodeId)
  sendingListeners.forEach((listener) => listener())
}

export function isAINodeSendInflight(nodeId: string) {
  return sendingAINodeIds.has(nodeId)
}

type UpstreamEntry = AIContextEntry & { color: string }

function categoryColor(category?: ContentCategory | null): string {
  if (category === 'video') return 'bg-red-500'
  if (category === 'image') return 'bg-cyan-500'
  if (category === 'social') return 'bg-pink-500'
  if (category === 'document') return 'bg-blue-500'
  if (category === 'data') return 'bg-emerald-500'
  if (category === 'mindmap') return 'bg-violet-500'
  return 'bg-slate-500'
}

function upstreamColor(node: NodeSpec): string {
  if (node.kind === 'content') return categoryColor(node.category)
  if (node.kind === 'browser') return 'bg-blue-500'
  if (node.kind === 'ai') return 'bg-violet-500'
  return 'bg-slate-500'
}

function promptWithVariableLabels(value: string, entries: UpstreamEntry[]): string {
  const labels = new Map(entries.map((entry) => [entry.nodeId, entry.label]))
  return value.replace(/\{\{node:([A-Za-z0-9_-]+)\}\}/g, (_match, nodeId: string) => `【${labels.get(nodeId) || '变量'}】`)
}

function createVariableElement(entry: UpstreamEntry): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.dataset.aiVariable = entry.nodeId
  chip.className = 'ai-prompt-variable'
  const dot = document.createElement('span')
  dot.className = `ai-prompt-variable-dot ${entry.color}`
  const label = document.createElement('span')
  label.textContent = entry.label
  chip.append(dot, label)
  return chip
}

function promptValueFromEditor(element: HTMLElement): string {
  const visit = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.dataset.aiVariable) return aiVariableToken(node.dataset.aiVariable)
    if (node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(visit).join('')
    return node.tagName === 'DIV' ? `${text}\n` : text
  }
  return [...element.childNodes].map(visit).join('').replace(/\n+$/, '')
}

function renderPromptEditor(element: HTMLElement, value: string, entries: UpstreamEntry[]): void {
  const entryById = new Map(entries.map((entry) => [entry.nodeId, entry]))
  const content = document.createElement('span')
  content.className = 'ai-prompt-editor-content'
  content.dataset.placeholder = element.dataset.placeholder || ''
  let cursor = 0
  for (const match of value.matchAll(/\{\{node:([A-Za-z0-9_-]+)\}\}/g)) {
    const index = match.index || 0
    if (index > cursor) content.append(document.createTextNode(value.slice(cursor, index)))
    const entry = entryById.get(match[1])
    content.append(entry ? createVariableElement(entry) : document.createTextNode('【未连接变量】'))
    cursor = index + match[0].length
  }
  if (cursor < value.length) content.append(document.createTextNode(value.slice(cursor)))
  element.replaceChildren(content)
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the document command for older or restricted desktop shells.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard-unavailable')
}

function createTextContentNode(id: string, position: { x: number; y: number }, content: string): ContentNodeSpec {
  return {
    id,
    kind: 'content',
    position,
    size: { width: CONTENT_NODE_DEFAULT_SIZE.width, height: CONTENT_NODE_DEFAULT_SIZE.height },
    label: 'AI 回复',
    category: 'text',
    subtype: 'markdown',
    source: { kind: 'text', mimeType: 'text/markdown' },
    content,
  }
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
        nodeId: fields.id,
        title: '新会话 1',
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    }
    if (!runtime.aiSessions[declaredId]?.nodeId) runtime.putAISession({ ...runtime.aiSessions[declaredId], nodeId: fields.id })
    return declaredId
  }

  const now = Date.now()
  const session: AISession = {
    id: nanoid(),
    nodeId: fields.id,
    title: '新会话 1',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  runtime.putAISession(session)
  patchAI(fields.id, { activeSessionId: session.id })
  return session.id
}

function textFromUpstreamNode(node: NodeSpec): string {
  switch (node.kind) {
    case 'content':
      return contentNodeText(node) ?? node.label
    case 'browser':
      return (node.latestCaptureId ? useRuntimeStore.getState().captures[node.latestCaptureId]?.text : undefined) || node.url
    case 'sticky':
      return node.content
    case 'ai':
      return (node.activeSessionId ? useRuntimeStore.getState().aiSessions[node.activeSessionId]?.messages.filter(message => message.role === 'assistant').slice(-1)[0]?.content : undefined) || node.label
    case 'request':
    case 'group':
      return node.label
  }
}

function collectUpstreamEntries(
  nodeId: string,
  nodes: NodeSpec[] | undefined,
  edges: { source: string; target: string }[] | undefined,
): UpstreamEntry[] {
  if (!nodes || !edges) return []
  const sourceIds = [...new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source))]
  const entries: UpstreamEntry[] = []
  for (const sourceId of sourceIds) {
    const source = nodes.find((item) => item.id === sourceId)
    if (!source) continue
    entries.push({
      nodeId: source.id,
      label: source.label || '上游节点',
      text: textFromUpstreamNode(source).trim(),
      color: upstreamColor(source),
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

export const AIContent = memo(function AIContent({ node, presentation = 'node' }: { node: AINodeSpec; presentation?: 'node' | 'panel' }) {
  const showSettings = useUiStore((state) => state.nodeChrome[node.id]?.settings === true)
  const sessions = useRuntimeStore((state) => state.aiSessions)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('')
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setToolbarHost(presentation === 'node' ? document.querySelector<HTMLElement>(`[data-ai-toolbar="${node.id}"]`) : null)
  }, [node.id, presentation])
  const apiKeys = useAIStore((state) => state.apiKeys)
  const getAPIKey = useAIStore((state) => state.getAPIKey)
  const createClientForChannel = useAIStore((state) => state.createClientForChannel)

  const session = useRuntimeStore((state) =>
    node.activeSessionId ? state.aiSessions[node.activeSessionId] : undefined,
  )
  const messages = session?.messages ?? EMPTY_MESSAGES

  const documentEdges = useGraphStore((state) => state.currentDocument?.edges)
  const documentNodes = useGraphStore((state) => state.currentDocument?.nodes)
  const upstreamEntries = useMemo(
    () => collectUpstreamEntries(node.id, documentNodes, documentEdges),
    [documentEdges, documentNodes, node.id],
  )
  const lastUserMessageIndex = useMemo(
    () => messages.reduce((lastIndex, message, index) => (message.role === 'user' ? index : lastIndex), -1),
    [messages],
  )

  const [prompt, setPrompt] = useState(node.prompt || '')
  const [systemPromptDraft, setSystemPromptDraft] = useState(node.systemPrompt || '')
  const showSystemPrompt = useUiStore((state) => state.nodeChrome[node.id]?.systemPrompt === true)
  const isSending = useSyncExternalStore(subscribeSending, () => isAINodeSendInflight(node.id), () => false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [hoveredMessage, setHoveredMessage] = useState<{ role: AIMessage['role']; index: number } | null>(null)
  const [messageActionsPosition, setMessageActionsPosition] = useState<{
    top: number
    left: number
    align: 'left' | 'right'
  } | null>(null)
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)

  const sendingRef = useRef(false)
  const requestControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const composerAreaRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const messageElementRefs = useRef(new Map<number, HTMLDivElement>())
  const messageActionsHoverTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!rootRef.current) return
    return bindNodeMenus(rootRef.current, () => {
      const insets = canvasOverlayInsets(useUiStore.getState())
      return presentation === 'panel' ? { zoom: 1, leftInset: 0, rightInset: 0 } : { zoom: useGraphStore.getState().view.zoom, leftInset: insets.left, rightInset: insets.right }
    })
  }, [presentation])

  useEffect(() => {
    if (!toolbarHost) return
    return bindNodeMenus(toolbarHost, () => ({ zoom: 1, leftInset: canvasOverlayInsets(useUiStore.getState()).left, rightInset: canvasOverlayInsets(useUiStore.getState()).right }))
  }, [toolbarHost])

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

  useLayoutEffect(() => {
    const composer = composerRef.current
    if (!composer || document.activeElement === composer) return
    renderPromptEditor(composer, prompt, upstreamEntries)
  }, [prompt, upstreamEntries])

  useEffect(() => {
    return () => {
      if (messageActionsHoverTimerRef.current !== null) window.clearTimeout(messageActionsHoverTimerRef.current)
    }
  }, [])

  const persistPrompt = useCallback(
    (value: string) => {
      setPrompt(value)
      const stored = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === node.id)
      if (stored && stored.kind === 'ai' && (stored.prompt || '') === value) return
      patchAI(node.id, { prompt: value })
    },
    [node.id],
  )

  const insertVariable = useCallback(
    (entry: UpstreamEntry, range?: Range) => {
      const composer = composerRef.current
      if (!composer || isSending || node.disabled) return
      composer.focus()
      const editorContent = composer.querySelector<HTMLElement>('.ai-prompt-editor-content') || composer
      const selection = window.getSelection()
      const targetRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : null)
      const insertionRange = targetRange && composer.contains(targetRange.commonAncestorContainer)
        ? targetRange
        : document.createRange()
      if (!targetRange || !composer.contains(targetRange.commonAncestorContainer)) {
        insertionRange.selectNodeContents(editorContent)
      }
      insertionRange.collapse(false)
      insertionRange.deleteContents()
      const chip = createVariableElement(entry)
      insertionRange.insertNode(chip)
      const trailing = document.createTextNode(' ')
      chip.after(trailing)
      const nextRange = document.createRange()
      nextRange.setStartAfter(trailing)
      nextRange.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(nextRange)
      persistPrompt(promptValueFromEditor(composer))
    },
    [isSending, node.disabled, persistPrompt],
  )

  const receiveVariableDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nodeId = event.dataTransfer.getData(VARIABLE_MIME)
      const entry = upstreamEntries.find((item) => item.nodeId === nodeId)
      if (!entry) return
      const docWithCaret = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
      insertVariable(entry, docWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY) || undefined)
    },
    [insertVariable, upstreamEntries],
  )

  const updateMessageActionsPosition = useCallback(
    (role: AIMessage['role'], index: number, element?: HTMLDivElement | null) => {
      const root = rootRef.current
      const composerArea = composerAreaRef.current
      const history = historyRef.current
      const message = element || messageElementRefs.current.get(index)
      if (!root || !composerArea || !message) return
      const rootRect = root.getBoundingClientRect()
      const messageRect = message.getBoundingClientRect()
      const composerRect = composerArea.getBoundingClientRect()
      const historyRect = history?.getBoundingClientRect()
      if (historyRect && (messageRect.bottom < historyRect.top || messageRect.top > composerRect.top)) {
        setHoveredMessage(null)
        setMessageActionsPosition(null)
        return
      }
      const scaleX = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1
      const scaleY = root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1
      const preferredTop = (messageRect.bottom - rootRect.top) / scaleY + 6
      const lowestTop = (composerRect.top - rootRect.top) / scaleY - 38
      const leftEdge = (role === 'user' ? messageRect.right : messageRect.left) - rootRect.left
      const left = Math.max(8, Math.min(leftEdge / scaleX, root.offsetWidth - 8))
      setMessageActionsPosition({
        top: Math.max(8, Math.min(preferredTop, Math.max(8, lowestTop))),
        left,
        align: role === 'user' ? 'right' : 'left',
      })
    },
    [],
  )

  const showMessageActions = (role: AIMessage['role'], index: number, element: HTMLDivElement) => {
    if (messageActionsHoverTimerRef.current !== null) window.clearTimeout(messageActionsHoverTimerRef.current)
    setHoveredMessage({ role, index })
    updateMessageActionsPosition(role, index, messageElementRefs.current.get(index) || element)
  }

  const hideMessageActions = () => {
    if (messageActionsHoverTimerRef.current !== null) window.clearTimeout(messageActionsHoverTimerRef.current)
    messageActionsHoverTimerRef.current = window.setTimeout(() => {
      setHoveredMessage(null)
      setMessageActionsPosition(null)
    }, 140)
  }

  const copyMessage = async (index: number) => {
    const message = messages[index]
    if (!message) return
    const key = `${message.role}:${index}`
    const value = message.role === 'user' ? promptWithVariableLabels(message.content, upstreamEntries) : message.content
    try {
      await copyText(value)
      setCopiedMessageKey(key)
      window.setTimeout(() => setCopiedMessageKey((current) => (current === key ? null : current)), 1200)
    } catch {
      setRequestError('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  const branchReply = (index: number) => {
    const reply = messages[index]
    if (!reply || reply.role !== 'assistant') return
    const source = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === node.id)
    if (!source) return
    const now = Date.now()
    const branchNodeId = nanoid()
    const branchSession: AISession = {
      id: nanoid(),
      nodeId: branchNodeId,
      title: `${source.label || 'AI 节点'} 分支`,
      messages: messages.slice(0, index + 1).map((item) => ({ ...item })),
      model: node.model,
      createdAt: now,
      updatedAt: now,
    }
    useRuntimeStore.getState().putAISession(branchSession)
    const branchNode: NodeSpec = {
      id: branchNodeId,
      kind: 'ai',
      position: { x: source.position.x + source.size.width + DOWNSTREAM_OFFSET_X, y: source.position.y },
      size: { width: AI_NODE_DEFAULT_SIZE.width, height: AI_NODE_DEFAULT_SIZE.height },
      label: `${source.label || 'AI 节点'} 分支`,
      channelId: node.channelId,
      model: node.model,
      systemPrompt: node.systemPrompt,
      temperature: node.temperature,
      maxOutputTokens: node.maxOutputTokens,
      webSearch: node.webSearch,
      reasoningLevel: node.reasoningLevel,
      activeSessionId: branchSession.id,
    }
    useGraphStore.getState().addNode(branchNode)
    setHoveredMessage(null)
    setMessageActionsPosition(null)
  }

  const editReplyAsTextNode = (index: number) => {
    const reply = messages[index]
    const source = useGraphStore.getState().currentDocument?.nodes.find((item) => item.id === node.id)
    if (!reply || reply.role !== 'assistant' || !source) return
    const createdId = nanoid()
    useGraphStore.getState().addNode(
      createTextContentNode(
        createdId,
        { x: source.position.x + source.size.width + DOWNSTREAM_OFFSET_X, y: source.position.y },
        reply.content,
      ),
    )
    useGraphStore.getState().addEdge(node.id, createdId, { sourceHandle: 'out', targetHandle: 'in' })
    setHoveredMessage(null)
    setMessageActionsPosition(null)
  }

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
      nodeId: node.id,
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

  const sendMessage = useCallback(async (options?: { retryIndex?: number }) => {
    const retryIndex = options?.retryIndex
    const isRetry = retryIndex !== undefined
    const retryTarget = isRetry ? messages[retryIndex] : undefined
    if (isRetry && (!retryTarget || retryTarget.role !== 'user' || retryIndex !== lastUserMessageIndex)) return

    const displayContent = (retryTarget?.content || prompt).trim()
    if (!promptHasUsableContent(displayContent) || sendingRef.current || isAINodeSendInflight(node.id) || node.disabled) return

    const sessionId = ensureActiveSession({ id: node.id, activeSessionId: node.activeSessionId })
    const active = useRuntimeStore.getState().aiSessions[sessionId]
    if (!active) {
      setRequestError('当前没有可用的会话')
      return
    }

    const requestOption =
      isRetry && retryTarget?.channelId && retryTarget.model
        ? {
            channelId: retryTarget.channelId,
            model: retryTarget.model,
            channelName: selectedOption?.channelName || '',
          }
        : selectedOption
    if (!requestOption) {
      setRequestError('请先选择一个已配置的模型')
      return
    }
    const client = createClientForChannel(requestOption.channelId)
    if (!client) {
      setRequestError('当前模型渠道尚未正确配置，请检查 API Key、服务地址和模型列表')
      return
    }

    if (isRetry) {
      useRuntimeStore.getState().putAISession({
        ...active,
        messages: active.messages.slice(0, retryIndex),
        updatedAt: Date.now(),
      })
    }

    const userMessage: AIMessage = {
      role: 'user',
      content: displayContent,
      channelId: requestOption.channelId,
      model: requestOption.model,
      createdAt: Date.now(),
    }
    useRuntimeStore.getState().appendMessage(sessionId, userMessage)
    persistPrompt('')
    if (composerRef.current) renderPromptEditor(composerRef.current, '', upstreamEntries)
    setRequestError(null)
    setHoveredMessage(null)
    setMessageActionsPosition(null)
    setNodeSending(node.id, true)
    sendingRef.current = true

    const controller = new AbortController()
    requestControllerRef.current = controller

    try {
      const entries = collectUpstreamEntries(
        node.id,
        useGraphStore.getState().currentDocument?.nodes,
        useGraphStore.getState().currentDocument?.edges,
      )
      const resolvedEntries = await resolveAIContextEntries(entries, useGraphStore.getState().currentDocument?.nodes || [], displayContent, controller.signal)
      if (controller.signal.aborted) throw new DOMException('执行已停止', 'AbortError')
      const compiled = toChatContent(compileAiPromptParts(displayContent, resolvedEntries))
      const history = useRuntimeStore.getState().aiSessions[sessionId]?.messages ?? []
      const prior = history.slice(0, -1)
      const request: ChatCompletionRequest = {
        model: requestOption.model,
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
        channelId: requestOption.channelId,
        model: requestOption.model,
        createdAt: Date.now(),
      })
      const currentSession = useRuntimeStore.getState().aiSessions[sessionId]
      if (currentSession && currentSession.messages.length <= 2) {
        useRuntimeStore.getState().putAISession({
          ...currentSession,
          title: promptWithVariableLabels(displayContent, entries).slice(0, 24) || currentSession.title,
          updatedAt: Date.now(),
        })
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setRequestError(null)
      } else {
        setRequestError(errorText(error, 'AI 请求失败，请稍后重试'))
      }
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null
      sendingRef.current = false
      setNodeSending(node.id, false)
    }
  }, [
    createClientForChannel,
    effectiveReasoningLevel,
    lastUserMessageIndex,
    messages,
    modelCapabilities.webSearch,
    node.activeSessionId,
    node.disabled,
    node.id,
    node.maxOutputTokens,
    node.temperature,
    persistPrompt,
    prompt,
    selectedOption,
    systemPromptDraft,
    upstreamEntries,
    webSearch,
  ])

  const retryMessage = (index: number) => {
    if (isSending || index !== lastUserMessageIndex) return
    void sendMessage({ retryIndex: index })
  }

  const modelMenu = (
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
            data-node-menu="left" data-menu-width="256" data-menu-height="288"
            className="cnote-menu-surface absolute left-0 top-[calc(100%+8px)] z-50 max-h-72 min-w-64 overflow-auto overscroll-contain"
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
  )
  const toolbarControls = <>
    {modelMenu}
    <details className="relative min-w-0">
      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden" title="会话管理" aria-label="会话管理">
        <MessageSquarePlus className="h-4 w-4" />
      </summary>
      <div data-node-menu="left" data-menu-width="256" data-menu-height="288" className="cnote-menu-surface absolute left-0 top-full z-50 max-h-72 min-w-64 overflow-auto" onWheel={stopNodeGesture}>
        <button type="button" className="cnote-menu-item" disabled={isSending} onClick={(event) => { if (isAINodeSendInflight(node.id)) return; startNewSession(); closeMenu(event.currentTarget) }}>新建会话</button>
        <div className="my-1 h-px bg-border" />
        {Object.values(sessions).filter((item) => item.nodeId === node.id || item.id === node.activeSessionId).sort((first, second) => second.updatedAt - first.updatedAt).map((item) => (
          <div key={item.id} className="flex min-w-0 items-center">
            {renamingSessionId === item.id ? <form className="flex min-w-0 flex-1 gap-1 p-2" onSubmit={(event) => { event.preventDefault(); const current = useRuntimeStore.getState().aiSessions[item.id]; if (current && sessionTitle.trim()) useRuntimeStore.getState().putAISession({ ...current, title: sessionTitle.trim(), updatedAt: Date.now() }); setRenamingSessionId(null) }}>
              <input autoFocus aria-label="会话名称" className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs" value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setRenamingSessionId(null) } }} />
              <button type="submit" className="text-xs" disabled={!sessionTitle.trim()}>保存</button>
            </form> : <button type="button" className="cnote-menu-item min-w-0 flex-1" aria-pressed={item.id === node.activeSessionId} disabled={isSending} onClick={(event) => { if (isAINodeSendInflight(node.id)) return; patchAI(node.id, { activeSessionId: item.id }); setRequestError(null); closeMenu(event.currentTarget) }}><span className="truncate">{item.title || '新会话'}</span></button>}
            <button type="button" title="重命名会话" aria-label={typeof item.title === 'string' ? '重命名会话 ' + item.title : '重命名会话'} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => { setRenamingSessionId(item.id); setSessionTitle(item.title) }}><SquarePen className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </details>
    <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="系统提示词" title="系统提示词" aria-pressed={showSystemPrompt} onClick={() => { persistSystemPrompt(); useUiStore.getState().setNodeChrome(node.id, { systemPrompt: !showSystemPrompt }) }}><FileCog className="h-4 w-4" /></button>
    <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="AI 设置" title="AI 设置" aria-pressed={showSettings} onClick={() => useUiStore.getState().setNodeChrome(node.id, { settings: !showSettings })}><Settings2 className="h-4 w-4" /></button>
  </>

  return (
    <div
      ref={rootRef}
      className={`relative flex h-full w-full min-h-0 min-w-0 overflow-visible bg-card ${presentation === 'panel' ? 'flex-col' : 'rounded-[24px] border border-border'}`}
      onPointerDown={stopNodeGesture}
    >
      {upstreamEntries.length > 0 && (
        <div
          className={presentation === 'panel' ? "flex shrink-0 flex-wrap gap-2 pb-2" : "absolute right-[calc(100%+20px)] top-1/2 flex max-h-full max-w-[180px] -translate-y-1/2 flex-col gap-2 overflow-y-auto py-2"}
          role="list"
          aria-label="上游变量"
          onPointerDown={stopNodeGesture}
          onWheel={stopNodeGesture}
        >
          {upstreamEntries.map((entry) => (
            <button
              key={entry.nodeId}
              type="button"
              draggable
              role="listitem"
              className="ai-source-variable"
              title={`拖入输入框引用${entry.label}`}
              aria-label={`插入变量 ${entry.label}`}
              onPointerDown={stopNodeGesture}
              onDragStart={(event) => {
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData(VARIABLE_MIME, entry.nodeId)
                event.dataTransfer.setData('text/plain', aiVariableToken(entry.nodeId))
              }}
              onClick={() => insertVariable(entry)}
            >
              <span className={`ai-source-variable-dot ${entry.color}`} />
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible">
      {presentation === 'panel' ? <div className="flex flex-wrap items-center gap-1 pb-2">{toolbarControls}</div> : toolbarHost ? createPortal(toolbarControls, toolbarHost) : null}

      {showSystemPrompt && (
        <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2">
          <label className="mb-1 block text-[10px] font-medium text-muted-foreground" htmlFor={`ai-system-${presentation}-${node.id}`}>
            系统提示词
          </label>
          <textarea
            id={`ai-system-${presentation}-${node.id}`}
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


      <div
        ref={historyRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
        onPointerDown={stopNodeGesture}
        onWheel={stopNodeGesture}
        onScroll={() => {
          if (hoveredMessage) updateMessageActionsPosition(hoveredMessage.role, hoveredMessage.index)
        }}
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
                  className={`ai-message-row ${isUser ? 'ai-user-message-row' : 'ai-assistant-message-row'}`}
                >
                  <div
                    data-ai-message-role={message.role}
                    data-ai-message-index={index}
                    ref={(element) => {
                      if (element) messageElementRefs.current.set(index, element)
                      else messageElementRefs.current.delete(index)
                    }}
                    onMouseEnter={(event) => showMessageActions(message.role, index, event.currentTarget)}
                    onMouseLeave={hideMessageActions}
                    className={`ai-message-bubble max-w-[86%] min-w-0 rounded-2xl px-3 py-2 text-xs leading-5 ${
                      isUser ? 'whitespace-pre-wrap bg-muted text-foreground' : 'bg-transparent text-foreground'
                    }`}
                  >
                    {isUser ? promptWithVariableLabels(message.content, upstreamEntries) : (
                      <RichTextEditor
                        value={message.content}
                        editable={false}
                        toolbar={false}
                        markdownSource
                        className="[&_.cnote-rich-text]:min-h-0 [&_.cnote-rich-text]:text-xs [&_.cnote-rich-text]:leading-5"
                        contentClassName="overflow-visible"
                      />
                    )}
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

      <div ref={composerAreaRef} className="relative z-30 shrink-0 p-2 pt-1">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
          <div
            ref={composerRef}
            role="textbox"
            aria-multiline="true"
            aria-label="输入提示词"
            contentEditable={!isSending && !node.disabled}
            suppressContentEditableWarning
            data-placeholder="输入提示词，可从侧栏插入上游变量"
            className="ai-prompt-editor min-h-[40px] flex-1 px-2 py-1 text-xs leading-5 text-foreground outline-none"
            onPointerDown={stopNodeGesture}
            onWheel={stopNodeGesture}
            onInput={(event) => persistPrompt(promptValueFromEditor(event.currentTarget))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={receiveVariableDrop}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
      {showSettings && (
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
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
        <div className="ml-auto min-w-0">{modelMenu}</div>
      </div>

      )}
      </div>

      {hoveredMessage && messageActionsPosition && (
        <div
          className={`ai-message-actions ${messageActionsPosition.align === 'right' ? 'ai-message-actions-right' : 'ai-message-actions-left'}`}
          style={{ top: messageActionsPosition.top, left: messageActionsPosition.left }}
          role="toolbar"
          aria-label={hoveredMessage.role === 'user' ? '用户消息操作' : '回复操作'}
          onMouseEnter={() => {
            if (messageActionsHoverTimerRef.current !== null) window.clearTimeout(messageActionsHoverTimerRef.current)
          }}
          onMouseLeave={hideMessageActions}
          onPointerDown={stopNodeGesture}
        >
          {hoveredMessage.role === 'user' ? (
            <>
              <button
                type="button"
                title="复制"
                aria-label="复制用户消息"
                onClick={() => {
                  void copyMessage(hoveredMessage.index)
                }}
              >
                <Copy className="h-4 w-4" />
                {copiedMessageKey === `user:${hoveredMessage.index}` && <span className="sr-only">已复制</span>}
              </button>
              {hoveredMessage.index === lastUserMessageIndex && (
                <button
                  type="button"
                  disabled={isSending}
                  title="重试"
                  aria-label="重试最后一条用户消息"
                  onClick={() => retryMessage(hoveredMessage.index)}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" title="分支" aria-label="分支为新 AI 节点" onClick={() => branchReply(hoveredMessage.index)}>
                <GitBranch className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="编辑为文本节点"
                aria-label="编辑为文本节点"
                onClick={() => editReplyAsTextNode(hoveredMessage.index)}
              >
                <SquarePen className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="复制"
                aria-label="复制回复"
                onClick={() => {
                  void copyMessage(hoveredMessage.index)
                }}
              >
                <Copy className="h-4 w-4" />
                {copiedMessageKey === `assistant:${hoveredMessage.index}` && <span className="sr-only">已复制</span>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})
