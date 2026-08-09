import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { FileText, Download, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PDFNodeData {
  label: string
  fileName?: string
  pageCount?: number
  extractedText?: string
}

export const PDFNode = memo(({ data, selected }: NodeProps<PDFNodeData>) => {
  const [fileName, setFileName] = useState(data.fileName || '')
  const [pageCount, setPageCount] = useState(data.pageCount || 0)
  const [status, setStatus] = useState<'idle' | 'processing' | 'success'>('idle')

  const handleFileSelect = () => {
    // TODO: 实现文件选择逻辑
    console.log('选择 PDF 文件')
  }

  return (
    <div
      className={`bg-white rounded-xl shadow-lg border-2 min-w-[320px] max-w-[400px] ${
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
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
            <FileText className="w-4 h-4 text-red-600" />
          </div>
          <span className="font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <Button variant="ghost" size="icon" className="w-6 h-6">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 文件上传区域 */}
      <div className="p-4">
        {!fileName ? (
          <div
            onClick={handleFileSelect}
            className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-[#d2d2d7] rounded-lg cursor-pointer hover:border-[#34c759] hover:bg-[#f2f2f7] transition-colors"
          >
            <Upload className="w-10 h-10 text-[#8e8e93] mb-2" />
            <p className="text-sm text-[#1d1d1f] font-medium mb-1">点击上传 PDF</p>
            <p className="text-xs text-[#8e8e93]">支持最大 10MB</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-[#f2f2f7] rounded-lg">
              <FileText className="w-8 h-8 text-red-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1d1d1f] truncate">{fileName}</p>
                <p className="text-xs text-[#8e8e93]">{pageCount} 页</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6"
                onClick={() => {
                  setFileName('')
                  setPageCount(0)
                  setStatus('idle')
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {status === 'processing' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-blue-700">正在提取文本...</span>
              </div>
            )}

            {status === 'success' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-[#34c759]" />
                <span className="text-xs text-green-700">文本提取完成</span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
              >
                <Download className="w-3 h-3 mr-1" />
                下载原文件
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs bg-[#34c759] hover:bg-[#2fb350] text-white"
                onClick={() => {
                  setStatus('processing')
                  setTimeout(() => setStatus('success'), 2000)
                }}
                disabled={status !== 'idle'}
              >
                提取文本
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#d2d2d7] bg-[#f2f2f7] rounded-b-xl">
        <span className="text-xs text-[#8e8e93]">
          {!fileName ? '等待上传' : status === 'success' ? '已就绪' : '处理中'}
        </span>
        <Button variant="ghost" size="sm" className="text-xs h-7">
          查看预览
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

PDFNode.displayName = 'PDFNode'
