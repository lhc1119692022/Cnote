import type { GenerationModel } from '@/stores/use-generation-store'
import type { GenerationReference, GenerationVariantConfig } from '@/types/flow'
import { identifyVideoModel, normalizeVideoModelName } from './video-model-identity'

export type OfficialMediaProfileId = 'wan-3' | 'seedance-1.0' | 'seedance-2.0' | 'seedance-2.5' | 'minimax-h3'
export type MediaKind = GenerationReference['type']

export interface MediaMetadata {
  bytes: number
  format: string
  width?: number
  height?: number
  duration?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio?: boolean
}

export interface MediaFileRule {
  formats: readonly string[]
  maxBytes: number
  exclusiveBytes?: boolean
  minSide?: number
  maxSide?: number
  minRatio?: number
  maxRatio?: number
  minPixels?: number
  maxPixels?: number
  minDuration?: number
  maxDuration?: number
  minFps?: number
  maxFps?: number
  videoCodecs?: readonly string[]
  audioCodecs?: readonly string[]
}

export interface OfficialMediaProfile {
  id: OfficialMediaProfileId
  name: string
  revision: string
  source: string
  files: Record<MediaKind, MediaFileRule>
  maxCounts: Partial<Record<MediaKind, number>>
  maxTotalDurations: Partial<Record<MediaKind, number>>
  maxTotalCount?: number
  maxRequestBytes?: number
  maxPromptCharacters?: number
}

export interface MediaViolation {
  referenceId: string
  label: string
  code: 'bytes' | 'format' | 'dimensions' | 'ratio' | 'pixels' | 'duration' | 'fps' | 'codec' | 'count' | 'total-duration' | 'total-count' | 'unverifiable'
  actual: string
  expected: string
  message: string
}

export interface MediaValidationResult {
  status: 'valid' | 'invalid' | 'unverifiable' | 'unconfigured'
  violations: MediaViolation[]
}

const MB = 1_000_000
const codecs = { videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'mp3'] }
const seedanceImage: MediaFileRule = {
  formats: ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'heic', 'heif'],
  maxBytes: 30 * MB, exclusiveBytes: true, minSide: 300, maxSide: 6000, minRatio: 0.4, maxRatio: 2.5,
}
const seedanceVideo: MediaFileRule = {
  formats: ['mp4', 'mov'], maxBytes: 200 * MB, minSide: 300, maxSide: 6000,
  minRatio: 0.4, maxRatio: 2.5, minPixels: 407696, maxPixels: 8295044,
  minDuration: 2, minFps: 24, maxFps: 60, ...codecs,
}

function freezeRules<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeRules)
    Object.freeze(value)
  }
  return value
}

// This baseline is shared by every recognized alias. Channel declarations never write to it.
export const OFFICIAL_MEDIA_PROFILES: Readonly<Record<OfficialMediaProfileId, OfficialMediaProfile>> = freezeRules({
  'wan-3': {
    id: 'wan-3', name: 'Wan', revision: '2026-09-19.1', source: '用户提供的官方规范图1；不检查透明通道',
    files: {
      image: { formats: ['jpeg', 'png', 'bmp', 'webp'], maxBytes: 20 * MB, minSide: 240, maxSide: 8000, minRatio: 1 / 8, maxRatio: 8 },
      video: { formats: ['mp4', 'mov'], maxBytes: 100 * MB, minSide: 240, maxSide: 4096, minRatio: 1 / 8, maxRatio: 8, minDuration: 1, maxDuration: 15, minFps: 16 },
      audio: { formats: ['wav', 'mp3'], maxBytes: 15 * MB, minDuration: 1, maxDuration: 15 },
    },
    maxCounts: {}, maxTotalDurations: { video: 15, audio: 15 },
  },
  'seedance-1.0': {
    id: 'seedance-1.0', name: 'Seedance 1.0', revision: '2026-09-22.1', source: 'docs/seedance-rules.md；用户附件 Ark 创建视频生成任务 API',
    files: {
      image: { ...seedanceImage, formats: ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'] },
      video: { ...seedanceVideo, formats: [] },
      audio: { formats: [], maxBytes: 0 },
    },
    maxCounts: { image: 2, video: 0, audio: 0 }, maxTotalDurations: {}, maxRequestBytes: 64 * MB,
  },
  'seedance-2.0': {
    id: 'seedance-2.0', name: 'Seedance 2.0', revision: '2026-09-22.1', source: 'docs/seedance-rules.md；用户附件 Ark 创建视频生成任务 API',
    files: {
      image: seedanceImage,
      video: { ...seedanceVideo, maxDuration: 15 },
      audio: { formats: ['wav', 'mp3'], maxBytes: 15 * MB, minDuration: 2, maxDuration: 15 },
    },
    maxCounts: { image: 9, video: 3, audio: 3 }, maxTotalDurations: { video: 15, audio: 15 }, maxRequestBytes: 64 * MB,
  },
  'seedance-2.5': {
    id: 'seedance-2.5', name: 'Seedance 2.5', revision: '2026-09-22.1', source: 'docs/seedance-rules.md；用户附件 Ark 创建视频生成任务 API',
    files: {
      image: seedanceImage,
      video: { ...seedanceVideo, maxDuration: 30 },
      audio: { formats: ['wav', 'mp3'], maxBytes: 15 * MB, minDuration: 2, maxDuration: 30 },
    },
    maxCounts: { image: 30, video: 10, audio: 10 }, maxTotalDurations: { video: 30, audio: 30 }, maxRequestBytes: 64 * MB,
  },
  'minimax-h3': {
    id: 'minimax-h3', name: 'MiniMax H3', revision: '2026-09-19.1', source: '用户提供的官方规范图3；常规参考图片与首尾帧分开检查',
    files: {
      image: { formats: ['jpeg', 'png', 'webp', 'heic', 'heif'], maxBytes: 30 * MB, minSide: 256, maxSide: 5760 },
      video: { formats: ['mp4', 'mov'], maxBytes: 50 * MB, minSide: 256, maxSide: 5760, minRatio: 0.4, maxRatio: 2.5, minDuration: 2, maxDuration: 15, ...codecs },
      audio: { formats: ['wav', 'mp3'], maxBytes: 15 * MB, minDuration: 2, maxDuration: 15 },
    },
    maxCounts: { image: 9, video: 3, audio: 3 }, maxTotalDurations: { video: 15, audio: 15 },
    maxTotalCount: 12, maxRequestBytes: 64 * MB, maxPromptCharacters: 7000,
  },
})

export function officialMediaProfile(modelId?: string): OfficialMediaProfile | undefined {
  const identity = identifyVideoModel(modelId)
  if (identity?.family === 'wan' && identity.version === '3.0') return OFFICIAL_MEDIA_PROFILES['wan-3']
  if (identity?.family === 'minimax-h3' && identity.version === '3.0') return OFFICIAL_MEDIA_PROFILES['minimax-h3']
  if (identity?.family === 'seedance' && identity.version === '2.5') return OFFICIAL_MEDIA_PROFILES['seedance-2.5']
  if (identity?.family === 'seedance' && identity.version === '2.0') return OFFICIAL_MEDIA_PROFILES['seedance-2.0']
  if (identity?.family === 'seedance' && identity.version === '1.0') return OFFICIAL_MEDIA_PROFILES['seedance-1.0']
  return undefined
}

export function seedanceGenerationRules(modelId: string) {
  const identity = identifyVideoModel(modelId)
  if (identity?.family !== 'seedance' || !['1.0', '2.0', '2.5'].includes(identity.version)) return undefined
  const name = normalizeVideoModelName(modelId)
  const tier = name.match(/(?:^|[^a-z0-9])(?:seedance|doubao|sd|s)(?:[-_.\s]|\p{Script=Han}){0,16}v?(?:[12](?:[._-]0)?|[12]0)(?:[-_.\s]*pro)?[-_.\s]*(fast|mini)(?=$|[^a-z])/u)?.[1]
  const limitedTier = tier === 'fast' || tier === 'mini'
  return {
    version: identity.version,
    minDuration: identity.version === '1.0' ? 2 : 4,
    maxDuration: identity.version === '2.5' ? 30 : identity.version === '2.0' ? 15 : 12,
    resolutions: identity.version === '2.0'
      ? limitedTier ? ['480p', '720p'] : ['480p', '720p', '1080p', '4k']
      : ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    allowsAudioOnlyReference: identity.version === '2.5',
    supportsLastFrame: identity.version !== '1.0' || tier !== 'fast',
  }
}

function minimumLimit(...values: Array<number | undefined>) {
  const declared = values.filter((value): value is number => value !== undefined)
  return declared.length ? Math.min(...declared) : undefined
}

export function withOfficialMediaCapabilities(model: GenerationModel): GenerationModel {
  const profile = officialMediaProfile(model.id)
  if (!profile) return model
  const generation = seedanceGenerationRules(model.id)
  const limits = model.videoRequestContract?.referenceLimits
  const limitFor = (type: MediaKind) => minimumLimit(
    profile.maxCounts[type], limits?.[type],
    { image: model.maxImages, video: model.maxVideos, audio: model.maxAudios }[type],
    model.inputTypes && !model.inputTypes.includes(type) ? 0 : undefined,
  )
  const inputTypes = (model.inputTypes || (['image', 'video', 'audio'] as const).filter((type) =>
    type === 'image' ? model.capabilities.some((capability) => ['image-to-video', 'reference-to-video', 'first-last-frame'].includes(capability))
      : model.capabilities.includes(type === 'video' ? 'video-reference' : 'audio-reference'),
  )).filter((type) => limitFor(type) !== 0)
  const minDuration = generation ? Math.max(generation.minDuration, model.minDuration ?? -Infinity) : model.minDuration
  const maxDuration = generation ? Math.min(generation.maxDuration, model.maxDuration ?? Infinity) : model.maxDuration
  const allowedDurations = generation && model.allowedDurations
    ? model.allowedDurations.filter((value) => Number.isInteger(value) && value >= minDuration! && value <= maxDuration!)
    : model.allowedDurations
  const defaultDuration = generation
    ? allowedDurations?.[0] === undefined && allowedDurations ? undefined
      : allowedDurations && !allowedDurations.includes(model.defaultDuration ?? 5) ? allowedDurations[0]
        : Math.max(minDuration!, Math.min(maxDuration!, model.defaultDuration ?? 5))
    : model.defaultDuration
  const contract = model.videoRequestContract
  return {
    ...model,
    inputTypes,
    maxImages: limitFor('image'),
    maxVideos: limitFor('video'),
    maxAudios: limitFor('audio'),
    allowsAudioOnlyReference: (generation?.allowsAudioOnlyReference ?? true) && model.allowsAudioOnlyReference !== false,
    allowsFirstFrameOnly: model.allowsFirstFrameOnly !== false && !contract?.requiresFramePair,
    capabilities: model.capabilities.filter((capability) => {
      if (['image-to-video', 'first-last-frame'].includes(capability) && !inputTypes.includes('image')) return false
      if (['video-reference', 'video-edit'].includes(capability) && !inputTypes.includes('video')) return false
      if (capability === 'audio-reference' && !inputTypes.includes('audio')) return false
      if (profile.id === 'seedance-1.0' && ['reference-to-video', 'generate-audio'].includes(capability)) return false
      return true
    }),
    ...(generation ? {
      minDuration, maxDuration, allowedDurations, defaultDuration,
      resolutions: (model.allowCustomResolution ? generation.resolutions : model.resolutions ?? generation.resolutions)
        .filter((value) => generation.resolutions.includes(value.toLowerCase())),
      aspectRatios: (model.aspectRatios ?? generation.aspectRatios).filter((value) => generation.aspectRatios.includes(value)),
      allowCustomResolution: false,
      promptRequired: model.promptRequired ?? false,
    } : {}),
    ...(contract ? { videoRequestContract: {
      ...contract,
      referenceLimits: { ...limits, image: limitFor('image'), video: limitFor('video'), audio: limitFor('audio') },
      maxReferenceCount: minimumLimit(profile.maxTotalCount, contract.maxReferenceCount),
    } } : {}),
  }
}

export function mediaProfileForModel(modelId?: string, model?: GenerationModel): OfficialMediaProfile | undefined {
  const resolvedModelId = modelId || model?.id
  const baseline = officialMediaProfile(resolvedModelId)
  if (!baseline || !model) return baseline
  const effective = withOfficialMediaCapabilities({ ...model, id: resolvedModelId! })
  return {
    ...baseline,
    maxCounts: { image: effective.maxImages, video: effective.maxVideos, audio: effective.maxAudios },
    maxTotalCount: minimumLimit(baseline.maxTotalCount, effective.videoRequestContract?.maxReferenceCount),
  }
}

export function mediaRuleFor(profile: OfficialMediaProfile, reference: GenerationReference, capability?: GenerationVariantConfig['capability']): MediaFileRule {
  const rule = profile.files[reference.type]
  if (profile.id === 'minimax-h3' && reference.type === 'image' && (reference.role === 'first_frame' || reference.role === 'last_frame')) {
    return { ...rule, minRatio: 0.4, maxRatio: 2.5 }
  }
  if (profile.id === 'seedance-2.5' && reference.type === 'video' && capability === 'video-edit') return { ...rule, minDuration: 4 }
  if (profile.id.startsWith('seedance') && reference.type === 'video') return rule
  return rule
}

function violation(reference: GenerationReference, code: MediaViolation['code'], actual: string, expected: string): MediaViolation {
  const label = reference.fileName || reference.label || reference.id
  return { referenceId: reference.id, label, code, actual, expected, message: `${label}：${actual}；要求${expected}` }
}

export function validateMediaFile(profile: OfficialMediaProfile, reference: GenerationReference, metadata: MediaMetadata, capability?: GenerationVariantConfig['capability']): MediaValidationResult {
  const rule = mediaRuleFor(profile, reference, capability)
  const violations: MediaViolation[] = []
  const add = (code: MediaViolation['code'], actual: string, expected: string) => violations.push(violation(reference, code, actual, expected))
  const unavailable = (name: string) => add('unverifiable', `无法读取${name}`, '能够验证真实素材规格')
  const finitePositive = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0
  if (!finitePositive(metadata.bytes)) unavailable('文件大小')
  else if (rule.exclusiveBytes ? metadata.bytes >= rule.maxBytes : metadata.bytes > rule.maxBytes) add('bytes', `${metadata.bytes}字节（${(metadata.bytes / MB).toFixed(2)} MB）`, `${rule.exclusiveBytes ? '小于' : '不超过'}${rule.maxBytes / MB} MB（${rule.maxBytes}字节）`)
  if (!metadata.format) unavailable('实际文件格式')
  else if (!rule.formats.includes(metadata.format)) add('format', `实际格式为${metadata.format}`, rule.formats.join('、'))
  if (rule.minSide !== undefined || rule.maxSide !== undefined) {
    if (!finitePositive(metadata.width) || !finitePositive(metadata.height)) unavailable('宽高')
    else {
      const { width, height } = metadata
      if (width < (rule.minSide || 0) || height < (rule.minSide || 0) || width > (rule.maxSide || Infinity) || height > (rule.maxSide || Infinity)) add('dimensions', `尺寸为${width}×${height}px`, `宽、高各在${rule.minSide}–${rule.maxSide}px范围内`)
      const ratio = width / height
      if (ratio < (rule.minRatio ?? 0) || ratio > (rule.maxRatio ?? Infinity)) add('ratio', `宽高比为${ratio.toFixed(4)}`, `宽高比在${rule.minRatio}–${rule.maxRatio}之间`)
      const pixels = width * height
      if (pixels < (rule.minPixels ?? 0) || pixels > (rule.maxPixels ?? Infinity)) add('pixels', `总像素为${pixels}`, `总像素在${rule.minPixels}–${rule.maxPixels}之间`)
    }
  }
  if (rule.minDuration !== undefined || rule.maxDuration !== undefined) {
    if (!finitePositive(metadata.duration)) unavailable('时长')
    else if (metadata.duration < (rule.minDuration ?? 0) || metadata.duration > (rule.maxDuration ?? Infinity)) add('duration', `时长为${metadata.duration}秒`, `${rule.minDuration}–${rule.maxDuration}秒`)
  }
  if (rule.minFps !== undefined || rule.maxFps !== undefined) {
    if (!finitePositive(metadata.fps)) unavailable('帧率')
    else if (metadata.fps < (rule.minFps ?? 0) || metadata.fps > (rule.maxFps ?? Infinity)) add('fps', `帧率为${metadata.fps} fps`, `${rule.minFps}–${rule.maxFps ?? '不限'} fps`)
  }
  if (rule.videoCodecs) {
    if (!metadata.videoCodec) unavailable('视频编码')
    else if (!rule.videoCodecs.includes(metadata.videoCodec)) add('codec', `视频编码为${metadata.videoCodec}`, rule.videoCodecs.join('、'))
  }
  if (rule.audioCodecs) {
    if (metadata.hasAudio === undefined) unavailable('音轨信息')
    else if (metadata.hasAudio) {
      const allowed = profile.id.startsWith('seedance') && metadata.format === 'mov' ? [...rule.audioCodecs, 'pcm'] : rule.audioCodecs
      if (!metadata.audioCodec) unavailable('视频内音频编码')
      else if (!allowed.includes(metadata.audioCodec)) add('codec', `音轨编码为${metadata.audioCodec}`, allowed.join('、'))
    }
  }
  return { status: violations.some((item) => item.code === 'unverifiable') ? 'unverifiable' : violations.length ? 'invalid' : 'valid', violations }
}

export function validateMediaCollection(profile: OfficialMediaProfile, references: GenerationReference[], metadata: ReadonlyMap<string, MediaMetadata>): MediaViolation[] {
  const violations: MediaViolation[] = []
  const counts: Partial<Record<MediaKind, number>> = {}
  const durations: Partial<Record<MediaKind, number>> = {}
  let frameCount = 0
  const frameRoles = new Set<string>()
  references.forEach((reference, index) => {
    const type = reference.type
    counts[type] = (counts[type] || 0) + 1
    const isFrame = reference.role === 'first_frame' || reference.role === 'last_frame'
    if (isFrame) frameCount += 1
    if (isFrame && frameRoles.has(reference.role!)) violations.push(violation(reference, 'count', '首尾帧角色重复', '首帧和尾帧各最多一张'))
    if (isFrame) frameRoles.add(reference.role!)
    const limit = profile.maxCounts[type]
    if (isFrame && frameCount > 2) violations.push(violation(reference, 'count', `首尾帧数量为${frameCount}`, '首尾帧最多2张'))
    if (limit !== undefined && counts[type]! > limit) violations.push(violation(reference, 'count', `${type}数量为${counts[type]}`, `不超过${limit}个`))
    const totalLimit = profile.maxTotalDurations[type]
    if (totalLimit !== undefined) {
      const duration = metadata.get(reference.id)?.duration
      if (duration !== undefined && Number.isFinite(duration)) {
        durations[type] = (durations[type] || 0) + duration
        if (durations[type]! > totalLimit) violations.push(violation(reference, 'total-duration', `${type}累计时长为${durations[type]}秒`, `不超过${totalLimit}秒`))
      }
    }
    if (profile.maxTotalCount !== undefined && index + 1 > profile.maxTotalCount) violations.push(violation(reference, 'total-count', `混合素材数量为${index + 1}`, `不超过${profile.maxTotalCount}个`))
  })
  return violations
}

export function officialRequestLimitError(profile: OfficialMediaProfile, config: GenerationVariantConfig, serializedBody?: string): string | undefined {
  if (profile.maxPromptCharacters !== undefined && Array.from(config.prompt).length > profile.maxPromptCharacters) return `${profile.name} 提示词超过${profile.maxPromptCharacters}个字符`
  if (serializedBody !== undefined && profile.maxRequestBytes !== undefined && new TextEncoder().encode(serializedBody).byteLength > profile.maxRequestBytes) return `${profile.name} 请求体超过${profile.maxRequestBytes / MB} MB`
  return undefined
}
