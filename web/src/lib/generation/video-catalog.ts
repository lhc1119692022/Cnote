import type {
  GenerationChannelPreset,
  GenerationChannel,
  GenerationModel,
  GenerationVideoRequestContract,
} from '@/stores/use-generation-store'

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

const KACANG_CAMEL_CONTRACT: GenerationVideoRequestContract = {
  createPath: '/v1/videos',
  pollPath: '/v1/videos/{id}',
  contentPath: '/v1/videos/{id}/content',
  durationField: 'duration_seconds',
  resolutionField: 'resolution',
  aspectRatioField: 'aspect_ratio',
  imageReferencesField: 'referenceImages',
  videoReferencesField: 'referenceVideos',
  audioReferencesField: 'referenceAudios',
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
  imageReferencesField: 'reference_images',
  videoReferencesField: 'video_references',
  audioReferencesField: 'audio_reference',
  generateAudioField: 'generate_audio',
  requiresPublicHttps: true,
}

const videoCapabilities = ['text-to-video', 'image-to-video', 'reference-to-video'] as const

export const WAN_3_MODEL: GenerationModel = {
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

export function is808VideoChannel(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, protocol = channel.protocol) {
  if (protocol === 'video-808relay') return true
  if (protocol !== 'video-api') return false
  if (channel.presetId === 'video-808relay') return true
  try { return /^(api|va)[.]808relay[.]com$/i.test(new URL(channel.baseURL).hostname) } catch { return false }
}

export function resolve808WanModel(channel: Pick<GenerationChannel, 'protocol' | 'baseURL' | 'presetId'>, modelId: string, protocol = channel.protocol) {
  return is808VideoChannel(channel, protocol) && /(?:^|[^a-z0-9])wan[-_. ]?3(?![0-9])/i.test(modelId)
    ? { ...WAN_3_MODEL, id: modelId, name: modelId }
    : undefined
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
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  create808Model({
    id: 'seedance-2-fast',
    name: 'Seedance 2 Fast',
    allowedDurations: [5, 10],
    resolutions: ['480p', '720p'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  }),
  create808Model({
    id: 'seedance-2-mini',
    name: 'Seedance 2 Mini',
    allowedDurations: [5, 10],
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
  const contract = input.videoRequestContract || KACANG_CAMEL_CONTRACT
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
    videoRequestContract: contract,
    ...input,
  }
}

const KACANG_COMMON_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
const KACANG_WIDE_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']

export const VIDEO_KACANG_MODELS: GenerationModel[] = [
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
    inputTypes: ['image', 'video', 'audio'],
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
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

export const GENERATION_CHANNEL_PRESETS: GenerationChannelPreset[] = [
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
    version: '2',
    name: 'Kacang 视频',
    description: 'Kacang 文档中已列出的二十个视频模型；模型参数按文档目录绑定',
    providerId: 'video',
    protocol: 'video-kacang',
    defaultBaseURL: 'https://newapi.prompt-hubs.com/v1',
    modelIds: VIDEO_KACANG_MODELS.map((model) => model.id),
    models: VIDEO_KACANG_MODELS,
    supportsImage: false,
    supportsVideo: true,
    videoRequestContract: KACANG_CAMEL_CONTRACT,
  },
]
