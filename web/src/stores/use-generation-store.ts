import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import { deleteDesktopSecret, syncDesktopSecretInBackground } from '@/lib/desktop-secrets'
import type { GenerationCapability } from '@/types/flow'

export type GenerationProviderId = 'openai' | 'google' | 'video' | 'custom'
export type GenerationProtocolId = 'openai-images' | 'google-images' | 'video-api'
/** How local video references become provider-readable inputs. */
export type GenerationMediaTransport = 'auto' | 'multipart' | 'custom' | 'public-url'
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
  /** How local video references are handed to a provider. */
  mediaTransport?: GenerationMediaTransport
  /** Optional provider-relative upload endpoint used by auto/multipart. */
  mediaUploadPath?: string
  /** Full custom upload service URL used when mediaTransport is custom. */
  mediaUploadURL?: string
  /** Optional multipart field name for a custom upload service. */
  mediaUploadField?: string
  /** Optional response path containing the public URL, defaults to url. */
  mediaUploadResponsePath?: string
  /** Upload-service credential kept in desktop SafeStorage when available. */
  mediaUploadApiKey?: string
  encryptedMediaUploadKey?: string
  mediaUploadSecretName?: string
}

export interface GenerationAdapter {
  id: string
  protocol: GenerationProtocolId
  label?: string
  enabled?: boolean
  supportsImage?: boolean
  supportsVideo?: boolean
  mediaTransport?: GenerationMediaTransport
  mediaUploadPath?: string
  mediaUploadURL?: string
  mediaUploadField?: string
  mediaUploadResponsePath?: string
}

export const GENERATION_PROVIDER_LABELS: Record<GenerationProviderId, string> = {
  openai: 'OpenAI', google: 'Google', video: '视频 API', custom: '自定义生成渠道',
}

export const GENERATION_PROTOCOL_LABELS: Record<GenerationProtocolId, string> = {
  'openai-images': 'OpenAI 图像生成 / 编辑',
  'google-images': 'Google Gemini 图像生成 / 编辑',
  'video-api': '视频 API（文档协议）',
}

export type GenerationProtocolGroup = 'image' | 'video'
export interface GenerationProtocolOption { value: GenerationProtocolId; label: string; description: string; group: GenerationProtocolGroup }
export const GENERATION_PROTOCOL_OPTIONS: GenerationProtocolOption[] = [
  { value: 'openai-images', label: 'OpenAI 图像', description: '原生 OpenAI Images 生成与编辑接口', group: 'image' },
  { value: 'google-images', label: 'Google 图像', description: '原生 Gemini generateContent 图像接口', group: 'image' },
  { value: 'video-api', label: '视频 API', description: '视频调用文档定义的异步任务接口', group: 'video' },
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
  { id: 'seedance-2-pro', name: 'Seedance 2 Pro', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'generate-audio'], inputTypes: ['image', 'video', 'audio'], maxImages: 9, maxVideos: 3, maxAudios: 3, minDuration: 4, maxDuration: 15, pollIntervalMs: 10000, resolutions: ['480p', '720p', '1080p', '4k'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  { id: 'seedance-2-fast', name: 'Seedance 2 Fast', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'generate-audio'], inputTypes: ['image', 'video', 'audio'], maxImages: 9, maxVideos: 3, maxAudios: 3, minDuration: 5, maxDuration: 10, pollIntervalMs: 10000, resolutions: ['480p', '720p'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  { id: 'seedance-2-mini', name: 'Seedance 2 Mini', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'generate-audio'], inputTypes: ['image', 'video', 'audio'], maxImages: 9, maxVideos: 3, maxAudios: 3, minDuration: 5, maxDuration: 10, pollIntervalMs: 10000, resolutions: ['480p', '720p'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  { id: 'seedance-2.5-pro', name: 'Seedance 2.5 Pro', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio'], inputTypes: ['image', 'video', 'audio'], maxImages: 30, maxVideos: 10, maxAudios: 10, minDuration: 4, maxDuration: 30, pollIntervalMs: 10000, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  { id: 'wan-3', name: 'Wan 3', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference', 'generate-audio'], inputTypes: ['image', 'video', 'audio'], maxImages: 10, maxVideos: 5, maxAudios: 5, minDuration: 2, maxDuration: 30, pollIntervalMs: 10000, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16'] },
  { id: 'gemini-omni-1.1', name: 'Gemini Omni 1.1', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'generate-audio'], inputTypes: ['image', 'video'], maxImages: 8, maxVideos: 3, minDuration: 3, maxDuration: 10, pollIntervalMs: 10000, resolutions: ['360p', '720p', '1080p', '4k'], aspectRatios: ['16:9', '9:16'] },
]

export const GENERATION_MODEL_CATALOG: Record<GenerationProviderId, GenerationModel[]> = {
  openai: IMAGE_MODELS.filter((model) => model.id.startsWith('gpt-')),
  google: IMAGE_MODELS.filter((model) => model.id.includes('gemini') || model.id.includes('banana')),
  video: VIDEO_MODELS,
  custom: [],
}

export const GENERATION_PROTOCOL_MODEL_CATALOG: Record<GenerationProtocolId, GenerationModel[]> = {
  'openai-images': IMAGE_MODELS.filter((model) => model.id.startsWith('gpt-') || model.id === 'dall-e-3'),
  'google-images': IMAGE_MODELS.filter((model) => model.id.includes('gemini') || model.id.includes('banana')),
  'video-api': VIDEO_MODELS,
}
export function defaultGenerationProtocol(providerId: GenerationProviderId): GenerationProtocolId {
  if (providerId === 'openai') return 'openai-images'
  if (providerId === 'google') return 'google-images'
  if (providerId === 'video') return 'video-api'
  return 'video-api'
}

export function generationProtocolForChannel(channel: Pick<GenerationChannel, 'protocol' | 'providerId'>): GenerationProtocolId {
  return channel.protocol || defaultGenerationProtocol(channel.providerId)
}

export function generationAdaptersForChannel(channel: GenerationChannel): GenerationAdapter[] {
  const legacyProtocol = generationProtocolForChannel(channel)
  const adapters = (channel.adapters || []).filter((adapter) => adapter.enabled !== false)
  if (adapters.length) {
    // A channel has one request contract. Older persisted channels could
    // contain several adapters; keep the selected protocol and ignore the
    // rest so model routing cannot silently switch request formats.
    const selected = (channel.protocol ? adapters.find((adapter) => adapter.protocol === legacyProtocol) : undefined) || adapters[0]
    const selectedProtocol = selected.protocol || legacyProtocol
    return [{ ...selected, protocol: selectedProtocol, id: selected.id || selectedProtocol }]
  }
  return [{
    id: legacyProtocol,
    protocol: legacyProtocol,
    label: GENERATION_PROTOCOL_LABELS[legacyProtocol],
    supportsImage: channel.supportsImage,
    supportsVideo: channel.supportsVideo,
    mediaTransport: channel.mediaTransport,
    mediaUploadPath: channel.mediaUploadPath,
    mediaUploadURL: channel.mediaUploadURL,
    mediaUploadField: channel.mediaUploadField,
    mediaUploadResponsePath: channel.mediaUploadResponsePath,
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

export function generationSecretName(channelId: string) {
  return `cnote:generation:${channelId}`
}

export function generationMediaUploadSecretName(channelId: string) {
  return `cnote:generation-media-upload:${channelId}`
}

function saveDesktopSecret(name: string, value: string | undefined) {
  syncDesktopSecretInBackground(name, value)
}

export function modelsForGenerationProtocol(protocol: GenerationProtocolId) {
  return GENERATION_PROTOCOL_MODEL_CATALOG[protocol] || []
}

export function inferGenerationModelCapabilities(modelId: string, protocol: GenerationProtocolId): GenerationCapability[] {
  const value = modelId.trim().toLowerCase()
  if (/image|banana|dall-e|gemini.*flash|gemini.*pro|seedream|flux|imagen/.test(value)) return ['text-to-image', 'image-to-image']
  if (/video|seedance|minimax|h3|kling|wan|veo|sora/.test(value)) return ['text-to-video', 'image-to-video', 'reference-to-video']
  if (protocol === 'video-api') return ['text-to-video', 'image-to-video', 'reference-to-video']
  if (protocol === 'openai-images' || protocol === 'google-images') return ['text-to-image', 'image-to-image']
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
  const configuredAdapters = (channel.adapters || []).filter((adapter) => adapter.enabled !== false)
  const protocol = channel.protocol
    ? generationProtocolForChannel(channel)
    : configuredAdapters[0]?.protocol || generationProtocolForChannel(channel)
  const catalog = modelsForGenerationProtocol(protocol)
  const modelIds = channel.modelIds || catalog.map((model) => model.id)
  const selectedAdapter = configuredAdapters.find((adapter) => adapter.protocol === protocol) || configuredAdapters[0]
  const normalized = {
    ...channel,
    protocol,
    modelIds,
    secretName: channel.secretName || generationSecretName(channel.id),
    mediaUploadSecretName: channel.mediaUploadSecretName || generationMediaUploadSecretName(channel.id),
    adapters: [{
      ...(selectedAdapter || {}),
      id: selectedAdapter?.id || protocol,
      protocol,
      label: selectedAdapter?.label || GENERATION_PROTOCOL_LABELS[protocol],
      mediaTransport: selectedAdapter?.mediaTransport ?? channel.mediaTransport,
      mediaUploadPath: selectedAdapter?.mediaUploadPath ?? channel.mediaUploadPath,
      mediaUploadURL: selectedAdapter?.mediaUploadURL ?? channel.mediaUploadURL,
      mediaUploadField: selectedAdapter?.mediaUploadField ?? channel.mediaUploadField,
      mediaUploadResponsePath: selectedAdapter?.mediaUploadResponsePath ?? channel.mediaUploadResponsePath,
    }],
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
          supportsImage: input.supportsImage ?? protocol !== 'video-api',
          supportsVideo: input.supportsVideo ?? protocol === 'video-api',
          secretName: input.secretName || generationSecretName(id),
          mediaUploadSecretName: input.mediaUploadSecretName || generationMediaUploadSecretName(id),
          mediaTransport: input.mediaTransport,
          mediaUploadPath: input.mediaUploadPath,
          mediaUploadURL: input.mediaUploadURL,
          mediaUploadField: input.mediaUploadField,
          mediaUploadResponsePath: input.mediaUploadResponsePath,
          mediaUploadApiKey: input.mediaUploadApiKey,
          adapters: input.adapters,
        })
        saveDesktopSecret(channel.secretName || generationSecretName(id), input.apiKey)
        saveDesktopSecret(channel.mediaUploadSecretName || generationMediaUploadSecretName(id), input.mediaUploadApiKey)
        set((state) => ({ channels: [...state.channels, channel] }))
        return channel
      },
      updateChannel: (id, updates) => set((state) => ({
        channels: state.channels.map((channel) => {
          if (channel.id !== id) return channel
          const keyUpdates = updates.apiKey === undefined
            ? {}
            : { encryptedKey: updates.apiKey ? encryptAPIKey(updates.apiKey) : undefined, secretName: channel.secretName || generationSecretName(id) }
          const mediaKeyUpdates = updates.mediaUploadApiKey === undefined
            ? {}
            : {
                encryptedMediaUploadKey: updates.mediaUploadApiKey ? encryptAPIKey(updates.mediaUploadApiKey) : undefined,
                mediaUploadSecretName: channel.mediaUploadSecretName || generationMediaUploadSecretName(id),
              }
          if (updates.apiKey) saveDesktopSecret(keyUpdates.secretName || generationSecretName(id), updates.apiKey)
          if (updates.mediaUploadApiKey) saveDesktopSecret(mediaKeyUpdates.mediaUploadSecretName || generationMediaUploadSecretName(id), updates.mediaUploadApiKey)
          if (updates.apiKey === '' && channel.secretName) void deleteDesktopSecret(channel.secretName).catch(() => undefined)
          if (updates.mediaUploadApiKey === '' && channel.mediaUploadSecretName) void deleteDesktopSecret(channel.mediaUploadSecretName).catch(() => undefined)
          return normalizeChannel({ ...channel, ...updates, ...keyUpdates, ...mediaKeyUpdates })
        }),
      })),
      removeChannel: (id) => set((state) => {
        const channel = state.channels.find((item) => item.id === id)
        void deleteDesktopSecret(channel?.secretName).catch(() => undefined)
        void deleteDesktopSecret(channel?.mediaUploadSecretName).catch(() => undefined)
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
          mediaUploadApiKey: undefined,
          encryptedMediaUploadKey: channel.mediaUploadApiKey ? encryptAPIKey(channel.mediaUploadApiKey) : channel.encryptedMediaUploadKey,
        })),
      }),
      version: 2,
      migrate: () => ({ channels: [] }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<GenerationState> | undefined
        return {
          ...current,
          ...stored,
          channels: (stored?.channels || []).map((channel) => normalizeChannel({
            ...channel,
            apiKey: channel.apiKey || (channel.encryptedKey ? decryptAPIKey(channel.encryptedKey) : ''),
            mediaUploadApiKey: channel.mediaUploadApiKey || (channel.encryptedMediaUploadKey ? decryptAPIKey(channel.encryptedMediaUploadKey) : ''),
          } as GenerationChannel)),
        }
      },
    },
  ),
)
