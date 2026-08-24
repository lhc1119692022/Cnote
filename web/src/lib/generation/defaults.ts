import { nanoid } from 'nanoid'
import type { GenerationReference, GenerationVariantConfig, RequestNodeData, RequestVariant } from '@/types/flow'

export function createGenerationVariantConfig(variant: 'image' | 'video'): GenerationVariantConfig {
  return {
    prompt: '',
    references: [],
    capability: variant === 'image' ? 'text-to-image' : 'text-to-video',
    seconds: variant === 'video' ? 30 : undefined,
    resolution: variant === 'video' ? '720p' : undefined,
    aspectRatio: '16:9',
    quality: 'standard',
    generateAudio: variant === 'video',
  }
}

export function createRequestNodeData(variant: RequestVariant = 'body'): RequestNodeData {
  const idleTask = { status: 'idle' as const }
  return {
    schemaVersion: 1,
    label: '请求体',
    variant,
    image: createGenerationVariantConfig('image'),
    video: createGenerationVariantConfig('video'),
    tasks: { image: idleTask, video: { ...idleTask } },
    task: variant === 'body' ? idleTask : { ...idleTask },
    resultNodeIds: {},
  }
}

export function createGenerationReference(input: Partial<GenerationReference> & Pick<GenerationReference, 'type'>): GenerationReference {
  return {
    id: input.id || nanoid(),
    type: input.type,
    role: input.role,
    label: input.label,
    source: input.source || 'local',
    url: input.url,
    previewUrl: input.previewUrl,
    resourceId: input.resourceId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.size,
    duration: input.duration,
    order: input.order ?? 0,
    status: input.status || 'ready',
    error: input.error,
  }
}
