export interface BrowserWebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getTitle(): string
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>
}

export interface BrowserPageCapture {
  url: string
  title: string
  text: string
  html: string
  media: Array<{ kind: 'image' | 'video'; url: string; poster?: string; alt?: string; width?: number; height?: number }>
}

export type DesktopParsedPage = Awaited<ReturnType<NonNullable<Window['cnoteDesktop']>['content']['parseHtml']>>

export function findBrowserWebview(nodeId: string) {
  return [...document.querySelectorAll('webview[data-browser-node-id]')]
    .map((element) => element as BrowserWebviewElement)
    .find((element) => element.getAttribute('data-browser-node-id') === nodeId) || null
}

export async function captureBrowserWebview(nodeId: string): Promise<BrowserPageCapture> {
  const webview = findBrowserWebview(nodeId)
  if (!webview) throw new Error('浏览器页面尚未挂载')
  const result = await webview.executeJavaScript<Partial<BrowserPageCapture>>(
    `(() => {
      const absolute = (value) => { try { return new URL(value, location.href).toString() } catch { return '' } }
      const ignored = 'script,style,noscript,template,svg,nav,header,footer,aside,form,button,input,textarea,select,[class*="avatar" i],[id*="avatar" i],[class*="comment" i],[id*="comment" i],[class*="recommend" i],[id*="recommend" i],[class*="related" i],[id*="related" i],[class*="sidebar" i],[id*="sidebar" i],[class*="category" i],[id*="category" i],[class*="feed" i],[id*="feed" i]'
      const clean = (root) => {
        const clone = root.cloneNode(true)
        clone.querySelectorAll(ignored).forEach((node) => node.remove())
        return clone
      }
      const candidates = [
        document.querySelector('article'),
        document.querySelector('[class*="note-content" i],[class*="note-content" i]'),
        document.querySelector('[class*="detail-content" i],[class*="detail" i]'),
        ...Array.from(document.querySelectorAll('main,[class*="post" i],[class*="content" i]')),
      ].filter(Boolean)
      const scored = candidates.map((node) => {
        const text = (node.innerText || '').replace(/\\s+/g, ' ').trim()
        const media = node.querySelectorAll('img,video').length
        const links = node.querySelectorAll('a').length
        const semanticBonus = node.tagName === 'ARTICLE' ? 9000 : node.tagName === 'MAIN' ? 3000 : 0
        const detailBonus = /detail|note-content|post-content/i.test(String(node.className || '')) ? 5000 : 0
        return { node, score: semanticBonus + detailBonus + Math.min(text.length, 5000) + Math.min(media, 8) * 220 - Math.min(links, 80) * 20, text }
      }).filter((entry) => entry.text.length >= 20).sort((a, b) => b.score - a.score)
      const root = clean(scored[0]?.node || document.body)
      const rawLines = (root.innerText || '').replace(/\\n[ \\t]+/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').split(/\\n+/).map((line) => line.trim()).filter(Boolean)
      const seenLines = new Map()
      const noiseLine = /^(推荐|相关推荐|热门推荐|猜你喜欢|评论|回复|关注|收藏|点赞|分享|展开|收起|更多|首页|发现|分类|登录|注册|私信|笔记|视频|图文|RED|REDnote|小红书)$/i
      const text = rawLines.filter((line) => { const count = seenLines.get(line) || 0; seenLines.set(line, count + 1); return count < 2 && !noiseLine.test(line) && line.length <= 500 }).join('\\n\\n').trim()
      const media = []
      root.querySelectorAll('img').forEach((image) => {
        const url = absolute(image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original'))
        const width = image.naturalWidth || image.width || undefined
        const height = image.naturalHeight || image.height || undefined
        const avatarLike = /avatar|head|user[_-]?icon|profile|face|logo|icon/i.test((image.className || '') + ' ' + (image.id || '') + ' ' + (image.alt || '') + ' ' + url)
        const siteChromeLike = /xiaohongshu|xhscdn|rednote/i.test(url) && /logo|icon|default|placeholder|avatar|profile|cover/i.test((image.alt || '') + ' ' + url)
        const useful = url && !avatarLike && !siteChromeLike && !/^(data:|blob:)/i.test(url) && (!width || !height || (width >= 240 && height >= 240))
        if (useful && !media.some((item) => item.url === url)) media.push({ kind: 'image', url, alt: image.alt || undefined, width, height })
      })
      root.querySelectorAll('video').forEach((video) => {
        const url = absolute(video.currentSrc || video.src || video.querySelector('source')?.src)
        const poster = absolute(video.poster)
        if (url && !media.some((item) => item.url === url)) media.push({ kind: 'video', url, poster: poster || undefined, width: video.videoWidth || video.width || undefined, height: video.videoHeight || video.height || undefined })
      })
      if (!media.length) document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]').forEach((meta) => { const url = absolute(meta.content); if (url && !media.some((item) => item.url === url)) media.push({ kind: 'image', url }) })
      return { url: location.href, title: document.title, text, html: root.outerHTML || '', media: media.slice(0, 80) }
    })()`,
    true,
  )
  return {
    url: String(result.url || webview.getURL() || ''),
    title: String(result.title || webview.getTitle() || ''),
    text: String(result.text || ''),
    html: String(result.html || ''),
    media: Array.isArray(result.media) ? result.media : [],
  }
}
