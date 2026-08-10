import { useState } from 'react'
import { Check, Eye, EyeOff, Plus, Settings, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PROVIDERS, validateAPIKey } from '@/lib/api'
import { useAIStore } from '@/stores/use-ai-store'

export function APIKeysManager() {
  const { apiKeys, addAPIKey, removeAPIKey, getAPIKey, currentAPIKeyId, setCurrentAPIKey, proxyURL, setProxyURL } = useAIStore()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newKeyProviderId, setNewKeyProviderId] = useState('openai')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testingKey, setTestingKey] = useState<string | null>(null)

  const resetDialog = () => {
    setShowAddDialog(false)
    setNewKeyValue('')
    setNewKeyName('')
  }

  const handleAddKey = () => {
    if (!newKeyValue.trim()) return
    if (!validateAPIKey(newKeyProviderId, newKeyValue)) {
      alert('API Key 格式无效')
      return
    }
    addAPIKey(newKeyProviderId, newKeyValue, newKeyName)
    resetDialog()
  }

  const handleTestKey = async (id: string) => {
    setTestingKey(id)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setTestingKey(null)
  }

  const providerName = (id: string) => PROVIDERS.find((provider) => provider.id === id)?.name || id
  const displayKey = (encryptedKey: string, show: boolean) => show ? getAPIKey(encryptedKey) || '••••••••••••••••' : '••••••••••••••••'

  return (
    <AppShell>
      <main className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-[15px] font-semibold">API 密钥管理</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowAddDialog(true)}><Plus className="h-3.5 w-3.5" />添加密钥</Button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <section className="mb-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Cloudflare 代理</h2>
            <p className="mt-1 text-xs text-muted-foreground">用于解决 CORS 问题的代理服务器地址</p>
            <div className="mt-3 flex gap-2">
              <input value={proxyURL} onChange={(event) => setProxyURL(event.target.value)} placeholder="https://ai-proxy.cnote.workers.dev" className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
              <Button variant="secondary" size="sm">测试连接</Button>
            </div>
          </section>

          {apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Settings className="mb-4 h-10 w-10 text-muted-foreground/50" />
              <h2 className="text-sm font-medium">还没有 API Key</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">添加你的第一个 API Key 开始使用 AI 功能</p>
              <Button size="sm" className="mt-6 gap-1.5" onClick={() => setShowAddDialog(true)}><Plus className="h-3.5 w-3.5" />添加密钥</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((apiKey) => (
                <article key={apiKey.id} onClick={() => setCurrentAPIKey(apiKey.id)} className={`cursor-pointer rounded-xl border bg-card p-4 transition-colors ${currentAPIKeyId === apiKey.id ? 'border-primary' : 'border-border hover:border-primary/60'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{apiKey.name || '未命名密钥'}</span>
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{providerName(apiKey.providerId)}</span>
                        {currentAPIKeyId === apiKey.id && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <code className="mt-2 block text-xs text-muted-foreground">{displayKey(apiKey.encryptedKey, showKeys[apiKey.id])}</code>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); setShowKeys((current) => ({ ...current, [apiKey.id]: !current[apiKey.id] })) }} aria-label="显示或隐藏密钥">{showKeys[apiKey.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                      <Button variant="ghost" size="icon-sm" disabled={testingKey === apiKey.id} onClick={(event) => { event.stopPropagation(); handleTestKey(apiKey.id) }} aria-label="测试密钥"><Check className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); if (confirm('确定要删除这个 API Key 吗？')) removeAPIKey(apiKey.id) }} aria-label="删除密钥"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog open={showAddDialog} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-base">添加 API Key</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">提供商</span><select value={newKeyProviderId} onChange={(event) => setNewKeyProviderId(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20">{PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">名称（可选）</span><input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} placeholder="如：我的 OpenAI Key" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
            <label className="block text-[13px] text-muted-foreground"><span className="mb-2 block font-medium">API Key</span><input type="password" autoFocus value={newKeyValue} onChange={(event) => setNewKeyValue(event.target.value)} placeholder="sk-..." className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" /></label>
          </div>
          <div className="mt-6 flex gap-3"><Button variant="secondary" className="flex-1" onClick={resetDialog}>取消</Button><Button className="flex-1" onClick={handleAddKey} disabled={!newKeyValue.trim()}>添加</Button></div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}