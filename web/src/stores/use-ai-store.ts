import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import { AIClient, getProvider, inferProviderId, type ProviderConfig, type ProtocolType } from '@/lib/api'
import { encryptAPIKey, decryptAPIKey } from '@/lib/secure-storage'

export interface APIChannel {
  id: string
  providerId: string
  encryptedKey: string
  proxyHeaderName?: string
  encryptedProxyHeaderValue?: string
  name: string
  baseURL?: string
  modelIds?: string[]
  protocol?: ProtocolType
}

export interface APIChannelInput {
  id?: string
  providerId: string
  apiKey: string
  proxyHeaderName?: string
  proxyHeaderValue?: string
  name: string
  baseURL?: string
  modelIds?: string[]
  protocol?: ProtocolType
}

interface AIState {
  // API Keys
  apiKeys: APIChannel[]

  // 当前选中的配置
  currentProviderId: string | null
  currentModelId: string | null
  currentAPIKeyId: string | null

  // AI 客户端实例
  client: AIClient | null
  defaultsInitialized: boolean
  defaultsVersion: number

  // 操作方法
  addAPIKey: (providerId: string, apiKey: string, name?: string, options?: { baseURL?: string; modelIds?: string[]; protocol?: ProtocolType; proxyHeaderName?: string; proxyHeaderValue?: string }) => string
  removeAPIKey: (id: string) => void
  updateAPIKey: (id: string, updates: { providerId?: string; apiKey?: string; name?: string; baseURL?: string; modelIds?: string[]; protocol?: ProtocolType; proxyHeaderName?: string; proxyHeaderValue?: string }) => void
  replaceAPIKeys: (channels: APIChannelInput[]) => void
  initializeDefaultChannels: () => void
  getAPIKey: (id: string) => string | null
  getProxyHeaderValue: (id: string) => string | null

  setCurrentProvider: (providerId: string) => void
  setCurrentModel: (modelId: string) => void
  setCurrentAPIKey: (keyId: string) => void

  // 初始化 AI 客户端
  initializeClient: (provider: ProviderConfig) => void
  createClientForChannel: (channelId: string) => AIClient | null

  // 测试连接
  testConnection: () => Promise<boolean>
}

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      apiKeys: [],
      currentProviderId: null,
      currentModelId: null,
      currentAPIKeyId: null,
      client: null,
      defaultsInitialized: false,
      defaultsVersion: 0,

      // 添加 API Key
      addAPIKey: (providerId, apiKey, name, options) => {
        const id = `key-${Date.now()}`
        const encryptedKey = encryptAPIKey(apiKey)

        set((state) => ({
          apiKeys: [
            ...state.apiKeys,
            {
              id,
              providerId,
              encryptedKey,
              name: name || `${providerId} 渠道`,
              baseURL: options?.baseURL,
              modelIds: options?.modelIds,
              protocol: options?.protocol,
              proxyHeaderName: options?.proxyHeaderName,
              encryptedProxyHeaderValue: options?.proxyHeaderValue ? encryptAPIKey(options.proxyHeaderValue) : undefined,
            },
          ],
        }))

        return id
      },

      // 删除 API Key
      removeAPIKey: (id) => {
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
          currentAPIKeyId: state.currentAPIKeyId === id ? null : state.currentAPIKeyId,
        }))
      },

      // 更新 API Key
      updateAPIKey: (id, updates) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id
              ? {
                  ...k,
                  ...updates,
                  encryptedKey: updates.apiKey ? encryptAPIKey(updates.apiKey) : k.encryptedKey,
                  encryptedProxyHeaderValue: updates.proxyHeaderValue !== undefined
                    ? (updates.proxyHeaderValue ? encryptAPIKey(updates.proxyHeaderValue) : undefined)
                    : k.encryptedProxyHeaderValue,
                }
              : k
          ),
        }))
      },

      replaceAPIKeys: (channels) => {
        const apiKeys = channels.map((channel, index) => ({
          id: channel.id || `key-${Date.now()}-${index}`,
          providerId: channel.providerId,
          encryptedKey: encryptAPIKey(channel.apiKey),
          name: channel.name,
          baseURL: channel.baseURL,
          modelIds: channel.modelIds,
          protocol: channel.protocol,
          proxyHeaderName: channel.proxyHeaderName,
          encryptedProxyHeaderValue: channel.proxyHeaderValue ? encryptAPIKey(channel.proxyHeaderValue) : undefined,
        }))
        set({ apiKeys, currentAPIKeyId: apiKeys[0]?.id || null, client: null })
      },

      initializeDefaultChannels: () => {
        set((state) => {
          if (state.defaultsVersion >= 5) return state
          const defaultSpecs = [
            { id: 'official-openai', providerId: 'openai', name: 'OpenAI 官方' },
            { id: 'official-deepseek', providerId: 'deepseek', name: 'DeepSeek 官方' },
          ]
          const createDefaultChannel = ({ id, providerId, name }: typeof defaultSpecs[number]) => {
            const provider = getProvider(providerId)
            return {
              id,
              providerId,
              name,
              encryptedKey: encryptAPIKey(''),
              baseURL: provider?.baseURL,
              modelIds: [],
              protocol: provider?.protocol,
            }
          }
          if (state.apiKeys.length > 0) {
            let migratedGoogleChannelId: string | null = null
            const apiKeys = state.apiKeys.flatMap((channel) => {
              if (channel.id === 'official-google') {
                const googleProvider = getProvider('google')
                const hasUserConfiguration = Boolean(
                  decryptAPIKey(channel.encryptedKey).trim()
                  || channel.modelIds?.length
                  || channel.proxyHeaderName
                  || channel.encryptedProxyHeaderValue
                  || channel.name !== 'Gemini 官方'
                  || (channel.baseURL && channel.baseURL !== googleProvider?.baseURL)
                  || (channel.protocol && channel.protocol !== googleProvider?.protocol)
                )
                if (!hasUserConfiguration) return []
                migratedGoogleChannelId = `key-google-${Date.now()}`
                return [{
                  ...channel,
                  id: migratedGoogleChannelId,
                  name: channel.name === 'Gemini 官方' ? 'Gemini' : channel.name,
                }]
              }
              if (state.defaultsVersion >= 3 || (channel.id !== 'official-openai' && channel.id !== 'official-deepseek')) return channel
              const provider = getProvider(channel.providerId)
              return [{ ...channel, modelIds: [], protocol: provider?.protocol || channel.protocol }]
            })
            defaultSpecs.forEach((spec) => {
              if (!apiKeys.some((channel) => channel.id === spec.id)) apiKeys.push(createDefaultChannel(spec))
            })
            return {
              apiKeys,
              currentAPIKeyId: state.currentAPIKeyId === 'official-google' ? migratedGoogleChannelId : state.currentAPIKeyId,
              defaultsInitialized: true,
              defaultsVersion: 5,
            }
          }

          const defaults = defaultSpecs.map(createDefaultChannel)

          return {
            apiKeys: defaults,
            currentAPIKeyId: null,
            defaultsInitialized: true,
            defaultsVersion: 5,
          }
        })
      },

      // 获取解密后的 API Key
      getAPIKey: (id) => {
        const keyStore = get().apiKeys.find((k) => k.id === id)
        if (!keyStore) return null

        return decryptAPIKey(keyStore.encryptedKey)
      },

      getProxyHeaderValue: (id) => {
        const channel = get().apiKeys.find((item) => item.id === id)
        return channel?.encryptedProxyHeaderValue ? decryptAPIKey(channel.encryptedProxyHeaderValue) : null
      },

      // 设置当前提供商
      setCurrentProvider: (providerId) => {
        set({ currentProviderId: providerId })
      },

      // 设置当前模型
      setCurrentModel: (modelId) => {
        set({ currentModelId: modelId })
      },

      // 设置当前 API Key
      setCurrentAPIKey: (keyId) => {
        set({ currentAPIKeyId: keyId })
      },

      // 初始化 AI 客户端
      initializeClient: (provider) => {
        const { currentAPIKeyId } = get()
        if (!currentAPIKeyId) {
          throw new Error('No API key selected')
        }

        const apiKey = get().getAPIKey(currentAPIKeyId)
        if (!apiKey) {
          throw new Error('API key not found')
        }

        const channel = get().apiKeys.find((item) => item.id === currentAPIKeyId)
        const proxyHeaderValue = get().getProxyHeaderValue(currentAPIKeyId)
        const selectedModels = channel?.modelIds?.length
          ? channel.modelIds.map((modelId) => provider.models.find((model) => model.id === modelId) || {
              id: modelId,
              name: modelId,
              maxTokens: 4096,
              supportsStreaming: true,
            })
          : []
        const protocol = channel?.protocol || provider.protocol
        const baseURL = channel?.baseURL || provider.baseURL
        const inferredProviderId = inferProviderId(channel?.providerId || provider.id, baseURL, channel?.modelIds || [], protocol)
        const inferredProvider = getProvider(inferredProviderId) || provider
        const client = new AIClient({
          ...inferredProvider,
          id: inferredProviderId,
          protocol,
          baseURL,
          models: selectedModels,
          extraHeaders: channel?.proxyHeaderName && proxyHeaderValue
            ? { [channel.proxyHeaderName]: proxyHeaderValue }
            : undefined,
        }, apiKey)
        set({ client })
      },

      createClientForChannel: (channelId) => {
        const channel = get().apiKeys.find((item) => item.id === channelId)
        if (!channel || !channel.modelIds?.length) return null
        const apiKey = get().getAPIKey(channelId)
        if (!apiKey) return null
        const proxyHeaderValue = get().getProxyHeaderValue(channelId)
        if (!channel.baseURL || !channel.protocol) return null
        const inferredProviderId = inferProviderId(channel.providerId, channel.baseURL, channel.modelIds, channel.protocol)
        const provider = getProvider(inferredProviderId) || getProvider('custom')
        if (!provider) return null
        const selectedModels = channel.modelIds.map((modelId) =>
          provider.models.find((model) => model.id === modelId) || {
            id: modelId,
            name: modelId,
            maxTokens: 4096,
            supportsStreaming: true,
          }
        )
        return new AIClient({
          ...provider,
          id: inferredProviderId,
          name: channel.name,
          protocol: channel.protocol || provider.protocol,
          baseURL: channel.baseURL || provider.baseURL,
          models: selectedModels,
          extraHeaders: channel.proxyHeaderName && proxyHeaderValue
            ? { [channel.proxyHeaderName]: proxyHeaderValue }
            : undefined,
        }, apiKey)
      },

      // 测试连接
      testConnection: async () => {
        const { client } = get()
        if (!client) {
          throw new Error('Client not initialized')
        }

        return client.testConnection()
      },
    }),
    {
      name: 'cnote-ai',
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        currentProviderId: state.currentProviderId,
        currentModelId: state.currentModelId,
        currentAPIKeyId: state.currentAPIKeyId,
        defaultsInitialized: state.defaultsInitialized,
        defaultsVersion: state.defaultsVersion,
      }),
    }
  )
)
