import type {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ResponsesAPIRequest,
  ResponsesAPIResponse,
  StreamChunk,
  APIError,
} from './types'
import { detectCORSCached } from './cors-detector'

/**
 * AI API 客户端
 * 支持 Responses API 和 Chat Completions API
 * 自动 CORS 检测和代理切换
 */
export class AIClient {
  private provider: ProviderConfig
  private apiKey: string
  private proxyURL?: string

  constructor(provider: ProviderConfig, apiKey: string, proxyURL?: string) {
    this.provider = provider
    this.apiKey = apiKey
    this.proxyURL = proxyURL
  }

  /**
   * 获取实际请求 URL（考虑代理）
   */
  private async getRequestURL(endpoint: string): Promise<string> {
    const fullURL = `${this.provider.baseURL}${endpoint}`

    // 如果配置了需要代理，直接使用代理
    if (this.provider.needsProxy && this.proxyURL) {
      // 使用 Cloudflare Worker 代理格式: /proxy/{provider}/{endpoint}
      const providerName = this.provider.id.toLowerCase()
      return `${this.proxyURL}/proxy/${providerName}${endpoint}`
    }

    // 自动检测 CORS
    const corsResult = await detectCORSCached(this.provider.baseURL)
    if (corsResult.needsProxy && this.proxyURL) {
      // 使用 Cloudflare Worker 代理格式: /proxy/{provider}/{endpoint}
      const providerName = this.provider.id.toLowerCase()
      return `${this.proxyURL}/proxy/${providerName}${endpoint}`
    }

    return fullURL
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

    const url = await this.getRequestURL('/v1/chat/completions')

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
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

    const url = await this.getRequestURL('/v1/responses')

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
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
      if (this.provider.protocol === 'chatCompletions') {
        const response = await this.chatCompletion({
          model: this.provider.models[0].id,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5,
        })

        return !!(response as ChatCompletionResponse).id
      } else {
        const response = await this.responses({
          model: this.provider.models[0].id,
          prompt: 'Hello',
          max_tokens: 5,
        })

        return !!(response as ResponsesAPIResponse).id
      }
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }
}
