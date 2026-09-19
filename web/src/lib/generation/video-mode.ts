import type { GenerationModel } from '@/stores/use-generation-store'
import type { GenerationCapability, GenerationReference, GenerationVariantConfig } from '@/types/flow'

import { withOfficialMediaCapabilities } from './official-media-rules'

export const VIDEO_MODE_LABELS = {
  'reference-to-video': '多模态',
  'first-last-frame': '首尾帧',
} as const

export type VideoMode = keyof typeof VIDEO_MODE_LABELS

export const VIDEO_MODE_PLACEHOLDERS: Record<VideoMode, string> = {
  'first-last-frame': '上传或连接首帧和尾帧，描述两帧之间的过渡…',
  'reference-to-video': '描述镜头、动作和氛围，可添加参考素材…',
}

export function videoModesForModel(model?: GenerationModel): VideoMode[] {
  if (model) model = withOfficialMediaCapabilities(model)
  if (!model) return []
  if (model.capabilitySource === 'inferred' && model.capabilities.some((capability) => capability.endsWith('-to-video') || ['video-reference', 'audio-reference', 'video-edit', 'generate-audio'].includes(capability))) {
    return ['reference-to-video', 'first-last-frame']
  }
  const modes: VideoMode[] = []
  if (model.capabilities.some((capability) => ['text-to-video', 'image-to-video', 'reference-to-video', 'video-reference', 'audio-reference', 'video-edit'].includes(capability))) modes.push('reference-to-video')
  if (model.capabilities.includes('first-last-frame')) modes.push('first-last-frame')
  return modes
}

export function resolveVideoMode(capability: GenerationCapability | undefined, references: GenerationReference[] = []): VideoMode {
  if (capability === 'first-last-frame') return 'first-last-frame'
  if ((!capability || capability === 'generate-audio') && references.some((reference) => reference.type === 'image' && reference.role === 'last_frame')) return 'first-last-frame'
  return 'reference-to-video'
}

export function videoInputTypes(model: GenerationModel | undefined, mode: VideoMode): GenerationReference['type'][] {
  if (model) model = withOfficialMediaCapabilities(model)
  if (model?.capabilitySource === 'inferred' && model.capabilities.some((capability) => capability.endsWith('-to-video') || ['video-reference', 'audio-reference', 'video-edit', 'generate-audio'].includes(capability))) {
    return mode === 'reference-to-video' ? ['image', 'video', 'audio'] : ['image']
  }
  const supported = model?.inputTypes || (model?.capabilities.includes('image-to-video') ? ['image'] : [])
  return (['image', 'video', 'audio'] as const).filter((type) => supported.includes(type) && (mode === 'reference-to-video' || type === 'image'))
}

export function normalizeVideoModeConfig(config: GenerationVariantConfig, model?: GenerationModel): GenerationVariantConfig {
  const capability = resolveVideoMode(config.capability, config.references)
  const assigned = new Set(config.references.filter((reference) => reference.type === 'image').map((reference) => reference.role))
  const references = config.references.map((reference): GenerationReference => {
    if (reference.type === 'video') return { ...reference, role: 'reference_video' }
    if (reference.type === 'audio') return { ...reference, role: reference.role === 'reference_voice' ? 'reference_voice' : 'reference_audio' }
    if (capability === 'reference-to-video') return { ...reference, role: 'reference_image' }
    if (reference.role === 'first_frame' || reference.role === 'last_frame') return reference
    const role = !assigned.has('first_frame') ? 'first_frame' : !assigned.has('last_frame') ? 'last_frame' : 'reference_image'
    assigned.add(role)
    return { ...reference, role }
  })
  return { ...config, capability: config.capability === 'video-edit' ? 'video-edit' : capability, references, generateAudio: Boolean(config.generateAudio) && !config.noMusic && (!model || model.capabilities.includes('generate-audio')), noMusic: undefined }
}

export function videoReferenceError(model: GenerationModel | undefined, config: GenerationVariantConfig): string | undefined {
  if (model) model = withOfficialMediaCapabilities(model)
  const mode = resolveVideoMode(config.capability, config.references)
  if (model && !videoModesForModel(model).includes(mode)) return `尚未配置 ${model.name} 的${VIDEO_MODE_LABELS[mode]}能力`
  const allowedTypes = videoInputTypes(model, mode)
  if (mode === 'reference-to-video' && !config.references.length && model && model.capabilitySource !== 'inferred' && !model.capabilities.includes('text-to-video')) return '当前模型未配置纯文本生成能力，请添加参考素材'
  if (config.references.some((reference) => !allowedTypes.includes(reference.type))) return '当前模式或模型不支持这些素材类型，请切换模式或移除素材'
  if (mode === 'first-last-frame') {
    const firstFrames = config.references.filter((reference) => reference.role === 'first_frame').length
    const lastFrames = config.references.filter((reference) => reference.role === 'last_frame').length
    if (model?.allowsFirstFrameOnly) {
      if (firstFrames !== 1 || lastFrames > 1 || config.references.length !== firstFrames + lastFrames) return '首尾帧模式需要一张首帧，可选一张尾帧'
    } else if (config.references.length !== 2 || firstFrames !== 1 || lastFrames !== 1) return '首尾帧模式需要一张首帧和一张尾帧'
  }
  for (const [type, limit] of [['image', model?.maxImages], ['video', model?.maxVideos], ['audio', model?.maxAudios]] as const) {
    if (limit !== undefined && config.references.filter((reference) => reference.type === type).length > limit) return `${model?.name} 最多支持 ${limit} 个${{ image: '图片', video: '视频', audio: '音频' }[type]}参考素材`
  }
  return undefined
}
