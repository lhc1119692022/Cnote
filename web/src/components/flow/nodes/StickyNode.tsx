import { memo, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
import { STICKY_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
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
      className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-hidden rounded-xl border ${
        selected ? 'node-selected' : 'border-border'
      }`}
      style={{ backgroundColor: currentColor.value, minWidth: STICKY_NODE_MIN_SIZE.width, minHeight: STICKY_NODE_MIN_SIZE.height }}
    >
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={STICKY_NODE_MIN_SIZE.width} minHeight={STICKY_NODE_MIN_SIZE.height} />
      <Button variant="ghost" size="icon" className="nodrag absolute right-2 top-2 z-10 h-7 w-7 rounded-full opacity-0 transition-opacity group-hover:opacity-100" onClick={rotateColor} title="更换颜色"><Pin className="h-3.5 w-3.5" /></Button>

      {/* 内容区域 */}
      <div className="min-h-0 flex-1 p-4 pt-5">
        <textarea
          value={content}
          onChange={(event) => { const value = event.target.value; setContent(value); updateNode(id, { data: { ...data, content: value, text: value } }) }}
          placeholder="添加备注..."
          className="h-full min-h-0 w-full resize-none overflow-auto bg-transparent px-0 py-0 text-base leading-7 focus:outline-none"
          style={{ color: '#1d1d1f' }}
        />
      </div>

    </div>
  )
})

StickyNode.displayName = 'StickyNode'
