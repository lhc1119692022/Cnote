import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Cloud, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText, createAccessSecret, createCloudflareWorkerScript } from '@/lib/cloudflare-worker-templates'
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
  const [scriptMessage, setScriptMessage] = useState('')

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

  const generateToken = () => {
    setAccessToken(createAccessSecret())
    setScriptMessage('已生成访问令牌。复制脚本时会自动写入；请不要把令牌发给其他人。')
  }

  const copyWorkerScript = async () => {
    try {
      const source = await createCloudflareWorkerScript('content-service', {
        CNOTE_CONTENT_TOKEN: accessToken.trim(),
      })
      await copyText(source)
      setScriptMessage('预制脚本已复制。现在切换到 Cloudflare 编辑器，全部替换后点击“部署”。')
    } catch (error) {
      setScriptMessage(error instanceof Error ? error.message : '复制失败，请检查浏览器剪贴板权限。')
    }
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
            <span className="mb-2 block font-medium">访问令牌 <span className="font-normal">（可选）</span></span>
            <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="与 Worker 的 CN_CONTENT_TOKEN 保持一致" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" disabled={testing || !baseURL.trim()} onClick={() => void testAndSave()}><RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />{testing ? '正在测试' : '测试并保存'}</Button>
          {(settings.baseURL || baseURL) && <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={clear}><Trash2 className="h-3.5 w-3.5" />清除配置</Button>}
        </div>
        {message && <p className={`mt-3 text-[12px] leading-5 ${message.startsWith('连接成功') ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{message}</p>}

        <details className="mt-5 rounded-lg border border-border bg-muted/30 p-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium">
            <span className="flex items-center gap-2"><Cloud className="h-4 w-4 text-muted-foreground" />部署自己的内容解析服务</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </summary>
          <div className="mt-3 space-y-3 text-[11px] leading-relaxed text-muted-foreground">
            <p>不需要安装任何软件。准备一个 Cloudflare 账号，在网页中创建 Worker 并粘贴 Cnote 预制脚本即可。</p>
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
              <h3 className="text-[12px] font-medium text-foreground">Cnote 还没有部署到 GitHub Pages 也可以继续</h3>
              <p className="mt-1">这里不需要填写 Cnote 的网页域名。内容解析 Worker 独立部署，Cloudflare 会自动提供 <code className="text-foreground">workers.dev</code> 地址；当前本地运行的 Cnote 就能用它测试。</p>
            </div>
            <ol className="space-y-2">
              <li className="rounded-lg border border-border bg-background p-3"><span className="font-medium text-foreground">1. 打开 Cloudflare 控制台</span><p className="mt-1">登录后进入左侧 <strong>Workers 和 Pages</strong>，点击<strong>创建</strong>，选择 <strong>Worker</strong>，再点击<strong>部署</strong>。</p></li>
              <li className="rounded-lg border border-border bg-background p-3"><span className="font-medium text-foreground">2. 打开在线编辑器</span><p className="mt-1">进入刚创建的 Worker，点击右上角<strong>编辑代码</strong>。删除编辑器中的示例内容。</p></li>
              <li className="rounded-lg border border-border bg-background p-3"><span className="font-medium text-foreground">3. 复制脚本并再次部署</span><p className="mt-1">先决定是否使用令牌，然后点击“复制预制脚本”，粘贴到编辑器并点击<strong>部署</strong>。</p></li>
              <li className="rounded-lg border border-border bg-background p-3"><span className="font-medium text-foreground">4. 打开安全兼容标志</span><p className="mt-1">回到 Worker 页面，进入<strong>设置 → 运行时 → 兼容性标志</strong>，添加 <code className="text-foreground">global_fetch_strictly_public</code> 并保存。它会让内容抓取请求严格走公开互联网。</p></li>
            </ol>

            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="flex items-center gap-1.5 text-[12px] font-medium text-foreground"><ShieldCheck className="h-3.5 w-3.5" />访问令牌（推荐）</h3><p className="mt-1">生成后会同时填入上方表单和预制脚本；不生成则 Worker 无令牌保护。</p></div><Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={generateToken}><KeyRound className="h-3.5 w-3.5" />生成令牌</Button></div>
              <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" className="gap-1.5" onClick={() => void copyWorkerScript()}><Copy className="h-3.5 w-3.5" />复制预制脚本</Button><Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => window.open('https://dash.cloudflare.com/', '_blank', 'noopener,noreferrer')}><ExternalLink className="h-3.5 w-3.5" />打开 Cloudflare</Button></div>
              {scriptMessage && <p className="mt-2 text-[11px] text-foreground">{scriptMessage}</p>}
            </div>

            <div className="rounded-lg border border-border bg-background p-3"><h3 className="text-[12px] font-medium text-foreground">5. 复制 Cloudflare 自动生成的地址</h3><p className="mt-1">部署完成后，从 Cloudflare 复制 Worker 的实际地址，填入上方“服务地址”。不要照抄下面的示例文字；这里的子域属于 Cloudflare，不是 GitHub Pages 域名。</p><code className="mt-2 block break-all rounded-md bg-muted/50 px-2.5 py-2 text-foreground">https://你的-worker-名称.你的-Cloudflare-子域.workers.dev</code><p className="mt-2">访问令牌已经自动填入上方表单。现在可以直接在本地 Cnote 中“测试并保存”。</p></div>
            <div className="rounded-lg border border-border bg-background p-3"><h3 className="text-[12px] font-medium text-foreground">以后部署 GitHub Pages 时</h3><p className="mt-1">继续使用同一个 Worker 地址即可，不需要重新创建 Worker，也不需要修改预制脚本。</p></div>
          </div>
        </details>
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
