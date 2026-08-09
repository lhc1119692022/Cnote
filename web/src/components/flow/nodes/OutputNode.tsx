import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { FileOutput, Download, Eye, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OutputNodeData {
  label: string
  format?: 'txt' | 'md' | 'html' | 'json'
  content?: string
}

export const OutputNode = memo(({ data, selected }: NodeProps<OutputNodeData>) => {
  const [format, setFormat] = useState<'txt' | 'md' | 'html' | 'json'>(data.format || 'txt')
  const [content] = useState(data.content || '')

  const handleDownload = () => {
    // TODO: 实现下载逻辑
    console.log('下载输出')
  }

  const handleCopy = () => {
    // TODO: 实现复制逻辑
    console.log('复制到剪贴板')
  }

  const handlePreview = () => {
    // TODO: 实现预览逻辑
    console.log('预览输出')
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
          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
            <FileOutput className="w-4 h-4 text-green-600" />
          </div>
          <span className="font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <Button variant="ghost" size="icon" className="w-6 h-6">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 格式选择 */}
      <div className="px-4 py-3 border-b border-[#d2d2d7]">
        <label className="text-xs text-[#6e6e73] mb-2 block">输出格式</label>
        <div className="flex gap-2">
          {(['txt', 'md', 'html', 'json'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFormat(fmt)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                format === fmt
                  ? 'bg-[#34c759] text-white'
                  : 'bg-[#f2f2f7] text-[#6e6e73] hover:bg-[#e5e5ea]'
              }`}
            >
              .{fmt}
            </button>
          ))}
        </div>
      </div>

      {/* 预览区域 */}
      <div className="p-4">
        <div className="h-32 px-3 py-2 bg-[#f2f2f7] border border-[#d2d2d7] rounded-lg overflow-auto">
          {content ? (
            <pre className="text-xs text-[#1d1d1f] whitespace-pre-wrap">{content}</pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full">
              <FileOutput className="w-8 h-8 text-[#8e8e93] mb-2" />
              <p className="text-xs text-[#8e8e93]">等待上游节点输出</p>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="px-4 py-2 border-t border-[#d2d2d7] bg-[#f2f2f7] rounded-b-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#8e8e93]">
            {content.length} 字符
          </span>
          <span className="text-xs text-[#8e8e93]">
            {Math.ceil(content.length / 1024)} KB
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handlePreview}
          >
            <Eye className="w-3 h-3 mr-1" />
            预览
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handleCopy}
          >
            <Copy className="w-3 h-3 mr-1" />
            复制
          </Button>
          <Button
            size="sm"
            className="flex-1 h-8 text-xs bg-[#34c759] hover:bg-[#2fb350] text-white"
            onClick={handleDownload}
          >
            <Download className="w-3 h-3 mr-1" />
            下载
          </Button>
        </div>
      </div>
    </div>
  )
})

OutputNode.displayName = 'OutputNode'
