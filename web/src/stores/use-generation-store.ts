import { create } from 'zustand'
import { withOfficialMediaCapabilities } from '@/lib/generation/official-media-rules'
import { createJSONStorage, persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { localForageStorage } from '@/lib/localforage-storage'
import { decryptAPIKey, encryptAPIKey } from '@/lib/secure-storage'
import { deleteDesktopSecret, syncDesktopSecretInBackground } from '@/lib/desktop-secrets'
import { normalizeMediaTransport } from '@/lib/generation/media-policy'
import type { GenerationCapability } from '@/types/flow'
import { is808VideoChannel, resolve808WanModel, resolveKacangModel, resolveVideoModelAdapter, GENERATION_CHANNEL_PRESETS, VIDEO_808_DEFAULT_BASE_URL, VIDEO_MODEL_CATALOG } from '@/lib/generation/video-catalog'
export { GENERATION_CHANNEL_PRESETS } from '@/lib/generation/video-catalog'

export type GenerationProviderId = 'openai' | 'google' | 'video' | 'custom'
export type GenerationProtocolId = 'openai-images' | 'google-images' | 'video-api' | 'video-808relay' | 'video-kacang'
/** How local video references become provider-readable inputs. */
export type GenerationMediaTransport = import('@/lib/generation/media-policy').MediaTransport
export type GenerationNodeVariant = 'image' | 'video'

export interface GenerationVideoRequestContract {
  createPath: string
  pollPath: string
  contentPath?: string
  durationField: string
  resolutionField?: string
  aspectRatioField?: string
  firstFrameField?: string
  lastFrameField?: string
  imageReferencesField?: string
  videoReferencesField?: string
  audioReferencesField?: string
  generateAudioField?: string
  requiresPublicHttps?: boolean
  referenceLimits?: Partial<Record<'image' | 'video' | 'audio', number>>
  minReferenceImages?: number
  requiresFramePair?: boolean
  maxDurationByResolution?: Record<string, number>
  referenceResolutions?: string[]
  maxPromptLength?: number
}

export interface GenerationChannelPreset {
  id: string
  version: string
  name: string
  description?: string
  providerId: GenerationProviderId
  protocol: GenerationProtocolId
  defaultBaseURL?: string
  modelIds: string[]
  supportsImage: boolean
  supportsVideo: boolean
  mediaTransport?: GenerationMediaTransport
  models?: GenerationModel[]
  videoRequestContract?: GenerationVideoRequestContract
  adapters?: GenerationAdapter[]
}

export interface GenerationModel {
  id: string
  name: string
  /** Adapter that owns this model when a connection exposes multiple protocols. */
  adapterId?: string
  capabilities: GenerationCapability[]
  capabilitySource?: 'catalog' | 'inferred'
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
  qualities?: Array<'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>
  defaultQuality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  allowedDurations?: number[]
  defaultDuration?: number
  /** Audio is directed by the prompt; the provider exposes no boolean switch. */
  audioGeneration?: 'prompt'
  promptRequired?: boolean
  promptlessWithReferences?: boolean
  allowsAudioOnlyReference?: boolean
  allowsFirstFrameOnly?: boolean
  allowCustomResolution?: boolean
  videoRequestContract?: Partial<GenerationVideoRequestContract>
}

export interface GenerationChannel {
  id: string
  /** Built-in bundle copied when the channel was created. */
  presetId?: string
  /** Version of the copied bundle; existing channels may omit this. */
  presetVersion?: string
  /** Source metadata is informational and never drives runtime routing. */
  presetSource?: { id: string; version: string; copiedAt: string }
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
  modelCatalog?: GenerationModel[]
  videoRequestContract?: GenerationVideoRequestContract
  /** One connection can expose multiple request contracts. */
  adapters?: GenerationAdapter[]
  /** How local video references are handed to a provider. */
  mediaTransport?: GenerationMediaTransport
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
  videoRequestContract?: GenerationVideoRequestContract
}

export const GENERATION_PROVIDER_LABELS: Record<GenerationProviderId, string> = {
  openai: 'OpenAI', google: 'Google', video: '视频 API', custom: '自定义生成渠道',
}

export const GENERATION_PROTOCOL_LABELS: Record<GenerationProtocolId, string> = {
  'openai-images': 'OpenAI 图像生成 / 编辑',
  'google-images': 'Google Gemini 图像生成 / 编辑',
  'video-api': '视频 API（文档协议）',
  'video-808relay': '808Relay 视频',
  'video-kacang': 'Kacang 视频',
}

export type GenerationProtocolGroup = 'image' | 'video'
export interface GenerationProtocolOption { value: GenerationProtocolId; label: string; description: string; group: GenerationProtocolGroup }
export const GENERATION_PROTOCOL_OPTIONS: GenerationProtocolOption[] = [
  { value: 'openai-images', label: 'OpenAI 图像', description: '原生 OpenAI Images 生成与编辑接口', group: 'image' },
  { value: 'google-images', label: 'Google 图像', description: '原生 Gemini generateContent 图像接口', group: 'image' },
  { value: 'video-api', label: '视频 API', description: '视频调用文档定义的异步任务接口', group: 'video' },
]
const IMAGE_MODELS: GenerationModel[] = [  ...['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'].map((id) => ({
    id,
    name: id === 'gpt-image-2.5-sunburst' ? 'GPT Image 2.5 Sunburst' : id === 'gpt-image-2.5-flare' ? 'GPT Image 2.5 Flare' : 'GPT Image 2.5',
    capabilities: ['text-to-image', 'image-to-image'] as GenerationCapability[],
    inputTypes: ['image'] as Array<'image'>,
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
    qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as Array<'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>,
    defaultQuality: 'auto' as const,
  })),
  { id: 'gpt-image-2.5', name: 'GPT Image 2.5', capabilities: ['text-to-image', 'image-to-image'], inputTypes: ['image'], resolutions: ['1k', '2k', '4k'], aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], defaultQuality: 'auto' },
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

export const GENERATION_MODEL_CATALOG: Record<GenerationProviderId, GenerationModel[]> = {
  openai: IMAGE_MODELS.filter((model) => model.id.startsWith('gpt-')),
  google: IMAGE_MODELS.filter((model) => model.id.includes('gemini') || model.id.includes('banana')),
  video: VIDEO_MODEL_CATALOG,
  custom: [],
}

export const GENERATION_PROTOCOL_MODEL_CATALOG: Record<GenerationProtocolId, GenerationModel[]> = {
  'openai-images': IMAGE_MODELS.filter((model) => model.id.startsWith('gpt-') || model.id === 'dall-e-3'),
  'google-images': IMAGE_MODELS.filter((model) => model.id.includes('gemini') || model.id.includes('banana')),
  'video-api': VIDEO_MODEL_CATALOG,
  'video-808relay': VIDEO_MODEL_CATALOG,
  'video-kacang': GENERATION_CHANNEL_PRESETS.find((preset) => preset.id === 'video-kacang')?.models || [],
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

export function isVideoGenerationProtocol(protocol: GenerationProtocolId) {
  return protocol === 'video-api' || protocol === 'video-808relay' || protocol === 'video-kacang'
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
  const adapters = generationAdaptersForChannel(channel)
  const channelCatalog = channel.modelCatalog || []
  const channelModelIds = new Set(channel.modelIds || [])
  const channelModel = channelCatalog.some((model) => model.id === modelId) || channelModelIds.has(modelId)
  if (channelModel && adapters.length === 1) return adapters[0]
  return adapters.find((adapter) => {
    const catalog = channelCatalog.length ? channelCatalog : modelsForGenerationProtocol(adapter.protocol)
    return catalog.some((model) => model.id === modelId)
  }) || generationAdapterForConfig(channel)
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

export function generationVideoRequestContractForModel(channel: GenerationChannel, model?: GenerationModel, adapterId?: string) {
  const adapter = generationAdapterForConfig(channel, adapterId)
  const wan = resolve808WanModel(channel, model?.id || '', adapter?.protocol || generationProtocolForChannel(channel))
  if (wan) return wan.videoRequestContract
  const kacang = resolveKacangModel(channel, model?.id || '', adapter?.protocol || generationProtocolForChannel(channel))
  if (kacang) return kacang.videoRequestContract
  const familyAdapter = resolveVideoModelAdapter(channel, model?.id || '', adapter?.protocol || generationProtocolForChannel(channel))
  if (familyAdapter) return familyAdapter.requestContract
  const preset = generationPresetForId(channel.presetId)
  const contract = model?.videoRequestContract || adapter?.videoRequestContract || channel.videoRequestContract || preset?.videoRequestContract
  if (contract) return contract
  return GENERATION_CHANNEL_PRESETS.find((item) => item.protocol === generationProtocolForChannel(channel))?.videoRequestContract
    || VIDEO_MODEL_CATALOG[0]?.videoRequestContract as GenerationVideoRequestContract | undefined
}

export function generationPresetForId(presetId?: string) {
  return GENERATION_CHANNEL_PRESETS.find((preset) => preset.id === presetId)
}

const UNKNOWN_VIDEO_MODEL_CAPABILITIES: GenerationCapability[] = [
  'text-to-video',
  'image-to-video',
  'reference-to-video',
  'first-last-frame',
  'video-reference',
  'audio-reference',
  'video-edit',
  'generate-audio',
]

const UNKNOWN_VIDEO_MODEL_INPUT_TYPES: Array<'image' | 'video' | 'audio'> = ['image', 'video', 'audio']
const UNKNOWN_VIDEO_MODEL_RESOLUTIONS = ['360p', '480p', '720p', '1080p', '2k', '4k', '768']
const UNKNOWN_VIDEO_MODEL_ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']

export function unknownGenerationModelForProtocol(modelId: string, protocol: GenerationProtocolId): GenerationModel {
  if (!isVideoGenerationProtocol(protocol)) {
    return {
      id: modelId,
      name: modelId,
      capabilitySource: 'inferred',
      capabilities: inferGenerationModelCapabilities(modelId, protocol),
    }
  }

  return {
    id: modelId,
    name: modelId,
    capabilitySource: 'inferred',
    capabilities: [...UNKNOWN_VIDEO_MODEL_CAPABILITIES],
    inputTypes: [...UNKNOWN_VIDEO_MODEL_INPUT_TYPES],
    minDuration: 1,
    maxDuration: 60,
    defaultDuration: 5,
    resolutions: [...UNKNOWN_VIDEO_MODEL_RESOLUTIONS],
    aspectRatios: [...UNKNOWN_VIDEO_MODEL_ASPECT_RATIOS],
    promptRequired: false,
    allowsAudioOnlyReference: true,
  }
}

export function inferGenerationModelCapabilities(modelId: string, protocol: GenerationProtocolId): GenerationCapability[] {
  const value = modelId.trim().toLowerCase()
  if (/image|banana|dall-e|gemini.*flash|gemini.*pro|seedream|flux|imagen/.test(value)) return ['text-to-image', 'image-to-image']
  if (/video|seedance|minimax|h3|kling|wan|veo|sora/.test(value) || isVideoGenerationProtocol(protocol)) return [...UNKNOWN_VIDEO_MODEL_CAPABILITIES]
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
  generationDefaultsVersion: number
  initializeDefaultChannels: () => void
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
  const preset = generationPresetForId(channel.presetId)
  const presetProtocol = preset?.protocol
  const protocol = channel.protocol
    ? (channel.protocol === 'video-api' && presetProtocol && presetProtocol !== 'video-api' ? presetProtocol : generationProtocolForChannel(channel))
    : configuredAdapters[0]?.protocol || generationProtocolForChannel(channel)
  const catalog = modelsForGenerationProtocol(protocol)
  const modelIds = Array.isArray(channel.modelIds) ? channel.modelIds : []
  const modelCatalog = channel.modelCatalog?.length ? channel.modelCatalog : preset?.models?.length ? preset.models : catalog
  const selectedAdapter = configuredAdapters.find((adapter) => adapter.protocol === protocol) || configuredAdapters[0]
  const mediaTransport = normalizeMediaTransport(is808VideoChannel(channel, protocol)
    ? channel.mediaTransport ?? selectedAdapter?.mediaTransport
    : selectedAdapter?.mediaTransport ?? channel.mediaTransport)
  const videoRequestContract = channel.videoRequestContract || selectedAdapter?.videoRequestContract || preset?.videoRequestContract
  const normalizedBaseURL = channel.baseURL.trim().replace(/\/$/, '')
  const baseURL = channel.presetId === 'video-808relay' && /^https:\/\/va\.808relay\.com(?:\/v1)?$/i.test(normalizedBaseURL)
    ? VIDEO_808_DEFAULT_BASE_URL
    : normalizedBaseURL
  const normalized = {
    ...channel,
    protocol,
    modelIds,
    modelCatalog,
    videoRequestContract,
    baseURL,
    mediaTransport,
    secretName: channel.secretName || generationSecretName(channel.id),
    mediaUploadSecretName: channel.mediaUploadSecretName || generationMediaUploadSecretName(channel.id),
    adapters: [{
      ...(selectedAdapter || {}),
      id: selectedAdapter?.id || protocol,
      protocol,
      label: selectedAdapter?.label || GENERATION_PROTOCOL_LABELS[protocol],
      mediaTransport,
      mediaUploadPath: selectedAdapter?.mediaUploadPath ?? channel.mediaUploadPath,
      mediaUploadURL: selectedAdapter?.mediaUploadURL ?? channel.mediaUploadURL,
      mediaUploadField: selectedAdapter?.mediaUploadField ?? channel.mediaUploadField,
      mediaUploadResponsePath: selectedAdapter?.mediaUploadResponsePath ?? channel.mediaUploadResponsePath,
      videoRequestContract: selectedAdapter?.videoRequestContract || videoRequestContract,
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
      generationDefaultsVersion: 0,
      initializeDefaultChannels: () => {
        const state = get()
        if (state.generationDefaultsVersion >= 2) return
        const channels = state.channels.map((channel) => {
          const preset = generationPresetForId(channel.presetId)
          const isUntouchedDefault = preset && channel.id === `official-${preset.id}`
            && !channel.apiKey && !channel.encryptedKey
            && channel.modelIds.length === preset.modelIds.length
            && channel.modelIds.every((id) => preset.modelIds.includes(id))
          return isUntouchedDefault ? { ...channel, modelIds: [] } : channel
        })
        if (state.generationDefaultsVersion >= 1) {
          set({ channels, generationDefaultsVersion: 2 })
          return
        }
        const additions = GENERATION_CHANNEL_PRESETS
          .filter((preset) => {
            const defaultId = `official-${preset.id}`
            return !state.channels.some((channel) => channel.id === defaultId || channel.presetId === preset.id || generationProtocolForChannel(channel) === preset.protocol)
          })
          .map((preset) => normalizeChannel({
            id: `official-${preset.id}`,
            presetId: preset.id,
            presetVersion: preset.version,
            presetSource: { id: preset.id, version: preset.version, copiedAt: new Date().toISOString() },
            providerId: preset.providerId,
            protocol: preset.protocol,
            name: preset.name,
            baseURL: preset.defaultBaseURL || '',
            apiKey: '',
            modelIds: [],
            modelCatalog: preset.models,
            enabled: true,
            supportsImage: preset.supportsImage,
            supportsVideo: preset.supportsVideo,
            mediaTransport: preset.mediaTransport,
            videoRequestContract: preset.videoRequestContract,
            adapters: preset.videoRequestContract ? [{
              id: preset.protocol,
              protocol: preset.protocol,
              label: GENERATION_PROTOCOL_LABELS[preset.protocol],
              supportsImage: preset.supportsImage,
              supportsVideo: preset.supportsVideo,
              mediaTransport: preset.mediaTransport,
              videoRequestContract: preset.videoRequestContract,
            }] : undefined,
          }))
        additions.forEach((channel) => saveDesktopSecret(channel.secretName || generationSecretName(channel.id), undefined))
        set({ channels: [...channels, ...additions], generationDefaultsVersion: 2 })
      },
      addChannel: (input = {}) => {
        const providerId = input.providerId || 'custom'
        const protocol = input.protocol || defaultGenerationProtocol(providerId)
        const catalog = modelsForGenerationProtocol(protocol)
        const id = nanoid()
        const preset = generationPresetForId(input.presetId) || GENERATION_CHANNEL_PRESETS.find((item) => item.protocol === protocol)
        const endpointURL = input.baseURL || preset?.defaultBaseURL || ''
        const channel = normalizeChannel({
          id,
          presetId: input.presetId || preset?.id,
          presetVersion: input.presetVersion || preset?.version,
          presetSource: input.presetSource || (preset ? { id: preset.id, version: preset.version, copiedAt: new Date().toISOString() } : undefined),
          providerId,
          protocol: preset?.protocol || protocol,
          name: input.name || '生成渠道',
          baseURL: endpointURL,
          apiKey: input.apiKey || '',
          modelIds: input.modelIds || [],
          modelCatalog: input.modelCatalog || preset?.models || catalog,
          enabled: input.enabled ?? true,
          supportsImage: input.supportsImage ?? !isVideoGenerationProtocol(preset?.protocol || protocol),
          supportsVideo: input.supportsVideo ?? isVideoGenerationProtocol(preset?.protocol || protocol),
          secretName: input.secretName || generationSecretName(id),
          mediaUploadSecretName: input.mediaUploadSecretName || generationMediaUploadSecretName(id),
          mediaTransport: input.mediaTransport,
          mediaUploadPath: input.mediaUploadPath,
          mediaUploadURL: input.mediaUploadURL,
          mediaUploadField: input.mediaUploadField,
          mediaUploadResponsePath: input.mediaUploadResponsePath,
          videoRequestContract: input.videoRequestContract || preset?.videoRequestContract,
          mediaUploadApiKey: input.mediaUploadApiKey,
          adapters: input.adapters || (preset?.videoRequestContract ? [{
            id: preset.protocol,
            protocol: preset.protocol,
            label: GENERATION_PROTOCOL_LABELS[preset.protocol],
            supportsImage: preset.supportsImage,
            supportsVideo: preset.supportsVideo,
            mediaTransport: input.mediaTransport || preset.mediaTransport,
            videoRequestContract: preset.videoRequestContract,
          }] : undefined),
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
        const catalogs = [...(channel.modelCatalog || []), ...adapters.flatMap((adapter) => modelsForGenerationProtocol(adapter.protocol))]
        return (channel.modelIds || []).map((id) => {
          const owner = adapters.find((adapter) => (channel.modelCatalog || modelsForGenerationProtocol(adapter.protocol)).some((model) => model.id === id))
          const protocol = owner?.protocol || adapters[0]?.protocol || generationProtocolForChannel(channel)
          const catalogModel = resolve808WanModel(channel, id, protocol) || resolveKacangModel(channel, id, protocol) || catalogs.find((model) => model.id === id)
          return withOfficialMediaCapabilities(catalogModel
            ? { ...catalogModel, id, adapterId: owner?.id }
            : {
                ...unknownGenerationModelForProtocol(id, owner?.protocol || adapters[0]?.protocol || generationProtocolForChannel(channel)),
                adapterId: owner?.id || adapters[0]?.id,
              })
        })
      },
    }),
    {
      name: 'cnote-generation',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        generationDefaultsVersion: state.generationDefaultsVersion,
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


