import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { FileEdit, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EditorNodeData {
  label: string
  content?: string
  syntax?: 'plain' | 'markdown' | 'html' | 'json'
}

export const EditorNode = memo(({ data, selected }: NodeProps<EditorNodeData>) => {
  const [content, setContent] = useState(data.content || '')
  const [syntax, setSyntax] = useState<'plain' | 'markdown' | 'html' | 'json'>(
    data.syntax || 'plain'
  )
  const [wordCount, setWordCount] = useState(0)

  const handleContentChange = (value: string) => {
    setContent(value)
    setWordCount(value.trim().split(/\s+/).filter(Boolean).length)
  }

  return (
    <div
      className={`bg-card rounded-xl shadow-lg border-2 min-w-[400px] max-w-[500px] ${
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
          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
            <FileEdit className="w-4 h-4 text-orange-600" />
          </div>
          <span className="font-medium text-foreground">{data.label}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            title="保存"
          >
            <Save className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 语法选择 */}
      <div className="flex gap-1 px-4 py-2 border-b border-border">
        {(['plain', 'markdown', 'html', 'json'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSyntax(s)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              syntax === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {s === 'plain' && '纯文本'}
            {s === 'markdown' && 'Markdown'}
            {s === 'html' && 'HTML'}
            {s === 'json' && 'JSON'}
          </button>
        ))}
      </div>

      {/* 编辑器区域 */}
      <div className="p-4">
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="在此编辑内容..."
          className="w-full h-64 px-3 py-2 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
          spellCheck={false}
        />
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted rounded-b-xl">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{wordCount} 词</span>
          <span>{content.length} 字符</span>
          <span>{content.split('\n').length} 行</span>
        </div>
        <Button variant="ghost" size="sm" className="text-xs h-7">
          格式化
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

EditorNode.displayName = 'EditorNode'
