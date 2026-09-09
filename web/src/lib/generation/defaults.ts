import { nanoid } from 'nanoid'
import type { GenerationReference, GenerationVariantConfig, RequestNodeData, RequestVariant } from '@/types/flow'

export function createGenerationVariantConfig(variant: 'image' | 'video'): GenerationVariantConfig {
  return {
    prompt: '',
    references: [],
    capability: variant === 'image' ? 'text-to-image' : 'text-to-video',
    seconds: variant === 'video' ? 5 : undefined,
    resolution: variant === 'video' ? '720p' : 'auto',
    aspectRatio: '16:9',
    quality: variant === 'video' ? 'standard' : 'medium',
    background: variant === 'image' ? 'auto' : undefined,
    outputFormat: variant === 'image' ? 'png' : undefined,
    thinkingLevel: variant === 'image' ? 'minimal' : undefined,
    generateAudio: variant === 'video',
    noMusic: false,
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

/** Keep the persisted array and the provider request payload in the same order. */
export function normalizeGenerationReferences(references: GenerationReference[]) {
  return references
    .map((reference, index) => ({ reference, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.reference.order) ? left.reference.order : left.index
      const rightOrder = Number.isFinite(right.reference.order) ? right.reference.order : right.index
      return leftOrder - rightOrder || left.index - right.index
    })
    .map(({ reference }, index) => ({ ...reference, order: index }))
}
