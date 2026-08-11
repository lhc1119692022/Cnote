import { memo, useEffect, useMemo, useState } from 'react'
import { Position, NodeProps } from 'reactflow'
import { ChevronDown, Send, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAIStore } from '@/stores/use-ai-store'
import { useFlowStore } from '@/stores/use-flow-store'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc } from './NodeChrome'

interface AINodeData {
  label: string
  channelId?: string
  model?: string
  prompt?: string
  systemPrompt?: string
  temperature?: number
}

export const AINode = memo(({ id, data, selected }: NodeProps<AINodeData>) => {
  const apiKeys = useAIStore((state) => state.apiKeys)
  const getAPIKey = useAIStore((state) => state.getAPIKey)
  const updateNode = useFlowStore((state) => state.updateNode)
  const availableChannels = useMemo(
    () => apiKeys.filter((channel) => Boolean(getAPIKey(channel.id)) && Boolean(channel.modelIds?.length)),
    [apiKeys, getAPIKey]
  )
  const selectedChannel = availableChannels.find((channel) => channel.id === data.channelId) || availableChannels[0]
  const models = selectedChannel?.modelIds || []
  const disabled = Boolean((data as any).disabled || !selectedChannel || !data.model)
  const [showSettings, setShowSettings] = useState(false)
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [temperature, setTemperature] = useState(data.temperature ?? 0.7)

  useEffect(() => {
    if (!selectedChannel) return
    const model = models.includes(data.model || '') ? data.model : models[0]
    if (data.channelId !== selectedChannel.id || data.model !== model) {
      updateNode(id, { data: { ...data, channelId: selectedChannel.id, model } })
    }
  }, [data, id, models, selectedChannel, updateNode])

  const updateData = (updates: Partial<AINodeData>) => updateNode(id, { data: { ...data, ...updates } })

  return (
    <div className={`node-card node-panel-shadow group relative flex h-full min-h-[360px] w-full min-w-[380px] flex-col overflow-visible rounded-2xl border bg-card ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'} ${disabled ? 'opacity-50 grayscale' : ''}`}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={380} minHeight={360} />

      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500"><Sparkles className="h-4 w-4 text-primary-foreground" /></div>
          <div><div className="text-sm font-semibold text-foreground">{data.label}</div><div className="text-[11px] text-muted-foreground">{selectedChannel?.name || '未配置渠道'}</div></div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowSettings((value) => !value)} aria-label="AI 节点设置"><Settings className="h-4 w-4" /></Button>
      </div>

      {showSettings && <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-3">
        {availableChannels.length ? <>
          <label className="block text-[11px] text-muted-foreground">渠道<div className="relative mt-1"><select value={selectedChannel?.id || ''} onChange={(e) => updateData({ channelId: e.target.value, model: apiKeys.find((channel) => channel.id === e.target.value)?.modelIds?.[0] })} className="h-9 w-full appearance-none rounded-lg border border-border bg-card px-3 pr-9 text-xs text-foreground"><option value="" disabled>选择渠道</option>{availableChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.modelIds?.length || 0} 个模型</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /></div></label>
          <label className="block text-[11px] text-muted-foreground">模型<div className="relative mt-1"><select value={data.model || models[0] || ''} onChange={(e) => updateData({ model: e.target.value })} className="h-9 w-full appearance-none rounded-lg border border-border bg-card px-3 pr-9 text-xs text-foreground">{models.map((model) => <option key={model} value={model}>{model}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /></div></label>
        </> : <p className="text-xs text-muted-foreground">请先配置 API Key 并拉取至少一个模型</p>}
        <div><div className="mb-1 flex items-center justify-between"><label className="text-[11px] text-muted-foreground">Temperature</label><span className="text-[11px] text-foreground">{temperature}</span></div><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => { const value = parseFloat(e.target.value); setTemperature(value); updateData({ temperature: value }) }} className="w-full" /></div>
        <Input type="number" placeholder="Max Tokens（可选）" className="h-8 text-xs" />
      </div>}

      <div className="flex min-h-[210px] flex-1 items-center justify-center px-8 py-8 text-center">
        <div className="space-y-2 text-muted-foreground"><Sparkles className="mx-auto h-8 w-8 opacity-20" /><p className="text-xs">输入提示词开始生成</p><p className="text-[11px] opacity-70">也可以使用上游节点的输出作为输入</p></div>
      </div>

      <div className="border-t border-border bg-muted/40 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2"><textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); updateData({ prompt: e.target.value }) }} placeholder="输入消息..." rows={2} className="nodrag nowheel min-h-[42px] flex-1 resize-none bg-transparent px-1 py-1 text-xs text-foreground outline-none" /><Button variant="secondary" size="icon" className="h-8 w-8 shrink-0 rounded-full" aria-label="测试运行"><Send className="h-3.5 w-3.5" /></Button></div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{prompt.length} 字符</span><span className="max-w-[210px] truncate">{data.model || models[0] || '未选择模型'}</span></div>
      </div>

    </div>
  )
})

AINode.displayName = 'AINode'
