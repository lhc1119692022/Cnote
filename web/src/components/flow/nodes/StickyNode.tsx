import { memo, useState } from 'react'
import { NodeProps } from 'reactflow'
import { StickyNote, Pin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StickyNodeData {
  label: string
  content?: string
  color?: string
}

const COLORS = [
  { name: '黄色', value: '#fef3c7', border: '#fbbf24' },
  { name: '粉色', value: '#fce7f3', border: '#ec4899' },
  { name: '蓝色', value: '#dbeafe', border: '#3b82f6' },
  { name: '绿色', value: '#d1fae5', border: '#10b981' },
  { name: '紫色', value: '#e9d5ff', border: '#a855f7' },
]

export const StickyNode = memo(({ data, selected }: NodeProps<StickyNodeData>) => {
  const [content, setContent] = useState(data.content || '')
  const [colorIndex, setColorIndex] = useState(0)
  const currentColor = COLORS[colorIndex]

  const rotateColor = () => {
    setColorIndex((prev) => (prev + 1) % COLORS.length)
  }

  return (
    <div
      className={`rounded-xl shadow-lg border-2 min-w-[240px] max-w-[280px] ${
        selected ? 'border-[#34c759]' : 'border-[#d2d2d7]'
      }`}
      style={{ backgroundColor: currentColor.value }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b-2"
        style={{ borderColor: currentColor.border }}
      >
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4" style={{ color: currentColor.border }} />
          <span className="text-sm font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5"
            onClick={rotateColor}
            title="更换颜色"
          >
            <Pin className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-5 h-5"
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="p-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="添加备注..."
          className="w-full h-32 px-0 py-0 resize-none focus:outline-none text-sm bg-transparent"
          style={{ color: '#1d1d1f' }}
        />
      </div>

      {/* 底部信息 */}
      <div className="px-3 py-2 border-t-2" style={{ borderColor: currentColor.border }}>
        <span className="text-xs" style={{ color: currentColor.border }}>
          {content.length} 字符
        </span>
      </div>
    </div>
  )
})

StickyNode.displayName = 'StickyNode'
