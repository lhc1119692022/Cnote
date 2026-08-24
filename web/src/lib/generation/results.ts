import type { ContentMediaItem, ContentNodeData } from '@/types/flow'

export function createGenerationResultContentData(
  variant: 'image' | 'video',
  urls: string[],
  label?: string,
  resourceIds?: string[],
  mimeTypes?: string[],
): ContentNodeData {
  const isImage = variant === 'image'
  const title = label || (isImage ? '图片生成结果' : '视频生成结果')
  const resources: ContentMediaItem[] = urls.map((url, index) => ({
    resource: {
      url,
      resourceId: resourceIds?.[index],
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
