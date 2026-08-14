import { useEffect, useState } from 'react'
import { CheckCircle2, Cloud, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { CONTENT_SERVICE_WORKER_GUIDE_URL } from '@/config/links'
import { useContentServiceStore } from '@/stores/use-content-service-store'

const capabilityLabels = {
  webPage: '网页正文',
  youtubeTranscript: 'YouTube 字幕',
  social: '社媒解析',
  documentProxy: '文档代理',
} as const

export function ContentServiceSettings() {
  const settings = useContentServiceStore()
  const [baseURL, setBaseURL] = useState(settings.baseURL)
  const [accessToken, setAccessToken] = useState(settings.accessToken)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setBaseURL(settings.baseURL)
    setAccessToken(settings.accessToken)
  }, [settings.baseURL, settings.accessToken])

  const testAndSave = async () => {
    if (testing) return
    setTesting(true)
    setMessage('')
    try {
      const health = await settings.testConnection({ baseURL, accessToken })
      setMessage(`连接成功，服务版本 ${health.version}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法连接内容解析服务')
    } finally {
      setTesting(false)
    }
  }

  const clear = () => {
    if (!confirm('确定清除当前内容解析服务配置吗？')) return
    settings.clearSettings()
    setBaseURL('')
    setAccessToken('')
    setMessage('已清除配置；本地文件、视频播放和 URL 输出仍可使用。')
  }

  const capabilities = settings.capabilities
  const capabilityEntries = capabilities ? [
    { key: 'webPage', enabled: capabilities.webPage, detail: '' },
    { key: 'youtubeTranscript', enabled: capabilities.youtubeTranscript, detail: '' },
    { key: 'social', enabled: capabilities.social.length > 0, detail: capabilities.social.join('、') },
    { key: 'documentProxy', enabled: capabilities.documentProxy, detail: '' },
  ] as const : []

  return (
    <section>
      <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-muted/55 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>内容解析服务用于公开网页正文、YouTube 字幕和社媒解析。它不代理登录态、受限网页或 PDF 文档；与 AI 渠道完全独立。</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">自有内容解析服务</h2>
            <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">服务地址与令牌仅保存在当前浏览器，不会写入 Flow 或随画板导出。</p>
          </div>
          {settings.enabled && settings.serviceVersion && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />已连接</span>}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">服务地址</span>
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://cnote-content.your-name.workers.dev" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">访问令牌 <span className="font-normal">（建议填写）</span></span>
            <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="与 Worker 的 CN_CONTENT_TOKEN 保持一致" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" disabled={testing || !baseURL.trim()} onClick={() => void testAndSave()}><RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />{testing ? '正在测试' : '测试并保存'}</Button>
          {(settings.baseURL || baseURL) && <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={clear}><Trash2 className="h-3.5 w-3.5" />清除配置</Button>}
        </div>
        {message && <p className={`mt-3 text-[12px] leading-5 ${message.startsWith('连接成功') ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{message}</p>}

        <div className="mt-5 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3.5">
          <div className="max-w-[560px]">
            <h3 className="flex items-center gap-2 text-[13px] font-medium"><Cloud className="h-4 w-4 text-muted-foreground" />还没有内容解析服务？</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">按文档复制脚本、填写醒目标出的访问令牌，再把 Worker 地址和同一令牌粘贴回来即可。</p>
          </div>
          <a href={CONTENT_SERVICE_WORKER_GUIDE_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'gap-1.5' })}><ExternalLink className="h-3.5 w-3.5" />查看部署文档</a>
        </div>
      </div>

      {capabilityEntries.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">服务能力</h2><span className="text-[11px] text-muted-foreground">版本 {settings.serviceVersion}</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {capabilityEntries.map((item) => <div key={item.key} className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2.5 text-[12px]"><span>{capabilityLabels[item.key]}{item.detail ? ` · ${item.detail}` : ''}</span><span className={item.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{item.enabled ? '支持' : '不支持'}</span></div>)}
          </div>
        </div>
      )}
    </section>
  )
}
