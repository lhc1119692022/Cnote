import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { ArrowUp, Brain, ChevronDown, Copy, FileCog, GitBranch, History, LoaderCircle, MessageSquarePlus, Search, Settings, Sparkles, SquarePen, Trash2, X } from 'lucide-react'
import { useAIStore } from '@/stores/use-ai-store'
import { useFlowStore } from '@/stores/use-flow-store'
import { extractTextFromNode, saveTextContentToNode } from '@/lib/content-import-controller'
import { emptyContentData } from '@/lib/content-import'
import { adaptReasoningLevel, getAIModelCapabilities, getProvider, type ChatCompletionRequest, type ChatContentPart } from '@/lib/api'
import { AI_NODE_DEFAULT_SIZE, AI_NODE_MAX_AUTO_HEIGHT, AI_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import { aiVariableToken, compileAiPrompt, compileAiPromptParts, promptHasUsableContent, type AIContextEntry } from '@/lib/flow/ai-prompt'
import { buildAIContextEntries } from '@/lib/flow/ai-context'
import type { AIMessage, AINodeData, AIReasoningLevel, AISession, ContentCategory, ContentNodeData, AIWebSearchMode } from '@/types/flow'
import { MarkdownPreview } from '../ContentEditorPanel'
import { NodeHandle, NodeResizeArc } from './NodeChrome'

const WEB_SEARCH_MODES: AIWebSearchMode[] = ['auto', 'on', 'off']
const WEB_SEARCH_LABELS: Record<AIWebSearchMode, string> = { auto: '自动', on: '开启', off: '关闭' }
const REASONING_LEVELS: AIReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const VARIABLE_PATTERN = /\{\{node:([A-Za-z0-9_-]+)\}\}/g
const LEGACY_AI_NODE_DEFAULT_HEIGHT = 680

type UpstreamEntry = AIContextEntry & { color: string }

function categoryColor(category?: ContentCategory | null) {
  if (category === 'video') return 'bg-red-500'
  if (category === 'image') return 'bg-cyan-500'
  if (category === 'social') return 'bg-pink-500'
  if (category === 'document') return 'bg-blue-500'
  if (category === 'data') return 'bg-emerald-500'
  if (category === 'mindmap') return 'bg-violet-500'
  return 'bg-slate-500'
}

function contextTextForNode(node: { type?: string; data?: Record<string, unknown> }) {
  const directText = extractTextFromNode(node as any).trim()
  if (directText) return directText
  const data = node.data as ContentNodeData | undefined
  if (node.type === 'content') {
    const payload = data?.payload
    if (payload?.kind === 'image') return [payload.alt, data?.preview?.title, data?.preview?.description, data?.source?.kind === 'url' ? data.source.normalizedUrl : ''].filter(Boolean).join('\n')
    if (payload?.kind === 'video') return [payload.title, payload.url, data?.preview?.description].filter(Boolean).join('\n')
    if (data?.source?.kind === 'url') return [data.preview?.title, data.preview?.description, data.source.normalizedUrl].filter(Boolean).join('\n')
  }
  if (node.type === 'browser') return String(node.data?.confirmedUrl || node.data?.url || '')
  return String(node.data?.label || '')
}

function isUnsupportedLocalVideoNode(node: { type?: string; data?: Record<string, unknown> }) {
  const data = node.data as ContentNodeData | undefined
  return node.type === 'content' && data?.category === 'video' && data.source?.kind === 'file'
}

function promptWithVariableLabels(value: string, entries: UpstreamEntry[]) {
  const labels = new Map(entries.map((entry) => [entry.nodeId, entry.label]))
  return value.replace(VARIABLE_PATTERN, (_match, nodeId: string) => `【${labels.get(nodeId) || '变量'}】`)
}

function messageContentLength(content: string | ChatContentPart[]) {
  return typeof content === 'string'
    ? content.length
    : content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 1200), 0)
}

function createVariableElement(entry: UpstreamEntry) {
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

function promptValueFromEditor(element: HTMLElement) {
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

function renderPromptEditor(element: HTMLElement, value: string, entries: UpstreamEntry[]) {
  const entryById = new Map(entries.map((entry) => [entry.nodeId, entry]))
  const content = document.createElement('span')
  content.className = 'ai-prompt-editor-content'
  content.dataset.placeholder = element.dataset.placeholder || ''
  let cursor = 0
  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const index = match.index || 0
    if (index > cursor) content.append(document.createTextNode(value.slice(cursor, index)))
    const entry = entryById.get(match[1])
    content.append(entry ? createVariableElement(entry) : document.createTextNode('【未连接变量】'))
    cursor = index + match[0].length
  }
  if (cursor < value.length) content.append(document.createTextNode(value.slice(cursor)))
  element.replaceChildren(content)
}

function createSession(index: number): AISession {
  const now = Date.now()
  return {
    id: globalThis.crypto?.randomUUID?.() || `session-${now}-${index}`,
    title: `新会话 ${index + 1}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function closeOpenMenus(root: ParentNode | null, except?: HTMLDetailsElement | null) {
  root?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
    if (menu !== except) menu.removeAttribute('open')
  })
}

export const AINode = memo(({ id, data, selected }: NodeProps<AINodeData>) => {
  const apiKeys = useAIStore((state) => state.apiKeys)
  const getAPIKey = useAIStore((state) => state.getAPIKey)
  const createClientForChannel = useAIStore((state) => state.createClientForChannel)
  const updateNode = useFlowStore((state) => state.updateNode)
  const deleteNode = useFlowStore((state) => state.deleteNode)
  const addNode = useFlowStore((state) => state.addNode)
  const addEdge = useFlowStore((state) => state.addEdge)
  const nodes = useFlowStore((state) => state.nodes)
  const edges = useFlowStore((state) => state.edges)
  const nodeStyle = useFlowStore((state) => state.nodes.find((node) => node.id === id)?.style)
  const [showSettings, setShowSettings] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [systemPromptDraft, setSystemPromptDraft] = useState(data.systemPrompt || '')
  const [prompt, setPrompt] = useState(data.prompt || data.userPrompt || '')
  const [isSending, setIsSending] = useState(false)
  const [streamingReply, setStreamingReply] = useState('')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [hoveredReplyIndex, setHoveredReplyIndex] = useState<number | null>(null)
  const [replyActionsTop, setReplyActionsTop] = useState<number | null>(null)
  const [copiedReplyIndex, setCopiedReplyIndex] = useState<number | null>(null)
  const nodeRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const composerAreaRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const replyElementRefs = useRef(new Map<number, HTMLDivElement>())
  const lastAutoSizeRef = useRef<{ width: number; height: number } | null>(null)
  const manuallyResizedRef = useRef(false)
  const replyHoverTimerRef = useRef<number | null>(null)

  const availableChannels = useMemo(
    () => apiKeys.filter((channel) => Boolean(getAPIKey(channel.id)) && Boolean(channel.modelIds?.length)),
    [apiKeys, getAPIKey],
  )
  const modelOptions = useMemo(
    () => availableChannels.flatMap((channel) => (channel.modelIds || []).map((model) => ({ channelId: channel.id, channelName: channel.name, model }))),
    [availableChannels],
  )
  const modelGroups = useMemo(
    () => availableChannels.map((channel) => ({ channelId: channel.id, channelName: channel.name, models: channel.modelIds || [] })),
    [availableChannels],
  )
  const selectedModel = modelOptions.find((option) => option.channelId === data.channelId && option.model === data.model) || modelOptions[0]
  const selectedChannel = selectedModel ? apiKeys.find((channel) => channel.id === selectedModel.channelId) : undefined
  const selectedProvider = selectedChannel ? getProvider(selectedChannel.providerId) : undefined
  const modelCapabilities = selectedModel && selectedChannel
    ? getAIModelCapabilities(selectedChannel.providerId, selectedChannel.protocol || selectedProvider?.protocol || 'chatCompletions', selectedModel.model, selectedChannel.baseURL)
    : getAIModelCapabilities('custom', 'chatCompletions', '')
  const sessions = useMemo(() => data.sessions || [], [data.sessions])
  const activeSession = sessions.find((session) => session.id === data.activeSessionId)
  const messages = useMemo(() => activeSession?.messages || data.messages || [], [activeSession?.messages, data.messages])
  const webSearch = data.webSearch || 'auto'
  const reasoningLevel = data.reasoningLevel || 'medium'
  const effectiveReasoningLevel = adaptReasoningLevel(modelCapabilities, reasoningLevel)
  const disabled = Boolean(data.disabled || !selectedModel)
  const upstreamEntries = useMemo<UpstreamEntry[]>(() => {
    const sourceIds = [...new Set(edges.filter((edge) => edge.target === id).map((edge) => edge.source))]
    return sourceIds.flatMap((sourceId) => {
      const source = nodes.find((node) => node.id === sourceId)
      if (!source || isUnsupportedLocalVideoNode(source)) return []
      return [{
        nodeId: source.id,
        label: String(source.data?.label || '上游节点'),
        text: contextTextForNode(source),
        color: source.type === 'content' ? categoryColor((source.data as ContentNodeData).category) : source.type === 'browser' ? 'bg-blue-500' : source.type === 'ai' ? 'bg-violet-500' : 'bg-slate-500',
      }]
    })
  }, [edges, id, nodes])
  const upstreamSourceIds = useMemo(() => [...new Set(edges.filter((edge) => edge.target === id).map((edge) => edge.source))], [edges, id])
  const canSend = promptHasUsableContent(prompt) && Boolean(selectedModel) && !isSending && !data.disabled
  const showEmptyState = !messages.length && !isSending && !requestError

  const persist = useCallback((updates: Partial<AINodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    updateNode(id, { data: { ...current.data, ...updates } })
  }, [id, updateNode])

  useEffect(() => {
    const updates: Partial<AINodeData> = {}
    if (selectedModel && (data.channelId !== selectedModel.channelId || data.model !== selectedModel.model)) {
      updates.channelId = selectedModel.channelId
      updates.model = selectedModel.model
    }
    if (data.temperature !== 1) updates.temperature = 1
    if (!data.maxTokens) updates.maxTokens = 258000
    if (!data.autoCompressThreshold) updates.autoCompressThreshold = 0.7
    if (!data.webSearch) updates.webSearch = 'auto'
    if (!data.reasoningLevel) updates.reasoningLevel = 'medium'
    if (!data.sessions) updates.sessions = []
    if (!data.messages) updates.messages = []
    if (Object.keys(updates).length) persist(updates)
  }, [data, persist, selectedModel])

  useEffect(() => {
    setPrompt(data.prompt || data.userPrompt || '')
  }, [data.prompt, data.userPrompt])

  useEffect(() => {
    setSystemPromptDraft(data.systemPrompt || '')
  }, [data.systemPrompt])

  useLayoutEffect(() => {
    const composer = composerRef.current
    if (!composer || document.activeElement === composer) return
    renderPromptEditor(composer, prompt, upstreamEntries)
  }, [prompt, upstreamEntries])

  useEffect(() => () => {
    if (replyHoverTimerRef.current !== null) window.clearTimeout(replyHoverTimerRef.current)
  }, [])

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

  useLayoutEffect(() => {
    const history = historyRef.current
    if (!history || (!messages.length && !streamingReply && !isSending && !requestError)) return
    history.scrollTop = history.scrollHeight
  }, [isSending, messages, requestError, streamingReply])

  useLayoutEffect(() => {
    const persistedHeight = Number(nodeStyle?.height)
    const height = Number.isFinite(persistedHeight) && persistedHeight > 0
      ? persistedHeight
      : AI_NODE_DEFAULT_SIZE.height
    const width = Number(nodeStyle?.width) || AI_NODE_DEFAULT_SIZE.width
    if (manuallyResizedRef.current) return
    const lastAutoSize = lastAutoSizeRef.current
    if (lastAutoSize && (Math.abs(lastAutoSize.width - width) > 1 || Math.abs(lastAutoSize.height - height) > 1)) {
      manuallyResizedRef.current = true
      return
    }
    const isLegacyEmptyDefault = !messages.length && Math.abs(height - LEGACY_AI_NODE_DEFAULT_HEIGHT) <= 1
    if (!lastAutoSize && Number.isFinite(persistedHeight) && Math.abs(height - AI_NODE_DEFAULT_SIZE.height) > 1 && !isLegacyEmptyDefault) {
      manuallyResizedRef.current = true
      return
    }

    const messageBodyHeight = messageContentRef.current?.scrollHeight || 0
    const targetHeight = Math.max(
      AI_NODE_DEFAULT_SIZE.height,
      Math.min(AI_NODE_MAX_AUTO_HEIGHT, Math.ceil(messageBodyHeight + 156)),
    )
    if (Math.abs(height - targetHeight) <= 1) {
      lastAutoSizeRef.current = { width, height: targetHeight }
      return
    }
    lastAutoSizeRef.current = { width, height: targetHeight }
    updateNode(id, { style: { ...(nodeStyle || {}), width, height: targetHeight } })
  }, [id, isSending, messages, nodeStyle, showSystemPrompt, streamingReply, updateNode])

  const persistPrompt = useCallback((value: string) => {
    setPrompt(value)
    persist({ prompt: value, userPrompt: value })
  }, [persist])

  const insertVariable = useCallback((entry: UpstreamEntry, range?: Range) => {
    const composer = composerRef.current
    if (!composer) return
    composer.focus()
    const editorContent = composer.querySelector<HTMLElement>('.ai-prompt-editor-content') || composer
    const selection = window.getSelection()
    const targetRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : null)
    const insertionRange = targetRange && composer.contains(targetRange.commonAncestorContainer)
      ? targetRange
      : document.createRange()
    if (!targetRange || !composer.contains(targetRange.commonAncestorContainer)) insertionRange.selectNodeContents(editorContent)
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
  }, [persistPrompt])

  const receiveVariableDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const nodeId = event.dataTransfer.getData('application/x-cnote-ai-variable')
    const entry = upstreamEntries.find((item) => item.nodeId === nodeId)
    if (!entry) return
    const docWithCaret = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    insertVariable(entry, docWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY) || undefined)
  }, [insertVariable, upstreamEntries])

  const chooseModel = (channelId: string, model: string) => persist({ channelId, model })

  const startNewSession = () => {
    const session = createSession(sessions.length)
    persist({ sessions: [...sessions, session], activeSessionId: session.id, messages: [], prompt: '', userPrompt: '' })
    setPrompt('')
  }

  const selectSession = (session: AISession) => {
    persist({ activeSessionId: session.id, messages: session.messages, prompt: '', userPrompt: '' })
    setPrompt('')
  }

  const clearSessions = () => {
    persist({ sessions: [], activeSessionId: undefined, messages: [], prompt: '', userPrompt: '' })
    setPrompt('')
  }

  const updateReplyActionsPosition = useCallback((index: number, element?: HTMLDivElement | null) => {
    const node = nodeRef.current
    const composerArea = composerAreaRef.current
    const reply = element || replyElementRefs.current.get(index)
    if (!node || !composerArea || !reply) return
    const nodeRect = node.getBoundingClientRect()
    const replyRect = reply.getBoundingClientRect()
    const composerRect = composerArea.getBoundingClientRect()
    const scaleY = node.offsetHeight > 0 ? nodeRect.height / node.offsetHeight : 1
    const preferredTop = (replyRect.bottom - nodeRect.top) / scaleY + 6
    const lowestTop = (composerRect.top - nodeRect.top) / scaleY - 38
    setReplyActionsTop(Math.max(8, Math.min(preferredTop, lowestTop)))
  }, [])

  const showReplyActions = (index: number, element: HTMLDivElement) => {
    if (replyHoverTimerRef.current !== null) window.clearTimeout(replyHoverTimerRef.current)
    setHoveredReplyIndex(index)
    updateReplyActionsPosition(index, element)
  }

  const hideReplyActions = () => {
    if (replyHoverTimerRef.current !== null) window.clearTimeout(replyHoverTimerRef.current)
    replyHoverTimerRef.current = window.setTimeout(() => setHoveredReplyIndex(null), 140)
  }

  const branchReply = (index: number) => {
    const reply = messages[index]
    if (!reply || reply.role !== 'assistant') return
    const now = Date.now()
    const branchSession: AISession = {
      id: globalThis.crypto?.randomUUID?.() || `branch-${now}`,
      title: `${data.label || 'AI 节点'} 分支`,
      createdAt: now,
      updatedAt: now,
      messages: messages.slice(0, index + 1).map((message) => ({ ...message })),
    }
    const width = Number(nodeStyle?.width) || AI_NODE_DEFAULT_SIZE.width
    addNode({
      type: 'ai',
      position: { x: (nodes.find((node) => node.id === id)?.position.x || 0) + width + 88, y: nodes.find((node) => node.id === id)?.position.y || 0 },
      style: AI_NODE_DEFAULT_SIZE,
      data: {
        label: `${data.label || 'AI 节点'} 分支`,
        channelId: data.channelId,
        model: data.model,
        systemPrompt: data.systemPrompt,
        temperature: 1,
        maxTokens: data.maxTokens || 258000,
        autoCompressThreshold: data.autoCompressThreshold || 0.7,
        webSearch: data.webSearch || 'auto',
        reasoningLevel: data.reasoningLevel || 'medium',
        sessions: [branchSession],
        activeSessionId: branchSession.id,
        messages: branchSession.messages,
        output: reply.content,
        prompt: '',
        userPrompt: '',
      },
    })
    setHoveredReplyIndex(null)
  }

  const copyReply = async (index: number) => {
    const reply = messages[index]
    if (!reply) return
    try {
      await navigator.clipboard.writeText(reply.content)
      setCopiedReplyIndex(index)
      window.setTimeout(() => setCopiedReplyIndex((current) => current === index ? null : current), 1200)
    } catch {
      setRequestError('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  const editReplyAsTextNode = (index: number) => {
    const reply = messages[index]
    const sourceNode = nodes.find((node) => node.id === id)
    if (!reply || !sourceNode) return
    const width = Number(nodeStyle?.width) || AI_NODE_DEFAULT_SIZE.width
    const created = addNode({
      type: 'content',
      position: { x: sourceNode.position.x + width + 88, y: sourceNode.position.y },
      style: { width: 420, height: 360 },
      data: emptyContentData('AI 回复'),
    })
    void saveTextContentToNode(created.id, reply.content, true, { overwrite: true })
    addEdge({ source: id, target: created.id, sourceHandle: 'out', targetHandle: 'in', type: 'interactive' })
    setHoveredReplyIndex(null)
  }

  const sendMessage = async () => {
    const displayContent = prompt.trim()
    if (!promptHasUsableContent(displayContent) || isSending) return
    if (!selectedModel) {
      setRequestError('请先在悬浮菜单中选择一个已配置的模型。')
      return
    }
    const client = createClientForChannel(selectedModel.channelId)
    if (!client) {
      setRequestError('当前模型渠道尚未正确配置，请检查 API Key、服务地址和模型列表。')
      return
    }
    const requestContent = compileAiPrompt(displayContent, upstreamEntries)
    const userMessage: AIMessage = { role: 'user', content: displayContent, requestContent, createdAt: Date.now() }
    const session = activeSession || createSession(sessions.length)
    const nextMessages = [...session.messages, userMessage]
    const nextSession = {
      ...session,
      title: session.messages.length ? session.title : promptWithVariableLabels(displayContent, upstreamEntries).slice(0, 24),
      updatedAt: Date.now(),
      messages: nextMessages,
    }
    const nextSessions = activeSession
      ? sessions.map((item) => item.id === session.id ? nextSession : item)
      : [...sessions, nextSession]
    persist({ sessions: nextSessions, activeSessionId: session.id, messages: nextMessages, prompt: '', userPrompt: '' })
    setPrompt('')
    setRequestError(null)
    setIsSending(true)
    try {
      const resolvedEntries = await buildAIContextEntries(useFlowStore.getState().nodes, upstreamSourceIds)
      const resolvedById = new Map(resolvedEntries.map((entry) => [entry.nodeId, entry]))
      const multimodalEntries = upstreamEntries.map((entry) => ({ ...entry, images: resolvedById.get(entry.nodeId)?.images }))
      const currentRequestParts: ChatContentPart[] = compileAiPromptParts(displayContent, multimodalEntries).map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image', source: part.image })
      const maximumContextTokens = data.maxTokens || 258000
      const threshold = data.autoCompressThreshold || 0.7
      const triggerCharacters = Math.floor(maximumContextTokens * threshold * 4)
      let requestMessages = nextMessages
      const totalCharacters = requestMessages.reduce((total, message) => total + messageContentLength(message.requestContent || message.content), 0)
      if (totalCharacters > triggerCharacters) {
        let retainedCharacters = 0
        const retained: AIMessage[] = []
        const retainedBudget = Math.floor(triggerCharacters * 0.55)
        for (let index = requestMessages.length - 1; index >= 0; index -= 1) {
          const message = requestMessages[index]
          const messageLength = messageContentLength(message.requestContent || message.content)
          if (retained.length && retainedCharacters + messageLength > retainedBudget) break
          retained.unshift(message)
          retainedCharacters += messageLength
        }
        requestMessages = retained
      }
      const request: ChatCompletionRequest = {
        model: selectedModel.model,
        messages: [
          { role: 'system', content: systemPromptDraft || '你是一个有用的助手。' },
          ...(requestMessages.length < nextMessages.length ? [{ role: 'system' as const, content: '较早的会话内容已在达到上下文 70% 后自动压缩；以下保留最近的完整消息。' }] : []),
          ...requestMessages.map((message, index) => ({
            role: message.role,
            content: message === userMessage && index === requestMessages.length - 1 && currentRequestParts.some((part) => part.type === 'image')
              ? currentRequestParts
              : message.requestContent || message.content,
          })),
        ],
        temperature: 1,
        max_tokens: 4096,
        web_search: modelCapabilities.webSearch === 'unsupported' ? 'off' : webSearch,
        reasoning_effort: effectiveReasoningLevel,
      }
      let response = ''
      for await (const delta of client.completeStream(request)) {
        response += delta
        setStreamingReply(response)
      }
      const completedResponse = response.trim()
      if (!completedResponse) throw new Error('模型返回了空响应')
      const assistantMessage: AIMessage = { role: 'assistant', content: completedResponse, createdAt: Date.now() }
      const currentNode = useFlowStore.getState().nodes.find((node) => node.id === id)
      if (!currentNode) return
      const currentData = currentNode.data as AINodeData
      const currentSessions = currentData.sessions || []
      const responseSessions = currentSessions.map((item) => item.id === session.id
        ? { ...item, updatedAt: Date.now(), messages: [...item.messages, assistantMessage] }
        : item)
      const responseSession = responseSessions.find((item) => item.id === session.id)
      updateNode(id, {
        data: {
          ...currentData,
          sessions: responseSessions,
          messages: currentData.activeSessionId === session.id ? responseSession?.messages || [] : currentData.messages,
          output: completedResponse,
        },
      })
      useFlowStore.getState().addToHistory()
      useFlowStore.getState().saveCurrentFlow()
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。')
    } finally {
      setStreamingReply('')
      setIsSending(false)
    }
  }

  const cycleWebSearch = () => {
    if (modelCapabilities.webSearch === 'unsupported' || modelCapabilities.webSearch === 'always') return
    const index = WEB_SEARCH_MODES.indexOf(webSearch)
    persist({ webSearch: WEB_SEARCH_MODES[(index + 1) % WEB_SEARCH_MODES.length] })
  }

  const cycleReasoning = () => {
    const supported = REASONING_LEVELS.filter((level) => modelCapabilities.reasoningLevels.includes(level))
    if (!supported.length) return
    const index = supported.indexOf(effectiveReasoningLevel || supported[0])
    persist({ reasoningLevel: supported[(index + 1) % supported.length] })
  }

  const closeMenu = (target: EventTarget | null) => {
    if (target instanceof HTMLElement) target.closest('details')?.removeAttribute('open')
  }

  const groupedModelMenu = (align: 'left' | 'right' = 'right') => (
    <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-[calc(100%+8px)] z-50 max-h-72 min-w-64 overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl`}>
      {modelGroups.length ? modelGroups.map((group, groupIndex) => <div key={group.channelId}>
        {groupIndex > 0 && <div className="my-1 h-px bg-border" />}
        <div className="px-3 pb-1 pt-2 text-left text-[10px] font-medium text-muted-foreground">{group.channelName}</div>
        {group.models.map((model) => <button key={`${group.channelId}:${model}`} type="button" className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs hover:bg-muted ${group.channelId === data.channelId && model === data.model ? 'bg-muted font-semibold' : ''}`} onClick={(event) => { chooseModel(group.channelId, model); closeMenu(event.currentTarget) }}>{model}</button>)}
      </div>) : <p className="px-3 py-2 text-left text-xs text-muted-foreground">暂无可用模型</p>}
    </div>
  )

  return (
    <div ref={nodeRef} className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-visible rounded-[22px] border bg-card ${selected ? 'node-selected' : 'border-border'} ${disabled ? 'opacity-60' : ''}`} style={{ minWidth: AI_NODE_MIN_SIZE.width, minHeight: AI_NODE_MIN_SIZE.height }}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeResizeArc nodeId={id} minWidth={AI_NODE_MIN_SIZE.width} minHeight={AI_NODE_MIN_SIZE.height} />
      {upstreamEntries.length > 0 && <div className="ai-variable-rail nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
        {upstreamEntries.map((entry) => <button key={entry.nodeId} type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-cnote-ai-variable', entry.nodeId) }} onClick={() => insertVariable(entry)} className="ai-source-variable" title={`拖入输入框引用${entry.label}`}><span className={`ai-source-variable-dot ${entry.color}`} /><span className="truncate">{entry.label}</span></button>)}
      </div>}

      <div ref={toolbarRef} className="ai-node-toolbar nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onMouseLeave={() => closeOpenMenus(toolbarRef.current)}>
        <div className="ai-node-toolbar-surface flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-1" role="toolbar" aria-label="AI 节点操作">
          <span className="flex h-8 w-8 items-center justify-center text-violet-600"><Sparkles className="h-4 w-4" /></span>
          <span className="max-w-[150px] truncate px-1.5 text-sm font-semibold text-foreground" title={data.label || 'AI 节点'}>{data.label || 'AI 节点'}</span>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <details className="group/menu relative">
            <summary className="flex h-8 max-w-[180px] cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="模型选择">
              <span className="truncate">{selectedModel?.model || '选择模型'}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </summary>
            {groupedModelMenu('left')}
          </details>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" onClick={startNewSession} aria-label="新会话" title="新会话"><MessageSquarePlus className="h-4 w-4" /></button>
          <details className="group/menu relative">
            <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="历史会话" title="历史会话"><History className="h-4 w-4" /></summary>
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-xl border border-border bg-card p-1.5 shadow-xl">
              <div className="max-h-56 overflow-auto">
                {sessions.length ? [...sessions].reverse().map((session) => <button key={session.id} type="button" className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs hover:bg-muted ${session.id === data.activeSessionId ? 'bg-muted font-semibold' : ''}`} onClick={(event) => { selectSession(session); closeMenu(event.currentTarget) }}>{session.title}</button>) : <p className="px-3 py-3 text-xs text-muted-foreground">还没有会话历史</p>}
              </div>
              <div className="my-1 h-px bg-border" />
              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40" disabled={!sessions.length} onClick={(event) => { clearSessions(); closeMenu(event.currentTarget) }}><Trash2 className="h-3.5 w-3.5" />清空所有会话历史</button>
            </div>
          </details>
          <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${showSystemPrompt ? 'bg-muted text-foreground' : ''}`} onClick={() => { if (showSystemPrompt) persist({ systemPrompt: systemPromptDraft }); setShowSystemPrompt((value) => !value) }} aria-label="系统提示词" title="系统提示词"><FileCog className="h-4 w-4" /></button>
          <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${showSettings ? 'bg-muted text-foreground' : ''}`} onClick={() => setShowSettings((value) => !value)} aria-label="设置" title="设置"><Settings className="h-4 w-4" /></button>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => deleteNode(id)} aria-label="删除 AI 节点" title="删除"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {showSystemPrompt && <div className="nodrag border-b border-border bg-muted/20 px-4 py-3" onPointerDown={(event) => event.stopPropagation()}>
        <label className="mb-1.5 block text-xs font-medium text-foreground">系统提示词</label>
        <textarea value={systemPromptDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setSystemPromptDraft(event.target.value)} onBlur={() => persist({ systemPrompt: systemPromptDraft })} placeholder="为这个 AI 节点设置独立的系统提示词" rows={3} className="nodrag nowheel block w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-base leading-7 outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10" />
      </div>}

      <div
        ref={historyRef}
        onScroll={() => { if (hoveredReplyIndex !== null) updateReplyActionsPosition(hoveredReplyIndex) }}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        className={`nodrag nopan nowheel select-text overscroll-contain min-h-0 flex-1 overflow-auto px-5 pt-5 ${showEmptyState ? 'flex items-center justify-center pb-5' : ''}`}
      >
        <div ref={messageContentRef} className={showEmptyState ? 'w-full' : undefined}>
        {showEmptyState && <div className="mx-auto max-w-[360px] px-4 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">今天想做什么？</h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">可以直接聊天，也可以让我分析上游的内容。善用变量胶囊能更好的帮你描述问题</p>
        </div>}
        {messages.length > 0 && <div className="space-y-3 pb-3">
          {messages.map((message, index) => <div key={`${message.createdAt || index}-${index}`} data-ai-message-role={message.role} data-ai-message-index={index} ref={(element) => { if (element && message.role === 'assistant') replyElementRefs.current.set(index, element); else replyElementRefs.current.delete(index) }} onMouseEnter={(event) => message.role === 'assistant' && showReplyActions(index, event.currentTarget)} onMouseLeave={() => message.role === 'assistant' && hideReplyActions()} className={`max-w-[86%] rounded-2xl px-4 py-3 text-base leading-7 ${message.role === 'user' ? 'ml-auto whitespace-pre-wrap bg-muted text-foreground' : 'bg-transparent text-foreground'}`}>{message.role === 'assistant' ? <MarkdownPreview source={message.content} /> : promptWithVariableLabels(message.content, upstreamEntries)}</div>)}
        </div>}
        {isSending && !streamingReply && <div className="mb-3 flex max-w-[86%] items-center gap-2 px-4 py-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在请求模型…</div>}
        {streamingReply && <div className="mb-3 max-w-[86%] px-4 py-3 text-base leading-7 text-foreground"><MarkdownPreview source={streamingReply} /></div>}
        {requestError && <div role="alert" className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{requestError}</div>}
        </div>
      </div>

      {hoveredReplyIndex !== null && replyActionsTop !== null && messages[hoveredReplyIndex]?.role === 'assistant' && <div className="ai-reply-actions nodrag nowheel" style={{ top: replyActionsTop }} onMouseEnter={() => { if (replyHoverTimerRef.current !== null) window.clearTimeout(replyHoverTimerRef.current) }} onMouseLeave={hideReplyActions} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => branchReply(hoveredReplyIndex)} title="分支" aria-label="分支"><GitBranch className="h-4 w-4" /></button>
          <button type="button" onClick={() => editReplyAsTextNode(hoveredReplyIndex)} title="编辑为文本节点" aria-label="编辑为文本节点"><SquarePen className="h-4 w-4" /></button>
          <button type="button" onClick={() => void copyReply(hoveredReplyIndex)} title="复制" aria-label="复制"><Copy className="h-4 w-4" />{copiedReplyIndex === hoveredReplyIndex && <span className="sr-only">已复制</span>}</button>
      </div>}
      <div ref={composerAreaRef} className="relative p-3 pt-1">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10">
          <div ref={composerRef} role="textbox" aria-multiline="true" aria-label="输入消息" contentEditable={!isSending} suppressContentEditableWarning data-placeholder="有问题，随便问" onInput={(event) => persistPrompt(promptValueFromEditor(event.currentTarget))} onDragOver={(event) => event.preventDefault()} onDrop={receiveVariableDrop} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} className="ai-prompt-editor nodrag nowheel flex-1 px-3 text-base leading-7 text-foreground outline-none" />
          <button type="button" className="nodrag ai-send-button flex shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:bg-muted disabled:text-muted-foreground" disabled={!canSend} onClick={() => void sendMessage()} aria-label="发送消息">{isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px] stroke-[2]" />}</button>
        </div>
        {showSettings && <div className="nodrag mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" disabled={modelCapabilities.webSearch !== 'optional'} title={modelCapabilities.webSearch === 'unknown' ? '当前模型的联网能力尚未识别' : modelCapabilities.webSearch === 'unsupported' ? '当前模型或协议不支持内置联网搜索' : modelCapabilities.webSearch === 'always' ? '当前搜索模型始终联网' : '切换联网搜索模式'} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${webSearch === 'off' || modelCapabilities.webSearch === 'unsupported' || modelCapabilities.webSearch === 'unknown' ? 'border-border bg-card text-muted-foreground hover:bg-muted/50' : 'border-foreground/25 bg-muted/75 text-foreground hover:bg-muted'}`} onClick={cycleWebSearch}><Search className="h-3.5 w-3.5" />{modelCapabilities.webSearch === 'unknown' ? '联网能力未识别' : modelCapabilities.webSearch === 'unsupported' ? '不支持联网' : modelCapabilities.webSearch === 'always' ? '始终联网' : WEB_SEARCH_LABELS[webSearch]}</button>
            <button type="button" disabled={!modelCapabilities.reasoningLevels.length} title={modelCapabilities.reasoningLevels.length ? '切换当前模型支持的推理等级' : modelCapabilities.reasoningStatus === 'unsupported' ? '当前模型明确不支持推理等级' : '当前模型的推理能力尚未识别'} className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted/45 px-3 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" onClick={cycleReasoning}><Brain className="h-3.5 w-3.5" />{effectiveReasoningLevel || (modelCapabilities.reasoningStatus === 'unsupported' ? '不支持推理' : '推理能力未识别')}</button>
          </div>
          <details className="group/menu relative min-w-0">
            <summary className="flex h-8 min-w-40 max-w-56 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted/50" aria-label="设置中的模型选择"><span className="flex-1 truncate text-right">{selectedModel?.model || '选择模型'}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></summary>
            {groupedModelMenu('right')}
          </details>
        </div>}
      </div>
    </div>
  )
})

AINode.displayName = 'AINode'
