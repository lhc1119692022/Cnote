import type { APIReasoningLevel, ProtocolType } from './types'
import { inferProviderId } from './providers'

export interface AIModelCapabilities {
  webSearch: 'unknown' | 'unsupported' | 'optional' | 'always'
  reasoningLevels: APIReasoningLevel[]
  reasoningStatus: 'unknown' | 'unsupported' | 'supported'
  thinkingMode: 'none' | 'responses' | 'openai-chat' | 'deepseek' | 'gemini-native' | 'gemini-openai' | 'anthropic-adaptive' | 'anthropic-manual'
}

const commonReasoningLevels: APIReasoningLevel[] = ['low', 'medium', 'high']

function openAIReasoningLevels(model: string): APIReasoningLevel[] {
  if (/^gpt-5\.6(?:-|$)/i.test(model)) return [...commonReasoningLevels, 'xhigh', 'max']
  if (/^gpt-5\.(?:[2-5])(?:-|$)/i.test(model)) return [...commonReasoningLevels, 'xhigh']
  if (/^(?:gpt-5(?:-|$)|o\d)/i.test(model)) return commonReasoningLevels
  return []
}

function isAnthropicAdaptiveModel(model: string) {
  return /claude-(?:opus|sonnet|haiku|fable|mythos)-(?:[5-9](?:-|$)|4-(?:[6-9]|\d{2,}))/i.test(model)
}

function isAnthropicManualThinkingModel(model: string) {
  return /claude-(?:opus|sonnet|haiku)-4-(?:[0-5])(?:-|$)/i.test(model)
}

export function getAIModelCapabilities(providerId: string, protocol: ProtocolType, model: string, baseURL = ''): AIModelCapabilities {
  const provider = inferProviderId(providerId, baseURL, model, protocol)
  const modelId = model.toLowerCase()

  if (provider === 'deepseek' && /^deepseek-(?:reasoner|r1|v4)(?:-|$)/i.test(modelId)) {
    return {
      webSearch: 'unsupported',
      reasoningLevels: ['low', 'high', 'max'],
      reasoningStatus: 'supported',
      thinkingMode: protocol === 'responses' ? 'responses' : 'deepseek',
    }
  }

  if (protocol === 'gemini') {
    const reasoningLevels = /^gemini-(?:2\.5|[3-9](?:\.|-|$))/i.test(modelId) || /thinking/i.test(modelId) ? commonReasoningLevels : []
    return {
      webSearch: 'optional',
      reasoningLevels,
      reasoningStatus: reasoningLevels.length ? 'supported' : modelId.startsWith('gemini-') ? 'unsupported' : 'unknown',
      thinkingMode: reasoningLevels.length ? 'gemini-native' : 'none',
    }
  }

  if (protocol === 'responses') {
    const reasoningLevels = provider === 'openai' ? openAIReasoningLevels(modelId) : []
    return {
      webSearch: provider === 'openai' ? 'optional' : 'unsupported',
      reasoningLevels,
      reasoningStatus: reasoningLevels.length ? 'supported' : provider === 'openai' && modelId ? 'unknown' : 'unknown',
      thinkingMode: reasoningLevels.length ? 'responses' : 'none',
    }
  }

  if (protocol === 'messages') {
    const adaptive = provider === 'anthropic' && isAnthropicAdaptiveModel(modelId)
    const manual = provider === 'anthropic' && !adaptive && isAnthropicManualThinkingModel(modelId)
    return {
      webSearch: provider === 'anthropic' ? 'optional' : 'unsupported',
      reasoningLevels: adaptive || manual ? ['low', 'medium', 'high', 'max'] : [],
      reasoningStatus: adaptive || manual ? 'supported' : provider === 'anthropic' && modelId ? 'unknown' : 'unknown',
      thinkingMode: adaptive ? 'anthropic-adaptive' : manual ? 'anthropic-manual' : 'none',
    }
  }

  if (provider === 'openai' && /search(?:-api|-preview)/i.test(modelId)) {
    return { webSearch: 'always', reasoningLevels: [], reasoningStatus: 'unknown', thinkingMode: 'none' }
  }
  if (provider === 'google' && /^gemini-(?:2\.5|[3-9](?:\.|-|$))/i.test(modelId)) {
    return { webSearch: 'unknown', reasoningLevels: commonReasoningLevels, reasoningStatus: 'supported', thinkingMode: 'gemini-openai' }
  }
  const openAILevels = provider === 'openai' ? openAIReasoningLevels(modelId) : []
  if (openAILevels.length) {
    return { webSearch: 'unsupported', reasoningLevels: openAILevels, reasoningStatus: 'supported', thinkingMode: 'openai-chat' }
  }
  if (/(?:reasoner|reasoning|thinking|(?:^|[-_/])r1(?:[-_/]|$))/i.test(modelId)) {
    return { webSearch: 'unknown', reasoningLevels: commonReasoningLevels, reasoningStatus: 'supported', thinkingMode: 'openai-chat' }
  }
  return { webSearch: provider === 'deepseek' ? 'unsupported' : 'unknown', reasoningLevels: [], reasoningStatus: 'unknown', thinkingMode: 'none' }
}

export function adaptReasoningLevel(capabilities: AIModelCapabilities, requested?: APIReasoningLevel) {
  if (!requested || capabilities.reasoningLevels.length === 0) return undefined
  const maximumSupported = capabilities.reasoningLevels[capabilities.reasoningLevels.length - 1]
  if (capabilities.reasoningLevels.includes(requested)) return requested
  if (capabilities.thinkingMode === 'deepseek') {
    if (requested === 'low') return 'low' as const
    if (requested === 'max') return 'max' as const
    return 'high' as const
  }
  if (requested === 'xhigh') return capabilities.reasoningLevels.includes('high') ? 'high' : maximumSupported
  if (requested === 'max') return maximumSupported
  if (requested === 'medium' && capabilities.reasoningLevels.includes('high')) return 'high'
  return maximumSupported
}
