import { memo, useEffect, useState } from 'react'
import { NodeProps, Position } from 'reactflow'
import { Pin } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { STICKY_NODE_MIN_SIZE } from '@/lib/flow/node-dimensions'
import type { StickyNodeColor, StickyNodeData } from '@/types/flow'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

const COLORS: Array<{ name: string; id: StickyNodeColor; value: string; border: string; dot: string }> = [
  { name: '黄色', id: 'yellow', value: '#fef3c7', border: '#fbbf24', dot: '#fbbf24' },
  { name: '粉色', id: 'pink', value: '#fce7f3', border: '#ec4899', dot: '#ec4899' },
  { name: '蓝色', id: 'blue', value: '#dbeafe', border: '#3b82f6', dot: '#3b82f6' },
  { name: '绿色', id: 'green', value: '#d1fae5', border: '#10b981', dot: '#10b981' },
  { name: '紫色', id: 'purple', value: '#e9d5ff', border: '#a855f7', dot: '#a855f7' },
]

export const StickyNode = memo(({ id, data, selected }: NodeProps<StickyNodeData>) => {
  const legacyData = data as StickyNodeData & { text?: string }
  const [content, setContent] = useState(data.content || legacyData.text || '')
  const updateNode = useFlowStore((state) => state.updateNode)
  const addToHistory = useFlowStore((state) => state.addToHistory)
  const currentColor = COLORS.find((color) => color.id === data.color) || COLORS[0]
  const pinned = Boolean(data.pinned)

  useEffect(() => {
    setContent(data.content || legacyData.text || '')
  }, [data.content, legacyData.text])

  useEffect(() => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    const dragHandle = pinned ? '.sticky-pinned-no-drag-handle' : undefined
    if (current && (current.draggable !== !pinned || current.dragHandle !== dragHandle)) {
      updateNode(id, { draggable: !pinned, dragHandle })
    }
  }, [id, pinned, updateNode])

  const commitNodeUpdate = (updates: Partial<StickyNodeData> & { draggable?: boolean; dragHandle?: string }) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (!current) return
    const { draggable, dragHandle, ...dataUpdates } = updates
    updateNode(id, {
      ...(draggable === undefined ? {} : { draggable }),
      ...('dragHandle' in updates ? { dragHandle } : {}),
      data: { ...current.data, ...dataUpdates },
    })
    addToHistory()
  }

  const chooseColor = (color: StickyNodeColor) => {
    if (color === currentColor.id) return
    commitNodeUpdate({ color })
  }

  const togglePinned = () => {
    commitNodeUpdate({
      pinned: !pinned,
      draggable: pinned,
      dragHandle: pinned ? undefined : '.sticky-pinned-no-drag-handle',
    })
  }

  return (
    <div
      className={`node-card node-panel-shadow group relative flex h-full w-full flex-col overflow-visible rounded-xl border ${
        selected ? 'node-selected' : 'border-border'
      }`}
      data-sticky-pinned={pinned ? 'true' : 'false'}
      style={{ backgroundColor: currentColor.value, borderColor: currentColor.border, minWidth: STICKY_NODE_MIN_SIZE.width, minHeight: STICKY_NODE_MIN_SIZE.height }}
    >
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id}>
        <div className="flex h-8 items-center gap-1 px-1" role="group" aria-label="贴纸颜色">
          {COLORS.map((color) => <button
            key={color.id}
            type="button"
            className={`sticky-color-button ${color.id === currentColor.id ? 'is-active' : ''}`}
            style={{ '--sticky-dot-color': color.dot } as React.CSSProperties}
            aria-label={`切换为${color.name}贴纸`}
            aria-pressed={color.id === currentColor.id}
            title={color.name}
            onClick={(event) => { event.stopPropagation(); chooseColor(color.id) }}
          />)}
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted ${pinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-label={pinned ? '取消钉住贴纸' : '钉住贴纸'}
          aria-pressed={pinned}
          title={pinned ? '取消钉住，允许移动' : '钉住，禁止移动'}
          onClick={(event) => { event.stopPropagation(); togglePinned() }}
        >
          <Pin className={`h-4 w-4 ${pinned ? 'fill-current' : ''}`} />
        </button>
      </NodeHoverToolbar>
      <NodeResizeArc nodeId={id} minWidth={STICKY_NODE_MIN_SIZE.width} minHeight={STICKY_NODE_MIN_SIZE.height} />

      {/* 内容区域 */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-[inherit] p-4 pt-5">
        <textarea
          value={content}
          onChange={(event) => { const value = event.target.value; setContent(value); updateNode(id, { data: { ...data, content: value, text: value } }) }}
          placeholder="添加备注..."
          className="custom-scrollbar h-full min-h-0 w-full resize-none overflow-auto bg-transparent px-0 py-0 text-base leading-7 focus:outline-none"
          style={{ color: '#1d1d1f' }}
        />
      </div>

    </div>
  )
})

StickyNode.displayName = 'StickyNode'
