import type { FlowNode, FlowEdge, ContentNodeData, BrowserNodeData } from '@/types/flow'
import type { ChatContentPart, ChatMessage } from '@/lib/api'
import { compileAiPrompt, compileAiPromptParts, type AIContextEntry } from './ai-prompt'
import { buildAIContextEntries } from './ai-context'

function compactConversation(messages: ChatMessage[], maxTokens = 258000, threshold = 0.7): ChatMessage[] {
  const triggerTokens = Math.floor(maxTokens * threshold)
  const estimateTokens = (message: ChatMessage) => {
    const contentLength = typeof message.content === 'string'
      ? message.content.length
      : message.content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 1200), 0)
    return Math.ceil(contentLength / 4) + 4
  }
  const totalTokens = messages.reduce((total, message) => total + estimateTokens(message), 0)
  if (totalTokens <= triggerTokens) return messages

  const systemMessages = messages.filter((message) => message.role === 'system')
  const conversation = messages.filter((message) => message.role !== 'system')
  const retained: ChatMessage[] = []
  let retainedTokens = 0
  const retainedBudget = Math.floor(triggerTokens * 0.55)
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    const tokens = estimateTokens(message)
    if (retained.length && retainedTokens + tokens > retainedBudget) break
    retained.unshift(message)
    retainedTokens += tokens
  }
  return [
    ...systemMessages,
    { role: 'system' as const, content: '较早的会话内容已在达到上下文 70% 后自动压缩；以下保留最近的完整消息。' },
    ...retained,
  ]
}
import { topologicalSort, getPredecessors } from './graph'
import { AIClient } from '@/lib/api'
import { ScraperClient } from '@/lib/scraper'

function extractInputTexts(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const fields = ['text', 'content', 'plainText', 'bodyText', 'transcript', 'value', 'url']
  return fields.flatMap((field) =>
    typeof record[field] === 'string' && record[field].trim()
      ? [record[field] as string]
      : [],
  )
}

function isUnsupportedLocalVideoNode(node?: FlowNode) {
  if (node?.type !== 'content') return false
  const data = node.data as ContentNodeData
  return data.category === 'video' && data.source?.kind === 'file'
}

/**
 * 节点执行上下文
 */
export interface ExecutionContext {
  nodeId: string
  inputs: Record<string, any>
  output?: any
  error?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime?: number
  endTime?: number
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean
  contexts: Map<string, ExecutionContext>
  error?: string
}

/**
 * Flow 执行引擎
 */
export class FlowExecutor {
  private nodes: FlowNode[]
  private edges: FlowEdge[]
  private contexts: Map<string, ExecutionContext>
  private aiClient?: AIClient
  private aiClientResolver?: (channelId?: string) => AIClient | undefined
  private scraperClient?: ScraperClient
  private onNodeDataUpdate?: (nodeId: string, data: Record<string, unknown>) => void

  constructor(nodes: FlowNode[], edges: FlowEdge[], aiClient?: AIClient, scraperClient?: ScraperClient, aiClientResolver?: (channelId?: string) => AIClient | undefined, onNodeDataUpdate?: (nodeId: string, data: Record<string, unknown>) => void) {
    this.nodes = nodes
    this.edges = edges
    this.contexts = new Map()
    this.aiClient = aiClient
    this.scraperClient = scraperClient
    this.aiClientResolver = aiClientResolver
    this.onNodeDataUpdate = onNodeDataUpdate
  }

  /**
   * 执行整个 Flow
   */
  async execute(): Promise<ExecutionResult> {
    try {
      // 拓扑排序获取执行顺序
      const order = topologicalSort(this.nodes, this.edges)

      // 初始化所有节点的上下文
      this.nodes.forEach((node) => {
        this.contexts.set(node.id, {
          nodeId: node.id,
          inputs: {},
          status: 'pending',
        })
      })

      // 按顺序执行节点
      for (const nodeId of order) {
        const node = this.nodes.find((n) => n.id === nodeId)
        if (!node) continue

        await this.executeNode(node)
      }

      return {
        success: true,
        contexts: this.contexts,
      }
    } catch (error) {
      return {
        success: false,
        contexts: this.contexts,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(node: FlowNode): Promise<void> {
    const context = this.contexts.get(node.id)!
    context.status = 'running'
    context.startTime = Date.now()

    try {
      // 收集输入数据
      const inputs = this.collectInputs(node.id)
      context.inputs = inputs

      // 根据节点类型执行
      let output: any

      switch (node.type) {
        case 'content':
          output = await this.executeContentNode(node, inputs)
          break
        case 'ai':
          output = await this.executeAINode(node, inputs)
          break
        case 'browser':
          output = await this.executeBrowserNode(node, inputs)
          break
        case 'sticky':
          output = await this.executeStickyNode(node, inputs)
          break
        default:
          throw new Error(`Unknown node type: ${node.type}`)
      }

      context.output = output
      context.status = 'completed'
      context.endTime = Date.now()
    } catch (error) {
      context.status = 'failed'
      context.error = error instanceof Error ? error.message : 'Unknown error'
      context.endTime = Date.now()
      throw error
    }
  }

  /**
   * 收集节点的输入数据
   */
  private collectInputs(nodeId: string): Record<string, any> {
    const predecessors = getPredecessors(nodeId, this.edges)
    const inputs: Record<string, any> = {}

    predecessors.forEach((predId) => {
      const predContext = this.contexts.get(predId)
      if (predContext && predContext.output !== undefined) {
        inputs[predId] = predContext.output
      }
    })

    return inputs
  }

  /**
   * 执行 Content 节点
   */
  private async executeContentNode(
    node: FlowNode,
    inputs: Record<string, any>
  ): Promise<any> {
    const data = node.data as ContentNodeData
    const payload = data.payload
    const inputTexts = Object.values(inputs).flatMap(extractInputTexts)
    const mergedInput = inputTexts.join('\n\n')

    if (payload?.kind === 'document') return [payload.plainText, mergedInput].filter(Boolean).join('\n\n')
    if (payload?.kind === 'social') {
      return {
        kind: 'social',
        title: payload.title,
        bodyText: payload.bodyText,
        author: payload.author,
        publishedAt: payload.publishedAt,
        metrics: payload.metrics,
        contentBlocks: payload.contentBlocks,
        input: mergedInput || undefined,
      }
    }
    if (payload?.kind === 'video') {
      if (payload.provider === 'youtube' && this.scraperClient && payload.url && !payload.transcript) {
        const videoId = ScraperClient.extractVideoId(payload.url)
        if (videoId) {
          const result = await this.scraperClient.fetchYouTubeSubtitles(videoId)
          return { ...payload, transcript: result.subtitles, input: mergedInput || undefined }
        }
      }
      return { ...payload, input: mergedInput || undefined }
    }
    if (payload?.kind === 'data') return { ...payload, input: mergedInput || undefined }
    if (payload?.kind === 'mindmap') return { ...payload, input: mergedInput || undefined }
    if (payload?.kind === 'image') return { ...payload, input: mergedInput || undefined }
    if (payload?.kind === 'presentation') return { ...payload, input: mergedInput || undefined }

    if (data.source?.kind === 'url' && data.source.provider === 'youtube' && this.scraperClient) {
      const videoId = ScraperClient.extractVideoId(data.source.normalizedUrl)
      if (videoId) {
        const result = await this.scraperClient.fetchYouTubeSubtitles(videoId)
        return { kind: 'video', provider: 'youtube', url: data.source.normalizedUrl, transcript: result.subtitles, input: mergedInput || undefined }
      }
    }

    return mergedInput
  }

  /**
   * 执行 AI 节点
   */
  private async executeAINode(
    node: FlowNode,
    inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any
    const aiClient = data.channelId
      ? this.aiClientResolver?.(data.channelId)
      : this.aiClient
    if (!aiClient) {
      throw new Error('AI client not initialized')
    }

    const resolvedEntries = await buildAIContextEntries(this.nodes, Object.keys(inputs))
    const inputEntries: AIContextEntry[] = Object.entries(inputs).flatMap(([sourceId, value]) => {
      const source = this.nodes.find((item) => item.id === sourceId)
      if (isUnsupportedLocalVideoNode(source)) return []
      const text = extractInputTexts(value).join('\n\n').trim()
      const resolved = resolvedEntries.find((entry) => entry.nodeId === sourceId)
      if (!text && !resolved?.images?.length) return []
      return [{ nodeId: sourceId, label: String(source?.data?.label || '上游节点'), text: text || resolved?.text || '', images: resolved?.images }]
    })

    const systemPrompt = data.systemPrompt || '你是一个有用的助手。'
    const prompt = data.prompt || data.userPrompt || ''
    const userParts = compileAiPromptParts(prompt, inputEntries)
    const userContent: ChatMessage['content'] = userParts.some((part) => part.type === 'image')
      ? userParts.map((part): ChatContentPart => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image', source: part.image })
      : compileAiPrompt(prompt, inputEntries)

    // 调用 AI API
    const storedMessages: ChatMessage[] = Array.isArray(data.messages)
      ? data.messages.filter((message: ChatMessage) => message?.content && (message.role === 'user' || message.role === 'assistant'))
      : []
    const messages = compactConversation([
      { role: 'system', content: systemPrompt },
      ...storedMessages.map((message: ChatMessage & { requestContent?: string }) => ({
        ...message,
        content: message.requestContent || message.content,
      })),
      ...(userContent && (typeof userContent === 'string' ? userContent.trim() : userContent.length) ? [{ role: 'user' as const, content: userContent }] : []),
    ], data.maxTokens || 258000, data.autoCompressThreshold || 0.7)

    return aiClient.complete({
      model: data.model || 'gpt-3.5-turbo',
      messages,
      temperature: 1,
      max_tokens: 4096,
    })
  }

  /**
   * 执行 Browser 节点
   */
  private async executeBrowserNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string | { url: string; title?: string; text: string }> {
    const data = node.data as BrowserNodeData
    const url = String(data.confirmedUrl || data.url || '').trim()

    if (!url) {
      throw new Error('Browser node requires URL')
    }

    const outputMode = data.outputMode || (data.extractedContent ? 'text' : 'url')
    if (outputMode === 'url') return url

    if (data.extractedContent?.trim()) {
      return outputMode === 'text'
        ? data.extractedContent
        : { url, text: data.extractedContent }
    }

    if (data.snapshot?.url === url && data.snapshot.text.trim()) {
      return outputMode === 'text'
        ? data.snapshot.text
        : { url, title: data.snapshot.title, text: data.snapshot.text }
    }

    if (!this.scraperClient) {
      throw new Error('网页文本模式需要先在设置中配置内容解析服务')
    }

    try {
      const result = await this.scraperClient.scrapeWeb(url)
      const snapshot = { url, title: result.title, text: result.content, fetchedAt: Date.now() }
      this.onNodeDataUpdate?.(node.id, { snapshot })
      return outputMode === 'text'
        ? result.content
        : { url, title: result.title, text: result.content }
    } catch (error) {
      throw new Error('Failed to scrape ' + url + ': ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  /**
   * 执行 Sticky 节点
   */
  private async executeStickyNode(
    node: FlowNode,
    _inputs: Record<string, any>
  ): Promise<string> {
    const data = node.data as any
    return data.content || ''
  }

  /**
   * 获取执行统计
   */
  getStats() {
    const stats = {
      total: this.contexts.size,
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
      totalTime: 0,
    }

    this.contexts.forEach((context) => {
      switch (context.status) {
        case 'completed':
          stats.completed++
          break
        case 'failed':
          stats.failed++
          break
        case 'pending':
          stats.pending++
          break
        case 'running':
          stats.running++
          break
      }

      if (context.startTime && context.endTime) {
        stats.totalTime += context.endTime - context.startTime
      }
    })

    return stats
  }
}
