import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  Check,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContentServiceSettings } from '@/components/settings/ContentServiceSettings'
import { AI_PROXY_WORKER_GUIDE_URL } from '@/config/links'
import { AIClient, PROVIDERS, getProvider, inferProviderId, validateAPIKey, type ProtocolType } from '@/lib/api'
import { localForageStorage } from '@/lib/localforage-storage'
import { useAIStore, type APIChannel, type APIChannelInput } from '@/stores/use-ai-store'
import { useFlowStore } from '@/stores/use-flow-store'
import { useSourceStore } from '@/stores/use-source-store'
import { useTemplateStore } from '@/stores/use-template-store'

type SettingsTab = 'channels' | 'content-service' | 'storage'

interface StorageEstimate {
  usage: number
  quota: number
}

interface StorageBreakdown {
  flows: number
  templates: number
  sources: number
  channels: number
}

interface ExportedConfiguration {
  version: 1
  exportedAt: string
  channels: APIChannelInput[]
}

const PROTOCOL_OPTIONS: { value: ProtocolType; label: string }[] = [
  { value: 'responses', label: 'Responses' },
  { value: 'messages', label: 'Messages' },
  { value: 'chatCompletions', label: 'Chat Completions' },
  { value: 'gemini', label: 'Gemini 原生' },
]

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const getPersistedStateSize = async (key: string) => {
  const indexedDBValue = await localForageStorage.getItem(key)
  const value = indexedDBValue ?? window.localStorage.getItem(key) ?? ''
  return new Blob([value]).size
}

export function APIKeysManager() {
  const {
    apiKeys,
    addAPIKey,
    removeAPIKey,
    updateAPIKey,
    replaceAPIKeys,
    initializeDefaultChannels,
    getAPIKey,
    getProxyHeaderValue,
  } = useAIStore()
  const flowCount = useFlowStore((state) => state.flows.length)
  const sourceCount = useSourceStore((state) => state.sources.length)
  const templateCount = useTemplateStore((state) => state.templates.length)

  const [activeTab, setActiveTab] = useState<SettingsTab>('channels')
  const [showChannelDialog, setShowChannelDialog] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelName, setChannelName] = useState('')
  const [providerId, setProviderId] = useState('custom')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState<ProtocolType>('responses')
  const [showProtocolMenu, setShowProtocolMenu] = useState(false)
  const [apiKey, setAPIKey] = useState('')
  const [proxyHeaderName, setProxyHeaderName] = useState('')
  const [proxyHeaderValue, setProxyHeaderValue] = useState('')
  const [modelIds, setModelIds] = useState<string[]>([])
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([])
  const [customModelId, setCustomModelId] = useState('')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate>({ usage: 0, quota: 0 })
  const [storageBreakdown, setStorageBreakdown] = useState<StorageBreakdown>({ flows: 0, templates: 0, sources: 0, channels: 0 })
  const importInputRef = useRef<HTMLInputElement>(null)
  const modelRequestRef = useRef<Promise<string[]> | null>(null)
  const protocolMenuRef = useRef<HTMLDivElement>(null)

  const selectedProvider = getProvider(providerId) || getProvider('custom') || PROVIDERS[0]
  const refreshStorageEstimate = useCallback(async () => {
    const [estimate, flows, templates, sources, channels] = await Promise.all([
      navigator.storage?.estimate?.() ?? Promise.resolve({ usage: 0, quota: 0 }),
      getPersistedStateSize('cnote-flows'),
      getPersistedStateSize('cnote-templates'),
      getPersistedStateSize('cnote-sources'),
      getPersistedStateSize('cnote-ai'),
    ])
    setStorageEstimate({ usage: estimate.usage || 0, quota: estimate.quota || 0 })
    setStorageBreakdown({ flows, templates, sources, channels })
  }, [])

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

  useEffect(() => {
    if (activeTab === 'storage') void refreshStorageEstimate()
  }, [activeTab, refreshStorageEstimate])

  const resetChannelDialog = () => {
    setShowChannelDialog(false)
    setShowProtocolMenu(false)
    setEditingChannelId(null)
    setChannelName('')
    setProviderId('custom')
    setBaseURL('')
    setProtocol('responses')
    setAPIKey('')
    setProxyHeaderName('')
    setProxyHeaderValue('')
    setModelIds([])
    setAvailableModelIds([])
    setCustomModelId('')
    setConnectionMessage('')
  }

  const openNewChannelDialog = () => {
    resetChannelDialog()
    setShowChannelDialog(true)
  }

  const openEditChannelDialog = (channel: APIChannel) => {
    const provider = getProvider(channel.providerId) || getProvider('custom') || PROVIDERS[0]
    setEditingChannelId(channel.id)
    setChannelName(channel.name)
    setProviderId(channel.providerId)
    setBaseURL(channel.baseURL || provider.baseURL)
    setProtocol(channel.protocol || provider.protocol)
    setAPIKey('')
    setProxyHeaderName(channel.proxyHeaderName || '')
    setProxyHeaderValue('')
    setModelIds(channel.modelIds || [])
    setAvailableModelIds(channel.modelIds || [])
    setCustomModelId('')
    setConnectionMessage('')
    setShowChannelDialog(true)
  }

  const toggleModel = (modelId: string) => {
    setModelIds((current) => current.includes(modelId)
      ? current.filter((id) => id !== modelId)
      : [...current, modelId])
  }

  const addCustomModel = () => {
    const modelId = customModelId.trim()
    if (!modelId || modelIds.includes(modelId)) return
    setModelIds((current) => [...current, modelId])
    setCustomModelId('')
  }

  const requestModels = async () => {
    const key = apiKey.trim() || (editingChannelId ? getAPIKey(editingChannelId) || '' : '')
    const endpoint = baseURL.trim().replace(/\/$/, '')
    if (!endpoint) throw new Error('请输入接口地址')
    if (!key) throw new Error('请先输入 API Key')

    const inferredProviderId = inferProviderId(providerId, endpoint, modelIds, protocol)
    const inferredProvider = getProvider(inferredProviderId) || selectedProvider
    const client = new AIClient({
      id: inferredProviderId,
      name: inferredProvider.name,
      baseURL: endpoint,
      protocol,
      models: [],
      extraHeaders: proxyHeaderName.trim() && (proxyHeaderValue || (editingChannelId ? getProxyHeaderValue(editingChannelId) : ''))
        ? { [proxyHeaderName.trim()]: proxyHeaderValue || getProxyHeaderValue(editingChannelId || '') || '' }
        : undefined,
    }, key)
    return client.listModels()
  }

  const handleFetchModels = async () => {
    if (modelRequestRef.current) return
    setIsFetchingModels(true)
    setConnectionMessage('')
    const request = requestModels()
    modelRequestRef.current = request
    try {
      const ids = await request
      setAvailableModelIds(ids)
      setConnectionMessage(ids.length ? `已拉取 ${ids.length} 个模型，请选择要启用的模型` : '连接成功，但接口没有返回模型')
    } catch (error) {
      const message = error instanceof TypeError
        ? '连接失败，接口可能未允许浏览器跨域请求。请查看下方的 AI 代理部署文档。'
        : error instanceof Error ? error.message : '拉取模型失败'
      setConnectionMessage(message)
    } finally {
      modelRequestRef.current = null
      setIsFetchingModels(false)
    }
  }

  const handleSaveChannel = () => {
    const normalizedBaseURL = baseURL.trim().replace(/\/$/, '')
    const normalizedProviderId = inferProviderId(providerId, normalizedBaseURL, modelIds, protocol)
    const normalizedName = channelName.trim() || `${getProvider(normalizedProviderId)?.name || '自定义'} 渠道`
    const normalizedProxyHeaderName = proxyHeaderName.trim()

    if (!normalizedBaseURL) {
      alert('请输入接口地址')
      return
    }
    if (!editingChannelId && !apiKey.trim()) {
      alert('请输入 API Key')
      return
    }
    if (apiKey.trim() && !validateAPIKey(normalizedProviderId, apiKey.trim())) {
      alert('API Key 格式无效')
      return
    }
    if (!editingChannelId && normalizedProxyHeaderName && !proxyHeaderValue) {
      alert('请输入代理请求头值')
      return
    }
    if (modelIds.length === 0) {
      alert('请至少拉取并选择一个模型，或手动添加一个模型 ID')
      return
    }

    if (editingChannelId) {
      updateAPIKey(editingChannelId, {
        providerId: normalizedProviderId,
        name: normalizedName,
        baseURL: normalizedBaseURL,
        modelIds,
        protocol,
        proxyHeaderName: normalizedProxyHeaderName || undefined,
        ...(!normalizedProxyHeaderName ? { proxyHeaderValue: '' } : proxyHeaderValue ? { proxyHeaderValue } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
    } else {
      addAPIKey(normalizedProviderId, apiKey.trim(), normalizedName, {
        baseURL: normalizedBaseURL,
        modelIds,
        protocol,
        proxyHeaderName: normalizedProxyHeaderName || undefined,
        proxyHeaderValue,
      })
    }
    resetChannelDialog()
  }

  const handleExportConfiguration = () => {
    const configuration: ExportedConfiguration = {
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: apiKeys.map((channel) => ({
        id: channel.id,
        providerId: channel.providerId,
        apiKey: getAPIKey(channel.id) || '',
        name: channel.name,
        baseURL: channel.baseURL,
        modelIds: channel.modelIds,
        protocol: channel.protocol,
        proxyHeaderName: channel.proxyHeaderName,
        proxyHeaderValue: getProxyHeaderValue(channel.id) || undefined,
      })),
    }
    const blob = new Blob([JSON.stringify(configuration, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cnote-config-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportConfiguration = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const configuration = JSON.parse(await file.text()) as Partial<ExportedConfiguration>
      if (configuration.version !== 1 || !Array.isArray(configuration.channels)) {
        throw new Error('Unsupported configuration format')
      }
      const channels = configuration.channels.filter((channel): channel is APIChannelInput =>
        Boolean(channel && channel.providerId && channel.name && typeof channel.apiKey === 'string')
      )
      if (channels.length !== configuration.channels.length) {
        throw new Error('Invalid channel data')
      }
      if (apiKeys.length > 0 && !confirm('导入配置会替换当前全部渠道，是否继续？')) return
      replaceAPIKeys(channels)
      alert(`已导入 ${channels.length} 个渠道`)
    } catch {
      alert('配置文件无效或无法读取')
    }
  }

  const usagePercent = storageEstimate.quota > 0
    ? Math.min((storageEstimate.usage / storageEstimate.quota) * 100, 100)
    : 0
  const formattedUsagePercent = usagePercent > 0 && usagePercent < 0.01
    ? '<0.01%'
    : `${usagePercent.toFixed(2)}%`

  const dataRows = [
    { label: 'Flow', description: '工作流与画板数据', count: flowCount, size: storageBreakdown.flows },
    { label: '模板', description: '保存的 Flow 模板', count: templateCount, size: storageBreakdown.templates },
    { label: '内容', description: '内容库中的素材', count: sourceCount, size: storageBreakdown.sources },
    { label: '渠道配置', description: '加密保存在本机的 API 渠道', count: apiKeys.length, size: storageBreakdown.channels },
  ]

  return (
    <AppShell>
      <main className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-[15px] font-semibold text-foreground">设置</h1>
          <div className="flex items-center gap-2">
            {activeTab === 'channels' && (
              <>
                <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" style={{ display: 'none' }} onChange={handleImportConfiguration} />
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => importInputRef.current?.click()}><Upload className="h-3.5 w-3.5" />导入</Button>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={handleExportConfiguration}><Download className="h-3.5 w-3.5" />导出</Button>
                <Button size="sm" className="gap-1.5" onClick={openNewChannelDialog}><Plus className="h-3.5 w-3.5" />新增渠道</Button>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setActiveTab('channels')} className={activeTab === 'channels' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>渠道 ({apiKeys.length})</button>
            <button type="button" onClick={() => setActiveTab('content-service')} className={activeTab === 'content-service' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>内容解析服务</button>
            <button type="button" onClick={() => setActiveTab('storage')} className={activeTab === 'storage' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>本地存储</button>
          </div>

          {activeTab === 'channels' ? (
            <section>
              <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-muted/55 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>渠道配置仅保存在当前浏览器。导出的配置包含 API Key，请妥善保管；使用中转服务时，可直接填写自有 Worker 地址。</p>
              </div>

              {apiKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <KeyRound className="mb-4 h-10 w-10 text-muted-foreground/50" />
                  <h2 className="text-sm font-medium">还没有渠道</h2>
                  <p className="mt-2 text-[13px] text-muted-foreground">添加渠道后，即可在 AI 节点中选择对应模型</p>
                  <Button size="sm" className="mt-6 gap-1.5" onClick={openNewChannelDialog}><Plus className="h-3.5 w-3.5" />新增渠道</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {apiKeys.map((channel) => {
                    const provider = getProvider(channel.providerId) || PROVIDERS[0]
                    const channelModels = channel.modelIds || []
                    const isConfigured = Boolean(getAPIKey(channel.id))
                    const channelProtocol = channel.protocol || provider.protocol
                    const protocolLabel = PROTOCOL_OPTIONS.find((item) => item.value === channelProtocol)?.label || channelProtocol
                    return (
                      <article key={channel.id} onClick={() => openEditChannelDialog(channel)} className="group flex min-h-[82px] cursor-pointer items-center justify-between gap-5 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/60">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="truncate text-[14px] font-semibold text-foreground">{channel.name}</h2>
                            {!isConfigured && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">未配置</span>}
                          </div>
                          <p className="mt-1.5 truncate text-[12px] text-muted-foreground">
                            {protocolLabel} · {channelModels.length} 个模型 · {channel.baseURL || provider.baseURL}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="secondary" size="sm" className="gap-1.5" onClick={(event) => { event.stopPropagation(); openEditChannelDialog(channel) }}><Pencil className="h-3.5 w-3.5" />编辑</Button>
                          <Button variant="outline" size="icon-sm" aria-label={`删除渠道 ${channel.name}`} onClick={(event) => { event.stopPropagation(); if (confirm(`确定要删除渠道“${channel.name}”吗？`)) removeAPIKey(channel.id) }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          ) : activeTab === 'content-service' ? (
            <ContentServiceSettings />
          ) : (
            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><Database className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-medium">浏览器存储</h2></div>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">浏览器配额是当前网站可使用的本地存储上限估算，不是云端或账号额度</p>
                  </div>
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => void refreshStorageEstimate()}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
                </div>

                <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div className="rounded-lg bg-muted/50 px-4 py-3.5"><p className="text-[11px] text-muted-foreground">已使用</p><p className="mt-1.5 text-lg font-medium">{formatBytes(storageEstimate.usage)}</p></div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3.5"><p className="text-[11px] text-muted-foreground">浏览器配额</p><p className="mt-1.5 text-lg font-medium">{formatBytes(storageEstimate.quota)}</p></div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3.5"><p className="text-[11px] text-muted-foreground">可用空间</p><p className="mt-1.5 text-lg font-medium">{formatBytes(Math.max(storageEstimate.quota - storageEstimate.usage, 0))}</p></div>
                </div>

                <div className="mt-5 flex items-center justify-between text-[12px] text-muted-foreground"><span>当前站点占浏览器配额</span><span>{formattedUsagePercent}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} /></div>
              </div>

              <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {dataRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
                    <div className="min-w-0"><p className="text-[13px] font-medium">{row.label}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{row.description}</p></div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-medium">{formatBytes(row.size)}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">约 {row.count} 项</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-2 text-[10px] text-muted-foreground">分类大小按已保存数据的序列化内容估算，不包含浏览器索引等额外开销。</p>

              <div className="mt-4 flex gap-3 rounded-lg bg-muted/55 px-3.5 py-3">
                <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div><h2 className="text-[12px] font-medium">当前仅本地保存</h2><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">尚未启用跨设备同步，请定期导出配置并妥善备份重要 Flow。</p></div>
              </div>
            </section>
          )}
        </div>
      </main>

      <Dialog open={showChannelDialog} onOpenChange={(open) => !open && resetChannelDialog()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" style={{ width: 'min(560px, calc(100vw - 2rem))', maxWidth: 'none' }}>
          <DialogHeader><DialogTitle className="text-base">{editingChannelId ? '编辑渠道' : '新增渠道'}</DialogTitle></DialogHeader>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">渠道名称</span><input autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="如：我的 OpenAI" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
            <div ref={protocolMenuRef} className="relative block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">API 协议</span>
              <button type="button" aria-haspopup="menu" aria-expanded={showProtocolMenu} onClick={() => setShowProtocolMenu((value) => !value)} className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/20">
                <span>{PROTOCOL_OPTIONS.find((option) => option.value === protocol)?.label || protocol}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showProtocolMenu ? 'rotate-180' : ''}`} />
              </button>
              {showProtocolMenu && (
                <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-1.5 space-y-1 rounded-lg border border-border bg-card p-1.5 shadow-xl">
                  {PROTOCOL_OPTIONS.map((option) => (
                    <button key={option.value} type="button" role="menuitemradio" aria-checked={protocol === option.value} onClick={() => { setProtocol(option.value); if (option.value === 'gemini') { setProviderId('google'); if (!baseURL.trim()) setBaseURL('https://generativelanguage.googleapis.com') } setShowProtocolMenu(false) }} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-foreground hover:bg-muted ${protocol === option.value ? 'bg-muted font-medium' : ''}`}>
                      <span>{option.label}</span>
                      {protocol === option.value && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <label className="mt-3 block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">接口地址</span><input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.openai.com" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
          <div className="mt-4 text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">API Key {editingChannelId && <span className="font-normal">（留空则保持不变）</span>}</span>
            <input type="password" value={apiKey} onChange={(event) => setAPIKey(event.target.value)} placeholder={editingChannelId ? '留空保持现有密钥' : '输入 API Key'} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </div>

          <details className="group mt-4 rounded-lg border border-border bg-muted/30 p-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />浏览器提示跨域？</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-[390px] text-[11px] leading-relaxed text-muted-foreground">直连失败时，可以部署自己的 AI 代理。完整部署步骤、可复制脚本、服务商路径和排错说明已放在 GitHub 文档中。</p>
              <a href={AI_PROXY_WORKER_GUIDE_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'gap-1.5' })}><ExternalLink className="h-3.5 w-3.5" />查看部署文档</a>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div>
                <h3 className="text-[12px] font-medium text-foreground">代理访问校验 <span className="font-normal text-muted-foreground">（可选）</span></h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">只有在 Worker 脚本中启用了访问请求头时才填写。名称和值由你按照脚本注释自行设置，并且必须与 Worker 完全一致；已有渠道的请求头值留空会保持不变。</p>
              </div>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block">请求头名称</span><input value={proxyHeaderName} onChange={(event) => setProxyHeaderName(event.target.value)} placeholder="如：X-Cnote-Access" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block">请求头值 {editingChannelId && <span>（留空保持不变）</span>}</span><input type="password" value={proxyHeaderValue} onChange={(event) => setProxyHeaderValue(event.target.value)} placeholder={editingChannelId ? '留空保持现有值' : '输入随机请求头值'} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
              </div>
            </div>
          </details>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-[13px] font-medium">渠道模型</h3><p className="mt-1 text-[11px] text-muted-foreground">优先从接口拉取模型列表；拉取失败时可手动添加模型 ID。</p></div>
              <Button type="button" variant="secondary" size="sm" className="shrink-0 gap-1.5" disabled={isFetchingModels} onClick={() => void handleFetchModels()}><RefreshCw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />拉取模型</Button>
            </div>
            <div className={`mt-3 min-h-[52px] rounded-lg border px-3 py-3 text-[11px] ${availableModelIds.length > 0 ? 'border-border bg-background' : 'border-dashed border-border text-center text-muted-foreground'}`}>
              {availableModelIds.length > 0 ? (
                <>
                  {connectionMessage && <p className="mb-2 leading-relaxed text-muted-foreground">{connectionMessage}</p>}
                <div className="flex flex-wrap gap-2">
                  {availableModelIds.map((modelId) => (
                    <button key={modelId} type="button" onClick={() => toggleModel(modelId)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${modelIds.includes(modelId) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'}`}>{modelIds.includes(modelId) && <Check className="h-3 w-3" />}{modelId}</button>
                  ))}
                </div>
                </>
              ) : connectionMessage || '尚未拉取模型列表'}
            </div>
            <div className="mt-3 flex items-center justify-between"><span className={`text-[11px] ${modelIds.length === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{modelIds.length === 0 ? '至少需要选择或添加一个模型' : `已选 ${modelIds.length} 个模型`}</span></div>
            <div className="mt-2 flex gap-2"><input value={customModelId} onChange={(event) => setCustomModelId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomModel() } }} placeholder="手动输入模型 ID" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /><Button variant="secondary" size="sm" onClick={addCustomModel}>添加模型</Button></div>
            {modelIds.filter((id) => !availableModelIds.includes(id)).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {modelIds.filter((id) => !availableModelIds.includes(id)).map((id) => (
                  <button key={id} type="button" onClick={() => toggleModel(id)} className="flex items-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">{id}<X className="h-3 w-3" /></button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={resetChannelDialog}>取消</Button><Button onClick={handleSaveChannel} disabled={modelIds.length === 0}>{editingChannelId ? '保存' : '添加渠道'}</Button></div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
