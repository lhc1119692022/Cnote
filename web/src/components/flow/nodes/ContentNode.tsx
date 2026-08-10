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
      className={`bg-card rounded-xl shadow-lg border-2 min-w-[280px] max-w-[400px] ${
        selected ? 'border-primary' : 'border-border'
      }`}
    >
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-primary border-2 border-white"
      />

      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
            {renderModeIcon(mode)}
          </div>
          <span className="font-medium text-foreground">{data.label}</span>
        </div>

        <Button variant="ghost" size="icon" className="w-6 h-6">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 模式选择 */}
      <div className="flex gap-1 px-4 py-2 border-b border-border overflow-x-auto">
        {(['text', 'image', 'video', 'table', 'youtube'] as ContentMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              mode === m
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
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
            className="w-full h-32 px-3 py-2 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring text-sm"
          />
        )}

        {mode === 'image' && (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-lg">
            <Image className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">点击上传图片</p>
          </div>
        )}

        {mode === 'video' && (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-lg">
            <Video className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">点击上传视频</p>
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
                        className="border border-border px-2 py-1"
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
            <div className="flex flex-col items-center justify-center h-24 bg-muted rounded-lg">
              <Youtube className="w-8 h-8 text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">等待加载视频</p>
            </div>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted rounded-b-xl">
        <span className="text-xs text-muted-foreground">
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
        className="w-3 h-3 !bg-primary border-2 border-white"
      />
    </div>
  )
})

ContentNode.displayName = 'ContentNode'
