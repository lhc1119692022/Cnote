import { useState } from 'react'
import { Film, Image as ImageIcon, KeyRound, Plus, Save, Trash2, Video } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import {
  GENERATION_MODEL_CATALOG,
  GENERATION_PROVIDER_LABELS,
  useGenerationStore,
  type GenerationProviderId,
} from '@/stores/use-generation-store'
import type { GenerationCapability } from '@/types/flow'

const CAPABILITY_LABELS: Record<GenerationCapability, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'reference-to-video': '多参考视频',
  'first-last-frame': '首尾帧',
  'video-reference': '视频参考',
  'audio-reference': '音频参考',
  'video-edit': '视频编辑',
  'generate-audio': '生成音频',
}

const PROVIDER_DEFAULT_URLS: Record<GenerationProviderId, string> = {
  '808': 'https://api.808relay.com',
  newapi: '',
  meaicc: '',
  fmage: 'local://fmage',
  custom: '',
}

export function GenerationChannelsManager() {
  const channels = useGenerationStore((state) => state.channels)
  const addChannel = useGenerationStore((state) => state.addChannel)
  const updateChannel = useGenerationStore((state) => state.updateChannel)
  const removeChannel = useGenerationStore((state) => state.removeChannel)
  const [activeTabs, setActiveTabs] = useState<Record<string, 'capability' | 'model'>>({})
  const [capabilityFilters, setCapabilityFilters] = useState<Record<string, GenerationCapability | ''>>({})

  const addGenerationChannel = () => {
    const channel = addChannel({ providerId: '808', name: '808 视频生成渠道', baseURL: PROVIDER_DEFAULT_URLS['808'] })
    setActiveTabs((tabs) => ({ ...tabs, [channel.id]: 'model' }))
  }

  const setProvider = (channelId: string, providerId: GenerationProviderId) => {
    const catalog = GENERATION_MODEL_CATALOG[providerId]
    updateChannel(channelId, {
      providerId,
      baseURL: PROVIDER_DEFAULT_URLS[providerId],
      modelIds: catalog.map((model) => model.id),
    })
  }

  return <AppShell>
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div><h1 className="text-[15px] font-semibold text-foreground">生成渠道</h1><p className="mt-1 text-xs text-muted-foreground">图片和视频生成节点独立使用的渠道配置，不会影响文本渠道或旧 AI 节点。</p></div>
        <Button size="sm" className="gap-1.5" onClick={addGenerationChannel}><Plus className="h-3.5 w-3.5" />新增生成渠道</Button>
      </header>
      <main className="custom-scrollbar flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">模型能力会根据提供商和模型自动互相筛选。暂不支持的上传或配置会保留并置灰，避免切换渠道时丢失设置。</div>
          {channels.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center"><Film className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-sm font-semibold">还没有生成渠道</h2><p className="mt-1 text-xs text-muted-foreground">添加 808、Seedance、MiniMax H3 或 Fmage 渠道后即可在生成节点中选择。</p><Button size="sm" className="mt-5 gap-1.5" onClick={addGenerationChannel}><Plus className="h-3.5 w-3.5" />新增生成渠道</Button></div> : channels.map((channel) => {
            const catalog = GENERATION_MODEL_CATALOG[channel.providerId]
            const activeTab = activeTabs[channel.id] || 'model'
            const filter = capabilityFilters[channel.id] || ''
            const filteredModels = filter ? catalog.filter((model) => model.capabilities.includes(filter)) : catalog
            const enabledModels = catalog.filter((model) => channel.modelIds.includes(model.id))
            const supportedCapabilities = [...new Set(enabledModels.flatMap((model) => model.capabilities))]
            return <section key={channel.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">{channel.providerId === 'fmage' ? <ImageIcon className="h-4 w-4" /> : <Video className="h-4 w-4" />}</div><div className="min-w-0"><input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} className="w-full bg-transparent text-sm font-semibold outline-none" /><p className="text-[11px] text-muted-foreground">{GENERATION_PROVIDER_LABELS[channel.providerId]}</p></div></div>
                <div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={channel.enabled} onChange={(event) => updateChannel(channel.id, { enabled: event.target.checked })} />启用</label><button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => { if (confirm(`确定要删除生成渠道“${channel.name}”吗？`)) removeChannel(channel.id) }} aria-label="删除生成渠道"><Trash2 className="h-4 w-4" /></button></div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-xs text-muted-foreground"><span className="mb-1.5 block font-medium">提供商</span><select value={channel.providerId} onChange={(event) => setProvider(channel.id, event.target.value as GenerationProviderId)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none"><option value="808">808 Relay</option><option value="newapi">卡藏 / NewAPI</option><option value="meaicc">MEAICC</option><option value="fmage">Fmage</option><option value="custom">自定义</option></select></label><label className="text-xs text-muted-foreground md:col-span-2"><span className="mb-1.5 block font-medium">接口地址</span><input value={channel.baseURL} onChange={(event) => updateChannel(channel.id, { baseURL: event.target.value })} placeholder="https://..." className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none" /></label><label className="text-xs text-muted-foreground md:col-span-3"><span className="mb-1.5 flex items-center gap-1 font-medium"><KeyRound className="h-3 w-3" />API Key</span><input type="password" value={channel.apiKey || ''} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} placeholder={channel.providerId === 'fmage' ? '本地 Fmage 不需要 API Key' : '输入密钥，保存于当前浏览器'} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none" /></label></div>
              <div className="mt-4 rounded-xl border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex rounded-lg bg-muted/50 p-1 text-[11px] font-semibold"><button type="button" className={`rounded-md px-3 py-1.5 ${activeTab === 'capability' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} onClick={() => setActiveTabs((tabs) => ({ ...tabs, [channel.id]: 'capability' }))}>能力</button><button type="button" className={`rounded-md px-3 py-1.5 ${activeTab === 'model' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} onClick={() => setActiveTabs((tabs) => ({ ...tabs, [channel.id]: 'model' }))}>模型名称</button></div><span className="text-[11px] text-muted-foreground">已启用 {channel.modelIds.length} 个模型</span></div>{activeTab === 'capability' ? <div className="mt-3 flex flex-wrap gap-1.5">{[...new Set(catalog.flatMap((model) => model.capabilities))].map((capability) => <button key={capability} type="button" className={`rounded-full border px-2.5 py-1 text-[11px] ${filter === capability ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`} onClick={() => setCapabilityFilters((filters) => ({ ...filters, [channel.id]: filters[channel.id] === capability ? '' : capability }))}>{CAPABILITY_LABELS[capability]}</button>)}</div> : <div className="mt-3 space-y-2">{filteredModels.length ? filteredModels.map((model) => <label key={model.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/40"><input type="checkbox" checked={channel.modelIds.includes(model.id)} onChange={(event) => updateChannel(channel.id, { modelIds: event.target.checked ? [...channel.modelIds, model.id] : channel.modelIds.filter((id) => id !== model.id) })} className="mt-0.5" /><span className="min-w-0 flex-1"><span className="block font-medium">{model.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{model.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join('、')}</span></span></label>) : <p className="py-3 text-xs text-muted-foreground">没有支持当前能力的模型</p>}</div>}</div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>当前能力：{supportedCapabilities.length ? supportedCapabilities.map((capability) => CAPABILITY_LABELS[capability]).join('、') : '尚未选择模型'}</span><span className="flex items-center gap-1"><Save className="h-3 w-3" />自动保存</span></div>
            </section>
          })}
        </div>
      </main>
    </div>
  </AppShell>
}
