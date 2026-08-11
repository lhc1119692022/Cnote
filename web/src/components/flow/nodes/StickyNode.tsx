import { memo, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { StickyNote, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

interface StickyNodeData {
  label: string
  content?: string
  text?: string
  color?: string
}

const COLORS = [
  { name: '黄色', value: '#fef3c7', border: '#fbbf24' },
  { name: '粉色', value: '#fce7f3', border: '#ec4899' },
  { name: '蓝色', value: '#dbeafe', border: '#3b82f6' },
  { name: '绿色', value: '#d1fae5', border: '#10b981' },
  { name: '紫色', value: '#e9d5ff', border: '#a855f7' },
]

export const StickyNode = memo(({ id, data, selected }: NodeProps<StickyNodeData>) => {
  const [content, setContent] = useState(data.content || data.text || '')
  const [colorIndex, setColorIndex] = useState(0)
  const updateNode = useFlowStore((state) => state.updateNode)
  const currentColor = COLORS[colorIndex]

  const rotateColor = () => {
    setColorIndex((prev) => (prev + 1) % COLORS.length)
  }

  return (
    <div
      className={`node-card node-panel-shadow group relative flex h-full min-h-[210px] w-full min-w-[240px] flex-col rounded-xl border ${
        selected ? 'border-primary' : 'border-border'
      }`}
      style={{ backgroundColor: currentColor.value }}
    >
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={240} minHeight={210} />
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b-2"
        style={{ borderColor: currentColor.border }}
      >
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4" style={{ color: currentColor.border }} />
          <span className="text-sm font-medium text-foreground">{data.label}</span>
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
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 p-3">
        <textarea
          value={content}
          onChange={(event) => { const value = event.target.value; setContent(value); updateNode(id, { data: { ...data, content: value, text: value } }) }}
          placeholder="添加备注..."
          className="h-full min-h-32 w-full resize-none bg-transparent px-0 py-0 text-sm focus:outline-none"
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
