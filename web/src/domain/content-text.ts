import type { ContentNodeSpec } from './graph'

export function contentNodeText(node: ContentNodeSpec): string | undefined {
  if (node.content?.trim()) return node.content
  const payload = node.payload
  if (!payload) return undefined
  if (payload.kind === 'text') return payload.value.trim() || undefined
  if (payload.kind === 'document') return payload.plainText.trim() || payload.rawText?.trim() || undefined
  if (payload.kind === 'social') return payload.bodyText.trim() || undefined
  if (payload.kind === 'video') return payload.transcript?.trim() || undefined
  return undefined
}
