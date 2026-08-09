import { useState } from 'react'
import { Settings, Plus, Trash2, Eye, EyeOff, Check, X } from 'lucide-react'
import { useAIStore } from '@/stores/use-ai-store'
import { PROVIDERS, validateAPIKey } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function APIKeysManager() {
  const {
    apiKeys,
    addAPIKey,
    removeAPIKey,
    getAPIKey,
    currentAPIKeyId,
    setCurrentAPIKey,
    proxyURL,
    setProxyURL,
  } = useAIStore()

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newKeyProviderId, setNewKeyProviderId] = useState('openai')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testingKey, setTestingKey] = useState<string | null>(null)

  // 添加新 Key
  const handleAddKey = () => {
    if (!newKeyValue.trim()) return

    if (!validateAPIKey(newKeyProviderId, newKeyValue)) {
      alert('API Key 格式无效')
      return
    }

    addAPIKey(newKeyProviderId, newKeyValue, newKeyName)
    setShowAddDialog(false)
    setNewKeyValue('')
    setNewKeyName('')
  }

  // 切换显示/隐藏
  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // 测试 API Key
  const handleTestKey = async (id: string) => {
    setTestingKey(id)

    // TODO: 实现实际的测试逻辑
    await new Promise((resolve) => setTimeout(resolve, 1000))

    setTestingKey(null)
  }

  // 获取提供商名称
  const getProviderName = (providerId: string) => {
    return PROVIDERS.find((p) => p.id === providerId)?.name || providerId
  }

  // 格式化 API Key 显示
  const formatKeyDisplay = (encryptedKey: string, show: boolean) => {
    if (show) {
      const key = getAPIKey(encryptedKey)
      return key || '••••••••••••••••'
    }
    return '••••••••••••••••'
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7]">
      {/* 头部 */}
      <header className="bg-white border-b border-[#d2d2d7]">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Settings className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1d1d1f]">API Keys 管理</h1>
              <p className="text-sm text-[#6e6e73]">管理你的 AI 服务 API 密钥</p>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* 代理设置 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Cloudflare 代理</CardTitle>
            <CardDescription>
              用于解决 CORS 问题的代理服务器地址
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={proxyURL}
                onChange={(e) => setProxyURL(e.target.value)}
                placeholder="https://ai-proxy.cnote.workers.dev"
                className="flex-1"
              />
              <Button variant="outline">测试连接</Button>
            </div>
          </CardContent>
        </Card>

        {/* API Keys 列表 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[#1d1d1f]">API Keys</h2>
          <Button
            onClick={() => setShowAddDialog(true)}
            className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            添加 Key
          </Button>
        </div>

        {apiKeys.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Settings className="w-16 h-16 text-[#8e8e93] mb-4" />
              <h3 className="text-xl font-medium text-[#1d1d1f] mb-2">
                还没有 API Key
              </h3>
              <p className="text-[#6e6e73] mb-6">
                添加你的第一个 API Key 开始使用 AI 功能
              </p>
              <Button
                onClick={() => setShowAddDialog(true)}
                className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
              >
                <Plus className="w-4 h-4" />
                添加 Key
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <Card
                key={key.id}
                className={`cursor-pointer transition-colors ${
                  currentAPIKeyId === key.id ? 'border-[#34c759] border-2' : ''
                }`}
                onClick={() => setCurrentAPIKey(key.id)}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-[#1d1d1f]">
                        {key.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-[#f2f2f7] rounded text-[#6e6e73]">
                        {getProviderName(key.providerId)}
                      </span>
                      {currentAPIKeyId === key.id && (
                        <Check className="w-4 h-4 text-[#34c759]" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-[#6e6e73] font-mono">
                        {formatKeyDisplay(key.encryptedKey, showKeys[key.id])}
                      </code>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleShowKey(key.id)
                      }}
                    >
                      {showKeys[key.id] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTestKey(key.id)
                      }}
                      disabled={testingKey === key.id}
                    >
                      {testingKey === key.id ? (
                        <span className="animate-spin">⟳</span>
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('确定要删除这个 API Key 吗？')) {
                          removeAPIKey(key.id)
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* 添加 Key 对话框 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加 API Key</DialogTitle>
            <DialogDescription>
              选择提供商并输入你的 API 密钥
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="provider">提供商</Label>
              <select
                id="provider"
                value={newKeyProviderId}
                onChange={(e) => setNewKeyProviderId(e.target.value)}
                className="w-full px-3 py-2 border border-[#d2d2d7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34c759]"
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="name">名称（可选）</Label>
              <Input
                id="name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="如: 我的 OpenAI Key"
              />
            </div>

            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                placeholder="sk-..."
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowAddDialog(false)
                setNewKeyValue('')
                setNewKeyName('')
              }}
            >
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button
              className="flex-1 bg-[#34c759] hover:bg-[#2fb350] text-white"
              onClick={handleAddKey}
              disabled={!newKeyValue.trim()}
            >
              <Check className="w-4 h-4 mr-2" />
              添加
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
