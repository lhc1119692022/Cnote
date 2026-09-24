import type {
  GenerationChannelPreset,
  GenerationChannel,
  GenerationModel,
  GenerationVideoRequestContract,
} from '@/stores/use-generation-store'
import type { GenerationVariantConfig } from '@/types/flow'
import { identifyVideoModel, normalizeVideoModelName, type VideoModelIdentity } from './video-model-identity'
import { KACANG_PUBLIC_MODELS } from './kacang-public-catalog'

export const VIDEO_808_DEFAULT_BASE_URL = 'https://api.808relay.com'

const VIDEO_808_CONTRACT: GenerationVideoRequestContract = {
  createPath: '/v1/videos',
  pollPath: '/v1/videos/{id}',
  contentPath: '/v1/videos/{id}/content',
  durationField: 'seconds',
  resolutionField: 'resolution',
  aspectRatioField: 'aspect_ratio',
  firstFrameField: 'input_reference',
  lastFrameField: 'image_end',
  imageReferencesField: 'reference_images',
  videoReferencesField: 'reference_videos',
  audioReferencesField: 'reference_audios',
  generateAudioField: 'generate_audio',
}

const KACANG_REFERENCE_CONTRACT: GenerationVideoRequestContract = {
  createPath: '/v1/videos',
  pollPath: '/v1/videos/{id}',
  contentPath: '/v1/videos/{id}/content',
  durationField: 'duration_seconds',
  resolutionField: 'resolution',
  aspectRatioField: 'aspect_ratio',
  imageReferencesField: 'reference_images',
  videoReferencesField: 'reference_videos',
  audioReferencesField: 'reference_audios',
  requiresPublicHttps: true,
}

const KACANG_DOUBAO_CONTRACT: GenerationVideoRequestContract = {
  createPath: '/v1/videos',
  pollPath: '/v1/videos/{id}',
  contentPath: '/v1/videos/{id}/content',
  durationField: 'duration_seconds',
  resolutionField: 'resolution',
  aspectRatioField: 'aspect_ratio',
  firstFrameField: 'start_frame',
  lastFrameField: 'end_frame',
  requiresFramePair: true,
  imageReferencesField: 'reference_images',
  videoReferencesField: 'video_references',
  audioReferencesField: 'audio_reference',
  generateAudioField: 'generate_audio',
  requiresPublicHttps: true,
}

const videoCapabilities = ['text-to-video', 'image-to-video', 'reference-to-video'] as const

const LEGACY_WAN_3_MODEL: GenerationModel = {
  id: 'wan-3',
  name: 'Wan 3',
  capabilities: [...videoCapabilities, 'first-last-frame', 'video-reference', 'audio-reference', 'generate-audio'],
  inputTypes: ['image', 'video', 'audio'],
  maxImages: 10,
  maxVideos: 5,
  maxAudios: 5,
  minDuration: 1,
  maxDuration: 30,
  defaultDuration: 5,
  pollIntervalMs: 10000,
  promptRequired: true,
  resolutions: ['720p', '480p', '1080p', '360p', '2k', '4k', '768'],
  allowCustomResolution: true,
  aspectRatios: ['16:9', '21:9', '4:3', '1:1', '3:4', '9:16'],
  allowsFirstFrameOnly: true,
  allowsAudioOnlyReference: true,
  videoRequestContract: {
    createPath: '/v1/videos',
    pollPath: '/v1/videos/{id}',
    contentPath: '/v1/videos/{id}/content',
    durationField: 'duration',
    resolutionField: 'resolution',
    aspectRatioField: 'aspect_ratio',
    firstFrameField: 'input_reference',
    lastFrameField: 'image_end',
    imageReferencesField: 'image_urls',
    videoReferencesField: 'video_urls',
    audioReferencesField: 'audio_urls',
    generateAudioField: 'generate_audio',
  },
}

export const WAN_3_MODEL: GenerationModel = {
  ...LEGACY_WAN_3_MODEL,
  minDuration: 2,
  resolutions: ['480p', '720p', '1080p'],
  allowCustomResolution: false,
  videoRequestContract: { ...VIDEO_808_CONTRACT, referenceLimits: { image: 10, video: 5, audio: 5 } },
}

const WAN_30_MODEL: GenerationModel = {
  ...LEGACY_WAN_3_MODEL,
  id: 'wan-3.0', name: 'Wan 3.0', maxImages: 2,
  resolutions: ['720p'], allowCustomResolution: false,
  videoRequestContract: { ...LEGACY_WAN_3_MODEL.videoRequestContract!, referenceLimits: { image: 2 } },
}

function documented808WanModel(modelId: string) {
  const name = normalizeVideoModelName(modelId)
  return name === 'wan-3' ? WAN_3_MODEL : name === 'wan-3.0' ? WAN_30_MODEL : LEGACY_WAN_3_MODEL
}

function videoChannelKind(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, protocol = channel.protocol): '808relay' | 'kacang' | undefined {
  if (protocol === 'video-808relay') return '808relay'
  if (protocol === 'video-kacang') return 'kacang'
  if (protocol !== 'video-api') return undefined
  if (channel.presetId === 'video-808relay') return '808relay'
  if (channel.presetId === 'video-kacang') return 'kacang'
  try {
    const host = new URL(channel.baseURL).hostname.toLowerCase()
    if (/^(api|va)[.]808relay[.]com$/.test(host)) return '808relay'
    if (host === 'newapi.prompt-hubs.com') return 'kacang'
  } catch { return undefined }
  return undefined
}

export function is808VideoChannel(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, protocol = channel.protocol) {
  return videoChannelKind(channel, protocol) === '808relay'
}

export function completeKnownVideoRequestContract(
  channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>,
  modelId: string,
  contract: Partial<GenerationVideoRequestContract>,
  protocol = channel.protocol,
) {
  // Saved channel contracts keep their precedence. Supplement only a known
  // route's missing companion field; family-name similarity is not enough.
  if (contract.referenceVideoDurationsField !== undefined || !contract.videoReferencesField) return contract
  if (videoChannelKind(channel, protocol) !== 'kacang') return contract
  const documented = KACANG_PUBLIC_MODELS.find((model) => model.id === modelId)?.videoRequestContract
  if (!documented?.referenceVideoDurationsField || contract.videoReferencesField !== documented.videoReferencesField) return contract
  return { ...contract, referenceVideoDurationsField: documented.referenceVideoDurationsField }
}

interface VideoModelAdapter extends VideoModelIdentity {
  channel: '808relay' | 'kacang'
  modeStrategy: 'explicit-seedance' | 'media-fields'
  requestContract: Partial<GenerationVideoRequestContract>
}

function documentedKacangModel(modelId: string) {
  const identity = identifyVideoModel(modelId)
  const exact = KACANG_PUBLIC_MODELS.find((model) => model.id === modelId) || LEGACY_KACANG_MODELS.find((model) => model.id === modelId)
  const withFamilyContract = (model: GenerationModel) => identity?.family === 'minimax-h3'
    ? { ...model, videoRequestContract: { ...model.videoRequestContract, referenceVideoDurationsField: 'reference_video_durations' } }
    : model
  if (exact) return withFamilyContract(exact)
  if (!identity) return undefined
  const name = normalizeVideoModelName(modelId)
  const documented = [...KACANG_PUBLIC_MODELS, ...LEGACY_KACANG_MODELS].filter((model) => {
    const candidate = identifyVideoModel(model.id)
    if (candidate?.family !== identity.family || candidate.version !== identity.version) return false
    const feature = normalizeVideoModelName(model.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z0-9])${feature}(?=$|[^a-z0-9.])`).test(name)
  }).sort((left, right) => right.id.length - left.id.length)[0]
  return documented
    ? withFamilyContract({ ...documented, id: modelId })
    : undefined
}

export function resolveVideoModelAdapter(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, modelId: string, protocol = channel.protocol): VideoModelAdapter | undefined {
  const identity = identifyVideoModel(modelId)
  const provider = videoChannelKind(channel, protocol)
  if (!identity || !provider) return undefined
  const documented = provider === 'kacang' ? documentedKacangModel(modelId) : undefined
  const adapter = (requestContract: Partial<GenerationVideoRequestContract>, modeStrategy: VideoModelAdapter['modeStrategy'] = 'media-fields'): VideoModelAdapter => ({ ...identity, channel: provider, requestContract: documented?.videoRequestContract || requestContract, modeStrategy })
  switch (identity.family) {
    case 'seedance':
      if (!['2.0', '2.5'].includes(identity.version)) return undefined
      switch (provider) {
        case '808relay': {
          const name = normalizeVideoModelName(modelId)
          // Provider contracts are narrower than family identity. A new alias
          // can share media rules without proving which upstream route it uses.
          if (/^seedance-2(?:\.0)?-(?:pro|fast|mini)$/.test(name) || name === 'seedance-2.5-pro') return adapter(VIDEO_808_CONTRACT)
          if (name === 'sd2-5-720p') return adapter({ ...VIDEO_808_CONTRACT,
            imageReferencesField: 'image_urls', videoReferencesField: 'video_urls', audioReferencesField: 'audio_urls',
          }, 'explicit-seedance')
          return adapter(VIDEO_808_CONTRACT, 'explicit-seedance')
        }
        case 'kacang': return adapter(/(?:^|[^a-z0-9])doubao[-_.\s]+seedance/.test(normalizeVideoModelName(modelId)) ? KACANG_DOUBAO_CONTRACT : KACANG_REFERENCE_CONTRACT)
      }
      break
    case 'minimax-h3':
      if (identity.version === '3.0' && provider === 'kacang') {
        return adapter({ ...KACANG_REFERENCE_CONTRACT, referenceVideoDurationsField: 'reference_video_durations' })
      }
      break
    case 'wan':
      if (identity.version === '3.0' && provider === '808relay') return adapter(documented808WanModel(modelId).videoRequestContract!)
      break
    case 'grok-video':
      if (['1.0', '1.5'].includes(identity.version) && provider === 'kacang') return adapter({
        ...KACANG_REFERENCE_CONTRACT, firstFrameField: 'image', imageReferencesField: 'images',
        videoReferencesField: undefined, audioReferencesField: undefined,
      })
  }
  return undefined
}

type Seedance808WireMode = 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'start-end-to-video'

export function videoRequestMode(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, modelId: string, config: GenerationVariantConfig, protocol = channel.protocol): Seedance808WireMode | undefined {
  if (resolveVideoModelAdapter(channel, modelId, protocol)?.modeStrategy !== 'explicit-seedance') return undefined
  if (config.capability === 'first-last-frame') {
    return config.references.some((reference) => reference.type === 'image' && reference.role === 'last_frame')
      ? 'start-end-to-video'
      : 'image-to-video'
  }
  return config.references.length ? 'reference-to-video' : 'text-to-video'
}

export function resolve808WanModel(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, modelId: string, protocol = channel.protocol) {
  const adapter = resolveVideoModelAdapter(channel, modelId, protocol)
  return adapter?.family === 'wan' && adapter.channel === '808relay'
    ? { ...documented808WanModel(modelId), id: modelId, name: modelId }
    : undefined
}

export function resolveKacangModel(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, modelId: string, protocol = channel.protocol) {
  if (videoChannelKind(channel, protocol) !== 'kacang') return undefined
  const documented = documentedKacangModel(modelId)
  if (documented) {
    const durations = [...new Set(documented.allowedDurations || [])].sort((a, b) => a - b)
    const continuous = durations.length > 2 && durations.every((value, index) => Number.isInteger(value) && (!index || value === durations[index - 1] + 1))
    return {
      ...documented,
      ...(identifyVideoModel(modelId)?.family === 'minimax-h3' ? { audioGeneration: 'prompt' as const } : {}),
      ...(continuous ? { allowedDurations: undefined, minDuration: durations[0], maxDuration: durations[durations.length - 1] } : {}),
    }
  }
  const adapter = resolveVideoModelAdapter(channel, modelId, protocol)
  if (!adapter) return undefined
  const contract = adapter.requestContract
  return {
    id: modelId, name: modelId, capabilitySource: 'inferred',
    ...(adapter.family === 'minimax-h3' ? { audioGeneration: 'prompt' as const } : {}),
    capabilities: [...videoCapabilities, ...(contract.firstFrameField ? ['first-last-frame'] as const : []), ...(contract.generateAudioField ? ['generate-audio'] as const : [])],
    inputTypes: (['image', 'video', 'audio'] as const).filter((type) => Boolean(contract[`${type}ReferencesField`])),
    promptRequired: true, allowsAudioOnlyReference: true, allowsFirstFrameOnly: Boolean(contract.firstFrameField) && !contract.requiresFramePair,
    allowCustomResolution: true, videoRequestContract: contract,
  } satisfies GenerationModel
}

function create808Model(input: Omit<GenerationModel, 'capabilities'> & { capabilities?: GenerationModel['capabilities'] }): GenerationModel {
  return {
    capabilities: [...videoCapabilities, 'video-reference', 'audio-reference'],
    inputTypes: ['image', 'video', 'audio'],
    pollIntervalMs: 10000,
    defaultDuration: 5,
    promptRequired: true,
    videoRequestContract: VIDEO_808_CONTRACT,
    ...input,
  }
}

export const VIDEO_808_MODELS: GenerationModel[] = [
  create808Model({
    id: 'seedance-2-pro',
    name: 'Seedance 2 Pro',
    capabilities: [...videoCapabilities, 'first-last-frame', 'video-reference', 'audio-reference', 'generate-audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    promptRequired: false,
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  create808Model({
    id: 'seedance-2-fast',
    name: 'Seedance 2 Fast',
    allowedDurations: [5, 10],
    promptRequired: false,
    resolutions: ['480p', '720p'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  create808Model({
    id: 'seedance-2-mini',
    name: 'Seedance 2 Mini',
    allowedDurations: [5, 10],
    promptRequired: false,
    resolutions: ['480p', '720p'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  create808Model({
    id: 'seedance-2.5-pro',
    name: 'Seedance 2.5 Pro',
    capabilities: [...videoCapabilities, 'first-last-frame', 'video-reference', 'audio-reference', 'video-edit', 'generate-audio'],
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 30,
    promptRequired: false,
    allowsAudioOnlyReference: true,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  WAN_3_MODEL,
  {
    ...create808Model({
      id: 'gemini-omni-1.1',
      name: 'Gemini Omni 1.1',
      capabilities: [...videoCapabilities, 'video-reference'],
      inputTypes: ['image', 'video'],
      maxImages: 8,
      maxVideos: 3,
      maxAudios: 0,
      minDuration: 3,
      maxDuration: 10,
      resolutions: ['360p', '720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16'],
    }),
    promptRequired: false,
    promptlessWithReferences: true,
  },
]

function createKacangModel(
  input: Omit<GenerationModel, 'capabilities' | 'videoRequestContract'> & {
    capabilities?: GenerationModel['capabilities']
    videoRequestContract?: GenerationVideoRequestContract
  },
): GenerationModel {
  const contract = input.videoRequestContract || KACANG_REFERENCE_CONTRACT
  const capabilities: GenerationModel['capabilities'] = input.capabilities || [
    ...videoCapabilities,
    ...(input.inputTypes?.includes('video') ? ['video-reference'] as GenerationModel['capabilities'] : []),
    ...(input.inputTypes?.includes('audio') ? ['audio-reference'] as GenerationModel['capabilities'] : []),
  ]
  return {
    capabilities,
    inputTypes: ['image'],
    pollIntervalMs: 10000,
    defaultDuration: 4,
    promptRequired: true,
    mediaRulesSource: 'custom',
    videoRequestContract: contract,
    ...input,
  }
}

const KACANG_COMMON_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
const KACANG_WIDE_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']

const LEGACY_KACANG_MODELS: GenerationModel[] = [
  createKacangModel({
    id: 'minimax_h3',
    name: 'Minimax H3',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['768', '1080p', '2K', '4K'],
    aspectRatios: KACANG_COMMON_RATIOS,
  }),
  createKacangModel({
    id: 'MiniMax-H3-漫剧优化',
    name: 'MiniMax H3 漫剧优化',
    inputTypes: ['image', 'video'],
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['768', '2K', '4K'],
    aspectRatios: KACANG_COMMON_RATIOS,
  }),
  createKacangModel({
    id: 'MiniMax-H3-量化版',
    name: 'MiniMax H3 量化版',
    inputTypes: ['image', 'video'],
    minDuration: 4,
    maxDuration: 10,
    resolutions: ['768'],
    aspectRatios: KACANG_COMMON_RATIOS,
  }),
  createKacangModel({
    id: 'MiniMax-H3-四步采样版',
    name: 'MiniMax H3 四步采样版',
    inputTypes: ['image', 'video'],
    resolutions: ['768', '1080p'],
    aspectRatios: KACANG_COMMON_RATIOS,
  }),
  createKacangModel({
    id: 'S-2.0mini-线路三',
    name: 'S-2.0 Mini 线路三',
    inputTypes: ['image', 'audio'],
    maxImages: 9,
    maxAudios: 3,
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 5,
    resolutions: ['480p', '720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '21:9', '3:4', '4:3'],
  }),
  createKacangModel({
    id: 'S-2.0-900-内置过脸',
    name: 'S-2.0 900 内置过脸',
    maxImages: 9,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  }),
  createKacangModel({
    id: 'S-2.0-933-内置过脸',
    name: 'S-2.0 933 内置过脸',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  }),
  createKacangModel({
    id: 'S-2.5-10图-内置过脸',
    name: 'S-2.5 10 图内置过脸',
    maxImages: 10,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  }),
  createKacangModel({
    id: 'S-2.0满血933-线路九',
    name: 'S-2.0 满血 933 线路九',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    allowedDurations: [10, 15],
    defaultDuration: 10,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'],
  }),
  createKacangModel({
    id: 'S-2.5-101010-内置过脸',
    name: 'S-2.5 101010 内置过脸',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 10,
    maxVideos: 10,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
  }),
  createKacangModel({
    id: 'S-2.5-301010-内置过脸',
    name: 'S-2.5 301010 内置过脸',
    mediaRulesSource: 'custom',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    videoRequestContract: {
      ...KACANG_REFERENCE_CONTRACT,
      referenceLimits: { image: 30, video: 10, audio: 10 },
      maxReferenceCount: 40,
    },
  }),
  createKacangModel({
    id: 'S-满血2.0-稳定-线路一',
    name: 'S 满血 2.0 稳定 线路一',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: KACANG_WIDE_RATIOS,
  }),
  createKacangModel({
    id: 'S-2.0fast-稳定-线路一',
    name: 'S 2.0 Fast 稳定 线路一',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    aspectRatios: KACANG_WIDE_RATIOS,
  }),
  createKacangModel({
    id: 'S-2.0mini-稳定-线路一',
    name: 'S 2.0 Mini 稳定 线路一',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    aspectRatios: KACANG_WIDE_RATIOS,
  }),
  ...[
    ['doubao-seedance-2.0', 'Doubao Seedance 2.0', 15, ['720P']],
    ['doubao-seedance-2.0-fast', 'Doubao Seedance 2.0 Fast', 15, ['720P']],
    ['doubao-seedance-2.0-mini', 'Doubao Seedance 2.0 Mini', 15, ['720P']],
  ].map(([id, name, maxDuration, resolutions]) => createKacangModel({
    id: id as string,
    name: name as string,
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: maxDuration as number,
    resolutions: resolutions as string[],
    aspectRatios: KACANG_COMMON_RATIOS,
    capabilities: [...videoCapabilities, 'first-last-frame', 'video-reference', 'audio-reference', 'generate-audio'],
    videoRequestContract: KACANG_DOUBAO_CONTRACT,
  })),
  createKacangModel({
    id: 'doubao-seedance-2.5',
    name: 'Doubao Seedance 2.5',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['720P'],
    aspectRatios: KACANG_COMMON_RATIOS,
    capabilities: [...videoCapabilities, 'first-last-frame', 'video-reference', 'audio-reference', 'generate-audio'],
    videoRequestContract: KACANG_DOUBAO_CONTRACT,
  }),
  createKacangModel({
    id: 'S-2.0满血933-卡脸',
    name: 'S 2.0 满血 933 卡脸',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
  }),
  createKacangModel({
    id: 'S-2.0fast满血933-卡脸',
    name: 'S 2.0 Fast 满血 933 卡脸',
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
  }),
]

export const VIDEO_MODEL_CATALOG = VIDEO_808_MODELS
export const VIDEO_KACANG_MODELS = KACANG_PUBLIC_MODELS

export const GENERATION_CHANNEL_PRESETS: GenerationChannelPreset[] = [
  { id: 'runninghub', version: '1', name: 'RunningHub', providerId: 'runninghub', protocol: 'runninghub', defaultBaseURL: 'https://www.runninghub.cn', modelIds: [], models: [], supportsImage: false, supportsVideo: false },
  {
    id: 'video-808relay',
    version: '2',
    name: '808Relay 视频',
    description: '现有视频中转站的异步视频接口与六个已确认模型',
    providerId: 'video',
    protocol: 'video-808relay',
    defaultBaseURL: VIDEO_808_DEFAULT_BASE_URL,
    modelIds: VIDEO_808_MODELS.map((model) => model.id),
    models: VIDEO_808_MODELS,
    supportsImage: false,
    supportsVideo: true,
    videoRequestContract: VIDEO_808_CONTRACT,
  },
  {
    id: 'video-kacang',
    version: '2026-09-19.008',
    name: 'Kacang 视频',
    description: 'Kacang 公开目录中的二十二个视频模型；按渠道契约绑定参数',
    providerId: 'video',
    protocol: 'video-kacang',
    defaultBaseURL: 'https://newapi.prompt-hubs.com/v1',
    modelIds: VIDEO_KACANG_MODELS.map((model) => model.id),
    models: VIDEO_KACANG_MODELS,
    supportsImage: false,
    supportsVideo: true,
    videoRequestContract: KACANG_REFERENCE_CONTRACT,
  },
]
