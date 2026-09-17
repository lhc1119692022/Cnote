import type { Size } from '@/domain'

export function fitMediaSize(width?: number, height?: number): Size | null {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const scale = Math.min(640 / width, 540 / height, Math.max(1, 240 / Math.max(width, height)))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
