// API 配置类型
export type ProtocolType = 'responses' | 'messages' | 'chatCompletions'

export interface ProviderConfig {
  id: string
  name: string
  baseURL: string
  protocol: ProtocolType
  models: ModelConfig[]
}

export interface ModelConfig {
  id: string
  name: string
  maxTokens: number
  supportsStreaming: boolean
}

// API 请求/响应类型
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

export interface ResponsesAPIRequest {
  model: string
  input: string | ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  top_p?: number
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    message: ChatMessage
    finish_reason: string
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ResponsesAPIResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    text: string
    finish_reason: string
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

// 流式响应类型
export interface StreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: string
      content?: string
    }
    finish_reason: string | null
  }[]
}

// API 错误类型
export interface APIError {
  error: {
    message: string
    type: string
    code: string
  }
}

// 预设的 API 协议
export const API_PROTOCOLS: Record<ProtocolType, string> = {
  responses: '/v1/responses',
  messages: '/v1/messages',
  chatCompletions: '/v1/chat/completions',
}
