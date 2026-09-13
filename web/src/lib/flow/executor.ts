import type { FlowNode, FlowEdge, ContentNodeData, BrowserNodeData, RequestNodeData } from '@/types/flow'
import { captureBrowserWebview, type DesktopParsedPage } from '@/lib/browser-webview'
import type { ChatContentPart, ChatMessage } from '@/lib/api'
import { compileAiPrompt, compileAiPromptParts, type AIContextEntry } from './ai-prompt'
import { buildAIContextEntries } from './ai-context'
import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'

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
import { cancelGenerationTask, runGenerationTask } from '@/lib/generation/client'
import { runGenerationBatch } from '@/lib/generation/batch'
import { withGenerationUpstreamInputs } from '@/lib/generation/inputs'
import { generationChannelSupportsVariant, generationSecretName, useGenerationStore, type GenerationChannel } from '@/stores/use-generation-store'
import type { GenerationTaskState } from '@/types/flow'

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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
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

export interface ExecutionProgress {
  nodeId: string
  status: ExecutionContext['status']
  contexts: Map<string, ExecutionContext>
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
  private signal?: AbortSignal
  private onProgress?: (progress: ExecutionProgress) => void
  private initialContexts?: Array<Partial<ExecutionContext> & { nodeId: string }>

  constructor(nodes: FlowNode[], edges: FlowEdge[], aiClient?: AIClient, scraperClient?: ScraperClient, aiClientResolver?: (channelId?: string) => AIClient | undefined, onNodeDataUpdate?: (nodeId: string, data: Record<string, unknown>) => void, signal?: AbortSignal, onProgress?: (progress: ExecutionProgress) => void, initialContexts?: Array<Partial<ExecutionContext> & { nodeId: string }>) {
    this.nodes = nodes
    this.edges = edges
    this.contexts = new Map()
    this.aiClient = aiClient
    this.scraperClient = scraperClient
    this.aiClientResolver = aiClientResolver
    this.onNodeDataUpdate = onNodeDataUpdate
    this.signal = signal
    this.onProgress = onProgress
    this.initialContexts = initialContexts
  }

  private publishProgress(nodeId: string) {
    if (!this.onProgress) return
    try {
      this.onProgress({
        nodeId,
        status: this.contexts.get(nodeId)?.status || 'pending',
        contexts: new Map([...this.contexts.entries()].map(([id, context]) => [id, { ...context }])),
      })
    } catch {
      // Progress persistence is best-effort and must not fail a Flow execution.
    }
  }

  private throwIfAborted() {
    if (this.signal?.aborted) throw new DOMException('执行已停止', 'AbortError')
  }

  /**
   * 执行整个 Flow：无依赖关系的分支并行执行；失败只跳过自己的下游，
   * 不阻断其他分支。
   */
  async execute(): Promise<ExecutionResult> {
    try {
      // 拓扑排序获取执行顺序（同时校验无环）
      const order = topologicalSort(this.nodes, this.edges)

      // 初始化所有节点的上下文
      this.nodes.forEach((node) => {
        const initial = this.initialContexts?.find((context) => context.nodeId === node.id)
        this.contexts.set(node.id, {
          nodeId: node.id,
          inputs: initial?.inputs || {},
          output: initial?.output,
          error: initial?.error,
          status: initial?.status === 'completed' && initial.output !== undefined ? 'completed' : 'pending',
          startTime: initial?.startTime,
          endTime: initial?.endTime,
        })
      })

      const pending = new Set(order)
      let firstError: string | undefined

      while (pending.size > 0) {
        this.throwIfAborted()
        const ready: string[] = []
        const skipped: string[] = []
        for (const nodeId of pending) {
          const predecessors = getPredecessors(nodeId, this.edges)
          const unresolved = predecessors.some((predId) => {
            const status = this.contexts.get(predId)?.status
            return status === 'pending' || status === 'running'
          })
          if (unresolved) continue
          const failedUpstream = predecessors.some((predId) => {
            const status = this.contexts.get(predId)?.status
            return status === 'failed' || status === 'cancelled'
          })
          if (failedUpstream) skipped.push(nodeId)
          else ready.push(nodeId)
        }

        for (const nodeId of skipped) {
          pending.delete(nodeId)
          const context = this.contexts.get(nodeId)
          if (context) {
            context.status = 'cancelled'
            context.error = '上游节点执行失败，已跳过'
          }
          this.publishProgress(nodeId)
        }
        if (!ready.length) {
          if (!skipped.length) break
          continue
        }

        await Promise.all(ready.map(async (nodeId) => {
          pending.delete(nodeId)
          const node = this.nodes.find((n) => n.id === nodeId)
          if (!node) return
          const context = this.contexts.get(nodeId)
          if (context?.status === 'completed' && context.output !== undefined) {
            this.publishProgress(nodeId)
            return
          }
          try {
            await this.executeNode(node)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error
            if (!firstError) firstError = error instanceof Error ? error.message : 'Unknown error'
          }
        }))
      }

      const failed = [...this.contexts.values()].some((context) => context.status === 'failed')
      return {
        success: !failed,
        contexts: this.contexts,
        error: firstError,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.contexts.forEach((context) => {
          if (context.status === 'pending' || context.status === 'running') context.status = 'cancelled'
        })
      }
      return {
        success: false,
        contexts: this.contexts,
        error: error instanceof DOMException && error.name === 'AbortError'
          ? '执行已停止'
          : error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(node: FlowNode): Promise<void> {
    this.throwIfAborted()
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
        case 'request':
          output = await this.executeRequestNode(node, inputs)
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
      if (output?.kind === 'generation-result' && output.task?.status !== 'completed') {
        this.throwIfAborted()
        throw new Error(output.task?.error || '生成任务尚未全部完成')
      }
      context.status = 'completed'
      context.endTime = Date.now()
      this.publishProgress(node.id)
    } catch (error) {
      context.status = 'failed'
      context.error = error instanceof Error ? error.message : 'Unknown error'
      context.endTime = Date.now()
      this.publishProgress(node.id)
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
      if (payload.provider === 'youtube' && payload.url && !payload.transcript) {
        if (!this.scraperClient) throw new Error('YouTube 视频缺少字幕：请先在设置中配置内容解析服务')
        const videoId = ScraperClient.extractVideoId(payload.url)
        if (!videoId) throw new Error('无法识别的 YouTube 视频链接：' + payload.url)
        const result = await this.scraperClient.fetchYouTubeSubtitles(videoId, { signal: this.signal })
        return { ...payload, transcript: result.subtitles, input: mergedInput || undefined }
      }
      return { ...payload, source: data.source, preview: data.preview, input: mergedInput || undefined }
    }
    if (payload?.kind === 'data') return { ...payload, input: mergedInput || undefined }
    if (payload?.kind === 'mindmap') return { ...payload, input: mergedInput || undefined }
    if (payload?.kind === 'image') return { ...payload, source: data.source, preview: data.preview, input: mergedInput || undefined }
    if (payload?.kind === 'presentation') return { ...payload, input: mergedInput || undefined }

    if (data.source?.kind === 'url' && data.source.provider === 'youtube') {
      if (!this.scraperClient) throw new Error('YouTube 视频缺少字幕：请先在设置中配置内容解析服务')
      const videoId = ScraperClient.extractVideoId(data.source.normalizedUrl)
      if (videoId) {
        const result = await this.scraperClient.fetchYouTubeSubtitles(videoId, { signal: this.signal })
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
    if (!data.model?.trim()) {
      throw new Error('AI 节点尚未选择模型')
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
      model: data.model,
      messages,
      temperature: 1,
      max_tokens: data.maxOutputTokens || 8192,
      web_search: data.webSearch || 'auto',
      reasoning_effort: data.reasoningLevel || 'medium',
    }, this.signal).then((output) => {
      // 回复写回节点，下游节点和后续会话才能在执行结束后继续使用。
      this.onNodeDataUpdate?.(node.id, { output })
      return output
    })
  }

  /** Execute image/video requests as part of the Flow, including submission and polling. */
  private async executeRequestNode(
    node: FlowNode,
    inputs: Record<string, any>,
  ): Promise<Record<string, unknown> | GenerationTaskState> {
    const data = node.data as RequestNodeData
    const variant = data.variant || 'body'
    if (variant === 'body') {
      return { kind: 'generation-request', variant: 'body', inputs }
    }

    const config = data[variant]
    if (!config?.prompt?.trim() && !config?.references?.length && !Object.keys(inputs).length) {
      throw new Error(`${variant === 'image' ? '图片' : '视频'}生成节点需要提示词、参考文件或上游输入`)
    }

    const generationStore = useGenerationStore.getState()
    const existingTask = (data.tasks?.[variant] || data.task) as GenerationTaskState | undefined
    const persisted = existingTask?.requestSnapshot && (existingTask.taskId || existingTask.children?.some((child) => child.taskId)) && (existingTask.status === 'queued' || existingTask.status === 'in_progress')
      ? existingTask.requestSnapshot
      : undefined
    const liveChannel = config.channelId
      ? generationStore.getChannel(config.channelId)
      : generationStore.channels.find((item) => item.enabled && generationChannelSupportsVariant(item, variant))
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
    const baseConfig = persisted?.config || config
    const model = channel
      ? generationStore.getModels(channel.id).find((item) => item.id === (persisted?.model || config.model)) || { id: persisted?.model || config.model || '', name: persisted?.model || config.model || '', capabilities: [] }
      : undefined
    if (!channel || !model?.id) throw new Error('请先配置生成渠道和模型')

    const runConfig = persisted ? baseConfig : withGenerationUpstreamInputs(node.id, variant, config, this.nodes, this.edges, inputs)
    const initialTasks = persisted && existingTask ? existingTask.children || [existingTask] : undefined
    const requestedCount = initialTasks?.length || (persisted || variant !== 'image' ? 1 : Math.max(1, Math.min(10, Math.trunc(runConfig.outputCount || 1))))
    const submittedAt = Date.now()
    const task = await runGenerationBatch({
      count: requestedCount,
      submittedAt,
      initialTasks,
      elapsedOffset: persisted ? existingTask?.elapsedMs : 0,
      onTaskUpdate: (state) => {
        const current = this.nodes.find((item) => item.id === node.id)?.data as RequestNodeData | undefined
        this.onNodeDataUpdate?.(node.id, { tasks: { ...(current?.tasks || {}), [variant]: state }, task: state })
      },
      run: (generationIndex, update) => {
        const previous = initialTasks?.[generationIndex]
        const requestConfig = previous?.requestSnapshot?.config || { ...runConfig, outputCount: 1 }
        return runGenerationTask(
          { channel, model, config: requestConfig, variant },
          {
            taskId: previous?.taskId,
            submittedAt,
            timeoutMs: variant === 'image' ? 15 * 60 * 1000 : 60 * 60 * 1000,
            signal: this.signal,
            onCancel: async (taskId) => { await cancelGenerationTask({ channel, model, config: requestConfig, variant }, taskId) },
            onConfigPrepared: (preparedConfig) => {
              update({ requestSnapshot: {
                variant,
                channelId: channel.id,
                presetId: channel.presetId,
                presetVersion: channel.presetVersion,
                providerId: channel.providerId,
                protocol: channel.protocol,
                adapterId: requestConfig.adapterId,
                baseURL: channel.baseURL,
                secretName: channel.secretName,
                mediaTransport: channel.mediaTransport,
                mediaUploadPath: channel.mediaUploadPath,
                mediaUploadURL: channel.mediaUploadURL,
                mediaUploadSecretName: channel.mediaUploadSecretName,
                model: model.id,
                config: preparedConfig,
              } })
            },
            onTaskUpdate: update,
          },
        )
      },
    })
    if (task.status === 'completed' && !task.resultUrls?.length && !task.resultResourceIds?.length) {
      throw new Error('生成任务已完成，但服务端没有返回可预览的结果')
    }
    return { kind: 'generation-result', variant, task }
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

    if (typeof window !== 'undefined' && window.cnoteDesktop) {
      try {
        const capture = await captureBrowserWebview(node.id)
        const parsed = await runDesktopNativeJob<DesktopParsedPage>({ kind: 'native:content-parse', input: { html: capture.html, url: capture.url, title: capture.title } }, this.signal)
        const snapshot = {
          url: capture.url,
          title: parsed.title || capture.title,
          text: parsed.text || capture.text,
          fetchedAt: Date.now(),
          headings: parsed.headings,
          links: parsed.links,
          parserId: parsed.parserId,
          parserVersion: parsed.parserVersion,
        }
        this.onNodeDataUpdate?.(node.id, { snapshot, url: capture.url, confirmedUrl: capture.url, observedUrl: capture.url, browserRuntime: 'desktop-native' })
        return outputMode === 'text'
          ? snapshot.text
          : { url: capture.url, title: snapshot.title, text: snapshot.text }
      } catch {
        // A closed or unavailable native session can fall back to the configured scraper.
      }
    }

    if (!this.scraperClient) {
      throw new Error('网页文本模式需要先在设置中配置内容解析服务')
    }

    try {
      const result = await this.scraperClient.scrapeWeb(url, { signal: this.signal })
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
        case 'cancelled':
          stats.pending++
          break
      }

      if (context.startTime && context.endTime) {
        stats.totalTime += context.endTime - context.startTime
      }
    })

    return stats
  }
}
