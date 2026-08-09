import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import { AIClient, type ProviderConfig } from '@/lib/api'
import { encryptAPIKey, decryptAPIKey } from '@/lib/secure-storage'

interface APIKeyStore {
  id: string
  providerId: string
  encryptedKey: string
  name?: string
}

interface AIState {
  // API Keys
  apiKeys: APIKeyStore[]

  // 当前选中的配置
  currentProviderId: string | null
  currentModelId: string | null
  currentAPIKeyId: string | null

  // AI 客户端实例
  client: AIClient | null

  // Cloudflare 代理 URL
  proxyURL: string

  // 操作方法
  addAPIKey: (providerId: string, apiKey: string, name?: string) => string
  removeAPIKey: (id: string) => void
  updateAPIKey: (id: string, apiKey: string) => void
  getAPIKey: (id: string) => string | null

  setCurrentProvider: (providerId: string) => void
  setCurrentModel: (modelId: string) => void
  setCurrentAPIKey: (keyId: string) => void
  setProxyURL: (url: string) => void

  // 初始化 AI 客户端
  initializeClient: (provider: ProviderConfig) => void

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
      proxyURL: 'https://ai-proxy.cnote.workers.dev',

      // 添加 API Key
      addAPIKey: (providerId, apiKey, name) => {
        const id = `key-${Date.now()}`
        const encryptedKey = encryptAPIKey(apiKey)

        set((state) => ({
          apiKeys: [
            ...state.apiKeys,
            {
              id,
              providerId,
              encryptedKey,
              name: name || `${providerId} Key`,
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
      updateAPIKey: (id, apiKey) => {
        const encryptedKey = encryptAPIKey(apiKey)

        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id ? { ...k, encryptedKey } : k
          ),
        }))
      },

      // 获取解密后的 API Key
      getAPIKey: (id) => {
        const keyStore = get().apiKeys.find((k) => k.id === id)
        if (!keyStore) return null

        return decryptAPIKey(keyStore.encryptedKey)
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

      // 设置代理 URL
      setProxyURL: (url) => {
        set({ proxyURL: url })
      },

      // 初始化 AI 客户端
      initializeClient: (provider) => {
        const { currentAPIKeyId, proxyURL } = get()
        if (!currentAPIKeyId) {
          throw new Error('No API key selected')
        }

        const apiKey = get().getAPIKey(currentAPIKeyId)
        if (!apiKey) {
          throw new Error('API key not found')
        }

        const client = new AIClient(provider, apiKey, proxyURL)
        set({ client })
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
      storage: localForageStorage as any,
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        currentProviderId: state.currentProviderId,
        currentModelId: state.currentModelId,
        currentAPIKeyId: state.currentAPIKeyId,
        proxyURL: state.proxyURL,
      }),
    }
  )
)
