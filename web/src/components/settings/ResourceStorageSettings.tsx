import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { askConfirmation } from '@/lib/app-dialog'
import { collectUnusedResources } from '@/storage/resource-library'
import storage from '@/lib/localforage-storage'

export function ResourceStorageSettings() {
  const [usage, setUsage] = useState<{ resources: number; data: number; cache: number; total: number }>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => { if (window.cnoteDesktop) setUsage(await window.cnoteDesktop.system.getStorageUsage()) }, [])
  useEffect(() => { void refresh().catch(error => setMessage(String(error))) }, [refresh])
  const action = async (cache: boolean) => {
    if (!await askConfirmation(cache ? '清理可重建缓存和画廊缩略图？不会删除生成结果、画布或浏览器登录信息。' : '核对资源使用关系并清理连续 7 天无人使用的资源？撤销历史、资料库和其他画布仍在使用的资源会保留。')) return
    setBusy(true); setMessage('')
    try {
      if (cache) {
        await window.cnoteDesktop?.system.clearCache()
        for (const key of await storage.keys()) if (key.startsWith('gallery-thumb:')) await storage.removeItem(key)
        setMessage('缓存已清理；仍在使用的浏览器可能立即生成少量新缓存。')
      } else {
        const result = await collectUnusedResources()
        setMessage('已清理 ' + result.removed + ' 项；' + result.pending + ' 项处于 7 天保留期。')
      }
      await refresh()
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const size = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return <section className="mt-5 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">{usage && <><span>媒体文件 {size(usage.resources)}</span><span>文档与会话 {size(usage.data)}</span><span>缓存与预览 {size(usage.cache)}</span><span>总计 {size(usage.total)}</span></>}</div>
    <div className="flex shrink-0 flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={() => void action(true)}>清理缓存</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => void action(false)}>清理未使用资源</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh().catch(error => setMessage(String(error)))}>刷新占用</Button></div>
    </div>
    {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
  </section>
}
