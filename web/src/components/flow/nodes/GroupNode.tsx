import { memo } from 'react'
import { NodeProps } from 'reactflow'
import { Folder, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GroupNodeData {
  label: string
  description?: string
}

export const GroupNode = memo(({ data, selected }: NodeProps<GroupNodeData>) => {
  return (
    <div
      className={`bg-[#f2f2f7]/50 rounded-2xl border-2 border-dashed min-w-[400px] min-h-[300px] ${
        selected ? 'border-[#34c759]' : 'border-[#d2d2d7]'
      }`}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/80 rounded-t-2xl border-b border-[#d2d2d7]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
            <Folder className="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <span className="font-medium text-[#1d1d1f] text-sm">{data.label}</span>
            {data.description && (
              <p className="text-xs text-[#8e8e93]">{data.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            title="折叠"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 组内区域 */}
      <div className="p-4 min-h-[240px] flex items-center justify-center">
        <div className="text-center">
          <Folder className="w-12 h-12 text-[#8e8e93] mx-auto mb-2 opacity-50" />
          <p className="text-sm text-[#8e8e93]">拖入节点到此分组</p>
        </div>
      </div>
    </div>
  )
})

GroupNode.displayName = 'GroupNode'
