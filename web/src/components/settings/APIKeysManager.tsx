import { askConfirmation, showMessage } from '@/lib/app-dialog'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  Download,
  HardDrive,
  FolderOpen,
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContentServiceSettings } from '@/components/settings/ContentServiceSettings'
import { GenerationChannelsManager } from '@/components/settings/GenerationChannelsManager'
import { AIClient, PROVIDERS, getProvider, inferProviderId, type ProtocolType } from '@/lib/api'
import { localForageStorage } from '@/lib/localforage-storage'
import { MAX_BROWSER_STORAGE_BYTES } from '@/lib/resource-storage'
import { useAIStore, type APIChannel, type APIChannelInput } from '@/stores/use-ai-store'
import { useFlowStore } from '@/stores/use-flow-store'
import { useGenerationStore } from '@/stores/use-generation-store'
import { MEDIA_STORAGE_DEFAULTS, useMediaStorageStore, type MediaStorageObject } from '@/stores/use-media-storage-store'
import { useSourceStore } from '@/stores/use-source-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { deleteDesktopSecret, syncDesktopSecret } from '@/lib/desktop-secrets'

type SettingsTab = 'channels' | 'generation' | 'content-service' | 'storage'

const isSettingsTab = (value: string | null): value is SettingsTab => value === 'channels' || value === 'generation' || value === 'content-service' || value === 'storage'

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
  const generationChannels = useGenerationStore((state) => state.channels)
  const mediaStorage = useMediaStorageStore()
  const sourceCount = useSourceStore((state) => state.sources.length)
  const templateCount = useTemplateStore((state) => state.templates.length)
  const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.cnoteDesktop)

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => isSettingsTab(requestedTab) ? requestedTab : 'channels')
  const [generationDialogRequest, setGenerationDialogRequest] = useState(0)
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
  const [desktopStorageLocation, setDesktopStorageLocation] = useState<Awaited<ReturnType<NonNullable<Window['cnoteDesktop']>['system']['getStorageLocation']>> | null>(null)
  const [desktopStorageBusy, setDesktopStorageBusy] = useState(false)
  const [desktopStorageMessage, setDesktopStorageMessage] = useState('')
  const [mediaBaseURL, setMediaBaseURL] = useState('')
  const [mediaUploadPath, setMediaUploadPath] = useState(MEDIA_STORAGE_DEFAULTS.uploadPath)
  const [mediaFieldName, setMediaFieldName] = useState(MEDIA_STORAGE_DEFAULTS.fieldName)
  const [mediaResponsePath, setMediaResponsePath] = useState(MEDIA_STORAGE_DEFAULTS.responsePath)
  const [mediaAccessToken, setMediaAccessToken] = useState('')
  const [mediaTesting, setMediaTesting] = useState(false)
  const [mediaRefreshing, setMediaRefreshing] = useState(false)
  const [mediaMessage, setMediaMessage] = useState('')
  const [mediaObjects, setMediaObjects] = useState<MediaStorageObject[]>([])
  const [mediaObjectsCursor, setMediaObjectsCursor] = useState<string | undefined>()
  const [mediaDeletingKey, setMediaDeletingKey] = useState<string | null>(null)
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
    setStorageEstimate({
      usage: Math.min(estimate.usage || 0, MAX_BROWSER_STORAGE_BYTES),
      quota: Math.min(estimate.quota || MAX_BROWSER_STORAGE_BYTES, MAX_BROWSER_STORAGE_BYTES),
    })
    setStorageBreakdown({ flows, templates, sources, channels })
  }, [])

  const refreshDesktopStorageLocation = useCallback(async () => {
    if (!isDesktopRuntime || !window.cnoteDesktop) return
    try {
      setDesktopStorageLocation(await window.cnoteDesktop.system.getStorageLocation())
      setDesktopStorageMessage('')
    } catch (error) {
      setDesktopStorageMessage(error instanceof Error ? error.message : '无法读取桌面存储位置')
    }
  }, [isDesktopRuntime])

  const refreshStorageOverview = useCallback(async () => {
    await Promise.all([refreshStorageEstimate(), refreshDesktopStorageLocation()])
  }, [refreshDesktopStorageLocation, refreshStorageEstimate])

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
    if (activeTab !== 'storage') return
    void refreshStorageOverview()
  }, [activeTab, refreshStorageOverview])

  useEffect(() => {
    setMediaBaseURL(mediaStorage.baseURL)
    setMediaUploadPath(mediaStorage.uploadPath || MEDIA_STORAGE_DEFAULTS.uploadPath)
    setMediaFieldName(mediaStorage.fieldName || MEDIA_STORAGE_DEFAULTS.fieldName)
    setMediaResponsePath(mediaStorage.responsePath || MEDIA_STORAGE_DEFAULTS.responsePath)
    setMediaAccessToken(mediaStorage.getAccessToken())
  }, [mediaStorage])

  useEffect(() => {
    if (mediaStorage.baseURL) return
    const legacyChannels = generationChannels.filter((channel) => channel.mediaUploadURL)
    const legacy = legacyChannels[0]
    if (!legacy?.mediaUploadURL) return
    try {
      const parsed = new URL(legacy.mediaUploadURL)
      const path = parsed.pathname.replace(/\/$/, '') || '/upload'
      const slash = path.lastIndexOf('/')
      const baseURL = `${parsed.origin}${slash > 0 ? path.slice(0, slash) : ''}`
      const uploadPath = slash > 0 ? path.slice(slash) : path
      mediaStorage.updateSettings({
        baseURL,
        uploadPath,
        fieldName: legacy.mediaUploadField || MEDIA_STORAGE_DEFAULTS.fieldName,
        responsePath: legacy.mediaUploadResponsePath || MEDIA_STORAGE_DEFAULTS.responsePath,
        accessToken: legacy.mediaUploadApiKey || '',
      })
      legacyChannels.forEach((channel) => useGenerationStore.getState().updateChannel(channel.id, {
        mediaUploadURL: undefined,
        mediaUploadApiKey: '',
        encryptedMediaUploadKey: undefined,
      }))
      setMediaMessage('已把旧渠道中的自定义上传配置迁移到这里，请检查后测试。')
    } catch {
      // Keep the legacy channel fallback for malformed historical values.
    }
  }, [generationChannels, mediaStorage])

  useEffect(() => {
    const nextTab = isSettingsTab(requestedTab) ? requestedTab : 'channels'
    setActiveTab((current) => current === nextTab ? current : nextTab)
  }, [requestedTab])

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab)
    setSearchParams(tab === 'channels' ? {} : { tab })
  }

  const mediaDraft = () => ({
    baseURL: mediaBaseURL.trim(),
    uploadPath: mediaUploadPath.trim() || MEDIA_STORAGE_DEFAULTS.uploadPath,
    fieldName: mediaFieldName.trim() || MEDIA_STORAGE_DEFAULTS.fieldName,
    responsePath: mediaResponsePath.trim() || MEDIA_STORAGE_DEFAULTS.responsePath,
    accessToken: mediaAccessToken,
  })

  const testMediaStorage = async () => {
    if (mediaTesting) return
    setMediaTesting(true)
    setMediaMessage('')
    try {
      const draft = mediaDraft()
      const health = await mediaStorage.testConnection(draft)
      try {
        await mediaStorage.refreshUsage({ baseURL: draft.baseURL, accessToken: draft.accessToken })
      } catch (error) {
        // A custom service may omit the optional usage API. The bundled Worker
        // exposes it, so its authentication failures must remain visible.
        const message = error instanceof Error ? error.message : ''
        if (health.uploadConfigured !== undefined || !message.includes('404')) throw error
      }
      setMediaMessage(`连接成功${health.version ? `，服务版本 ${health.version}` : ''}`)
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : '无法连接媒体上传服务')
    } finally {
      setMediaTesting(false)
    }
  }

  const refreshMediaUsage = async () => {
    if (mediaRefreshing) return
    setMediaRefreshing(true)
    setMediaMessage('')
    try {
      const usage = await mediaStorage.refreshUsage({ baseURL: mediaBaseURL, accessToken: mediaAccessToken })
      setMediaMessage(`已更新远端用量：${usage.objectCount} 个对象，${formatBytes(usage.totalBytes)}`)
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : '无法读取远端用量')
    } finally {
      setMediaRefreshing(false)
    }
  }

  const loadMediaObjects = async (cursor?: string) => {
    try {
      const result = await mediaStorage.listObjects({
        limit: 50,
        cursor,
        draft: { baseURL: mediaBaseURL, accessToken: mediaAccessToken },
      })
      setMediaObjects((current) => cursor ? [...current, ...result.objects] : result.objects)
      setMediaObjectsCursor(result.cursor)
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : '无法读取远端对象')
    }
  }

  const deleteMediaObject = async (object: MediaStorageObject) => {
    if (!await askConfirmation(`确定删除远端对象“${object.originalName || object.key}”吗？删除后，使用该地址的任务将无法再读取素材。`)) return
    setMediaDeletingKey(object.key)
    try {
      await mediaStorage.deleteObject(object.key, { baseURL: mediaBaseURL, accessToken: mediaAccessToken })
      setMediaObjects((current) => current.filter((item) => item.key !== object.key))
      await mediaStorage.refreshUsage({ baseURL: mediaBaseURL, accessToken: mediaAccessToken }).catch(() => undefined)
      setMediaMessage('远端对象已删除')
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : '删除远端对象失败')
    } finally {
      setMediaDeletingKey(null)
    }
  }

  const chooseDesktopStorageLocation = async () => {
    if (!isDesktopRuntime || !window.cnoteDesktop || desktopStorageBusy) return
    setDesktopStorageBusy(true)
    setDesktopStorageMessage('')
    try {
      const selected = await window.cnoteDesktop.system.selectDirectory({
        title: '选择 Cnote 浏览器缓存与本地数据位置',
        defaultPath: desktopStorageLocation?.configuredPath || desktopStorageLocation?.currentPath,
      })
      if (!selected) return
      const next = await window.cnoteDesktop.system.setStorageLocation(selected)
      setDesktopStorageLocation(next)
      setDesktopStorageMessage('新位置将在重启 Cnote 后生效；当前数据仍保留在原位置。')
    } catch (error) {
      setDesktopStorageMessage(error instanceof Error ? error.message : '无法设置桌面存储位置')
    } finally {
      setDesktopStorageBusy(false)
    }
  }

  const resetDesktopStorageLocation = async () => {
    if (!isDesktopRuntime || !window.cnoteDesktop || desktopStorageBusy) return
    if (!await askConfirmation('恢复默认位置后，重启 Cnote 才会生效。是否继续？')) return
    setDesktopStorageBusy(true)
    setDesktopStorageMessage('')
    try {
      const next = await window.cnoteDesktop.system.resetStorageLocation()
      setDesktopStorageLocation(next)
      setDesktopStorageMessage('已恢复默认位置，重启 Cnote 后生效。')
    } catch (error) {
      setDesktopStorageMessage(error instanceof Error ? error.message : '无法恢复默认存储位置')
    } finally {
      setDesktopStorageBusy(false)
    }
  }

  const restartDesktop = () => {
    if (!isDesktopRuntime || !window.cnoteDesktop) return
    void window.cnoteDesktop.system.restart()
  }

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
    const existingChannel = editingChannelId ? useAIStore.getState().apiKeys.find((item) => item.id === editingChannelId) : undefined
    const endpoint = baseURL.trim().replace(/\/$/, '')
    if (!endpoint) throw new Error('请输入接口地址')
    if (!key && !existingChannel?.secretName) throw new Error('请先输入 API Key')

    const inferredProviderId = inferProviderId(providerId, endpoint, modelIds, protocol)
    const inferredProvider = getProvider(inferredProviderId) || selectedProvider
    let secretName = existingChannel?.secretName
    if (isDesktopRuntime && window.cnoteDesktop && key) {
      if (!secretName) secretName = `cnote:ai:temp-model-fetch-${Date.now()}`
      try {
        await syncDesktopSecret(secretName, key)
      } catch {
        throw new Error('API Key 未能保存到桌面安全存储，请重试。')
      }
    }
    const client = new AIClient({
      id: inferredProviderId,
      name: inferredProvider.name,
      baseURL: endpoint,
      protocol,
      models: [],
      extraHeaders: proxyHeaderName.trim() && (proxyHeaderValue || (editingChannelId ? getProxyHeaderValue(editingChannelId) : ''))
        ? { [proxyHeaderName.trim()]: proxyHeaderValue || getProxyHeaderValue(editingChannelId || '') || '' }
        : undefined,
    }, key, secretName)
    try {
      return await client.listModels()
    } finally {
      if (secretName?.startsWith('cnote:ai:temp-model-fetch-')) {
        await deleteDesktopSecret(secretName).catch(() => undefined)
      }
    }
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
        ? '浏览器无法直接访问该接口，请改用支持跨域的端点或你信任的代理地址。'
        : error instanceof Error ? error.message : '拉取模型失败'
      setConnectionMessage(message)
    } finally {
      modelRequestRef.current = null
      setIsFetchingModels(false)
    }
  }

  const handleSaveChannel = async () => {
    const normalizedBaseURL = baseURL.trim().replace(/\/$/, '')
    const normalizedProviderId = inferProviderId(providerId, normalizedBaseURL, modelIds, protocol)
    const normalizedName = channelName.trim() || `${getProvider(normalizedProviderId)?.name || '自定义'} 渠道`
    const normalizedProxyHeaderName = proxyHeaderName.trim()

    if (!normalizedBaseURL) {
      showMessage('请输入接口地址')
      return
    }
    if (!editingChannelId && !apiKey.trim()) {
      showMessage('请输入 API Key')
      return
    }
    if (!editingChannelId && normalizedProxyHeaderName && !proxyHeaderValue) {
      showMessage('请输入代理请求头值')
      return
    }
    if (modelIds.length === 0) {
      showMessage('请至少拉取并选择一个模型，或手动添加一个模型 ID')
      return
    }

    let savedChannelId = editingChannelId
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
      savedChannelId = addAPIKey(normalizedProviderId, apiKey.trim(), normalizedName, {
        baseURL: normalizedBaseURL,
        modelIds,
        protocol,
        proxyHeaderName: normalizedProxyHeaderName || undefined,
        proxyHeaderValue,
      })
    }
    const savedChannel = savedChannelId ? useAIStore.getState().apiKeys.find((channel) => channel.id === savedChannelId) : undefined
    if (isDesktopRuntime && window.cnoteDesktop && savedChannel) {
      try {
        if (apiKey.trim() && savedChannel.secretName) await syncDesktopSecret(savedChannel.secretName, apiKey.trim())
        if (normalizedProxyHeaderName && proxyHeaderValue && savedChannel.proxySecretName) await syncDesktopSecret(savedChannel.proxySecretName, proxyHeaderValue)
      } catch {
        showMessage('密钥未能保存到桌面安全存储，请重试。')
        return
      }
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
      if (apiKeys.length > 0 && !await askConfirmation('导入配置会替换当前全部渠道，是否继续？')) return
      replaceAPIKeys(channels)
      if (isDesktopRuntime && window.cnoteDesktop) {
        const importedChannels = useAIStore.getState().apiKeys
        await Promise.all(importedChannels.map(async (channel, index) => {
          const source = channels.find((item) => item.id === channel.id) || channels[index]
          if (!source?.apiKey || !channel.secretName) return
          await syncDesktopSecret(channel.secretName, source.apiKey)
          if (source.proxyHeaderValue && channel.proxySecretName) {
            await syncDesktopSecret(channel.proxySecretName, source.proxyHeaderValue)
          }
        }))
      }
      showMessage(`已导入 ${channels.length} 个渠道`)
    } catch {
      showMessage('配置文件无效或无法读取')
    }
  }

  const usagePercent = storageEstimate.quota > 0
    ? Math.min((storageEstimate.usage / storageEstimate.quota) * 100, 100)
    : 0
  const formattedUsagePercent = usagePercent > 0 && usagePercent < 0.01
    ? '<0.01%'
    : `${usagePercent.toFixed(2)}%`

  const dataRows = [
    { label: 'Flow', count: flowCount, size: storageBreakdown.flows },
    { label: '模板', count: templateCount, size: storageBreakdown.templates },
    { label: '内容', count: sourceCount, size: storageBreakdown.sources },
    { label: '渠道配置', count: apiKeys.length, size: storageBreakdown.channels },
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
            {activeTab === 'generation' && <Button size="sm" className="gap-1.5" onClick={() => setGenerationDialogRequest((request) => request + 1)}><Plus className="h-3.5 w-3.5" />新增生成渠道</Button>}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => selectTab('channels')} className={activeTab === 'channels' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>文本渠道</button>
            <button type="button" onClick={() => selectTab('generation')} className={activeTab === 'generation' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>生成渠道</button>
            <button type="button" onClick={() => selectTab('content-service')} className={activeTab === 'content-service' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>内容解析服务</button>
            <button type="button" onClick={() => selectTab('storage')} className={activeTab === 'storage' ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>本地存储</button>
          </div>

          {activeTab === 'channels' ? (
            <section>
              {apiKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <KeyRound className="mb-4 h-10 w-10 text-muted-foreground/50" />
                  <h2 className="text-sm font-medium">还没有文本渠道</h2>
                  <p className="mt-2 text-[13px] text-muted-foreground">添加文本渠道后，即可在旧 AI 节点中选择对应模型</p>
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
                          <Button variant="outline" size="icon-sm" aria-label={`删除渠道 ${channel.name}`} onClick={async (event) => { event.stopPropagation(); if (await askConfirmation(`确定要删除渠道“${channel.name}”吗？`)) removeAPIKey(channel.id) }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          ) : activeTab === 'generation' ? (
            <GenerationChannelsManager embedded openNewRequest={generationDialogRequest} />
          ) : activeTab === 'content-service' ? (
            <ContentServiceSettings />
          ) : (
            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><Database className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-medium">浏览器存储</h2></div>
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => void refreshStorageOverview()}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
                </div>

                <div className="mt-4 flex flex-wrap items-baseline gap-x-7 gap-y-2 text-[12px]">
                  <div className="flex items-baseline gap-2"><span className="text-muted-foreground">已使用</span><span className="text-sm font-medium">{formatBytes(storageEstimate.usage)}</span></div>
                  <div className="flex items-baseline gap-2"><span className="text-muted-foreground">上限</span><span className="text-sm font-medium">{formatBytes(MAX_BROWSER_STORAGE_BYTES)}</span></div>
                  <div className="flex items-baseline gap-2"><span className="text-muted-foreground">可用</span><span className="text-sm font-medium">{formatBytes(Math.max(storageEstimate.quota - storageEstimate.usage, 0))}</span></div>
                </div>

                <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span>使用率</span><span>{formattedUsagePercent}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} /></div>

              <div className="mt-5 border-t border-border pt-4">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  {dataRows.map((row) => (
                    <div key={row.label} className="min-w-0">
                      <div className="flex items-center justify-between gap-3"><span className="text-[12px] text-muted-foreground">{row.label}</span><span className="text-[12px] font-medium">{formatBytes(row.size)}</span></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{row.count} 项</p>
                    </div>
                  ))}
                </div>
              </div>

              {isDesktopRuntime && <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-medium">桌面端缓存与本地数据</h2></div>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]"><span className="text-muted-foreground">当前位置</span><span className="min-w-0 break-all text-foreground">{desktopStorageLocation?.currentPath || '读取中…'}</span></div>
                {desktopStorageLocation?.configuredPath && desktopStorageLocation.configuredPath !== desktopStorageLocation.currentPath && <p className="mt-1 break-all text-[11px] text-muted-foreground">下次启动：{desktopStorageLocation.configuredPath}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" disabled={desktopStorageBusy} onClick={() => void chooseDesktopStorageLocation()}><FolderOpen className="h-3.5 w-3.5" />选择位置</Button>
                  <Button variant="secondary" size="sm" disabled={desktopStorageBusy || !desktopStorageLocation?.configuredPath} onClick={() => void resetDesktopStorageLocation()}>恢复默认</Button>
                  {desktopStorageLocation?.restartRequired && <Button variant="outline" size="sm" className="gap-1.5" onClick={restartDesktop}><RefreshCw className="h-3.5 w-3.5" />立即重启</Button>}
                </div>
                {desktopStorageMessage && <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{desktopStorageMessage}</p>}
              </div>}
              </div>

              <div className="mt-5 rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><Cloud className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-medium">自定义媒体存储</h2>{mediaStorage.enabled && mediaStorage.health?.ok && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />已连接</span>}</div>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">用于把本地图片、视频、音频等参考素材转换为无需登录即可读取的 HTTPS 地址。</p>
                  </div>
                  {mediaStorage.usage && <span className="text-[11px] text-muted-foreground">上次更新 {new Date(mediaStorage.usage.fetchedAt).toLocaleString()}</span>}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">服务地址</span><input value={mediaBaseURL} onChange={(event) => { setMediaBaseURL(event.target.value); setMediaMessage('') }} placeholder="https://cnote-media.your-name.workers.dev" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                  <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">访问令牌</span><input type="password" value={mediaAccessToken} onChange={(event) => { setMediaAccessToken(event.target.value); setMediaMessage('') }} placeholder="与 Worker 的 CN_MEDIA_UPLOAD_TOKEN 一致" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                </div>

                <details className="group mt-4 rounded-lg border border-border bg-muted/25 px-3.5 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-medium"><span>上传接口选项</span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block font-medium">上传路径</span><input value={mediaUploadPath} onChange={(event) => setMediaUploadPath(event.target.value)} placeholder="/upload" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                    <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block font-medium">文件字段</span><input value={mediaFieldName} onChange={(event) => setMediaFieldName(event.target.value)} placeholder="file" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                    <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block font-medium">响应 URL 路径</span><input value={mediaResponsePath} onChange={(event) => setMediaResponsePath(event.target.value)} placeholder="url" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
                  </div>
                </details>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" disabled={mediaTesting || !mediaBaseURL.trim()} onClick={() => void testMediaStorage()}><RefreshCw className={`h-3.5 w-3.5 ${mediaTesting ? 'animate-spin' : ''}`} />{mediaTesting ? '正在测试' : '测试并保存'}</Button>
                  <Button variant="secondary" size="sm" className="gap-1.5" disabled={mediaRefreshing || !mediaBaseURL.trim()} onClick={() => void refreshMediaUsage()}><RefreshCw className={`h-3.5 w-3.5 ${mediaRefreshing ? 'animate-spin' : ''}`} />刷新远端用量</Button>
                  {(mediaStorage.baseURL || mediaBaseURL) && <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={async () => { if (!await askConfirmation('确定清除自定义媒体存储配置吗？远端对象不会被删除。')) return; mediaStorage.clearSettings(); setMediaBaseURL(''); setMediaAccessToken(''); setMediaObjects([]); setMediaObjectsCursor(undefined); setMediaMessage('已清除配置；远端对象仍保留。') }}><Trash2 className="h-3.5 w-3.5" />清除配置</Button>}
                </div>
                {mediaMessage && <p className={`mt-3 text-[12px] leading-5 ${mediaMessage.startsWith('连接成功') || mediaMessage.includes('已更新') ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{mediaMessage}</p>}

                {mediaStorage.usage && <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-muted/50 px-4 py-3"><p className="text-[11px] text-muted-foreground">远端对象</p><p className="mt-1.5 text-lg font-medium">{mediaStorage.usage.objectCount}</p></div><div className="rounded-lg bg-muted/50 px-4 py-3"><p className="text-[11px] text-muted-foreground">远端占用</p><p className="mt-1.5 text-lg font-medium">{formatBytes(mediaStorage.usage.totalBytes)}</p></div></div>}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4"><div><h3 className="text-[12px] font-medium">远端对象</h3><p className="mt-1 text-[11px] text-muted-foreground">只删除你确认不再被任何 Flow 或任务使用的对象。</p></div><Button variant="outline" size="sm" className="gap-1.5" disabled={!mediaBaseURL.trim()} onClick={() => void loadMediaObjects()}><RefreshCw className="h-3.5 w-3.5" />查看对象</Button></div>
                {mediaObjects.length > 0 && <div className="mt-3 space-y-2">{mediaObjects.map((object) => <article key={object.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[12px] font-medium">{object.originalName || object.key}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{formatBytes(object.size)}{object.uploaded ? ` · ${new Date(object.uploaded).toLocaleString()}` : ''}</p></div><Button variant="outline" size="icon-sm" aria-label={`删除远端对象 ${object.originalName || object.key}`} disabled={mediaDeletingKey === object.key} onClick={() => void deleteMediaObject(object)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></article>)}{mediaObjectsCursor && <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => void loadMediaObjects(mediaObjectsCursor)}>加载更多</Button>}</div>}

              </div>

              <p className="mt-4 flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><HardDrive className="h-3.5 w-3.5 shrink-0" /><span>当前仅本地保存，未启用跨设备同步。</span></p>
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

          {!isDesktopRuntime && <details className="group mt-4 rounded-lg border border-border bg-muted/30 p-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />代理请求头（可选）</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block">请求头名称</span><input value={proxyHeaderName} onChange={(event) => setProxyHeaderName(event.target.value)} placeholder="如：X-Cnote-Access" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
              <label className="block text-[12px] text-muted-foreground"><span className="mb-1.5 block">请求头值 {editingChannelId && <span>（留空保持不变）</span>}</span><input type="password" value={proxyHeaderValue} onChange={(event) => setProxyHeaderValue(event.target.value)} placeholder={editingChannelId ? '留空保持现有值' : '输入请求头值'} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
            </div>
          </details>}

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
