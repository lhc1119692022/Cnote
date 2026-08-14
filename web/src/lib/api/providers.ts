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
    protocol: 'gemini',
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
 * 根据协议、接口地址和模型 ID 推断真实提供商。
 * 渠道可以继续使用自定义名称，但能力判断与请求适配不再依赖用户填写内部 ID。
 */
export function inferProviderId(
  providerId: string | undefined,
  baseURL = '',
  modelIds: string | string[] = [],
  protocol?: ProviderConfig['protocol'],
): string {
  const configured = providerId?.trim().toLowerCase() || 'custom'
  const models = (Array.isArray(modelIds) ? modelIds : [modelIds]).map((model) => model.toLowerCase())
  const endpoint = baseURL.toLowerCase()
  const proxyProvider = endpoint.match(/\/proxy\/(openai|anthropic|deepseek|google|xai)(?:\/|$)/)?.[1]

  if (protocol === 'gemini') return 'google'
  if (proxyProvider) return proxyProvider
  if (/api\.deepseek\.com/.test(endpoint) || models.some((model) => /^deepseek(?:-|$)/.test(model))) return 'deepseek'
  if (/api\.anthropic\.com/.test(endpoint) || models.some((model) => /^claude(?:-|$)/.test(model))) return 'anthropic'
  if (/generativelanguage\.googleapis\.com/.test(endpoint) || models.some((model) => /^gemini(?:-|$)/.test(model))) return 'google'
  if (/api\.x\.ai/.test(endpoint) || models.some((model) => /^(?:grok|xai)(?:[-.]|$)/.test(model))) return 'xai'
  if (/api\.openai\.com/.test(endpoint) || models.some((model) => /^(?:gpt-|o\d(?:-|$))/.test(model))) return 'openai'
  return configured
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
    case 'custom':
      return true // Custom endpoints can have any format
    default:
      return true // 手工填写的 provider 使用服务商自己的密钥格式
  }
}
