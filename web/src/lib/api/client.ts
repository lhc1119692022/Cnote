import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ResponsesAPIRequest,
  ResponsesAPIResponse,
  StreamChunk,
  APIError,
} from './types'

/**
 * AI API 客户端
 * 支持 Responses API 和 Chat Completions API
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
    if (baseURL.endsWith('/v1') && endpoint.startsWith('/v1/')) {
      return `${baseURL}${endpoint.slice(3)}`
    }
    return `${baseURL}${endpoint}`
  }

  private getHeaders(): Record<string, string> {
    if (this.provider.protocol === 'messages') {
      return {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      }
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(this.getRequestURL('/v1/models'), {
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
      .map((model) => model.id || model.name || '')
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b))
  }

  async complete(request: ChatCompletionRequest): Promise<string> {
    if (this.provider.protocol === 'chatCompletions') {
      const response = await this.chatCompletion({ ...request, stream: false }) as ChatCompletionResponse
      return response.choices?.[0]?.message?.content || ''
    }

    if (this.provider.protocol === 'responses') {
      const response = await fetch(this.getRequestURL('/v1/responses'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: request.model,
          input: request.messages,
          temperature: request.temperature,
          max_output_tokens: request.max_tokens,
        }),
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

    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }))
    const response = await fetch(this.getRequestURL('/v1/messages'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model,
        system: system || undefined,
        messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens || 4096,
      }),
    })
    if (!response.ok) {
      const error = await response.json() as APIError
      throw new Error(error.error?.message || 'API request failed')
    }
    const result = await response.json() as { content?: Array<{ type?: string; text?: string }> }
    return result.content?.filter((item) => item.type === 'text').map((item) => item.text || '').join('') || ''
  }

  /**
   * 发送请求到 Chat Completions API
   */
  async chatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncGenerator<StreamChunk>> {
    if (this.provider.protocol !== 'chatCompletions') {
      throw new Error('Provider does not support Chat Completions API')
    }

    const url = this.getRequestURL('/v1/chat/completions')

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
