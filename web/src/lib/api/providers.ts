import type { ProviderConfig } from './types'

/**
 * 预设的 AI 提供商配置
 */
export const PROVIDERS: ProviderConfig[] = [
  // OpenAI
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com',
    protocol: 'responses',
    models: [
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        maxTokens: 128000,
        supportsStreaming: true,
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        maxTokens: 8192,
        supportsStreaming: true,
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        maxTokens: 16384,
        supportsStreaming: true,
      },
    ],
  },

  // DeepSeek 官方 API
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    protocol: 'chatCompletions',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        maxTokens: 1000000,
        supportsStreaming: true,
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        maxTokens: 1000000,
        supportsStreaming: true,
      },
    ],
  },

  // Anthropic Claude
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    protocol: 'messages',
    models: [
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        maxTokens: 200000,
        supportsStreaming: true,
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        maxTokens: 200000,
        supportsStreaming: true,
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        maxTokens: 200000,
        supportsStreaming: true,
      },
    ],
  },

  // Google Gemini
  {
    id: 'google',
    name: 'Google',
    baseURL: 'https://generativelanguage.googleapis.com',
    protocol: 'chatCompletions',
    models: [
      {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        maxTokens: 32768,
        supportsStreaming: true,
      },
      {
        id: 'gemini-pro-vision',
        name: 'Gemini Pro Vision',
        maxTokens: 16384,
        supportsStreaming: true,
      },
    ],
  },

  // 本地 Ollama
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434',
    protocol: 'chatCompletions',
    models: [
      {
        id: 'llama2',
        name: 'Llama 2',
        maxTokens: 4096,
        supportsStreaming: true,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        maxTokens: 8192,
        supportsStreaming: true,
      },
      {
        id: 'codellama',
        name: 'Code Llama',
        maxTokens: 4096,
        supportsStreaming: true,
      },
    ],
  },

  // 自定义端点
  {
    id: 'custom',
    name: '自定义',
    baseURL: '',
    protocol: 'chatCompletions',
    models: [
      {
        id: 'custom-model',
        name: '自定义模型',
        maxTokens: 4096,
        supportsStreaming: true,
      },
    ],
  },
]

/**
 * 根据 ID 获取提供商
 */
export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/**
 * 获取提供商的所有模型
 */
export function getProviderModels(providerId: string) {
  const provider = getProvider(providerId)
  return provider?.models || []
}

/**
 * 验证 API Key 格式
 */
export function validateAPIKey(providerId: string, apiKey: string): boolean {
  if (!apiKey || apiKey.trim().length === 0) return false

  switch (providerId) {
    case 'openai':
    case 'deepseek':
      return apiKey.startsWith('sk-')
    case 'anthropic':
      return apiKey.startsWith('sk-ant-')
    case 'google':
      return apiKey.length === 39 // Google API keys are typically 39 chars
    case 'ollama':
      return true // Ollama doesn't require API key
    case 'custom':
      return true // Custom endpoints can have any format
    default:
      return false
  }
}
