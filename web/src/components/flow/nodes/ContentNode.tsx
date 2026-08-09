import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { FileText, Image, Video, Table, Youtube, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ContentMode = 'text' | 'image' | 'video' | 'table' | 'youtube'

interface ContentNodeData {
  label: string
  mode: ContentMode
  content: string
}

export const ContentNode = memo(({ data, selected }: NodeProps<ContentNodeData>) => {
  const [mode, setMode] = useState<ContentMode>(data.mode || 'text')
  const [content, setContent] = useState(data.content || '')

  const renderModeIcon = (m: ContentMode) => {
    switch (m) {
      case 'text':
        return <FileText className="w-4 h-4" />
      case 'image':
        return <Image className="w-4 h-4" />
      case 'video':
        return <Video className="w-4 h-4" />
      case 'table':
        return <Table className="w-4 h-4" />
      case 'youtube':
        return <Youtube className="w-4 h-4" />
    }
  }

  const renderModeLabel = (m: ContentMode) => {
    switch (m) {
      case 'text':
        return '文本'
      case 'image':
        return '图片'
      case 'video':
        return '视频'
      case 'table':
        return '表格'
      case 'youtube':
        return 'YouTube'
    }
  }

  return (
    <div
      className={`bg-white rounded-xl shadow-lg border-2 min-w-[280px] max-w-[400px] ${
        selected ? 'border-[#34c759]' : 'border-[#d2d2d7]'
      }`}
    >
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-[#34c759] border-2 border-white"
      />

      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
            {renderModeIcon(mode)}
          </div>
          <span className="font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <Button variant="ghost" size="icon" className="w-6 h-6">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 模式选择 */}
      <div className="flex gap-1 px-4 py-2 border-b border-[#d2d2d7] overflow-x-auto">
        {(['text', 'image', 'video', 'table', 'youtube'] as ContentMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              mode === m
                ? 'bg-[#34c759] text-white'
                : 'bg-[#f2f2f7] text-[#6e6e73] hover:bg-[#e5e5ea]'
            }`}
          >
            {renderModeIcon(m)}
            <span>{renderModeLabel(m)}</span>
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="p-4">
        {mode === 'text' && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入文本内容..."
            className="w-full h-32 px-3 py-2 border border-[#d2d2d7] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#34c759] text-sm"
          />
        )}

        {mode === 'image' && (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-[#d2d2d7] rounded-lg">
            <Image className="w-8 h-8 text-[#8e8e93] mb-2" />
            <p className="text-sm text-[#8e8e93]">点击上传图片</p>
          </div>
        )}

        {mode === 'video' && (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-[#d2d2d7] rounded-lg">
            <Video className="w-8 h-8 text-[#8e8e93] mb-2" />
            <p className="text-sm text-[#8e8e93]">点击上传视频</p>
          </div>
        )}

        {mode === 'table' && (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {[0, 1, 2].map((row) => (
                  <tr key={row}>
                    {[0, 1, 2].map((col) => (
                      <td
                        key={col}
                        className="border border-[#d2d2d7] px-2 py-1"
                      >
                        <input
                          type="text"
                          className="w-full focus:outline-none"
                          placeholder="..."
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {mode === 'youtube' && (
          <div className="space-y-2">
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴 YouTube 链接..."
            />
            <div className="flex flex-col items-center justify-center h-24 bg-[#f2f2f7] rounded-lg">
              <Youtube className="w-8 h-8 text-[#8e8e93] mb-1" />
              <p className="text-xs text-[#8e8e93]">等待加载视频</p>
            </div>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#d2d2d7] bg-[#f2f2f7] rounded-b-xl">
        <span className="text-xs text-[#8e8e93]">
          {content.length} 字符
        </span>
        <Button variant="ghost" size="sm" className="text-xs h-7">
          保存到库
        </Button>
      </div>

      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-[#34c759] border-2 border-white"
      />
    </div>
  )
})

ContentNode.displayName = 'ContentNode'
