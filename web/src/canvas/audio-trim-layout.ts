import type { NodeSpec } from '@/domain'

export const AUDIO_TRIM_EXTRA_HEIGHT = 48

export function audioTrimDisplayNode(node: NodeSpec, trimming: boolean): NodeSpec {
  return trimming && node.kind === 'content' && node.category === 'audio'
    ? { ...node, size: { ...node.size, height: node.size.height + AUDIO_TRIM_EXTRA_HEIGHT } }
    : node
}

export function formatAudioTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

export function parseAudioTime(value: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  const seconds = Number(match[1]) * 60 + Number(match[2])
  return Number.isSafeInteger(seconds) ? seconds : null
}
