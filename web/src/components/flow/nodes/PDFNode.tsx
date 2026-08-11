import { memo, useEffect, useState } from 'react'
import { Position, NodeProps } from 'reactflow'
import { FileText, Download, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc, NodeResourceLostNotice } from './NodeChrome'

interface PDFNodeData {
  label: string
  fileName?: string
  pageCount?: number
  extractedText?: string
  content?: string
  resourceLost?: boolean
  disabled?: boolean
  enabled?: boolean
}

export const PDFNode = memo(({ id, data, selected }: NodeProps<PDFNodeData>) => {
  const updateNode = useFlowStore((state) => state.updateNode)
  const [fileName, setFileName] = useState(data.fileName || '')
  const [pageCount, setPageCount] = useState(data.pageCount || 0)
  const [status, setStatus] = useState<'idle' | 'processing' | 'success'>('idle')
  const resourceLost = Boolean(data.resourceLost)
  const disabled = Boolean(data.disabled && !resourceLost)

  useEffect(() => setFileName(data.fileName || ''), [data.fileName])
  useEffect(() => setPageCount(data.pageCount || 0), [data.pageCount])
  useEffect(() => {
    if (!data.content?.startsWith('blob:')) return
    let active = true
    fetch(data.content)
      .then((response) => { if (!response.ok) throw new Error('PDF resource unavailable') })
      .catch(() => {
        if (!active || data.resourceLost) return
        const current = useFlowStore.getState().nodes.find((node) => node.id === id)
        if (current) updateNode(id, { data: { ...current.data, resourceLost: true } })
      })
    return () => { active = false }
  }, [data.content, data.resourceLost, id, updateNode])

  const handleFileSelect = () => {
    // TODO: 实现文件选择逻辑
    console.log('选择 PDF 文件')
  }

  return (
    <div
      className={`node-card node-panel-shadow group relative flex h-full min-h-[300px] w-full min-w-[320px] flex-col rounded-xl border bg-card ${
        selected ? 'border-primary' : 'border-border'
      } ${disabled ? 'opacity-50 grayscale' : ''}`}
    >
      {/* 输入连接点 */}
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={320} minHeight={300} />
      {resourceLost && <NodeResourceLostNotice />}

      {/* 头部 */}
      <div className="flex items-center px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
            <FileText className="w-4 h-4 text-red-600" />
          </div>
          <span className="font-medium text-foreground">{data.label}</span>
        </div>
      </div>

      {/* 文件上传区域 */}
      <div className="flex-1 p-4">
        {!fileName ? (
          <div
            onClick={handleFileSelect}
            className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary hover:bg-muted transition-colors"
          >
            <Upload className="w-10 h-10 text-muted-foreground mb-2" />
            <p className="text-sm text-foreground font-medium mb-1">点击上传 PDF</p>
            <p className="text-xs text-muted-foreground">支持最大 10MB</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <FileText className="w-8 h-8 text-red-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
                <p className="text-xs text-muted-foreground">{pageCount} 页</p>
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
                <div className="w-2 h-2 rounded-full bg-primary" />
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
                className="flex-1 h-8 text-xs bg-primary text-primary-foreground hover:brightness-90"
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
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted rounded-b-xl">
        <span className="text-xs text-muted-foreground">
          {!fileName ? '等待上传' : status === 'success' ? '已就绪' : '处理中'}
        </span>
        <Button variant="ghost" size="sm" className="text-xs h-7">
          查看预览
        </Button>
      </div>

    </div>
  )
})

PDFNode.displayName = 'PDFNode'
