import type { NodeSpec } from '@/domain'
import { assetIdForResource, loadAssetUrl } from '@/storage/asset-store'
import { aiPromptVariableIds, type AIContextEntry, type AIImageInput } from './ai-prompt'

async function imageInput(url: string, signal?: AbortSignal): Promise<AIImageInput> {
  if (/^https?:\/\//i.test(url)) return { kind: 'url', url }
  if (!/^(blob:|data:image\/)/i.test(url)) throw new Error('不支持的图片地址')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('图片读取失败')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('上游资源不是图片')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return { kind: 'base64', mediaType: blob.type, data: btoa(binary) }
}

export async function resolveAIContextEntries<T extends AIContextEntry>(
  entries: T[], nodes: NodeSpec[], prompt: string, signal?: AbortSignal,
): Promise<T[]> {
  const explicitIds = new Set(aiPromptVariableIds(prompt))
  const selected = explicitIds.size ? entries.filter(entry => explicitIds.has(entry.nodeId)) : entries
  for (const id of explicitIds) {
    if (!entries.some(entry => entry.nodeId === id)) throw new Error('引用的上游节点已断开，请重新连接或移除胶囊。')
  }
  return Promise.all(selected.map(async entry => {
    const node = nodes.find(candidate => candidate.id === entry.nodeId)
    if (!node || node.kind !== 'content' || node.category !== 'image') return entry
    try {
      const payload = node.payload?.kind === 'image' ? node.payload : undefined
      const resources = payload?.resources
      const index = Number.isInteger(payload?.activeResourceIndex)
        ? Math.max(0, Math.min((resources?.length || 1) - 1, payload!.activeResourceIndex!)) : 0
      const resource = resources?.[index]?.resource
      const assetId = resource?.resourceId ? assetIdForResource(resource.resourceId)
        : resource ? undefined : node.assetId || (node.source?.kind === 'file' || node.source?.kind === 'clipboard-image' ? node.source.assetId : undefined)
      const remoteUrl = resource?.url || (!resource && node.source?.kind === 'url' ? node.source.url : undefined)
      const localUrl = assetId ? await loadAssetUrl(assetId) : null
      const url = localUrl || remoteUrl
      if (!url) throw new Error('图片资源已丢失，请重新导入或刷新资源')
      const image = await imageInput(url, signal)
      return { ...entry, images: [image] }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('执行已停止', 'AbortError')
      throw new Error('无法读取上游图片「' + entry.label + '」：' + (error instanceof Error ? error.message : '读取失败'))
    }
  }))
}
