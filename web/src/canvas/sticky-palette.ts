import type { StickyColor } from '@/domain'

export const STICKY_PALETTE: Record<StickyColor, { fill: string; border: string; label: string }> = {
  yellow: { fill: '#fef3c7', border: '#fbbf24', label: '黄色' },
  pink: { fill: '#fce7f3', border: '#ec4899', label: '粉色' },
  blue: { fill: '#dbeafe', border: '#3b82f6', label: '蓝色' },
  green: { fill: '#d1fae5', border: '#10b981', label: '绿色' },
  purple: { fill: '#e9d5ff', border: '#a855f7', label: '紫色' },
}

export const STICKY_COLOR_ORDER: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple']
