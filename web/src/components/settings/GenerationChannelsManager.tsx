import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Film, Image as ImageIcon, KeyRound, Layers3, Pencil, Plus, Trash2, Video, X } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  GENERATION_PROTOCOL_LABELS,
  GENERATION_PROTOCOL_OPTIONS,
  generationChannelSupportsVariant,
  generationProtocolForChannel,
  modelsForGenerationProtocol,
  useGenerationStore,
  type GenerationChannel,
  type GenerationProtocolId,
} from '@/stores/use-generation-store'

const PROTOCOL_DEFAULT_URLS: Record<GenerationProtocolId, string> = {
  'openai-images': 'https://api.openai.com/v1',
  'gemini-generate-content': 'https://generativelanguage.googleapis.com',
  'zenmux-vertex': 'https://zenmux.ai/api/vertex-ai',
  'openai-images-808': '',
  '808-video': 'https://api.808relay.com',
  'meaicc-video': '',
  'generic-video': '',
  newapi: '',
}

const PROTOCOL_GROUP_LABELS = {
  image: '图像端点',
  video: '视频端点',
  'image-video': '图像与视频端点',
} as const

const protocolSupportsImage = (value: GenerationProtocolId) => !['808-video', 'meaicc-video', 'generic-video'].includes(value)
const protocolSupportsVideo = (value: GenerationProtocolId) => ['808-video', 'meaicc-video', 'generic-video', 'newapi'].includes(value)

interface GenerationChannelsManagerProps {
  embedded?: boolean
  openNewRequest?: number
}

function normalizeEndpoint(baseURL: string) {
  return baseURL.trim().replace(/\/$/, '')
}

export function GenerationChannelsManager({ embedded = false, openNewRequest = 0 }: GenerationChannelsManagerProps = {}) {
  const channels = useGenerationStore((state) => state.channels)
  const addChannel = useGenerationStore((state) => state.addChannel)
  const updateChannel = useGenerationStore((state) => state.updateChannel)
  const removeChannel = useGenerationStore((state) => state.removeChannel)
  const getAPIKey = useGenerationStore((state) => state.getAPIKey)

  const [showChannelDialog, setShowChannelDialog] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelName, setChannelName] = useState('')
  const [protocol, setProtocol] = useState<GenerationProtocolId>('openai-images')
  const [adapterProtocols, setAdapterProtocols] = useState<GenerationProtocolId[]>(['openai-images'])
  const [baseURL, setBaseURL] = useState(PROTOCOL_DEFAULT_URLS['openai-images'])
  const [apiKey, setAPIKey] = useState('')
  const [modelIds, setModelIds] = useState<string[]>([])
  const [customModelId, setCustomModelId] = useState('')
  const [supportsImage, setSupportsImage] = useState(true)
  const [supportsVideo, setSupportsVideo] = useState(false)
  const [mediaTransport, setMediaTransport] = useState<NonNullable<GenerationChannel['mediaTransport']>>('auto')
  const [mediaUploadPath, setMediaUploadPath] = useState('/v1/files')
  const [showProtocolMenu, setShowProtocolMenu] = useState(false)
  const protocolMenuRef = useRef<HTMLDivElement>(null)

  const selectedProtocol = GENERATION_PROTOCOL_OPTIONS.find((item) => item.value === protocol) || GENERATION_PROTOCOL_OPTIONS[0]

  useEffect(() => {
    if (!showProtocolMenu) return
    const closeProtocolMenu = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && protocolMenuRef.current?.contains(event.target as Node)) return
      setShowProtocolMenu(false)
    }
    document.addEventListener('pointerdown', closeProtocolMenu, true)
    document.addEventListener('keydown', closeProtocolMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeProtocolMenu, true)
      document.removeEventListener('keydown', closeProtocolMenu, true)
    }
  }, [showProtocolMenu])

  const clearDialogFields = useCallback(() => {
    setEditingChannelId(null)
    setChannelName('')
    setProtocol('openai-images')
    setAdapterProtocols(['openai-images'])
    setBaseURL(PROTOCOL_DEFAULT_URLS['openai-images'])
    setAPIKey('')
    setModelIds([])
    setCustomModelId('')
    setSupportsImage(true)
    setSupportsVideo(false)
    setMediaTransport('auto')
    setMediaUploadPath('/v1/files')
    setShowProtocolMenu(false)
  }, [])

  const resetChannelDialog = useCallback(() => {
    setShowChannelDialog(false)
    clearDialogFields()
  }, [clearDialogFields])

  const openNewChannelDialog = useCallback(() => {
    clearDialogFields()
    setShowChannelDialog(true)
  }, [clearDialogFields])

  useEffect(() => {
    if (openNewRequest > 0) openNewChannelDialog()
  }, [openNewRequest, openNewChannelDialog])

  const openEditChannelDialog = (channel: GenerationChannel) => {
    const nextProtocol = generationProtocolForChannel(channel)
    setEditingChannelId(channel.id)
    setChannelName(channel.name)
    setProtocol(nextProtocol)
    setAdapterProtocols(channel.adapters?.length ? channel.adapters.map((adapter) => adapter.protocol) : [nextProtocol])
    setBaseURL(channel.baseURL || PROTOCOL_DEFAULT_URLS[nextProtocol])
    setAPIKey('')
    setModelIds(channel.modelIds || [])
    setCustomModelId('')
    setSupportsImage(generationChannelSupportsVariant(channel, 'image'))
    setSupportsVideo(generationChannelSupportsVariant(channel, 'video'))
    setMediaTransport(channel.mediaTransport || channel.adapters?.find((adapter) => adapter.mediaTransport)?.mediaTransport || 'auto')
    setMediaUploadPath(channel.mediaUploadPath || channel.adapters?.find((adapter) => adapter.mediaUploadPath)?.mediaUploadPath || '/v1/files')
    setShowProtocolMenu(false)
    setShowChannelDialog(true)
  }

  const selectProtocol = (nextProtocol: GenerationProtocolId) => {
    setProtocol(nextProtocol)
    setAdapterProtocols((current) => current.includes(nextProtocol) ? current : [nextProtocol, ...current])
    setBaseURL(PROTOCOL_DEFAULT_URLS[nextProtocol])
    const knownModels = ['808-video', 'meaicc-video'].includes(nextProtocol)
      ? modelsForGenerationProtocol(nextProtocol).map((model) => model.id)
      : []
    setModelIds(knownModels)
    setCustomModelId('')
    setShowProtocolMenu(false)
    setSupportsImage(protocolSupportsImage(nextProtocol))
    setSupportsVideo(protocolSupportsVideo(nextProtocol))
  }

  const toggleAdapterProtocol = (value: GenerationProtocolId) => {
    setAdapterProtocols((current) => {
      if (current.includes(value)) {
        if (current.length === 1) return current
        const next = current.filter((item) => item !== value)
        if (value === protocol) setProtocol(next[0])
        return next
      }
      return [...current, value]
    })
  }

  const addCustomModel = () => {
    const modelId = customModelId.trim()
    if (!modelId || modelIds.includes(modelId)) return
    setModelIds((current) => [...current, modelId])
    setCustomModelId('')
  }

  const handleSaveChannel = async () => {
    const normalizedBaseURL = normalizeEndpoint(baseURL)
    const normalizedName = channelName.trim() || '生成渠道'
    const normalizedUploadPath = mediaUploadPath.trim() || undefined
    if (!normalizedBaseURL) {
      alert('请输入接口地址')
      return
    }
    if (!editingChannelId && !apiKey.trim()) {
      alert('请输入 API Key')
      return
    }
    if (modelIds.length === 0) {
      alert('请至少手动添加一个模型 ID')
      return
    }
    if (!supportsImage && !supportsVideo) {
      alert('请至少选择图片节点或视频节点')
      return
    }

    const updates = {
      providerId: 'custom' as const,
      protocol,
      name: normalizedName,
      baseURL: normalizedBaseURL,
      modelIds,
      enabled: true,
      supportsImage,
      supportsVideo,
      mediaTransport,
      mediaUploadPath: normalizedUploadPath,
      adapters: adapterProtocols.map((value) => ({
        id: value,
        protocol: value,
        label: GENERATION_PROTOCOL_LABELS[value],
        supportsImage: protocolSupportsImage(value),
        supportsVideo: protocolSupportsVideo(value),
        mediaTransport,
        mediaUploadPath: normalizedUploadPath,
      })),
    }
    const secretValue = apiKey.trim()
    let savedChannel: GenerationChannel | undefined
    if (editingChannelId) {
      updateChannel(editingChannelId, { ...updates, ...(secretValue ? { apiKey: secretValue } : {}) })
      savedChannel = channels.find((channel) => channel.id === editingChannelId)
    } else {
      savedChannel = addChannel({ ...updates, apiKey: secretValue })
    }
    // The desktop network layer intentionally rejects plaintext sensitive
    // headers. Wait for the SafeStorage write to finish before closing the
    // dialog so an immediate click on “生成” cannot race the secret write.
    if (secretValue && savedChannel?.secretName) {
      try {
        await window.cnoteDesktop?.secrets.set(savedChannel.secretName, secretValue)
      } catch {
        alert('API Key 未能保存到桌面安全存储，请重试。')
        return
      }
    }
    resetChannelDialog()
  }

  const content = (
    <div className={embedded ? 'flex min-w-0 flex-col' : 'flex h-full min-w-0 flex-col overflow-hidden'}>
      {!embedded && (
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
          <h1 className="text-[15px] font-semibold text-foreground">生成渠道</h1>
          <Button size="sm" className="gap-1.5" onClick={openNewChannelDialog}><Plus className="h-3.5 w-3.5" />新增生成渠道</Button>
        </header>
      )}

      <main className={embedded ? 'custom-scrollbar flex-1' : 'custom-scrollbar flex-1 overflow-y-auto p-6'}>
        {channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Film className="mb-4 h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-sm font-medium">还没有生成渠道</h2>
            <p className="mt-2 text-[13px] text-muted-foreground">添加生成渠道后，即可在图片生成和视频生成节点中选择</p>
            <Button size="sm" className="mt-6 gap-1.5" onClick={openNewChannelDialog}><Plus className="h-3.5 w-3.5" />新增生成渠道</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => {
              const configured = Boolean(getAPIKey(channel.id))
              const scopeLabel = [generationChannelSupportsVariant(channel, 'image') ? '图片' : '', generationChannelSupportsVariant(channel, 'video') ? '视频' : ''].filter(Boolean).join(' / ')
              return (
                <article key={channel.id} onClick={() => openEditChannelDialog(channel)} className="group flex min-h-[82px] cursor-pointer items-center justify-between gap-5 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[14px] font-semibold text-foreground">{channel.name}</h2>
                      {!configured && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">未配置</span>}
                    </div>
                    <p className="mt-1.5 truncate text-[12px] text-muted-foreground">{GENERATION_PROTOCOL_LABELS[generationProtocolForChannel(channel)]} · {channel.modelIds?.length || 0} 个模型 · {scopeLabel || '未选择节点'} · {channel.baseURL || '未设置接口地址'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" className="gap-1.5" onClick={(event) => { event.stopPropagation(); openEditChannelDialog(channel) }}><Pencil className="h-3.5 w-3.5" />编辑</Button>
                    <Button variant="outline" size="icon-sm" aria-label={`删除渠道 ${channel.name}`} onClick={(event) => { event.stopPropagation(); if (confirm(`确定要删除渠道“${channel.name}”吗？`)) removeChannel(channel.id) }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>

      <Dialog open={showChannelDialog} onOpenChange={(open) => !open && resetChannelDialog()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" style={{ width: 'min(560px, calc(100vw - 2rem))', maxWidth: 'none' }}>
          <DialogHeader><DialogTitle className="text-base">{editingChannelId ? '编辑生成渠道' : '新增生成渠道'}</DialogTitle></DialogHeader>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">提供商名称</span><input autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="如：Fmage / 我的图像服务" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
            <div ref={protocolMenuRef} className="relative text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">端点方式</span>
              <button type="button" aria-haspopup="listbox" aria-expanded={showProtocolMenu} onClick={() => setShowProtocolMenu((visible) => !visible)} className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20">
                <span className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{selectedProtocol.group === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : selectedProtocol.group === 'video' ? <Video className="h-3.5 w-3.5" /> : <Layers3 className="h-3.5 w-3.5" />}</span><span className="truncate">{selectedProtocol.label}</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showProtocolMenu ? 'rotate-180' : ''}`} />
              </button>
              {showProtocolMenu && <div role="listbox" aria-label="选择生成端点方式" className="cnote-menu-surface absolute left-0 right-0 top-full z-[80] mt-2 max-h-72 overflow-y-auto">
                {(Object.keys(PROTOCOL_GROUP_LABELS) as Array<keyof typeof PROTOCOL_GROUP_LABELS>).map((group) => {
                  const options = GENERATION_PROTOCOL_OPTIONS.filter((option) => option.group === group)
                  if (!options.length) return null
                  return <div key={group} className="border-t border-border py-1.5 first:border-t-0 first:pt-0"><div className="px-3 pb-1 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground">{PROTOCOL_GROUP_LABELS[group]}</div>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === protocol} data-active={option.value === protocol} onClick={() => selectProtocol(option.value)} className="cnote-menu-item"><span className="min-w-0"><span className="block truncate">{option.label}</span><span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{option.description}</span></span>{option.value === protocol && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</button>)}</div>
                })}
              </div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {adapterProtocols.map((value) => <button key={value} type="button" className="rounded-full border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] text-primary" onClick={() => toggleAdapterProtocol(value)} title="移除适配器">{GENERATION_PROTOCOL_LABELS[value]} <X className="ml-0.5 inline h-3 w-3" /></button>)}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {GENERATION_PROTOCOL_OPTIONS.filter((option) => !adapterProtocols.includes(option.value)).map((option) => <button key={option.value} type="button" className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => toggleAdapterProtocol(option.value)}>+ {option.label}</button>)}
              </div>
            </div>
          </div>

          <label className="mt-3 block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">接口地址</span><input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.example.com/v1" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>

          <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">素材传输方式</span><select value={mediaTransport} onChange={(event) => setMediaTransport(event.target.value as NonNullable<GenerationChannel['mediaTransport']>)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"><option value="auto">自动：优先按协议处理</option><option value="multipart">上传文件（multipart）</option><option value="public-url">仅使用公网 HTTPS 地址</option></select><span className="mt-1.5 block text-[11px] text-muted-foreground">视频参考素材通常需要供应商可访问的公网地址；自动模式会尝试上传。</span></label>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">供应商上传路径</span><input value={mediaUploadPath} onChange={(event) => setMediaUploadPath(event.target.value)} placeholder="/v1/files" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /><span className="mt-1.5 block text-[11px] text-muted-foreground">仅在自动或 multipart 模式下使用；不同供应商可留空并自行处理。</span></label>
          </div>

          <div className="mt-4 text-[13px] text-muted-foreground"><span className="mb-2 flex items-center gap-1.5 font-medium"><KeyRound className="h-3.5 w-3.5" />API Key {editingChannelId && <span className="font-normal">（留空则保持不变）</span>}</span><input type="password" value={apiKey} onChange={(event) => setAPIKey(event.target.value)} placeholder={editingChannelId ? '留空保持现有密钥' : '输入 API Key'} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></div>

          <div className="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground"><span className="shrink-0 font-medium text-foreground">渠道支持</span><div className="flex min-w-0 flex-1 gap-2"><button type="button" aria-pressed={supportsImage} onClick={() => setSupportsImage((value) => !value)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] transition-colors ${supportsImage ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}><ImageIcon className="h-4 w-4 shrink-0" />图片生成</button><button type="button" aria-pressed={supportsVideo} onClick={() => setSupportsVideo((value) => !value)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] transition-colors ${supportsVideo ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}><Video className="h-4 w-4 shrink-0" />视频生成</button></div></div>

          <div className="mt-5"><div><h3 className="text-[13px] font-medium">渠道模型</h3><p className="mt-1 text-[11px] text-muted-foreground">手动添加这个渠道实际开放的模型 ID。</p></div>
            <div className="mt-3 min-h-[52px] rounded-lg border border-border bg-background px-3 py-3">{modelIds.length > 0 ? <div className="flex flex-wrap gap-2">{modelIds.map((modelId) => <button key={modelId} type="button" onClick={() => setModelIds((current) => current.filter((id) => id !== modelId))} className="flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground" title="移除模型">{modelId}<X className="h-3 w-3" /></button>)}</div> : <p className="text-center text-[11px] text-muted-foreground">尚未添加模型 ID</p>}</div>
            <div className="mt-2 flex gap-2"><input value={customModelId} onChange={(event) => setCustomModelId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomModel() } }} placeholder="手动输入模型 ID" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /><Button variant="secondary" size="sm" onClick={addCustomModel}>添加模型</Button></div>
            {modelIds.length === 0 && <p className="mt-2 text-[11px] text-destructive">至少需要选择或添加一个模型 ID</p>}</div>

          <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={resetChannelDialog}>取消</Button><Button onClick={handleSaveChannel} disabled={modelIds.length === 0}>{editingChannelId ? '保存' : '添加生成渠道'}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )

  return embedded ? content : <AppShell>{content}</AppShell>
}
