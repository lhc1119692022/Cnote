import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Globe, RefreshCw, AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface BrowserNodeData {
  label: string
  url?: string
  selector?: string
  extractMode?: 'text' | 'html' | 'markdown'
}

export const BrowserNode = memo(({ data, selected }: NodeProps<BrowserNodeData>) => {
  const [url, setUrl] = useState(data.url || '')
  const [selector, setSelector] = useState(data.selector || '')
  const [extractMode, setExtractMode] = useState<'text' | 'html' | 'markdown'>(
    data.extractMode || 'text'
  )
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleFetch = () => {
    if (!url.trim()) return
    setStatus('loading')
    // TODO: 实际的网页抓取逻辑
    setTimeout(() => setStatus('success'), 1500)
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
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
            <Globe className="w-4 h-4 text-blue-600" />
          </div>
          <span className="font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <Button variant="ghost" size="icon" className="w-6 h-6">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* URL 输入 */}
      <div className="px-4 py-3 border-b border-[#d2d2d7]">
        <label className="text-xs text-[#6e6e73] mb-2 block">目标网址</label>
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 h-9 text-sm"
          />
          <Button
            size="sm"
            onClick={handleFetch}
            disabled={!url.trim() || status === 'loading'}
            className="bg-[#34c759] hover:bg-[#2fb350] text-white h-9 px-3"
          >
            {status === 'loading' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              '抓取'
            )}
          </Button>
        </div>
      </div>

      {/* 提取配置 */}
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs text-[#6e6e73] mb-2 block">CSS 选择器 (可选)</label>
          <Input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder=".article-content, #main"
            className="h-9 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-[#6e6e73] mb-2 block">提取模式</label>
          <div className="flex gap-2">
            {(['text', 'html', 'markdown'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setExtractMode(mode)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                  extractMode === mode
                    ? 'bg-[#34c759] text-white'
                    : 'bg-[#f2f2f7] text-[#6e6e73] hover:bg-[#e5e5ea]'
                }`}
              >
                {mode === 'text' && '纯文本'}
                {mode === 'html' && 'HTML'}
                {mode === 'markdown' && 'Markdown'}
              </button>
            ))}
          </div>
        </div>

        {/* 状态提示 */}
        {status === 'success' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-[#34c759]" />
            <span className="text-xs text-green-700">抓取成功，内容已就绪</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-700">抓取失败，请检查网址</span>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#d2d2d7] bg-[#f2f2f7] rounded-b-xl">
        <span className="text-xs text-[#8e8e93]">
          {status === 'idle' ? '等待抓取' : status === 'loading' ? '抓取中...' : '已完成'}
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

BrowserNode.displayName = 'BrowserNode'
