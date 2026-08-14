import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatContentPart,
  ChatMessage,
  ResponsesAPIRequest,
  ResponsesAPIResponse,
  StreamChunk,
  APIError,
} from './types'
import { adaptReasoningLevel, getAIModelCapabilities } from './capabilities'

/**
 * AI API 客户端
 * 支持 Responses、Messages、Chat Completions 和 Gemini 原生 API
 */
export class AIClient {
  private provider: ProviderConfig
  private apiKey: string

  constructor(provider: ProviderConfig, apiKey: string) {
    this.provider = provider
    this.apiKey = apiKey
  }

  /**
   * 获取实际请求 URL
   */
  private getRequestURL(endpoint: string): string {
    const baseURL = this.provider.baseURL.replace(/\/$/, '')
    const endpointVersion = endpoint.match(/^\/(v\d+(?:beta\d*)?)\//i)?.[1]
    if (endpointVersion && baseURL.toLowerCase().endsWith(`/${endpointVersion.toLowerCase()}`)) {
      return `${baseURL}${endpoint.slice(endpointVersion.length + 1)}`
    }
    if (/\/v\d+(?:beta\d*)?\/openai$/i.test(baseURL) && endpoint.startsWith('/v1/')) {
      return `${baseURL}${endpoint.slice(3)}`
    }
    return `${baseURL}${endpoint}`
  }

  private getHeaders(): Record<string, string> {
    if (this.provider.protocol === 'gemini') {
      return {
        ...this.provider.extraHeaders,
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      }
    }
    if (this.provider.protocol === 'messages') {
      return {
        ...this.provider.extraHeaders,
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      }
    }
    return {
      ...this.provider.extraHeaders,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  private messageText(content: ChatMessage['content']) {
    return typeof content === 'string'
      ? content
      : content.filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('\n')
  }

  private openAIContent(content: ChatMessage['content'], responses = false) {
    if (typeof content === 'string') return content
    return content.map((part) => part.type === 'text'
      ? { type: responses ? 'input_text' : 'text', text: part.text }
      : {
          type: responses ? 'input_image' : 'image_url',
          ...(responses
            ? { image_url: part.source.kind === 'url' ? part.source.url : `data:${part.source.mediaType};base64,${part.source.data}` }
            : { image_url: { url: part.source.kind === 'url' ? part.source.url : `data:${part.source.mediaType};base64,${part.source.data}` } }),
        })
  }

  private anthropicContent(content: ChatMessage['content']) {
    if (typeof content === 'string') return content
    return content.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.source.kind === 'base64') return { type: 'image', source: { type: 'base64', media_type: part.source.mediaType, data: part.source.data } }
      return { type: 'image', source: { type: 'url', url: part.source.url } }
    })
  }

  private requestCapabilities(request: ChatCompletionRequest) {
    const capabilities = getAIModelCapabilities(this.provider.id, this.provider.protocol, request.model, this.provider.baseURL)
    return {
      capabilities,
      reasoningEffort: adaptReasoningLevel(capabilities, request.reasoning_effort),
    }
  }

  private geminiContent(content: ChatMessage['content']) {
    if (typeof content === 'string') return [{ text: content }]
    return content.map((part) => {
      if (part.type === 'text') return { text: part.text }
      if (part.source.kind === 'url') {
        throw new Error('Gemini 原生协议暂不支持远程图片 URL，请先将图片转为本地或 base64 内容。')
      }
      return { inlineData: { mimeType: part.source.mediaType, data: part.source.data } }
    })
  }

  private geminiBody(request: ChatCompletionRequest) {
    const { capabilities, reasoningEffort } = this.requestCapabilities(request)
    const systemText = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => this.messageText(message.content))
      .filter(Boolean)
      .join('\n\n')
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.max_tokens,
    }
    if (reasoningEffort && capabilities.thinkingMode === 'gemini-native') {
      generationConfig.thinkingConfig = /^gemini-2\.5(?:-|$)/i.test(request.model)
        ? { thinkingBudget: { low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 24576 }[reasoningEffort] }
        : { thinkingLevel: (reasoningEffort === 'max' || reasoningEffort === 'xhigh' ? 'high' : reasoningEffort).toUpperCase() }
    } else if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature
    }
    const body: Record<string, unknown> = {
      contents: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: this.geminiContent(message.content),
        })),
      generationConfig,
    }
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }
    if (capabilities.webSearch === 'optional' && request.web_search !== 'off') body.tools = [{ googleSearch: {} }]
    return body
  }

  private geminiText(result: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }) {
    return result.candidates
      ?.flatMap((candidate) => candidate.content?.parts || [])
      .filter((part) => !part.thought)
      .map((part) => part.text || '')
      .join('') || ''
  }

  private responsesBody(request: ChatCompletionRequest, stream: boolean) {
    const { capabilities, reasoningEffort } = this.requestCapabilities(request)
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, content: this.openAIContent(message.content, true) })),
      max_output_tokens: request.max_tokens,
      stream,
    }
    if (this.provider.id === 'openai') body.store = false
    if (reasoningEffort) body.reasoning = { effort: reasoningEffort }
    else if (request.temperature !== undefined) body.temperature = request.temperature
    if (capabilities.webSearch === 'optional' && request.web_search !== 'off') {
      body.tools = [{ type: 'web_search' }]
      body.tool_choice = request.web_search === 'on' ? 'required' : 'auto'
    }
    return body
  }

  private messagesBody(request: ChatCompletionRequest, stream: boolean) {
    const { capabilities, reasoningEffort } = this.requestCapabilities(request)
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => this.messageText(message.content))
      .join('\n\n')
    const maxTokens = request.max_tokens || 4096
    const body: Record<string, unknown> = {
      model: request.model,
      system: system || undefined,
      messages: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: this.anthropicContent(message.content) })),
      max_tokens: maxTokens,
      stream,
    }
    if (reasoningEffort && capabilities.thinkingMode === 'anthropic-adaptive') {
      body.thinking = { type: 'adaptive' }
      body.output_config = { effort: reasoningEffort }
    } else if (reasoningEffort && capabilities.thinkingMode === 'anthropic-manual') {
      const budgets: Record<string, number> = { low: 1024, medium: 2048, high: 8192, max: 16000 }
      const budgetTokens = budgets[reasoningEffort] || 2048
      body.thinking = { type: 'enabled', budget_tokens: budgetTokens }
      body.max_tokens = Math.max(maxTokens, budgetTokens + 1024)
    } else if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (capabilities.webSearch === 'optional' && request.web_search !== 'off') {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]
      if (request.web_search === 'on') body.tool_choice = { type: 'any' }
    }
    return body
  }

  private chatCompletionsBody(request: ChatCompletionRequest, stream: boolean) {
    const { capabilities, reasoningEffort } = this.requestCapabilities(request)
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((message) => ({ role: message.role, content: this.openAIContent(message.content) })),
      max_tokens: request.max_tokens,
      stream,
    }
    if (reasoningEffort && capabilities.thinkingMode === 'deepseek') {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = reasoningEffort
    } else if (reasoningEffort && capabilities.thinkingMode === 'gemini-openai') {
      body.reasoning_effort = reasoningEffort
    } else if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort
    } else {
      if (request.temperature !== undefined) body.temperature = request.temperature
      if (request.top_p !== undefined) body.top_p = request.top_p
      if (request.frequency_penalty !== undefined) body.frequency_penalty = request.frequency_penalty
      if (request.presence_penalty !== undefined) body.presence_penalty = request.presence_penalty
    }
    return body
  }

  async listModels(): Promise<string[]> {
    const endpoint = this.provider.protocol === 'gemini' ? '/v1beta/models?pageSize=1000' : '/v1/models'
    const response = await fetch(this.getRequestURL(endpoint), {
      method: 'GET',
      headers: this.getHeaders(),
    })
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const body = await response.json() as { error?: { message?: string }; message?: string }
        message = body.error?.message || body.message || message
      } catch {
        // Keep the HTTP status when the endpoint does not return JSON.
      }
      throw new Error(message)
    }
    const body = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> }
    const models: Array<{ id?: string; name?: string }> = body.data || body.models || []
    return models
      .map((model) => model.id || model.name?.replace(/^models\//, '') || '')
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b))
  }

  async complete(request: ChatCompletionRequest, signal?: AbortSignal): Promise<string> {
    if (this.provider.protocol === 'gemini') {
      const response = await fetch(this.getRequestURL(`/v1beta/models/${encodeURIComponent(request.model)}:generateContent`), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(this.geminiBody(request)),
        signal,
      })
      if (!response.ok) {
        const error = await response.json().catch(() => undefined) as APIError | undefined
        throw new Error(error?.error?.message || `HTTP ${response.status}`)
      }
      return this.geminiText(await response.json())
    }

    if (this.provider.protocol === 'chatCompletions') {
      const response = await this.chatCompletion(request, signal) as ChatCompletionResponse
      const content = response.choices?.[0]?.message?.content
      return typeof content === 'string' ? content : this.messageText(content || '')
    }

    if (this.provider.protocol === 'responses') {
      const response = await fetch(this.getRequestURL('/v1/responses'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(this.responsesBody(request, false)),
        signal,
      })
      if (!response.ok) {
        const error: APIError = await response.json()
        throw new Error(error.error?.message || 'API request failed')
      }
      const result = await response.json() as ResponsesAPIResponse
      return result.output_text
        || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text
        || ''
    }

    const response = await fetch(this.getRequestURL('/v1/messages'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.messagesBody(request, false)),
      signal,
    })
    if (!response.ok) {
      const error = await response.json() as APIError
      throw new Error(error.error?.message || 'API request failed')
    }
    const result = await response.json() as { content?: Array<{ type?: string; text?: string }> }
    return result.content?.filter((item) => item.type === 'text').map((item) => item.text || '').join('') || ''
  }

  /**
   * Stream plain text deltas through the provider's native SSE protocol.
   */
  async *completeStream(request: ChatCompletionRequest, signal?: AbortSignal): AsyncGenerator<string> {
    let endpoint = '/v1/chat/completions'
    let body: Record<string, unknown> = { ...request, stream: true }

    if (this.provider.protocol === 'responses') {
      endpoint = '/v1/responses'
      body = this.responsesBody(request, true)
    } else if (this.provider.protocol === 'messages') {
      endpoint = '/v1/messages'
      body = this.messagesBody(request, true)
    } else if (this.provider.protocol === 'gemini') {
      endpoint = `/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`
      body = this.geminiBody(request)
    }

    if (this.provider.protocol === 'chatCompletions') {
      body = this.chatCompletionsBody(request, true)
    }

    const response = await fetch(this.getRequestURL(endpoint), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const error = await response.json() as APIError
        message = error.error?.message || message
      } catch {
        // Preserve the HTTP status for non-JSON errors.
      }
      throw new Error(message)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const result = await response.json() as ChatCompletionResponse & ResponsesAPIResponse & { content?: Array<{ type?: string; text?: string }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }
      const choiceContent = result.choices?.[0]?.message?.content
      const text = (typeof choiceContent === 'string' ? choiceContent : this.messageText(choiceContent || ''))
        || result.output_text
        || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text
        || result.content?.filter((item) => item.type === 'text').map((item) => item.text || '').join('')
        || this.geminiText(result)
        || ''
      if (text) yield text
      return
    }

    const citations = new Map<string, { url: string; title?: string }>()
    for await (const payload of this.handleEventStream(response)) {
      const choiceText = payload.choices?.map((choice: { delta?: { content?: string } }) => choice.delta?.content || '').join('') || ''
      const responseText = payload.type === 'response.output_text.delta' && typeof payload.delta === 'string'
        ? payload.delta
        : ''
      const messageText = payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta'
        ? payload.delta.text || ''
        : ''
      const citation = payload.type === 'content_block_delta' && payload.delta?.type === 'citations_delta'
        ? payload.delta.citation
        : payload.type === 'response.output_text.annotation.added'
          ? payload.annotation
          : undefined
      if (citation?.url) citations.set(citation.url, { url: citation.url, title: citation.title })
      const text = choiceText || responseText || messageText || this.geminiText(payload)
      if (text) yield text
    }
    if (citations.size) {
      yield `\n\n${[...citations.values()].map((source) => `- [${source.title || source.url}](${source.url})`).join('\n')}`
    }
  }

  /**
   * 发送请求到 Chat Completions API
   */
  async chatCompletion(
    request: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResponse | AsyncGenerator<StreamChunk>> {
    if (this.provider.protocol !== 'chatCompletions') {
      throw new Error('Provider does not support Chat Completions API')
    }

    const url = this.getRequestURL('/v1/chat/completions')

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.chatCompletionsBody(request, Boolean(request.stream))),
      signal,
    })

    if (!response.ok) {
      const error: APIError = await response.json()
      throw new Error(error.error.message || 'API request failed')
    }

    // 流式响应
    if (request.stream) {
      return this.handleStreamResponse(response)
    }

    // 非流式响应
    return response.json()
  }

  /**
   * 发送请求到 Responses API
   */
  async responses(
    request: ResponsesAPIRequest
  ): Promise<ResponsesAPIResponse | AsyncGenerator<StreamChunk>> {
    if (this.provider.protocol !== 'responses') {
      throw new Error('Provider does not support Responses API')
    }

    const url = this.getRequestURL('/v1/responses')

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error: APIError = await response.json()
      throw new Error(error.error.message || 'API request failed')
    }

    // 流式响应
    if (request.stream) {
      return this.handleStreamResponse(response)
    }

    // 非流式响应
    return response.json()
  }

  /**
   * 处理流式响应
   */
  private async *handleStreamResponse(response: Response): AsyncGenerator<StreamChunk> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') return

          try {
            const chunk: StreamChunk = JSON.parse(data)
            yield chunk
          } catch (error) {
            console.error('Failed to parse stream chunk:', error)
          }
        }
      }
    }
  }

  private async *handleEventStream(response: Response): AsyncGenerator<any> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    const decoder = new TextDecoder()
    let buffer = ''
    const parseEvent = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim()
      if (!data || data === '[DONE]') return undefined
      try { return JSON.parse(data) } catch { return undefined }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        const payload = parseEvent(block)
        if (payload) yield payload
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const payload = parseEvent(buffer)
      if (payload) yield payload
    }
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listModels()
      return true
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }
}
