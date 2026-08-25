import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import type { GenerationCapability } from '@/types/flow'

export type GenerationProviderId = '808' | 'newapi' | 'meaicc' | 'fmage' | 'custom'
export type GenerationProtocolId = 'openai-images' | 'gemini-generate-content' | 'zenmux-vertex' | 'openai-images-808' | '808-video' | 'meaicc-video' | 'generic-video' | 'newapi'
export type GenerationNodeVariant = 'image' | 'video'

export interface GenerationModel {
  id: string
  name: string
  /** Adapter that owns this model when a connection exposes multiple protocols. */
  adapterId?: string
  capabilities: GenerationCapability[]
  inputTypes?: Array<'image' | 'video' | 'audio'>
  maxImages?: number
  maxVideos?: number
  maxAudios?: number
  maxDuration?: number
  minDuration?: number
  pollIntervalMs?: number
  resolutions?: string[]
  aspectRatios?: string[]
  thinkingLevels?: Array<'minimal' | 'high'>
  defaultThinkingLevel?: 'minimal' | 'high'
}

export interface GenerationChannel {
  id: string
  /** Legacy provider id retained for persisted channels and old task records. */
  providerId: GenerationProviderId
  /** The request contract used to build the provider request body. */
  protocol?: GenerationProtocolId
  /** User-facing provider/channel name. */
  name: string
  baseURL: string
  apiKey?: string
  encryptedKey?: string
  /** SafeStorage key used by the desktop runtime. */
  secretName?: string
  modelIds: string[]
  enabled: boolean
  supportsImage?: boolean
  supportsVideo?: boolean
  /** One connection can expose multiple request contracts. */
  adapters?: GenerationAdapter[]
  /** How local references are handed to a provider. */
  mediaTransport?: 'auto' | 'multipart' | 'public-url'
  /** Optional provider upload endpoint used by the auto/multipart strategy. */
  mediaUploadPath?: string
}

export interface GenerationAdapter {
  id: string
  protocol: GenerationProtocolId
  label?: string
  enabled?: boolean
  supportsImage?: boolean
  supportsVideo?: boolean
  mediaTransport?: 'auto' | 'multipart' | 'public-url'
  mediaUploadPath?: string
}

export const GENERATION_PROVIDER_LABELS: Record<GenerationProviderId, string> = {
  '808': '808 Relay',
  newapi: '卡藏 / NewAPI',
  meaicc: 'MEAICC',
  fmage: 'Fmage',
  custom: '自定义生成渠道',
}

export const GENERATION_PROTOCOL_LABELS: Record<GenerationProtocolId, string> = {
  'openai-images': 'OpenAI Images / 兼容图像端点',
  'gemini-generate-content': 'Gemini generateContent',
  'zenmux-vertex': 'Vertex / ZenMux Predict',
  'openai-images-808': '808 OpenAI Images（异步）',
  '808-video': '808 视频任务端点',
  'meaicc-video': 'MEAICC 视频端点',
  'generic-video': '通用视频任务端点',
  newapi: 'NewAPI 图像 / 视频端点',
}

export type GenerationProtocolGroup = 'image' | 'video' | 'image-video'

export interface GenerationProtocolOption {
  value: GenerationProtocolId
  label: string
  description: string
  group: GenerationProtocolGroup
}

export const GENERATION_PROTOCOL_OPTIONS: GenerationProtocolOption[] = [
  { value: 'openai-images', label: 'OpenAI Images', description: 'OpenAI Images 兼容的图像生成与编辑端点', group: 'image' },
  { value: 'gemini-generate-content', label: 'Gemini generateContent', description: 'Gemini / Nano Banana 图像请求体', group: 'image' },
  { value: 'zenmux-vertex', label: 'Vertex / ZenMux Predict', description: 'Vertex 风格的 instances / parameters 请求体', group: 'image' },
  { value: 'openai-images-808', label: '808 OpenAI Images（异步）', description: '808 Relay 的异步图像端点', group: 'image' },
  { value: '808-video', label: '808 视频任务端点', description: '808 Relay 的 /v1/videos 任务端点', group: 'video' },
  { value: 'meaicc-video', label: 'MEAICC 视频端点', description: 'MEAICC 独立的视频请求体与任务端点', group: 'video' },
  { value: 'generic-video', label: '通用视频任务端点', description: '提交任务并轮询结果的兼容视频接口', group: 'video' },
  { value: 'newapi', label: 'NewAPI 图像 / 视频端点', description: 'NewAPI 图像与视频请求体', group: 'image-video' },
]

const IMAGE_MODELS: GenerationModel[] = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
  },
  {
    id: 'gpt-image-2-token',
    name: 'GPT Image 2 Token',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
  },
  {
    id: 'dall-e-3',
    name: 'DALL-E 3',
    capabilities: ['text-to-image'],
    resolutions: ['1024x1024', '1792x1024', '1024x1792'],
    aspectRatios: ['1:1', '16:9', '9:16'],
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2 / Gemini 3.1 Flash Image',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['512px', '1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1'],
    thinkingLevels: ['minimal', 'high'],
    defaultThinkingLevel: 'minimal',
  },
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro / Gemini 3 Pro Image',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
  {
    id: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['512px', '1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    thinkingLevels: ['minimal', 'high'],
    defaultThinkingLevel: 'minimal',
  },
  {
    id: 'gemini-3-pro-image',
    name: 'Gemini 3 Pro Image',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
  {
    id: 'google/gemini-3.1-flash-image',
    name: 'Google Gemini 3.1 Flash Image',
    capabilities: ['text-to-image', 'image-to-image'],
    inputTypes: ['image'],
    resolutions: ['512px', '1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
]

const VIDEO_MODELS: GenerationModel[] = [
  {
    id: 'seedance-2.0',
    name: 'Seedance S-2.0',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference'],
    inputTypes: ['image', 'video'],
    pollIntervalMs: 10000,
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'seedance-2.0-fast',
    name: 'Seedance S-2.0 Fast',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
    inputTypes: ['image', 'video'],
    pollIntervalMs: 10000,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'seedance-2.5',
    name: 'Seedance S-2.5',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio'],
    inputTypes: ['image', 'video', 'audio'],
    pollIntervalMs: 10000,
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  {
    id: 'seedance-2.5-fast',
    name: 'Seedance S-2.5 Fast',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
    inputTypes: ['image', 'video'],
    pollIntervalMs: 10000,
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'S-2.0-9图版',
    name: 'S-2.0-9图版',
    capabilities: ['image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference'],
    inputTypes: ['image', 'video'],
    maxImages: 9,
    maxVideos: 3,
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 10000,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'S-2.5特惠15s-线路六',
    name: 'S-2.5 特惠 15s · 线路六',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference'],
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 30,
    maxVideos: 3,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 10000,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'],
  },
  {
    id: 'S-2.0满血-线路六',
    name: 'S-2.0 满血 · 线路六',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference'],
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 10000,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'],
  },
  {
    id: 'S-2.0满血mini',
    name: 'S-2.0 满血 mini',
    capabilities: ['text-to-video', 'generate-audio'],
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 10000,
    resolutions: ['480p', '720p'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  },
  {
    id: 'S-2.5-10s',
    name: 'S-2.5 · 10s',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'audio-reference'],
    inputTypes: ['image', 'audio'],
    maxImages: 30,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 10,
    pollIntervalMs: 10000,
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  {
    id: 'minimax_h3',
    name: 'MiniMax H3',
    capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 20000,
    resolutions: ['768', '1080p', '2K', '4K'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  },
  {
    id: 'MiniMax-H3-漫剧优化',
    name: 'MiniMax-H3-漫剧优化',
    capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 20000,
    resolutions: ['768', '2K', '4K'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  },
  {
    id: 'MiniMax-H3-量化版',
    name: 'MiniMax-H3-量化版',
    capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'],
    inputTypes: ['image', 'video'],
    minDuration: 4,
    maxDuration: 15,
    pollIntervalMs: 20000,
    resolutions: ['768', '2K', '4K'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  },
]

const LEGACY_808_VIDEO_MODEL: GenerationModel = {
  id: 'sd2-5-720p',
  name: 'sd2-5-720p',
  capabilities: ['reference-to-video', 'generate-audio'],
  inputTypes: ['image', 'video', 'audio'],
  maxDuration: 30,
  minDuration: 1,
  pollIntervalMs: 10000,
  resolutions: ['720p'],
  aspectRatios: ['16:9', '9:16', '1:1'],
}

const LEGACY_MEAICC_MODEL: GenerationModel = {
  id: 'sd-2-c1',
  name: 'MiniMax H3 / sd-2-c1',
  capabilities: ['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video', 'video-reference', 'audio-reference'],
  inputTypes: ['image', 'video', 'audio'],
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  minDuration: 4,
  maxDuration: 15,
  pollIntervalMs: 20000,
  resolutions: ['768', '2K', '4K'],
  aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
}

export const GENERATION_MODEL_CATALOG: Record<GenerationProviderId, GenerationModel[]> = {
  '808': [LEGACY_808_VIDEO_MODEL],
  newapi: [...IMAGE_MODELS.slice(3, 5), ...VIDEO_MODELS],
  meaicc: [LEGACY_MEAICC_MODEL],
  fmage: [IMAGE_MODELS[0], IMAGE_MODELS[3], IMAGE_MODELS[4], IMAGE_MODELS[6]],
  custom: [],
}

export const GENERATION_PROTOCOL_MODEL_CATALOG: Record<GenerationProtocolId, GenerationModel[]> = {
  'openai-images': IMAGE_MODELS.filter((model) => ['gpt-image-2', 'gpt-image-2-token', 'dall-e-3'].includes(model.id)),
  'gemini-generate-content': IMAGE_MODELS.filter((model) => ['nano-banana-2', 'nano-banana-pro', 'gemini-3.1-flash-image', 'gemini-3-pro-image'].includes(model.id)),
  'zenmux-vertex': IMAGE_MODELS.filter((model) => model.id.startsWith('google/')),
  'openai-images-808': IMAGE_MODELS.filter((model) => ['gpt-image-2', 'gpt-image-2-token'].includes(model.id)),
  '808-video': [LEGACY_808_VIDEO_MODEL],
  'meaicc-video': [LEGACY_MEAICC_MODEL],
  'generic-video': VIDEO_MODELS,
  newapi: GENERATION_MODEL_CATALOG.newapi,
}

export function defaultGenerationProtocol(providerId: GenerationProviderId): GenerationProtocolId {
  if (providerId === 'fmage') return 'openai-images'
  if (providerId === 'newapi') return 'newapi'
  if (providerId === 'meaicc') return 'meaicc-video'
  if (providerId === '808') return '808-video'
  return 'generic-video'
}

export function generationProtocolForChannel(channel: Pick<GenerationChannel, 'protocol' | 'providerId'>): GenerationProtocolId {
  if (channel.protocol === 'generic-video' && channel.providerId === '808') return '808-video'
  if (channel.protocol === 'generic-video' && channel.providerId === 'meaicc') return 'meaicc-video'
  return channel.protocol || defaultGenerationProtocol(channel.providerId)
}

export function generationAdaptersForChannel(channel: GenerationChannel): GenerationAdapter[] {
  const legacyProtocol = generationProtocolForChannel(channel)
  const adapters = (channel.adapters || []).filter((adapter) => adapter.enabled !== false)
  if (adapters.length) return adapters
  return [{
    id: legacyProtocol,
    protocol: legacyProtocol,
    label: GENERATION_PROTOCOL_LABELS[legacyProtocol],
    supportsImage: channel.supportsImage,
    supportsVideo: channel.supportsVideo,
    mediaTransport: channel.mediaTransport,
    mediaUploadPath: channel.mediaUploadPath,
  }]
}

export function generationAdapterForConfig(channel: GenerationChannel, adapterId?: string) {
  const adapters = generationAdaptersForChannel(channel)
  return adapters.find((adapter) => adapter.id === adapterId) || adapters[0]
}

export function generationAdapterForModel(channel: GenerationChannel, modelId: string, adapterId?: string) {
  if (adapterId) return generationAdapterForConfig(channel, adapterId)
  return generationAdaptersForChannel(channel).find((adapter) => modelsForGenerationProtocol(adapter.protocol).some((model) => model.id === modelId)) || generationAdapterForConfig(channel)
}

function desktopSecretName(channelId: string) {
  return `cnote:generation:${channelId}`
}

function saveDesktopSecret(name: string, value: string | undefined) {
  if (!value || typeof window === 'undefined') return
  void window.cnoteDesktop?.secrets.set(name, value).catch(() => undefined)
}

export function modelsForGenerationProtocol(protocol: GenerationProtocolId) {
  return GENERATION_PROTOCOL_MODEL_CATALOG[protocol] || []
}

export function inferGenerationModelCapabilities(modelId: string, protocol: GenerationProtocolId): GenerationCapability[] {
  const value = modelId.trim().toLowerCase()
  if (/image|banana|dall-e|gemini.*flash|gemini.*pro|seedream|flux|imagen/.test(value)) return ['text-to-image', 'image-to-image']
  if (/video|seedance|minimax|h3|kling|wan|veo|sora/.test(value)) return ['text-to-video', 'image-to-video', 'reference-to-video']
  if (protocol === 'generic-video' || protocol === '808-video' || protocol === 'meaicc-video') return ['text-to-video', 'image-to-video', 'reference-to-video']
  if (protocol === 'openai-images' || protocol === 'gemini-generate-content' || protocol === 'zenmux-vertex' || protocol === 'openai-images-808') return ['text-to-image', 'image-to-image']
  return []
}

export function generationChannelSupportsVariant(channel: GenerationChannel, variant: GenerationNodeVariant): boolean {
  const explicit = variant === 'image' ? channel.supportsImage : channel.supportsVideo
  if (explicit !== undefined) return explicit
  const protocol = generationProtocolForChannel(channel)
  const models = channel.modelIds.map((id) => modelsForGenerationProtocol(protocol).find((model) => model.id === id) || { id, name: id, capabilities: inferGenerationModelCapabilities(id, protocol) })
  const relevant = variant === 'image' ? ['text-to-image', 'image-to-image'] : ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio']
  return models.some((model) => !model.capabilities.length || model.capabilities.some((capability) => relevant.includes(capability)))
}

export function generationChannelUsesModelInference(channel: GenerationChannel): boolean {
  // Model-name capability inference is opt-in only when both node scopes are enabled.
  // A single-scope channel intentionally exposes every selected model in that node.
  return channel.supportsImage === true && channel.supportsVideo === true
}

interface GenerationState {
  channels: GenerationChannel[]
  addChannel: (input?: Partial<GenerationChannel>) => GenerationChannel
  updateChannel: (id: string, updates: Partial<GenerationChannel>) => void
  removeChannel: (id: string) => void
  getChannel: (id: string) => GenerationChannel | undefined
  getAPIKey: (id: string) => string | null
  getSecretName: (id: string) => string | undefined
  getModels: (channelId?: string, adapterId?: string) => GenerationModel[]
}

function normalizeChannel(channel: GenerationChannel): GenerationChannel {
  const protocol = generationProtocolForChannel(channel)
  const catalog = modelsForGenerationProtocol(protocol)
  const modelIds = channel.modelIds || catalog.map((model) => model.id)
  const normalized = {
    ...channel,
    protocol,
    modelIds,
    secretName: channel.secretName,
    adapters: channel.adapters?.length
      ? channel.adapters
      : [{ id: protocol, protocol, label: GENERATION_PROTOCOL_LABELS[protocol], mediaTransport: channel.mediaTransport, mediaUploadPath: channel.mediaUploadPath }],
  }
  return {
    ...normalized,
    supportsImage: channel.supportsImage ?? generationChannelSupportsVariant({ ...normalized, supportsImage: undefined, supportsVideo: undefined }, 'image'),
    supportsVideo: channel.supportsVideo ?? generationChannelSupportsVariant({ ...normalized, supportsImage: undefined, supportsVideo: undefined }, 'video'),
  }
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set, get) => ({
      channels: [],
      addChannel: (input = {}) => {
        const providerId = input.providerId || 'custom'
        const protocol = input.protocol || defaultGenerationProtocol(providerId)
        const catalog = modelsForGenerationProtocol(protocol)
        const id = nanoid()
        const channel = normalizeChannel({
          id,
          providerId,
          protocol,
          name: input.name || '生成渠道',
          baseURL: input.baseURL || '',
          apiKey: input.apiKey || '',
          modelIds: input.modelIds || catalog.map((model) => model.id),
          enabled: input.enabled ?? true,
          supportsImage: input.supportsImage ?? !['808-video', 'meaicc-video', 'generic-video'].includes(protocol),
          supportsVideo: input.supportsVideo ?? ['808-video', 'meaicc-video', 'generic-video', 'newapi'].includes(protocol),
          secretName: input.secretName || desktopSecretName(id),
          mediaTransport: input.mediaTransport,
          mediaUploadPath: input.mediaUploadPath,
          adapters: input.adapters,
        })
        saveDesktopSecret(channel.secretName || desktopSecretName(id), input.apiKey)
        set((state) => ({ channels: [...state.channels, channel] }))
        return channel
      },
      updateChannel: (id, updates) => set((state) => ({
        channels: state.channels.map((channel) => {
          if (channel.id !== id) return channel
          const keyUpdates = updates.apiKey === undefined
            ? {}
            : { encryptedKey: updates.apiKey ? encryptAPIKey(updates.apiKey) : undefined, secretName: channel.secretName || desktopSecretName(id) }
          if (updates.apiKey) saveDesktopSecret(keyUpdates.secretName || desktopSecretName(id), updates.apiKey)
          return normalizeChannel({ ...channel, ...updates, ...keyUpdates })
        }),
      })),
      removeChannel: (id) => set((state) => {
        const channel = state.channels.find((item) => item.id === id)
        if (channel?.secretName && typeof window !== 'undefined') void window.cnoteDesktop?.secrets.delete(channel.secretName).catch(() => undefined)
        return { channels: state.channels.filter((item) => item.id !== id) }
      }),
      getChannel: (id) => get().channels.find((channel) => channel.id === id),
      getAPIKey: (id) => {
        const channel = get().getChannel(id)
        if (!channel) return null
        return channel.apiKey || (channel.encryptedKey ? decryptAPIKey(channel.encryptedKey) : null)
      },
      getSecretName: (id) => get().getChannel(id)?.secretName,
      getModels: (channelId, adapterId) => {
        const channel = channelId ? get().getChannel(channelId) : undefined
        if (!channel) return []
        const adapters = (adapterId ? [generationAdapterForConfig(channel, adapterId)] : generationAdaptersForChannel(channel)).filter((adapter): adapter is GenerationAdapter => Boolean(adapter))
        const catalogs = adapters.flatMap((adapter) => modelsForGenerationProtocol(adapter.protocol))
        return (channel.modelIds || []).map((id) => {
          const owner = adapters.find((adapter) => modelsForGenerationProtocol(adapter.protocol).some((model) => model.id === id))
          const catalogModel = catalogs.find((model) => model.id === id)
          return catalogModel
            ? { ...catalogModel, adapterId: owner?.id }
            : {
                id,
                name: id,
                adapterId: owner?.id || adapters[0]?.id,
                capabilities: inferGenerationModelCapabilities(id, owner?.protocol || adapters[0]?.protocol || generationProtocolForChannel(channel)),
              }
        })
      },
    }),
    {
      name: 'cnote-generation',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        channels: state.channels.map((channel) => ({
          ...channel,
          apiKey: undefined,
          encryptedKey: channel.apiKey ? encryptAPIKey(channel.apiKey) : channel.encryptedKey,
        })),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<GenerationState> | undefined
        return {
          ...current,
          ...stored,
          channels: (stored?.channels || []).map((channel) => normalizeChannel({
            ...channel,
            apiKey: channel.apiKey || (channel.encryptedKey ? decryptAPIKey(channel.encryptedKey) : ''),
          } as GenerationChannel)),
        }
      },
    },
  ),
)
