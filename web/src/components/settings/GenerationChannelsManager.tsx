import { showMessage, askConfirmation } from '@/lib/app-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Film, Image as ImageIcon, KeyRound, Layers3, Pencil, Plus, RefreshCw, Trash2, Video, X } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  GENERATION_PROTOCOL_LABELS,
  GENERATION_PROTOCOL_OPTIONS,
  GENERATION_CHANNEL_PRESETS,
  generationChannelSupportsVariant,
  isVideoGenerationProtocol,
  generationProtocolForChannel,
  modelsForGenerationProtocol,
  type GenerationMediaTransport,
  useGenerationStore,
  type GenerationChannel,
  type GenerationModel,
  type GenerationProtocolId,
} from '@/stores/use-generation-store'
import { testGenerationMediaUpload } from '@/lib/generation/client'
import { mediaTransportStatus, normalizeMediaTransport } from '@/lib/generation/media-policy'
import { AIClient } from '@/lib/api/client'
import { useMediaStorageStore } from '@/stores/use-media-storage-store'
import { ensureDesktopSecret, syncDesktopSecret } from '@/lib/desktop-secrets'

const PROTOCOL_GROUP_LABELS = {
  image: '图像端点',
  video: '视频端点',
  'image-video': '图像与视频端点',
} as const

const protocolSupportsImage = (value: GenerationProtocolId) => !isVideoGenerationProtocol(value)
const protocolSupportsVideo = (value: GenerationProtocolId) => isVideoGenerationProtocol(value)

interface GenerationChannelsManagerProps {
  embedded?: boolean
  openNewRequest?: number
}

function normalizeEndpoint(baseURL: string) {
  return baseURL.trim().replace(/\/$/, '')
}

export function GenerationChannelsManager({ embedded = false, openNewRequest = 0 }: GenerationChannelsManagerProps = {}) {
  const channels = useGenerationStore((state) => state.channels)
  const initializeDefaultChannels = useGenerationStore((state) => state.initializeDefaultChannels)
  const addChannel = useGenerationStore((state) => state.addChannel)
  const updateChannel = useGenerationStore((state) => state.updateChannel)
  const removeChannel = useGenerationStore((state) => state.removeChannel)
  const getAPIKey = useGenerationStore((state) => state.getAPIKey)
  const hasCustomMediaStorage = useMediaStorageStore((state) => Boolean(state.baseURL))

  const [showChannelDialog, setShowChannelDialog] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const hasExistingApiKey = Boolean(editingChannelId && getAPIKey(editingChannelId))
  const [presetId, setPresetId] = useState('')
  const [channelName, setChannelName] = useState('')
  const [protocol, setProtocol] = useState<GenerationProtocolId>('openai-images')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setAPIKey] = useState('')
  const [modelIds, setModelIds] = useState<string[]>([])
  const [modelCatalog, setModelCatalog] = useState<GenerationModel[]>([])
  const [customModelId, setCustomModelId] = useState('')
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelFetchMessage, setModelFetchMessage] = useState('')
  const [supportsImage, setSupportsImage] = useState(true)
  const [supportsVideo, setSupportsVideo] = useState(false)
  const [mediaTransport, setMediaTransport] = useState<GenerationMediaTransport>('custom')
  const [mediaTestState, setMediaTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [mediaTestMessage, setMediaTestMessage] = useState('')
  const [showProtocolMenu, setShowProtocolMenu] = useState(false)
  const protocolMenuRef = useRef<HTMLDivElement>(null)
  const savingRef = useRef<Promise<GenerationChannel | undefined> | null>(null)
  const mediaTestRunningRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [savedAPIKey, setSavedAPIKey] = useState('')

  const selectedProtocol = GENERATION_PROTOCOL_OPTIONS.find((item) => item.value === protocol) || { value: protocol, label: GENERATION_PROTOCOL_LABELS[protocol], description: '', group: 'video' as const }
  const channelPresets = GENERATION_CHANNEL_PRESETS || []
  const selectedPreset = channelPresets.find((preset) => preset.id === presetId)
  const requiresPublicHttps = Boolean(selectedPreset?.videoRequestContract?.requiresPublicHttps)
  const hasConfiguredMediaStorage = hasCustomMediaStorage || Boolean(channels.find((channel) => channel.id === editingChannelId)?.mediaUploadURL)
  const transportStatus = mediaTransport === 'custom' && !hasCustomMediaStorage && hasConfiguredMediaStorage
    ? { canTestUpload: true, message: '使用此渠道保留的自定义上传配置。' }
    : mediaTransportStatus(mediaTransport, hasConfiguredMediaStorage)

  useEffect(() => {
    initializeDefaultChannels()
  }, [initializeDefaultChannels])

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
    setSavedAPIKey('')
    setEditingChannelId(null)
    setPresetId('')
    setChannelName('')
    setProtocol('openai-images')
    setBaseURL('')
    setAPIKey('')
    setModelIds([])
    setModelCatalog([])
    setCustomModelId('')
    setAvailableModelIds([])
    setIsFetchingModels(false)
    setModelFetchMessage('')
    setSupportsImage(true)
    setSupportsVideo(false)
    setMediaTransport('custom')
    setMediaTestState('idle')
    setMediaTestMessage('')
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
    setSavedAPIKey('')
    const nextProtocol = generationProtocolForChannel(channel)
    setEditingChannelId(channel.id)
    setPresetId(channel.presetId || nextProtocol)
    setChannelName(channel.name)
    setProtocol(nextProtocol)
    setBaseURL(channel.baseURL || '')
    setAPIKey('')
    setModelIds(channel.modelIds || [])
    setModelCatalog(channel.modelCatalog || [])
    setCustomModelId('')
    setAvailableModelIds([])
    setIsFetchingModels(false)
    setModelFetchMessage('')
    setSupportsImage(generationChannelSupportsVariant(channel, 'image'))
    setSupportsVideo(generationChannelSupportsVariant(channel, 'video'))
    const storedMediaTransport = normalizeMediaTransport(channel.adapters?.find((adapter) => adapter.protocol === nextProtocol)?.mediaTransport ?? channel.mediaTransport)
    setMediaTransport(storedMediaTransport || 'custom')
    setMediaTestState('idle')
    setMediaTestMessage('')
    setShowProtocolMenu(false)
    setShowChannelDialog(true)
  }

  const selectProtocol = (nextProtocol: GenerationProtocolId) => {
    const matchingPreset = channelPresets.find((preset) => preset.protocol === nextProtocol)
    setPresetId(matchingPreset?.id || '')
    setProtocol(nextProtocol)
    setBaseURL('')
    setMediaTransport('custom')
    setModelIds([])
    setModelCatalog(modelsForGenerationProtocol(nextProtocol))
    setCustomModelId('')
    setAvailableModelIds([])
    setModelFetchMessage('')
    setShowProtocolMenu(false)
    setSupportsImage(protocolSupportsImage(nextProtocol))
    setSupportsVideo(protocolSupportsVideo(nextProtocol))
    setMediaTestState('idle')
    setMediaTestMessage('')
  }

  const handleFetchModels = async () => {
    const endpoint = normalizeEndpoint(baseURL)
    const apiKeyValue = apiKey.trim() || (editingChannelId ? getAPIKey(editingChannelId) : '') || ''
    if (!endpoint) { setModelFetchMessage('请先填写接口地址。'); return }
    setIsFetchingModels(true)
    setModelFetchMessage('')
    try {
      const secretName = editingChannelId ? channels.find(channel => channel.id === editingChannelId)?.secretName : undefined
      if (!apiKeyValue && !(await ensureDesktopSecret(secretName))) throw new Error('请先填写 API Key，或先保存现有渠道。')
      const client = new AIClient({ id: 'generation-models', name: '生成渠道', baseURL: endpoint, protocol: protocol === 'google-images' && !/^sk-/i.test(apiKeyValue) ? 'gemini' : 'chatCompletions', models: [] }, apiKeyValue, apiKeyValue ? undefined : secretName)
      const ids = await client.listModels()
      setAvailableModelIds(ids)
      setModelFetchMessage(ids.length ? '已拉取 ' + ids.length + ' 个模型，请选择需要启用的模型。' : '接口连接成功，但没有返回模型列表。')
    } catch (error) {
      setModelFetchMessage(error instanceof Error ? '拉取模型失败：' + error.message : '拉取模型失败。')
    } finally { setIsFetchingModels(false) }
  }

  const toggleFetchedModel = (modelId: string) => {
    setModelIds((current) => current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId])
  }
  const addCustomModel = () => {
    const modelId = customModelId.trim()
    if (!modelId || modelIds.includes(modelId)) return
    setModelIds((current) => [...current, modelId])
    setCustomModelId('')
  }

  const persistChannel = async (closeDialog: boolean) => {
    const normalizedBaseURL = normalizeEndpoint(baseURL)
    const normalizedName = channelName.trim() || '生成渠道'
    if (!normalizedBaseURL) {
      showMessage('请输入接口地址')
      return
    }
    if (!editingChannelId && !apiKey.trim()) {
      showMessage('请输入 API Key')
      return
    }
    if (!supportsImage && !supportsVideo) {
      showMessage('请至少选择图片节点或视频节点')
      return
    }
    if (supportsVideo && !mediaTransport) {
      showMessage(transportStatus.message)
      return
    }
    if (supportsVideo && requiresPublicHttps && mediaTransport !== 'custom') {
      showMessage('当前预设要求公网 HTTPS 参考素材，请使用自定义媒体存储。')
      return
    }

    const updates = {
      presetId,
      presetVersion: channelPresets.find((preset) => preset.id === presetId)?.version,
      providerId: protocol === 'openai-images' ? 'openai' as const : protocol === 'google-images' ? 'google' as const : 'video' as const,
      protocol,
      name: normalizedName,
      baseURL: normalizedBaseURL,
      modelIds,
      modelCatalog: [...new Map<string, GenerationModel>([
        ...modelCatalog.map((model) => [model.id, model] as const),
        ...(channelPresets.find((preset) => preset.id === presetId)?.models || []).map((model) => [model.id, model] as const),
      ]).values()],
      enabled: true,
      supportsImage,
      supportsVideo,
      mediaTransport: supportsVideo ? mediaTransport : undefined,
      adapters: [{
        id: protocol,
        protocol,
        label: GENERATION_PROTOCOL_LABELS[protocol],
        supportsImage: protocolSupportsImage(protocol),
        supportsVideo: protocolSupportsVideo(protocol),
        mediaTransport: supportsVideo ? mediaTransport : undefined,
        videoRequestContract: channelPresets.find((preset) => preset.id === presetId)?.videoRequestContract,
      }],
    }
    const secretValue = apiKey.trim()
    let savedChannel: GenerationChannel | undefined
    if (editingChannelId) {
      updateChannel(editingChannelId, { ...updates, ...(secretValue ? { apiKey: secretValue } : {}) })
      savedChannel = useGenerationStore.getState().getChannel(editingChannelId)
    } else {
      savedChannel = addChannel({ ...updates, apiKey: secretValue })
      setEditingChannelId(savedChannel.id)
    }
    // The desktop network layer intentionally rejects plaintext sensitive
    // headers. Wait for the SafeStorage write to finish before closing the
    // dialog so an immediate click on “生成” cannot race the secret write.
    if (secretValue && savedChannel?.secretName) {
      try {
        await syncDesktopSecret(savedChannel.secretName, secretValue)
      } catch {
        setMediaTestState('error')
        setMediaTestMessage('API Key 未能保存到桌面安全存储，请重试。')
        return
      }
    }
    setSavedAPIKey(secretValue)
    if (closeDialog) resetChannelDialog()
    return savedChannel
  }

  const handleSaveChannel = async (closeDialog = true) => {
    if (savingRef.current) return savingRef.current
    setIsSaving(true)
    const pending = persistChannel(closeDialog)
    savingRef.current = pending
    try { return await pending } finally { savingRef.current = null; setIsSaving(false) }
  }

  const handleTestMediaUpload = async () => {
    if (!supportsVideo || !transportStatus.canTestUpload || savingRef.current || mediaTestRunningRef.current) return
    mediaTestRunningRef.current = true
    try {
      const savedChannel = await handleSaveChannel(false)
      if (!savedChannel) return
      setMediaTestState('testing')
      setMediaTestMessage('正在验证上传接口…')
      const result = await testGenerationMediaUpload(savedChannel, protocol)
      setMediaTestState('success')
      setMediaTestMessage(result.message || '上传完成；测试文件需按存储服务的保留策略清理。')
    } catch (error) {
      setMediaTestState('error')
      setMediaTestMessage(error instanceof Error ? error.message : '上传接口验证失败')
    } finally {
      mediaTestRunningRef.current = false
    }
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
                      {generationChannelSupportsVariant(channel, 'video') && !hasCustomMediaStorage && !channel.mediaUploadURL && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">上传服务未连接</span>}
                    </div>
                    <p className="mt-1.5 truncate text-[12px] text-muted-foreground">{GENERATION_PROTOCOL_LABELS[generationProtocolForChannel(channel)]} · {channel.modelIds?.length || 0} 个模型 · {scopeLabel || '未选择节点'} · {channel.baseURL || '未设置接口地址'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" className="gap-1.5" onClick={(event) => { event.stopPropagation(); openEditChannelDialog(channel) }}><Pencil className="h-3.5 w-3.5" />编辑</Button>
                    <Button variant="outline" size="icon-sm" aria-label={`删除渠道 ${channel.name}`} onClick={async (event) => { event.stopPropagation(); if (await askConfirmation(`确定要删除渠道“${channel.name}”吗？`)) removeChannel(channel.id) }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>

      <Dialog open={showChannelDialog} onOpenChange={(open) => !open && !isSaving && mediaTestState !== 'testing' && resetChannelDialog()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" style={{ width: 'min(560px, calc(100vw - 2rem))', maxWidth: 'none' }}>
          <DialogHeader><DialogTitle className="text-base">{editingChannelId ? '编辑生成渠道' : '新增生成渠道'}</DialogTitle></DialogHeader>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">生成渠道名称</span><input autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="如：我的 808Relay 视频" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
            <div ref={protocolMenuRef} className="relative text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">端点方式（单选）</span>
              {presetId ? <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-foreground"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground"><Video className="h-3.5 w-3.5" /></span><span className="truncate">{selectedProtocol.label}</span></div> : <><button type="button" aria-haspopup="listbox" aria-expanded={showProtocolMenu} onClick={() => setShowProtocolMenu((visible) => !visible)} className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20">
                <span className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{selectedProtocol.group === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : selectedProtocol.group === 'video' ? <Video className="h-3.5 w-3.5" /> : <Layers3 className="h-3.5 w-3.5" />}</span><span className="truncate">{selectedProtocol.label}</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showProtocolMenu ? 'rotate-180' : ''}`} />
              </button>
              {showProtocolMenu && <div role="listbox" aria-label="选择生成端点方式" className="cnote-menu-surface absolute left-0 right-0 top-full z-[80] mt-2 max-h-72 overflow-y-auto">
                {(Object.keys(PROTOCOL_GROUP_LABELS) as Array<keyof typeof PROTOCOL_GROUP_LABELS>).map((group) => {
                  const options = GENERATION_PROTOCOL_OPTIONS.filter((option) => option.group === group)
                  if (!options.length) return null
                  return <div key={group} className="border-t border-border py-1.5 first:border-t-0 first:pt-0"><div className="px-3 pb-1 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground">{PROTOCOL_GROUP_LABELS[group]}</div>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === protocol} data-active={option.value === protocol} title={option.description} onClick={() => selectProtocol(option.value)} className="cnote-menu-item"><span className="min-w-0 flex-1 truncate text-left">{option.label}</span>{option.value === protocol && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</button>)}</div>
                })}
              </div>}</>}
              <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">预设渠道会直接显示在列表中；此处用于配置自定义渠道协议。</span>
            </div>
          </div>

          <label className="mt-3 block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">接口地址</span><input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.example.com/v1" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>

          <div className="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground"><span className="shrink-0 font-medium text-foreground">渠道支持</span><div className="flex min-w-0 flex-1 gap-2"><button type="button" aria-pressed={supportsImage} onClick={() => setSupportsImage((value) => !value)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] transition-colors ${supportsImage ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}><ImageIcon className="h-4 w-4 shrink-0" />图片生成</button><button type="button" aria-pressed={supportsVideo} onClick={() => setSupportsVideo((value) => !value)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] transition-colors ${supportsVideo ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}><Video className="h-4 w-4 shrink-0" />视频生成</button></div></div>

          {supportsVideo && <div className="mt-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <label htmlFor="generation-media-transport" className="shrink-0 text-[13px] font-medium text-muted-foreground">本地素材传输方式</label>
              <select id="generation-media-transport" aria-label="本地素材传输方式" value="custom" onChange={() => setMediaTransport('custom')} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20">
                <option value="custom">自定义媒体存储</option>
              </select>
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" title={transportStatus.canTestUpload ? '仅验证媒体存储，不提交模型生成任务' : transportStatus.message} onClick={() => void handleTestMediaUpload()} disabled={isSaving || !transportStatus.canTestUpload || mediaTestState === 'testing'}><Check className="h-3.5 w-3.5" />{mediaTestState === 'testing' ? '验证中' : '验证上传'}</Button>
            </div>
            {!transportStatus.canTestUpload && <p role="status" className="mt-2 text-[11px] text-muted-foreground">{transportStatus.message}</p>}
            {mediaTestMessage && <p role="status" className={`mt-2 min-w-0 break-words text-[11px] ${mediaTestState === 'success' ? 'text-emerald-700' : mediaTestState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} title={mediaTestMessage}>{mediaTestMessage}</p>}
          </div>}

          <div className="mt-4 text-[13px] text-muted-foreground"><span className="mb-2 flex items-center gap-1.5 font-medium"><KeyRound className="h-3.5 w-3.5" />API Key <span className="font-normal">{isSaving ? '（保存中…）' : apiKey.trim() ? savedAPIKey === apiKey.trim() ? '（已保存）' : '（待保存）' : hasExistingApiKey ? '（已配置，留空保持不变）' : '（尚未填写）'}</span></span><input type="password" value={apiKey} onChange={(event) => setAPIKey(event.target.value)} placeholder={hasExistingApiKey ? '留空保持现有密钥' : '请输入 API Key'} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></div>
          <div className="mt-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-[13px] font-medium">渠道模型</h3><p className="mt-1 text-[11px] text-muted-foreground">可从接口拉取模型；无法拉取时仍可手动添加模型 ID。</p></div><Button type="button" variant="secondary" size="sm" className="shrink-0 gap-1.5" disabled={isFetchingModels} onClick={() => void handleFetchModels()}><RefreshCw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />拉取模型</Button></div>
            {(availableModelIds.length > 0 || modelFetchMessage) && (
              <div className={`mt-3 min-h-[52px] rounded-lg border px-3 py-3 text-[11px] ${availableModelIds.length ? 'border-border bg-background' : 'border-dashed border-border text-muted-foreground'}`}>
                {modelFetchMessage && <p className="mb-2 leading-relaxed text-muted-foreground">{modelFetchMessage}</p>}
                {availableModelIds.length > 0 && <div className="flex flex-wrap gap-2">{availableModelIds.map((modelId) => <button key={modelId} type="button" onClick={() => toggleFetchedModel(modelId)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${modelIds.includes(modelId) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'}`}>{modelIds.includes(modelId) && <Check className="h-3 w-3" />}{modelId}</button>)}</div>}
              </div>
            )}
            <div className="mt-3 min-h-[52px] rounded-lg border border-border bg-background px-3 py-3">{modelIds.length > 0 ? <div className="flex flex-wrap gap-2">{modelIds.map((modelId) => <button key={modelId} type="button" onClick={() => setModelIds((current) => current.filter((id) => id !== modelId))} className="flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground" title="移除模型">{modelId}<X className="h-3 w-3" /></button>)}</div> : <p className="text-center text-[11px] text-muted-foreground">尚未添加模型 ID</p>}</div>
            <div className="mt-2 flex gap-2"><input value={customModelId} onChange={(event) => setCustomModelId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomModel() } }} placeholder="手动输入模型 ID" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /><Button variant="secondary" size="sm" onClick={addCustomModel}>添加模型</Button></div>
            {modelIds.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">已选 0 个模型</p>}</div>

          <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" disabled={isSaving || mediaTestState === 'testing'} onClick={resetChannelDialog}>关闭</Button><Button disabled={isSaving || mediaTestState === 'testing'} onClick={() => void handleSaveChannel()}>{editingChannelId ? '保存' : '添加生成渠道'}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )

  return embedded ? content : <AppShell>{content}</AppShell>
}
