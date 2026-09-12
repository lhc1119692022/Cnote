import type { ContentMediaItem, ContentNodeData, ImagePayload, VideoPayload } from '@/types/flow'

export function createGenerationResultContentData(
  variant: 'image' | 'video',
  urls: string[],
  label?: string,
  resourceIds?: string[],
  mimeTypes?: string[],
  fileNames?: string[],
): ContentNodeData {
  const isImage = variant === 'image'
  const title = label || (isImage ? '图片生成结果' : '视频生成结果')
  const resources: ContentMediaItem[] = urls.map((url, index) => ({
    resource: {
      url,
      resourceId: resourceIds?.[index],
      fileName: fileNames?.[index],
      mimeType: mimeTypes?.[index] || (isImage ? 'image/png' : 'video/mp4'),
    },
    label: `${isImage ? '图片' : '视频'} ${index + 1}`,
  }))

  return {
    schemaVersion: 2,
    label: title,
    category: isImage ? 'image' : 'video',
    subtype: isImage ? 'image' : 'remote-video',
    state: 'ready',
    source: null,
    payload: isImage
      ? { kind: 'image', resources, activeResourceIndex: 0, alt: title }
      : { kind: 'video', provider: 'direct', playback: 'video', resources, activeResourceIndex: 0, title },
    preview: {
      title,
      badge: isImage ? '生成图片' : '生成视频',
      meta: [`${urls.length} 个结果`],
    },
  }
}

/** Append a completed generation batch without replacing results already shown in the node. */
export function appendGenerationResultContentData(
  existing: ContentNodeData | undefined,
  variant: 'image' | 'video',
  urls: string[],
  label?: string,
  resourceIds?: string[],
  mimeTypes?: string[],
  fileNames?: string[],
): ContentNodeData {
  const next = createGenerationResultContentData(variant, urls, label, resourceIds, mimeTypes, fileNames)
  if (!existing || existing.payload?.kind !== variant) return next

  if (variant === 'image' && (existing.payload?.kind !== 'image' || next.payload?.kind !== 'image')) return next
  if (variant === 'video' && (existing.payload?.kind !== 'video' || next.payload?.kind !== 'video')) return next
  const existingPayload = existing.payload as ImagePayload | VideoPayload
  const nextPayload = next.payload as ImagePayload | VideoPayload
  const resources = [...(existingPayload.resources || []), ...(nextPayload.resources || [])]
    .map((item, index) => ({ ...item, label: `${variant === 'image' ? '图片' : '视频'} ${index + 1}` }))
  const newBatchStartIndex = Math.max(0, resources.length - (nextPayload.resources?.length || 1))

  return {
    ...next,
    ...existing,
    state: 'ready',
    label: existing.label || next.label,
    payload: {
      ...nextPayload,
      resources,
      activeResourceIndex: newBatchStartIndex,
    },
    preview: {
      ...next.preview,
      title: existing.preview?.title || next.preview?.title,
      meta: [`${resources.length} 个结果`],
    },
  }
}
