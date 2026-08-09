import { memo, useState } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Sparkles, Settings, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AINodeData {
  label: string
  provider?: string
  model?: string
  prompt?: string
  temperature?: number
}

export const AINode = memo(({ data, selected }: NodeProps<AINodeData>) => {
  const [provider, setProvider] = useState(data.provider || 'OpenAI')
  const [model, setModel] = useState(data.model || 'gpt-4')
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [temperature, setTemperature] = useState(data.temperature || 0.7)
  const [showSettings, setShowSettings] = useState(false)

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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-medium text-[#1d1d1f]">{data.label}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 模型选择 */}
      <div className="px-4 py-3 border-b border-[#d2d2d7] space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-[#6e6e73] mb-1 block">服务商</label>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 pr-8 border border-[#d2d2d7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#34c759] appearance-none bg-white"
              >
                <option>OpenAI</option>
                <option>Anthropic</option>
                <option>Google</option>
                <option>Cohere</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e8e93] pointer-events-none" />
            </div>
          </div>

          <div className="flex-1">
            <label className="text-xs text-[#6e6e73] mb-1 block">模型</label>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 pr-8 border border-[#d2d2d7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#34c759] appearance-none bg-white"
              >
                <option>gpt-4</option>
                <option>gpt-4-turbo</option>
                <option>gpt-3.5-turbo</option>
                <option>claude-3-opus</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e8e93] pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Prompt 区域 */}
      <div className="p-4">
        <label className="text-xs text-[#6e6e73] mb-2 block">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入 AI 提示词..."
          className="w-full h-32 px-3 py-2 border border-[#d2d2d7] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#34c759] text-sm"
        />

        {/* 高级设置 */}
        {showSettings && (
          <div className="mt-3 pt-3 border-t border-[#d2d2d7] space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-[#6e6e73]">Temperature</label>
                <span className="text-xs text-[#1d1d1f] font-medium">{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-xs text-[#6e6e73] mb-1 block">Max Tokens</label>
              <Input
                type="number"
                placeholder="2048"
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#d2d2d7] bg-[#f2f2f7] rounded-b-xl">
        <span className="text-xs text-[#8e8e93]">
          {prompt.length} 字符
        </span>
        <Button variant="ghost" size="sm" className="text-xs h-7 text-[#34c759]">
          测试运行
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

AINode.displayName = 'AINode'
