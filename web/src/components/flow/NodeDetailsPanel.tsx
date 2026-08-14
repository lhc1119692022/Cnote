import { Brain, ExternalLink, FileText, Image as ImageIcon, Search, Send, Share2, Sparkles, Video } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useLocalResourceUrl } from '@/hooks/use-local-resource-url'
import { getProvider, getAIModelCapabilities } from '@/lib/api'
import { getActiveMediaItem, getNodeMediaItems } from '@/lib/content-media'
import { requestAIMessageSend } from '@/lib/flow/ai-panel-events'
import { useAIStore } from '@/stores/use-ai-store'
import { useFlowStore } from '@/stores/use-flow-store'
import type { AINodeData, AIReasoningLevel, AIWebSearchMode, ContentNodeData } from '@/types/flow'
import { ContentEditorPanel, MarkdownPreview } from './ContentEditorPanel'

function contentSourceUrl(data: ContentNodeData) {
  if (data.source?.kind === 'url') return data.source.normalizedUrl
  if (data.payload?.kind === 'social') return data.payload.canonicalUrl
  if (data.payload?.kind === 'video') return data.payload.url || ''
  return ''
}

function contentResourceId(data: ContentNodeData) {
  return data.source?.kind === 'file' || data.source?.kind === 'clipboard-image' ? data.source.resourceId : undefined
}

function stateLabel(data: ContentNodeData) {
  if (data.state === 'ready') return '已就绪'
  if (data.state === 'partial') return '部分解析'
  if (data.state === 'parsing' || data.state === 'detecting' || data.state === 'importing') return '处理中'
  if (data.state === 'error' || data.state === 'unsupported') return '解析失败'
  if (data.state === 'missing') return '资源丢失'
  return '等待内容'
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 border-b border-border px-5 py-4 last:border-b-0">
    <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
    {children}
  </section>
}

function ContentDetails({ nodeId, data }: { nodeId: string; data: ContentNodeData }) {
  const resourceUrl = useLocalResourceUrl(contentResourceId(data))
  const imageItems = useMemo(() => getNodeMediaItems({ type: 'content', data } as any, 'image'), [data])
  const videoItems = useMemo(() => getNodeMediaItems({ type: 'content', data } as any, 'video'), [data])
  const image = data.payload?.kind === 'image' ? data.payload : undefined
  const video = data.payload?.kind === 'video' ? data.payload : undefined
  const activeImage = getActiveMediaItem(imageItems, image?.activeResourceIndex)
  const activeVideo = getActiveMediaItem(videoItems, video?.activeResourceIndex)
  const sourceUrl = contentSourceUrl(data)
  const imageUrl = resourceUrl || activeImage?.resource.url || data.preview?.thumbnailUrl || (data.category === 'image' ? sourceUrl : '')
  const videoUrl = resourceUrl || activeVideo?.resource.url || (video?.playback === 'video' ? video.url : '')

  return <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
    <PanelSection title="节点状态">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-foreground">{data.preview?.badge || data.subtype || data.category}</span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{stateLabel(data)}</span>
      </div>
      {data.parse?.error?.message && <p className="text-xs leading-5 text-destructive">{data.parse.error.message}</p>}
      {data.parse?.warnings?.[0]?.message && <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{data.parse.warnings[0].message}</p>}
    </PanelSection>

    {data.category === 'image' && <PanelSection title="图片预览">
      {imageUrl
        ? <img src={imageUrl} alt={image?.alt || data.preview?.title || ''} className="max-h-[420px] w-full rounded-xl border border-border bg-muted/20 object-contain" />
        : <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground"><ImageIcon className="h-8 w-8" />暂无可显示的图片</div>}
      {(image?.alt || data.preview?.description) && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{image?.alt || data.preview?.description}</p>}
    </PanelSection>}

    {data.category === 'video' && <PanelSection title="视频内容">
      {videoUrl
        ? <video src={videoUrl} controls preload="metadata" className="max-h-[420px] w-full rounded-xl border border-border bg-black object-contain" />
        : data.preview?.thumbnailUrl
          ? <img src={data.preview.thumbnailUrl} alt="" className="max-h-64 w-full rounded-xl border border-border object-contain" />
          : <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground"><Video className="h-8 w-8" />当前视频使用链接或嵌入方式播放</div>}
      <h4 className="text-base font-semibold text-foreground">{video?.title || data.preview?.title || data.label}</h4>
      {video?.transcript && <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/35 p-4 text-sm leading-6 text-foreground">{video.transcript}</div>}
    </PanelSection>}

    {data.category === 'social' && data.payload?.kind === 'social' && <PanelSection title="社媒内容">
      {data.preview?.thumbnailUrl && <img src={data.preview.thumbnailUrl} alt="" className="max-h-72 w-full rounded-xl border border-border object-contain" />}
      <div className="flex items-center gap-2"><Share2 className="h-4 w-4 text-pink-500" /><h4 className="text-base font-semibold text-foreground">{data.payload.title || data.label}</h4></div>
      <div className="text-xs text-muted-foreground">{[data.payload.author?.name, data.payload.publishedAt].filter(Boolean).join(' · ')}</div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{data.payload.bodyText || '未解析到正文内容。'}</p>
      {data.payload.topics?.length ? <div className="flex flex-wrap gap-2 text-xs text-pink-600">{data.payload.topics.map((topic) => <span key={topic}>#{topic}</span>)}</div> : null}
    </PanelSection>}

    {data.category === 'document' && <PanelSection title="文档内容">
      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-500" /><h4 className="text-base font-semibold text-foreground">{data.preview?.title || data.label}</h4></div>
      {data.payload?.kind === 'document' && data.payload.pageCount && <div className="text-xs text-muted-foreground">共 {data.payload.pageCount} 页</div>}
      <div className="max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/30 p-4 text-sm leading-6 text-foreground">{data.payload?.kind === 'document' ? data.payload.plainText || data.payload.rawText || '未解析到正文内容。' : data.preview?.description || '未解析到正文内容。'}</div>
    </PanelSection>}

    {sourceUrl && <PanelSection title="来源地址">
      <a href={sourceUrl} target="_blank" rel="noreferrer" className="flex items-start gap-2 break-all text-sm leading-6 text-sky-600 hover:underline"><ExternalLink className="mt-1 h-4 w-4 shrink-0" />{sourceUrl}</a>
    </PanelSection>}

    <div className="px-5 py-4 text-xs leading-5 text-muted-foreground">面板内容与画布中的节点 {nodeId ? '实时同步' : '同步'}。</div>
  </div>
}

function AIDetails({ nodeId, data }: { nodeId: string; data: AINodeData }) {
  const channels = useAIStore((state) => state.apiKeys)
  const getAPIKey = useAIStore((state) => state.getAPIKey)
  const updateNode = useFlowStore((state) => state.updateNode)
  const channel = channels.find((item) => item.id === data.channelId)
  const provider = channel ? getProvider(channel.providerId) : undefined
  const capabilities = getAIModelCapabilities(channel?.providerId || 'custom', channel?.protocol || provider?.protocol || 'chatCompletions', data.model || '', channel?.baseURL || provider?.baseURL)
  const activeSession = data.sessions?.find((session) => session.id === data.activeSessionId)
  const messages = activeSession?.messages || data.messages || []
  const prompt = data.prompt || data.userPrompt || ''
  const systemPrompt = data.systemPrompt || ''
  const modelOptions = channels.flatMap((item) => getAPIKey(item.id) ? (item.modelIds || []).map((model) => ({ channelId: item.id, channelName: item.name, model })) : [])
  const configured = Boolean(channel && data.model && getAPIKey(channel.id))
  const reasoningSelectValue = capabilities.reasoningLevels.length
    ? data.reasoningLevel || capabilities.reasoningLevels[0]
    : capabilities.reasoningStatus === 'supported' ? 'fixed' : 'unknown'
  const updateAI = (updates: Partial<AINodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current) return
    updateNode(nodeId, { data: { ...current.data, ...updates } })
  }
  const save = () => useFlowStore.getState().saveCurrentFlow()

  return <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
    <PanelSection title="AI 状态">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><Sparkles className="h-4 w-4 shrink-0 text-violet-500" /><div className="min-w-0"><div className="truncate text-sm font-semibold text-foreground">{data.model || '未选择模型'}</div><div className="truncate text-xs text-muted-foreground">{channel?.name || '未配置渠道'}</div></div></div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${configured ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{configured ? '可用' : '待配置'}</span>
      </div>
      <select value={data.channelId && data.model ? `${data.channelId}\t${data.model}` : ''} onChange={(event) => { const [channelId, model] = event.target.value.split('\t'); updateAI({ channelId, model }) }} onBlur={save} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-foreground/30">
        <option value="">选择模型</option>
        {modelOptions.map((option) => <option key={`${option.channelId}:${option.model}`} value={`${option.channelId}\t${option.model}`}>{option.channelName} · {option.model}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Search className="h-3.5 w-3.5" />联网搜索</span><select value={capabilities.webSearch === 'always' ? 'on' : data.webSearch || 'auto'} disabled={capabilities.webSearch !== 'optional'} onChange={(event) => updateAI({ webSearch: event.target.value as AIWebSearchMode })} onBlur={save} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground disabled:opacity-55"><option value="auto">自动</option><option value="on">开启</option><option value="off">关闭</option></select></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Brain className="h-3.5 w-3.5" />推理等级</span><select value={reasoningSelectValue} disabled={!capabilities.reasoningLevels.length} onChange={(event) => updateAI({ reasoningLevel: event.target.value as AIReasoningLevel })} onBlur={save} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground disabled:opacity-55">{capabilities.reasoningLevels.length ? capabilities.reasoningLevels.map((level) => <option key={level} value={level}>{level}</option>) : <option value={reasoningSelectValue}>{capabilities.reasoningStatus === 'supported' ? '默认推理' : '未识别'}</option>}</select></label>
      </div>
    </PanelSection>

    <PanelSection title="系统提示词">
      <textarea value={systemPrompt} onChange={(event) => updateAI({ systemPrompt: event.target.value })} onBlur={save} rows={4} placeholder="为这个 AI 节点设置独立的系统提示词" className="w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-6 outline-none focus:border-foreground/30" />
    </PanelSection>

    <PanelSection title={`当前会话 · ${messages.length} 条消息`}>
      <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-xl bg-muted/20 p-3">
        {messages.length ? messages.map((message, index) => <div key={`${message.createdAt || index}-${index}`} className={`rounded-xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'ml-8 bg-muted text-foreground' : 'mr-5 bg-card text-foreground'}`}><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{message.role === 'user' ? '你' : 'AI'}</div>{message.role === 'assistant' ? <MarkdownPreview source={message.content} /> : <p className="whitespace-pre-wrap">{message.content}</p>}</div>) : <div className="py-10 text-center text-sm text-muted-foreground">还没有会话内容</div>}
      </div>
    </PanelSection>

    <PanelSection title="输入消息">
      <textarea value={prompt} onChange={(event) => updateAI({ prompt: event.target.value, userPrompt: event.target.value })} onBlur={save} rows={5} placeholder="有问题，随便问" className="w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-6 outline-none focus:border-foreground/30" />
      <Button type="button" className="w-full" disabled={!prompt.trim() || !configured || data.disabled} onClick={() => requestAIMessageSend(nodeId)}><Send className="mr-2 h-4 w-4" />发送到当前 AI 节点</Button>
      <p className="text-xs leading-5 text-muted-foreground">发送状态、回复内容与画布中的 AI 节点保持同步。</p>
    </PanelSection>
  </div>
}

export function NodeDetailsPanel({ nodeId }: { nodeId: string }) {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId))
  if (!node) return null
  if (node.type === 'ai') return <AIDetails nodeId={nodeId} data={node.data as AINodeData} />
  if (node.type !== 'content') return <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border px-8 text-center text-sm text-muted-foreground">当前节点暂时没有专门的面板视图。</div>
  const data = node.data as ContentNodeData
  if (data.category === 'text' || data.category === 'mindmap') return <ContentEditorPanel nodeId={nodeId} />
  return <ContentDetails nodeId={nodeId} data={data} />
}
