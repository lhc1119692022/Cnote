/**
 * Cloudflare Worker：远程内容抓取服务。
 * 抓取只接受公开 http(s) 目标，并对重定向、超时和响应大小逐跳限制。
 */

interface Env {
  SCRAPER_ALLOWED_ORIGINS?: string
  CN_CONTENT_TOKEN?: string
}

interface ScrapeErrorShape {
  code: string
  message: string
  retryable: boolean
}

interface RemoteMediaRef {
  url: string
  mimeType?: string
  width?: number
  height?: number
}

interface SocialContentBlock {
  type: 'text' | 'image' | 'video' | 'live-photo' | 'topic' | 'mention' | 'link'
  text?: string
  resource?: RemoteMediaRef
  image?: RemoteMediaRef
  motionVideo?: RemoteMediaRef
  caption?: string
  poster?: RemoteMediaRef
  name?: string
  url?: string
}

interface SocialPayload {
  kind: 'social'
  platform: 'xiaohongshu' | 'weibo' | 'douyin' | 'instagram' | 'generic'
  canonicalUrl: string
  title: string
  bodyText: string
  contentBlocks: SocialContentBlock[]
  author?: { id?: string; name: string; avatarUrl?: string; profileUrl?: string }
  publishedAt?: string
  metrics?: { likes?: number; collects?: number; comments?: number; shares?: number; capturedAt?: string }
  topics?: string[]
}

interface WebContent {
  title: string
  content: string
  canonicalUrl?: string
  thumbnailUrl?: string
  authorName?: string
  duration?: number
  width?: number
  height?: number
  social?: SocialPayload
}

interface YouTubeMetadata {
  title?: string
  authorName?: string
  thumbnailUrl?: string
}

interface YouTubeTranscriptResult extends YouTubeMetadata {
  subtitles: string
  warning?: string
  transcriptError?: ScrapeErrorShape
}

const MAX_HTML_BYTES = 4 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_MEDIA_BYTES = 12 * 1024 * 1024
const MAX_EXTRACTED_TEXT_CHARS = 100_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 8
const YOUTUBE_ANDROID_CLIENT_VERSION = '20.10.38'

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  hostOnly: boolean
  expiresAt?: number
}

function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim()).filter(Boolean)
}

function responseSetCookies(headers: Headers) {
  const enhanced = headers as Headers & { getSetCookie?: () => string[] }
  const values = enhanced.getSetCookie?.()
  if (values?.length) return values
  const combined = headers.get('set-cookie')
  return combined ? splitSetCookieHeader(combined) : []
}

function defaultCookiePath(pathname: string) {
  if (!pathname.startsWith('/') || pathname === '/') return '/'
  const lastSlash = pathname.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash)
}

function cookieDomainMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

class RedirectCookieJar {
  private cookies: StoredCookie[] = []

  capture(headers: Headers, requestUrl: URL) {
    for (const header of responseSetCookies(headers)) {
      const parts = header.split(';').map((part) => part.trim())
      const pair = parts.shift()
      const separator = pair?.indexOf('=') ?? -1
      if (!pair || separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      if (!name) continue
      let domain = requestUrl.hostname.toLowerCase()
      let path = defaultCookiePath(requestUrl.pathname)
      let secure = false
      let hostOnly = true
      let expiresAt: number | undefined
      for (const attribute of parts) {
        const attributeSeparator = attribute.indexOf('=')
        const key = (attributeSeparator >= 0 ? attribute.slice(0, attributeSeparator) : attribute).trim().toLowerCase()
        const attributeValue = attributeSeparator >= 0 ? attribute.slice(attributeSeparator + 1).trim() : ''
        if (key === 'domain') {
          const candidate = attributeValue.toLowerCase().replace(/^\./, '')
          if (!candidate || !cookieDomainMatches(requestUrl.hostname.toLowerCase(), candidate)) continue
          domain = candidate
          hostOnly = false
        } else if (key === 'path' && attributeValue.startsWith('/')) path = attributeValue
        else if (key === 'secure') secure = true
        else if (key === 'max-age') {
          const seconds = Number(attributeValue)
          if (Number.isFinite(seconds)) expiresAt = Date.now() + seconds * 1_000
        } else if (key === 'expires' && expiresAt === undefined) {
          const timestamp = Date.parse(attributeValue)
          if (Number.isFinite(timestamp)) expiresAt = timestamp
        }
      }
      const existingIndex = this.cookies.findIndex((cookie) => cookie.name === name && cookie.domain === domain && cookie.path === path)
      if (!value || (expiresAt !== undefined && expiresAt <= Date.now())) {
        if (existingIndex >= 0) this.cookies.splice(existingIndex, 1)
        continue
      }
      const next = { name, value, domain, path, secure, hostOnly, expiresAt }
      if (existingIndex >= 0) this.cookies[existingIndex] = next
      else this.cookies.push(next)
    }
  }

  header(target: URL) {
    const now = Date.now()
    this.cookies = this.cookies.filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now)
    const hostname = target.hostname.toLowerCase()
    return this.cookies
      .filter((cookie) => {
        if (cookie.secure && target.protocol !== 'https:') return false
        if (cookie.hostOnly ? cookie.domain !== hostname : !cookieDomainMatches(hostname, cookie.domain)) return false
        return target.pathname === cookie.path || target.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`)
      })
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
  'Access-Control-Max-Age': '86400',
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  const allowedOrigins = env.SCRAPER_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) || []
  const allowedOrigin = allowedOrigins.length === 0
    ? '*'
    : origin && allowedOrigins.includes(origin)
      ? origin
      : undefined
  return {
    ...CORS_HEADERS,
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    Vary: 'Origin',
  }
}

const SERVICE_INFO = {
  status: 'ok',
  service: 'cnote-content-service',
  version: '1.6.3',
  capabilities: {
    webPage: true,
    youtubeTranscript: true,
    social: ['xiaohongshu', 'douyin', 'instagram'],
    documentProxy: false,
  },
}

class ScrapeError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number

  constructor(code: string, message: string, status = 502, retryable = false) {
    super(message)
    this.name = 'ScrapeError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

function errorResponse(error: unknown, request: Request, env: Env, fallbackStatus = 500) {
  const typed = error instanceof ScrapeError
  const body: ScrapeErrorShape = {
    code: typed ? error.code : 'UPSTREAM_ERROR',
    message: typed ? error.message : '远程内容抓取失败',
    retryable: typed ? error.retryable : true,
  }
  return new Response(JSON.stringify(body), {
    status: typed ? error.status : fallbackStatus,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  })
}

function assertRequestAccess(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  const allowedOrigins = env.SCRAPER_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) || []
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    throw new ScrapeError('ORIGIN_NOT_ALLOWED', '当前站点未被内容解析服务授权', 403, false)
  }
  if (env.CN_CONTENT_TOKEN) {
    const authorization = request.headers.get('Authorization')
    if (authorization !== `Bearer ${env.CN_CONTENT_TOKEN}`) {
      throw new ScrapeError('UNAUTHORIZED', '内容解析服务访问令牌无效', 401, false)
    }
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return true
  if (isPrivateIpv4(host)) return true
  // Workers cannot resolve a hostname safely on the client side, but literal
  // loopback, link-local, unique-local and IPv4-mapped IPv6 targets are known
  // to be private and should never be fetched by this public endpoint.
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('::ffff:')) return true
  return false
}

function validateTarget(rawUrl: string) {
  let target: URL
  try { target = new URL(rawUrl) } catch { throw new ScrapeError('INVALID_URL', 'URL 格式无效', 400) }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new ScrapeError('URL_REJECTED', '仅支持公开 http/https URL', 400)
  if (isPrivateHostname(target.hostname)) throw new ScrapeError('SSRF_BLOCKED', '出于安全原因拒绝访问该地址', 403)
  return target
}

async function readBodyLimited(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new ScrapeError('RESPONSE_TOO_LARGE', '上游响应超过大小限制', 413)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let result = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ScrapeError('RESPONSE_TOO_LARGE', '上游响应超过大小限制', 413)
      }
      result += decoder.decode(next.value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function fetchLimited(rawUrl: string, maxBytes: number, init?: RequestInit, cookieJar?: RedirectCookieJar) {
  let target = validateTarget(rawUrl)
  const redirects: string[] = []
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      const headers = new Headers(init?.headers)
      const cookie = cookieJar?.header(target)
      if (cookie) headers.set('Cookie', cookie)
      response = await fetch(target.toString(), { ...init, headers, redirect: 'manual', signal: controller.signal })
      cookieJar?.capture(response.headers, target)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new ScrapeError('FETCH_TIMEOUT', '上游请求超时', 504, true)
      throw new ScrapeError('UPSTREAM_ERROR', '无法访问上游内容', 502, true)
    } finally {
      clearTimeout(timeout)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new ScrapeError('UPSTREAM_ERROR', '上游重定向缺少目标地址', 502, true)
      if (redirect === MAX_REDIRECTS) throw new ScrapeError('TOO_MANY_REDIRECTS', '上游重定向次数过多', 502, true)
      target = validateTarget(new URL(location, target).toString())
      redirects.push(target.toString())
      continue
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ScrapeError('ACCESS_RESTRICTED', '上游内容需要登录或拒绝访问', response.status, false)
      if (response.status === 404 || response.status === 410) throw new ScrapeError('CONTENT_NOT_FOUND', '内容不存在或已被删除', response.status, false)
      if (response.status === 429) throw new ScrapeError('RATE_LIMITED', '上游请求频率受限，请稍后重试', 429, true)
      if (response.status === 412) throw new ScrapeError('UPSTREAM_CHALLENGE', '上游站点要求安全验证，无法读取公开内容', 502, true)
      throw new ScrapeError('UPSTREAM_ERROR', `上游返回 HTTP ${response.status}`, 502, true)
    }
    return { url: target.toString(), redirects, response, body: await readBodyLimited(response, maxBytes) }
  }
  throw new ScrapeError('TOO_MANY_REDIRECTS', '上游重定向次数过多', 502, true)
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
}

function firstMatch(html: string, pattern: RegExp) { return decodeHtml(html.match(pattern)?.[1]?.trim() || '') }

function findBalancedJsonAt(source: string, start: number) {
  if (source[start] !== '{' && source[start] !== '[') return undefined
  const opening = source[start]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === opening) depth += 1
    else if (char === closing) {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return undefined
}

function parseJavaScriptString(source: string, start: number): { value: string; end: number } | undefined {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return undefined
  let end = start + 1
  let escaped = false
  for (; end < source.length; end += 1) {
    const char = source[end]
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
    else if (char === quote) break
  }
  if (end >= source.length) return undefined
  const literal = source.slice(start, end + 1)
  try {
    if (quote === '"') return { value: JSON.parse(literal), end: end + 1 }
    const content = literal.slice(1, -1)
    return {
      value: content.replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\\'"bnrtfv0]))/g, (_, unicode, hex, escape) => {
        if (unicode) return String.fromCodePoint(Number.parseInt(unicode, 16))
        if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
        return ({ b: '\b', n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', 0: '\0' } as Record<string, string>)[escape] || escape
      }),
      end: end + 1,
    }
  } catch { return undefined }
}

function parseEmbeddedJson(source: string) {
  try { return JSON.parse(source) as unknown } catch { /* 小红书状态对象可能包含 undefined */ }
  let normalized = ''
  let quoted = false
  let escaped = false
  for (let index = 0; index < source.length;) {
    const char = source[index]
    if (quoted) {
      normalized += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      index += 1
      continue
    }
    if (char === '"') { quoted = true; normalized += char; index += 1; continue }
    const unsupported = source.slice(index).match(/^-?Infinity\b|^(?:undefined|NaN)\b/)
    if (unsupported) { normalized += 'null'; index += unsupported[0].length; continue }
    normalized += char
    index += 1
  }
  try { return JSON.parse(normalized) as unknown } catch { return undefined }
}

function parseInitialStateExpression(source: string, start: number): unknown | undefined {
  const expression = source.slice(start).trimStart()
  if (expression.startsWith('{') || expression.startsWith('[')) {
    const json = findBalancedJsonAt(expression, 0)
    if (!json) return undefined
    return parseEmbeddedJson(json)
  }

  const match = expression.match(/^JSON\.parse\(\s*(decodeURIComponent\(\s*)?/)
  if (!match) return undefined
  const stringStart = match[0].length
  const stringLiteral = parseJavaScriptString(expression, stringStart)
  if (!stringLiteral) return undefined
  try { return parseEmbeddedJson(match[1] ? decodeURIComponent(stringLiteral.value) : stringLiteral.value) } catch { return undefined }
}

function parseJsonScripts(html: string) {
  const values: unknown[] = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = parseHtmlAttributes(`<script${match[1]}>`)
    const body = match[2].trim()
    if (attributes.type?.toLowerCase() === 'application/ld+json') {
      try { values.push(JSON.parse(body)) } catch { /* 页面常含非 JSON 脚本，忽略 */ }
    }
    if (attributes.id === '__INITIAL_STATE__' || attributes.id === '__NEXT_DATA__' || attributes.id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
      const state = parseInitialStateExpression(body, 0)
      if (state) values.push(state)
      else { try { values.push(JSON.parse(body)) } catch { /* 页面常含非 JSON 脚本，忽略 */ } }
    }
    if (attributes.id === 'RENDER_DATA') {
      try { values.push(JSON.parse(decodeURIComponent(body))) } catch { /* 抖音会把页面状态编码在此脚本中 */ }
    }

    for (const assignment of body.matchAll(/(?:window\.)?(?:__INITIAL_STATE__|__SSR_DATA__|_SSR_DATA|_ROUTER_DATA)\s*=\s*/g)) {
      const state = parseInitialStateExpression(body, assignment.index + assignment[0].length)
      if (state) values.push(state)
    }
  }
  return values
}

function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '' }
function numberValue(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : undefined }

function socialImageItems(record: Record<string, unknown>) {
  const raw = record.imageList || record.imagesList || record.images || record.image_list || record.imageInfoList
  if (Array.isArray(raw)) return raw
  return raw ? [raw] : []
}

function findSocialCandidates(value: unknown, candidates: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 15 || !value || typeof value !== 'object') return candidates
  if (Array.isArray(value)) {
    value.forEach((item) => findSocialCandidates(item, candidates, depth + 1))
    return candidates
  }
  const record = value as Record<string, unknown>
  const hasText = Boolean(stringValue(record.itemTitle || record.item_title || record.title) || stringValue(record.desc) || stringValue(record.description))
  const hasMedia = socialImageItems(record).length > 0 || Boolean(record.video || record.media)
  if (hasText && hasMedia) candidates.push(record)
  Object.values(record).forEach((child) => findSocialCandidates(child, candidates, depth + 1))
  return candidates
}

function xiaohongshuNoteId(url: string) {
  return url.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/i)?.[1] || ''
}

function socialCandidateScore(candidate: Record<string, unknown>, noteId: string) {
  const candidateId = stringValue(candidate.noteId || candidate.note_id || candidate.id)
  const metadata = asRecord(candidate.interactInfo || candidate.interact || candidate.statistics || candidate.stats)
  return socialImageItems(candidate).length * 100
    + (stringValue(candidate.title) ? 20 : 0)
    + (stringValue(candidate.desc || candidate.description) ? 10 : 0)
    + (asRecord(candidate.user || candidate.author || candidate.creator) ? 5 : 0)
    + (Array.isArray(candidate.tagList || candidate.tags || candidate.topics) ? 3 : 0)
    + (metadata ? 3 : 0)
    + (noteId && candidateId === noteId ? 10_000 : 0)
}

function mediaFrom(value: unknown): RemoteMediaRef | null {
  if (typeof value === 'string' && value.trim()) return { url: normalizeMediaUrl(value.trim()) }
  const record = asRecord(value)
  if (!record) return null
  const listedUrl = (Array.isArray(record.urlList) ? record.urlList : Array.isArray(record.url_list) ? record.url_list : []).map(stringValue).find(Boolean)
  const infoList = Array.isArray(record.infoList) ? record.infoList : Array.isArray(record.info_list) ? record.info_list : Array.isArray(record.urlInfoList) ? record.urlInfoList : []
  const nested = infoList
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item && stringValue(item.urlDefault || item.url || item.urlPre || item.urlPreload || item.src || item.fileUrl)))
    .sort((left, right) => mediaVariantScore(right) - mediaVariantScore(left))[0] || record
  const source = asRecord(nested) || record
  const url = stringValue(source.urlDefault || source.url || source.urlPre || source.urlPreload || source.src || source.fileUrl || source.originUrl || source.origin_url) || listedUrl
  if (!url) return null
  return { url: normalizeMediaUrl(url), mimeType: stringValue(source.mimeType || source.type) || undefined, width: numberValue(record.width || source.width), height: numberValue(record.height || source.height) }
}

function mediaVariantScore(value: Record<string, unknown>) {
  const scene = stringValue(value.imageScene || value.image_scene || value.scene)
  if (/(?:origin|default|dft)/i.test(scene)) return 3
  if (/(?:preview|prv|thumbnail|thumb)/i.test(scene)) return 1
  return 2
}

function videoMediaFrom(value: unknown): RemoteMediaRef | null {
  const candidates: Array<{ resource: RemoteMediaRef; score: number }> = []
  const seen = new Set<unknown>()
  const visit = (current: unknown, key = '', depth = 0, inherited?: { width?: number; height?: number }) => {
    if (depth > 10 || current === null || current === undefined || seen.has(current)) return
    if (typeof current === 'string') {
      const raw = current.trim()
      if (!raw || !/^(?:https?:)?\/\//i.test(raw)) return
      const lowerKey = key.toLowerCase()
      const lowerUrl = raw.toLowerCase()
      const looksLikeVideo = /(?:video|stream|master|play|h26|av1|url)/i.test(lowerKey)
        || /(?:\.mp4|\.m3u8|video|stream|vod|h26)(?:[/?#]|$)/i.test(lowerUrl)
      if (!looksLikeVideo) return
      candidates.push({
        resource: { url: normalizeMediaUrl(raw), mimeType: /\.m3u8(?:[?#]|$)/i.test(raw) ? 'application/vnd.apple.mpegurl' : 'video/mp4', ...inherited },
        score: (/master/i.test(lowerKey) ? 100 : 0) + (/h264/i.test(lowerKey) ? 40 : 0) + (/h265|hevc/i.test(lowerKey) ? 20 : 0) + (/\.mp4(?:[?#]|$)/i.test(raw) ? 30 : 0),
      })
      return
    }
    if (typeof current !== 'object') return
    seen.add(current)
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key, depth + 1, inherited))
      return
    }
    const record = current as Record<string, unknown>
    const dimensions = {
      width: numberValue(record.width || record.videoWidth || record.video_width) || inherited?.width,
      height: numberValue(record.height || record.videoHeight || record.video_height) || inherited?.height,
    }
    Object.entries(record).forEach(([childKey, child]) => visit(child, childKey, depth + 1, dimensions))
  }
  visit(value)
  return candidates.sort((left, right) => right.score - left.score)[0]?.resource || null
}

function normalizeMediaUrl(value: string) {
  if (value.startsWith('//')) return `https:${value}`
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' && /(?:^|\.)xhscdn\.(?:com|net)$/i.test(url.hostname)) url.protocol = 'https:'
    return url.toString()
  } catch { return value }
}

function livePhotoFrom(value: unknown): { image: RemoteMediaRef; motionVideo?: RemoteMediaRef } | null {
  const record = asRecord(value)
  if (!record) return null
  const image = mediaFrom(record.image || record.photo || record.imageInfo || record.imageUrl || record.cover || record.coverUrl || record.photoInfo)
  const motionVideo = mediaFrom(record.motionVideo || record.motion || record.video || record.videoInfo || record.videoUrl || record.motionVideoUrl || record.videoInfoList)
  return image ? { image, motionVideo: motionVideo || undefined } : null
}

function socialPublishedAt(candidate: Record<string, unknown>) {
  const raw = candidate.time || candidate.createTime || candidate.publishedAt || candidate.publishTime || candidate.lastUpdateTime || candidate.last_update_time
  const rawNumber = numberValue(raw)
  const date = rawNumber && rawNumber > 100_000_000
    ? new Date((rawNumber < 100_000_000_000 ? rawNumber * 1000 : rawNumber) + 8 * 60 * 60 * 1000)
    : undefined
  const dateText = date && !Number.isNaN(date.getTime())
    ? `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    : stringValue(raw)
  const location = stringValue(candidate.ipLocation || candidate.ip_location || candidate.location || candidate.ipLocationName)
  return [dateText, location].filter(Boolean).join(' ') || undefined
}

function socialBodyText(value: string, topics: string[]) {
  if (!value || topics.length === 0) return value
  const withoutTopicMarkup = value.replace(/#([^#\n]+?)\[话题\]#/g, '').replace(/#([^#\n]+?)#/g, (match, name) => topics.includes(name.trim()) ? '' : match)
  return withoutTopicMarkup.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

function parseSocialPage(url: string, html: string): { title: string; thumbnailUrl?: string; social?: SocialPayload } {
  const scripts = parseJsonScripts(html)
  const noteId = xiaohongshuNoteId(url)
  const candidate = scripts
    .flatMap((state) => findSocialCandidates(state))
    .sort((left, right) => socialCandidateScore(right, noteId) - socialCandidateScore(left, noteId))[0] || null
  const title = stringValue(candidate?.title) || firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '小红书内容'
  const thumbnailUrl = mediaFrom(candidate?.cover || candidate?.image || candidate?.coverUrl || candidate?.coverImage)?.url || firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || undefined
  if (!candidate) return { title, thumbnailUrl }
  const user = asRecord(candidate.user || candidate.author || candidate.creator)
  const authorName = stringValue(user?.nickname || user?.nickName || user?.name)
  const imagesRaw = socialImageItems(candidate)
  const topicValues = Array.isArray(candidate.tagList || candidate.tags || candidate.topics) ? (candidate.tagList || candidate.tags || candidate.topics) as unknown[] : []
  const topics = topicValues.map((item) => stringValue(asRecord(item)?.name || asRecord(item)?.tag || item)).filter(Boolean)
  const bodyText = socialBodyText(stringValue(candidate.desc || candidate.description || candidate.content || candidate.text), topics)
  const liveRaw = candidate.livePhoto || candidate.live_photo || candidate.livePhotos || candidate.live_photo_list || asRecord(candidate.media)?.livePhoto || asRecord(candidate.media)?.live_photo
  const livePhotos = (Array.isArray(liveRaw) ? liveRaw : liveRaw ? [liveRaw] : [])
    .map(livePhotoFrom)
    .filter((item): item is { image: RemoteMediaRef; motionVideo?: RemoteMediaRef } => Boolean(item))
  const liveImageUrls = new Set(livePhotos.map((item) => item.image.url))
  const images = imagesRaw.map(mediaFrom).filter((item): item is RemoteMediaRef => Boolean(item) && !liveImageUrls.has(item.url))
  const videoValue = candidate.video || asRecord(candidate.media)?.video || candidate.videoInfo || candidate.video_info
  const video = videoMediaFrom(videoValue) || mediaFrom(videoValue)
  const videoPoster = images[0] || mediaFrom(candidate.cover || candidate.image || candidate.coverUrl || candidate.coverImage)
  const blocks: SocialContentBlock[] = []
  if (bodyText) blocks.push({ type: 'text', text: bodyText })
  images.forEach((resource) => blocks.push({ type: 'image', resource }))
  livePhotos.forEach((item) => blocks.push({ type: 'live-photo', image: item.image, motionVideo: item.motionVideo }))
  if (video) {
    const filteredImages = blocks.filter((block) => block.type !== 'image')
    blocks.length = 0
    blocks.push(...filteredImages, { type: 'video', resource: video, poster: videoPoster || undefined })
  }
  topics.forEach((name) => blocks.push({ type: 'topic', name }))
  const interact = asRecord(candidate.interactInfo || candidate.interact || candidate.statistics || candidate.stats)
  const metrics = {
    likes: numberValue(candidate.likeCount || candidate.likedCount || candidate.likes || interact?.likeCount || interact?.likedCount || interact?.likes),
    collects: numberValue(candidate.collectCount || candidate.collectedCount || candidate.collects || interact?.collectCount || interact?.collectedCount || interact?.collects),
    comments: numberValue(candidate.commentCount || candidate.comments || interact?.commentCount || interact?.comments),
    shares: numberValue(candidate.shareCount || candidate.shares || interact?.shareCount || interact?.shares),
    capturedAt: new Date().toISOString(),
  }
  const hasMetric = Object.values(metrics).some((value) => value !== undefined && value !== metrics.capturedAt)
  const social: SocialPayload = {
    kind: 'social', platform: 'xiaohongshu', canonicalUrl: url, title, bodyText, contentBlocks: blocks,
    author: authorName ? { id: stringValue(user?.userId || user?.id) || undefined, name: authorName, avatarUrl: mediaFrom(user?.avatar || user?.avatarUrl)?.url, profileUrl: stringValue(user?.homeLink || user?.profileUrl) || undefined } : undefined,
    publishedAt: socialPublishedAt(candidate),
    metrics: hasMetric ? metrics : undefined,
    topics: topics.length ? topics : undefined,
  }
  return { title, thumbnailUrl: thumbnailUrl || images[0]?.url, social }
}

function hashtagTopics(value: string) {
  return [...new Set(Array.from(value.matchAll(/#([^#\s，。！？、]{1,40})/g), (match) => match[1].trim()).filter(Boolean))]
}

function douyinDescriptionMetadata(value: string) {
  const matched = value.match(/\s+-\s+([^\r\n]{1,80}?)于(\d{8})发布在抖音(?:，|,|。|$)/)
  if (!matched || matched.index === undefined) return { bodyText: value.trim(), authorName: '' }
  return {
    bodyText: value.slice(0, matched.index).trim(),
    authorName: matched[1].trim(),
  }
}

function parseDouyinPage(url: string, html: string): { title: string; thumbnailUrl?: string; social?: SocialPayload } {
  const targetVideoId = douyinVideoIdFromUrl(url) || douyinVideoIdFromHtml(html)
  const candidate = parseJsonScripts(html)
    .flatMap((state) => findSocialCandidates(state))
    .sort((left, right) => {
      const score = (record: Record<string, unknown>) => {
        const candidateId = stringValue(record.awemeId || record.aweme_id || record.groupId || record.group_id)
        return (targetVideoId && candidateId === targetVideoId ? 10_000 : 0)
        + (candidateId ? 200 : 0)
        + (stringValue(record.desc || record.description) ? 100 : 0)
        + (asRecord(record.author || record.authorInfo) ? 50 : 0)
        + (record.video ? 40 : 0)
        + socialImageItems(record).length * 10
      }
      return score(right) - score(left)
    })[0] || null
  const metaTitle = findMetaContent(html, ['og:title', 'twitter:title'])
  const documentTitle = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s*[-–—]\s*抖音\s*$/i, '')
  const metaDescription = findMetaContent(html, ['og:description', 'twitter:description', 'description'])
  const descriptionMetadata = douyinDescriptionMetadata(metaDescription)
  const metaImage = resolveRemoteUrl(findMetaContent(html, ['og:image', 'twitter:image']), url)
  const bodyText = stringValue(candidate?.desc || candidate?.description || candidate?.content || candidate?.text) || descriptionMetadata.bodyText
  const author = asRecord(candidate?.author || candidate?.authorInfo || candidate?.user || candidate?.creator)
  const authorName = stringValue(author?.nickname || author?.name || author?.uniqueId || author?.unique_id) || descriptionMetadata.authorName
  const imagesValue = candidate?.images || asRecord(candidate?.imagePostInfo || candidate?.image_post_info)?.images
  const images = (Array.isArray(imagesValue) ? imagesValue : imagesValue ? [imagesValue] : [])
    .map((item) => mediaFrom(asRecord(item)?.displayImage || asRecord(item)?.display_image || item))
    .filter((item): item is RemoteMediaRef => Boolean(item))
  const videoValue = candidate?.video || candidate?.videoInfo || candidate?.video_info
  const video = videoMediaFrom(videoValue) || mediaFrom(videoValue)
  const poster = mediaFrom(asRecord(videoValue)?.cover || asRecord(videoValue)?.dynamicCover || candidate?.cover) || images[0] || (metaImage ? { url: metaImage } : null)
  const title = stringValue(candidate?.itemTitle || candidate?.item_title || candidate?.title) || metaTitle || documentTitle || bodyText.split('\n')[0]?.slice(0, 80) || (authorName ? `${authorName}的抖音内容` : '抖音内容')
  if (!candidate && !bodyText && !metaTitle && !documentTitle) return { title: '抖音内容', thumbnailUrl: metaImage }
  const canonicalUrl = resolveRemoteUrl(findCanonicalHref(html), url) || url
  const topics = hashtagTopics(bodyText)
  const blocks: SocialContentBlock[] = []
  if (bodyText) blocks.push({ type: 'text', text: bodyText })
  images.forEach((resource) => blocks.push({ type: 'image', resource }))
  if (video) blocks.push({ type: 'video', resource: video, poster: poster || undefined })
  topics.forEach((name) => blocks.push({ type: 'topic', name }))
  const statistics = asRecord(candidate?.statistics || candidate?.stats)
  const metrics = {
    likes: numberValue(statistics?.diggCount || statistics?.digg_count || candidate?.diggCount),
    collects: numberValue(statistics?.collectCount || statistics?.collect_count || candidate?.collectCount),
    comments: numberValue(statistics?.commentCount || statistics?.comment_count || candidate?.commentCount),
    shares: numberValue(statistics?.shareCount || statistics?.share_count || candidate?.shareCount),
    capturedAt: new Date().toISOString(),
  }
  const hasMetric = Object.entries(metrics).some(([key, value]) => key !== 'capturedAt' && value !== undefined)
  return {
    title,
    thumbnailUrl: poster?.url || metaImage,
    social: {
      kind: 'social', platform: 'douyin', canonicalUrl, title, bodyText, contentBlocks: blocks,
      author: authorName ? { id: stringValue(author?.uid || author?.id || author?.secUid || author?.sec_uid) || undefined, name: authorName, avatarUrl: mediaFrom(author?.avatarThumb || author?.avatar_thumb || author?.avatar)?.url } : undefined,
      publishedAt: socialPublishedAt(candidate || {}),
      metrics: hasMetric ? metrics : undefined,
      topics: topics.length ? topics : undefined,
    },
  }
}

function instagramCaption(value: string) {
  const quoted = value.match(/:\s*["“]([\s\S]*?)["”]\s*$/)?.[1]
  return decodeHtml((quoted || value).trim())
}

function parseInstagramPage(url: string, html: string): { title: string; thumbnailUrl?: string; social?: SocialPayload } {
  const candidate = parseJsonScripts(html).map((state) => findNestedRecord(state, (record) => Boolean(record.edge_media_to_caption || record.caption) && Boolean(record.owner || record.user))).find(Boolean)
  const owner = asRecord(candidate?.owner || candidate?.user || candidate?.author)
  const captionEdges = asRecord(candidate?.edge_media_to_caption)?.edges
  const firstCaption = Array.isArray(captionEdges) ? asRecord(asRecord(captionEdges[0])?.node) : null
  const metaDescription = findMetaContent(html, ['og:description', 'twitter:description', 'description'])
  const bodyText = stringValue(firstCaption?.text || asRecord(candidate?.caption)?.text || candidate?.caption) || instagramCaption(metaDescription)
  const authorName = stringValue(owner?.username || owner?.full_name || owner?.name)
  const metaTitle = findMetaContent(html, ['og:title', 'twitter:title'])
  const title = stringValue(candidate?.title) || metaTitle || (authorName ? `${authorName}的 Instagram 内容` : 'Instagram 内容')
  const imageUrl = stringValue(candidate?.display_url || candidate?.thumbnail_src) || resolveRemoteUrl(findMetaContent(html, ['og:image', 'twitter:image']), url)
  const videoUrl = stringValue(candidate?.video_url) || resolveRemoteUrl(findMetaContent(html, ['og:video:secure_url', 'og:video']), url)
  if (!candidate && !metaTitle && !metaDescription && !imageUrl) return { title: 'Instagram 内容' }
  const topics = hashtagTopics(bodyText)
  const blocks: SocialContentBlock[] = []
  if (bodyText) blocks.push({ type: 'text', text: bodyText })
  if (videoUrl) blocks.push({ type: 'video', resource: { url: videoUrl, mimeType: 'video/mp4' }, poster: imageUrl ? { url: imageUrl } : undefined })
  else if (imageUrl) blocks.push({ type: 'image', resource: { url: imageUrl } })
  topics.forEach((name) => blocks.push({ type: 'topic', name }))
  const metrics = {
    likes: numberValue(asRecord(candidate?.edge_media_preview_like)?.count || asRecord(candidate?.edge_liked_by)?.count),
    comments: numberValue(asRecord(candidate?.edge_media_to_parent_comment)?.count || asRecord(candidate?.edge_media_to_comment)?.count),
    capturedAt: new Date().toISOString(),
  }
  const hasMetric = metrics.likes !== undefined || metrics.comments !== undefined
  return {
    title,
    thumbnailUrl: imageUrl,
    social: {
      kind: 'social', platform: 'instagram', canonicalUrl: url, title, bodyText, contentBlocks: blocks,
      author: authorName ? { id: stringValue(owner?.id) || undefined, name: authorName, avatarUrl: stringValue(owner?.profile_pic_url) || undefined } : undefined,
      publishedAt: socialPublishedAt(candidate || {}),
      metrics: hasMetric ? metrics : undefined,
      topics: topics.length ? topics : undefined,
    },
  }
}

function parseHtmlAttributes(tag: string) {
  const attributes: Record<string, string> = {}
  const source = tag.replace(/^<[a-z][\w:-]*\b/i, '').replace(/\/?\s*>$/, '')
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || '')
  }
  return attributes
}

function findMetaContent(html: string, keys: string[]) {
  const expected = new Set(keys.map((key) => key.toLowerCase()))
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0])
    const key = (attributes.property || attributes.name || attributes.itemprop || '').toLowerCase()
    if (expected.has(key) && attributes.content?.trim()) return attributes.content.trim()
  }
  return ''
}

function findCanonicalHref(html: string) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0])
    if (attributes.rel?.toLowerCase().split(/\s+/).includes('canonical') && attributes.href?.trim()) return attributes.href.trim()
  }
  return ''
}

function resolveRemoteUrl(value: string, baseUrl: string) {
  if (!value) return undefined
  try { return new URL(value, baseUrl).toString() } catch { return undefined }
}

function htmlFragmentToText(html: string) {
  return decodeHtml(
    html
      .replace(/<!--([\s\S]*?)-->/g, '')
      .replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/?(?:address|article|blockquote|div|figcaption|figure|h[1-6]|header|li|main|p|pre|section|table|tbody|td|th|thead|tr|ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\t\f\r ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

function stripNonContentElements(html: string) {
  return html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<(?:script|style|noscript|template|svg|canvas|iframe|object|embed|form|nav|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|canvas|iframe|object|embed|form|nav|footer|aside|dialog)>/gi, '')
}

function extractTagBlocks(html: string, tagName: string, predicate?: (attributes: Record<string, string>) => boolean) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\/${tagName}>`, 'gi')
  const blocks: string[] = []
  for (const match of html.matchAll(pattern)) {
    if (!predicate || predicate(parseHtmlAttributes(`<${tagName}${match[1]}>`))) blocks.push(match[2])
  }
  return blocks
}

function mainContentHtml(html: string) {
  const cleaned = stripNonContentElements(html)
  const candidates: Array<{ html: string; priority: number }> = [
    ...extractTagBlocks(cleaned, 'article').map((value) => ({ html: value, priority: 3 })),
    ...extractTagBlocks(cleaned, 'main').map((value) => ({ html: value, priority: 3 })),
    ...extractTagBlocks(cleaned, 'section', (attributes) => attributes.role?.toLowerCase() === 'main').map((value) => ({ html: value, priority: 2 })),
    ...extractTagBlocks(cleaned, 'div', (attributes) => {
      const selectorText = `${attributes.id || ''} ${attributes.class || ''} ${attributes.role || ''}`.toLowerCase()
      return attributes.role?.toLowerCase() === 'main' || /\b(?:article|content|entry|main|post|story)\b/.test(selectorText)
    }).map((value) => ({ html: value, priority: 1 })),
  ]

  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned
  const usable = candidates
    .map((candidate) => ({ ...candidate, text: htmlFragmentToText(candidate.html) }))
    // Prefer a real article or main region even when it is a short page. Less
    // semantic div candidates need more text before they outrank the body.
    .filter((candidate) => candidate.text.length >= (candidate.priority >= 2 ? 80 : 180))
    .sort((left, right) => {
      const priority = right.priority - left.priority
      if (priority) return priority
      return right.text.length - left.text.length
    })

  return usable[0]?.html || body
}

function htmlToText(html: string) {
  return htmlFragmentToText(mainContentHtml(html)).slice(0, MAX_EXTRACTED_TEXT_CHARS)
}

function documentTextFromState(value: unknown) {
  const candidates: string[] = []
  const seen = new Set<unknown>()
  const visit = (current: unknown, key = '', depth = 0): string[] => {
    if (depth > 18 || current === null || current === undefined) return []
    if (typeof current === 'string') {
      const text = decodeHtml(current).replace(/\r\n/g, '\n').trim()
      return /(?:text|content|title|heading|paragraph|body|value|name)/i.test(key) && text.length > 1 && !/^https?:\/\//i.test(text) ? [text] : []
    }
    if (typeof current !== 'object' || seen.has(current)) return []
    seen.add(current)
    if (Array.isArray(current)) return current.flatMap((item) => visit(item, key, depth + 1))
    const record = current as Record<string, unknown>
    const local = Object.entries(record)
      .filter(([childKey]) => !/(?:i18n|locale|translation|config|style|css|icon|url|token|id)$/i.test(childKey))
      .flatMap(([childKey, child]) => visit(child, childKey, depth + 1))
    if (/(?:block|document|doc|page|content|body|paragraph|text|heading|title)/i.test(key) && local.length) {
      const joined = [...new Set(local)].join('\n').trim()
      if (joined.length >= 20) candidates.push(joined)
    }
    return local
  }
  visit(value)
  return candidates.sort((left, right) => right.length - left.length)[0]?.slice(0, MAX_EXTRACTED_TEXT_CHARS) || ''
}

function feishuPageToken(url: string) {
  try { return new URL(url).pathname.match(/\/(?:docx|docs|wiki)\/([A-Za-z0-9_-]+)/i)?.[1] } catch { return undefined }
}

function feishuMetaCache(html: string, token: string) {
  const marker = `"${token}"`
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) return undefined
  const encryptedIndex = html.indexOf('"encrypted"', markerIndex + marker.length)
  if (encryptedIndex < 0 || encryptedIndex - markerIndex > 2_000) return undefined
  const separator = html.indexOf(':', encryptedIndex + '"encrypted"'.length)
  if (separator < 0) return undefined
  const valueOffset = html.slice(separator + 1).search(/["']/)
  if (valueOffset < 0) return undefined
  return parseJavaScriptString(html, separator + 1 + valueOffset)?.value
}

function feishuBlockText(block: Record<string, unknown>) {
  const data = asRecord(block.data) || block
  const type = stringValue(data.type).toLowerCase()
  if (!/^(?:page|text|heading\d*|bullet|ordered|todo|quote|callout|code|equation|table_cell)$/.test(type)) return ''
  const textRecord = asRecord(data.text)
  const initial = asRecord(textRecord?.initialAttributedTexts)
  const textMap = asRecord(initial?.text)
  if (textMap) {
    const text = Object.entries(textMap)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => stringValue(value))
      .join('')
      .trim()
    if (text) return text
  }
  return stringValue(data.text || data.title || data.name)
}

function parseFeishuClientVars(url: string, payload: unknown) {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  if (!root || numberValue(root.code) !== 0 || !data) {
    throw new ScrapeError('ACCESS_RESTRICTED', stringValue(root?.msg) || '飞书未返回可读取的公开文档数据', 403, false)
  }
  const blockMap = asRecord(data.block_map)
  const sequence = Array.isArray(data.block_sequence) ? data.block_sequence.map(stringValue).filter(Boolean) : []
  const pageId = stringValue(data.id) || feishuPageToken(url) || ''
  const content = sequence
    .filter((id) => id !== pageId)
    .map((id) => asRecord(blockMap?.[id]))
    .filter((block): block is Record<string, unknown> => Boolean(block))
    .map(feishuBlockText)
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS)
  const metaMap = asRecord(data.meta_map)
  const pageMeta = asRecord(metaMap?.[pageId])
  const title = stringValue(pageMeta?.title) || feishuBlockText(asRecord(blockMap?.[pageId]) || {}) || '飞书文档'
  if (!content) throw new ScrapeError('NO_READABLE_CONTENT', '飞书文档没有可提取的文本正文', 422, false)
  return { title, content, canonicalUrl: url }
}

async function fetchFeishuPage(url: string) {
  const cookieJar = new RedirectCookieJar()
  const result = await fetchLimited(url, MAX_HTML_BYTES, { headers: browserPageHeaders() }, cookieJar)
  const token = feishuPageToken(result.url) || feishuPageToken(url)
  const encrypted = token ? feishuMetaCache(result.body, token) : undefined
  if (token && encrypted) {
    const endpoint = new URL('/space/api/docx/pages/client_vars', result.url)
    endpoint.searchParams.set('id', token)
    endpoint.searchParams.set('mode', '7')
    endpoint.searchParams.set('limit', '239')
    const metadata = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: result.url,
        'User-Agent': browserPageHeaders()['User-Agent'],
        'ccm-meta': JSON.stringify({ [token]: encrypted }),
      },
    }, cookieJar)
    return parseFeishuClientVars(result.url, parseJsonResponse(metadata.body, '飞书文档'))
  }
  return parseFeishuPage(result.url, result.body)
}

function parseFeishuPage(url: string, html: string) {
  const title = findMetaContent(html, ['og:title', 'twitter:title']) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '飞书文档'
  const shellText = htmlToText(html)
  const embeddedText = parseJsonScripts(html).map(documentTextFromState).sort((left, right) => right.length - left.length)[0] || ''
  const restricted = /(?:登录飞书|扫码登录|sign in|log in|无权限|暂无权限|access denied)/i.test(shellText)
  const content = embeddedText.length > shellText.length ? embeddedText : shellText
  if (restricted && content.length < 80) throw new ScrapeError('ACCESS_RESTRICTED', '飞书文档未公开分享或需要登录后访问', 403, false)
  if (!content || /^(?:飞书|Feishu|Lark)$/i.test(content.trim())) throw new ScrapeError('NO_READABLE_CONTENT', '未能读取飞书文档正文，请确认已开启公开分享', 422, false)
  return {
    title,
    content,
    canonicalUrl: resolveRemoteUrl(findCanonicalHref(html), url) || url,
    thumbnailUrl: resolveRemoteUrl(findMetaContent(html, ['og:image', 'twitter:image']), url),
  }
}

function hostMatches(hostname: string, ...domains: string[]) {
  const host = hostname.toLowerCase()
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function secureRemoteUrl(value: unknown) {
  const url = stringValue(value)
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url || undefined
}

function parseJsonResponse<T>(body: string, subject: string): T {
  try { return JSON.parse(body) as T } catch {
    throw new ScrapeError('UPSTREAM_ERROR', `${subject}元数据响应解析失败`, 502, true)
  }
}

function extractBilibiliVideoId(url: string) {
  const match = new URL(url).pathname.match(/\/video\/(BV[0-9A-Za-z]{10}|av\d+)/i)
  return match?.[1]
}

async function fetchBilibiliMetadata(url: string): Promise<WebContent> {
  const videoId = extractBilibiliVideoId(url)
  if (!videoId) throw new ScrapeError('INVALID_CONTENT', '无法识别 Bilibili 视频 ID', 400, false)
  const endpoint = new URL('https://api.bilibili.com/x/web-interface/view')
  endpoint.searchParams.set(videoId.toLowerCase().startsWith('av') ? 'aid' : 'bvid', videoId.replace(/^av/i, ''))
  const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
  })
  const payload = parseJsonResponse<{ code?: number; message?: string; data?: Record<string, unknown> }>(result.body, 'Bilibili')
  if (payload.code !== 0 || !payload.data) {
    const notFound = payload.code === -404
    throw new ScrapeError(notFound ? 'CONTENT_NOT_FOUND' : 'UPSTREAM_ERROR', stringValue(payload.message) || 'Bilibili 未返回视频元数据', notFound ? 404 : 502, !notFound)
  }
  const data = payload.data
  const owner = asRecord(data.owner)
  const dimension = asRecord(data.dimension)
  const title = stringValue(data.title) || videoId
  const description = stringValue(data.desc)
  return {
    title,
    content: description === '-' ? '' : description,
    canonicalUrl: `https://www.bilibili.com/video/${encodeURIComponent(videoId)}/`,
    thumbnailUrl: secureRemoteUrl(data.pic),
    authorName: stringValue(owner?.name) || undefined,
    duration: numberValue(data.duration),
    width: numberValue(dimension?.width),
    height: numberValue(dimension?.height),
  }
}

function extractVimeoVideoId(url: string) {
  const pathSegments = new URL(url).pathname.split('/').filter(Boolean)
  return pathSegments.find((segment) => /^\d+$/.test(segment))
}

function vimeoConfigMetadata(payload: Record<string, unknown>, videoId: string): WebContent | undefined {
  const video = asRecord(payload.video)
  if (!video) return undefined
  const owner = asRecord(video.owner)
  const thumbs = asRecord(video.thumbs)
  const thumbnail = thumbs
    ? Object.entries(thumbs).sort(([left], [right]) => Number(right) - Number(left)).map(([, value]) => stringValue(value)).find(Boolean)
    : ''
  const title = stringValue(video.title)
  if (!title) return undefined
  return {
    title,
    content: '',
    canonicalUrl: `https://vimeo.com/${videoId}`,
    thumbnailUrl: secureRemoteUrl(thumbnail),
    authorName: stringValue(owner?.name) || undefined,
    duration: numberValue(video.duration),
    width: numberValue(video.width),
    height: numberValue(video.height),
  }
}

async function fetchVimeoMetadata(url: string): Promise<WebContent> {
  const videoId = extractVimeoVideoId(url)
  if (!videoId) throw new ScrapeError('INVALID_CONTENT', '无法识别 Vimeo 视频 ID', 400, false)
  const headers = {
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://vimeo.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  }
  let firstError: unknown
  try {
    const result = await fetchLimited(`https://vimeo.com/api/v2/video/${encodeURIComponent(videoId)}.json`, MAX_TEXT_BYTES, { headers })
    const payload = parseJsonResponse<Array<Record<string, unknown>>>(result.body, 'Vimeo')
    const video = payload[0]
    const title = stringValue(video?.title)
    if (video && title) {
      return {
        title,
        content: htmlFragmentToText(stringValue(video.description)),
        canonicalUrl: stringValue(video.url) || `https://vimeo.com/${videoId}`,
        thumbnailUrl: secureRemoteUrl(video.thumbnail_large || video.thumbnail_medium || video.thumbnail_small),
        authorName: stringValue(video.user_name) || undefined,
        duration: numberValue(video.duration),
        width: numberValue(video.width),
        height: numberValue(video.height),
      }
    }
  } catch (error) { firstError = error }

  try {
    const result = await fetchLimited(`https://player.vimeo.com/video/${encodeURIComponent(videoId)}/config`, MAX_TEXT_BYTES, { headers })
    const metadata = vimeoConfigMetadata(parseJsonResponse<Record<string, unknown>>(result.body, 'Vimeo'), videoId)
    if (metadata) return metadata
  } catch (error) {
    if (!firstError) firstError = error
  }
  if (firstError instanceof ScrapeError) throw firstError
  throw new ScrapeError('NO_READABLE_CONTENT', '无法读取 Vimeo 视频元数据', 422, true)
}

function looksLikeAccessChallengePage(title: string, content: string) {
  const sample = `${title}\n${content.slice(0, 2_000)}`.toLowerCase()
  const explicitPhrases = [
    'verify to continue',
    'confirm that you\'re a human',
    'confirm that you are a human',
    'not a spambot',
    'checking if the site connection is secure',
    'needs to review the security of your connection',
    '人机验证',
    '安全验证',
  ]
  if (explicitPhrases.some((phrase) => sample.includes(phrase))) return true
  const genericSignals = ['captcha', 'challenge-platform', 'cf-chl-', 'access denied', 'security check']
  return genericSignals.filter((signal) => sample.includes(signal)).length >= 2
}

function isHtmlContentType(contentType: string) {
  return /(?:^|\s|;)text\/html(?:;|$)|application\/xhtml\+xml/i.test(contentType)
}

function isPlainTextContentType(contentType: string) {
  return /(?:^|\s|;)text\/plain(?:;|$)/i.test(contentType)
}

function looksLikeHtml(value: string) {
  return /^\s*<!doctype\s+html|^\s*<html\b|^\s*<body\b/i.test(value)
}

function isXiaohongshuHost(hostname: string) {
  return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com') || hostname === 'xhslink.com' || hostname.endsWith('.xhslink.com')
}

function isDouyinHost(hostname: string) {
  return hostMatches(hostname, 'douyin.com', 'iesdouyin.com')
}

function douyinVideoIdFromUrl(value: string) {
  try {
    const target = new URL(value)
    const queryId = target.searchParams.get('modal_id') || target.searchParams.get('aweme_id') || target.searchParams.get('video_id')
    if (queryId && /^\d{12,24}$/.test(queryId)) return queryId
    return target.pathname.match(/\/(?:video|note|share\/(?:video|note))\/(\d{12,24})(?:\/|$)/i)?.[1] || ''
  } catch { return '' }
}

function douyinVideoIdFromHtml(html: string) {
  const patterns = [
    /["'](?:aweme_id|awemeId|video_id|videoId|modal_id)["']\s*:\s*["']?(\d{12,24})/i,
    /(?:aweme_id|video_id|modal_id)(?:%3D|=)(\d{12,24})/i,
    /\/(?:video|note|share\/(?:video|note))\/(\d{12,24})(?:[/?#"']|$)/i,
  ]
  return patterns.map((pattern) => html.match(pattern)?.[1] || '').find(Boolean) || ''
}

function usefulDouyinSocial(social: SocialPayload | undefined) {
  if (!social) return false
  return Boolean(
    social.bodyText.trim()
    || social.author?.name
    || social.contentBlocks.some((block) => block.type === 'image' || block.type === 'video' || block.type === 'live-photo'),
  )
}

function douyinCanonicalUrl(id: string, urls: string[]) {
  const isNote = urls.some((value) => {
    try { return new URL(value).pathname.includes(`/note/${id}`) } catch { return false }
  })
  return `https://www.douyin.com/${isNote ? 'note' : 'video'}/${id}`
}

function isInstagramHost(hostname: string) {
  return hostMatches(hostname, 'instagram.com')
}

function isFeishuHost(hostname: string) {
  return hostMatches(hostname, 'feishu.cn', 'larksuite.com')
}

function browserPageHeaders(language = 'zh-CN,zh;q=0.9,en;q=0.8') {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': language,
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }
}

function douyinMobilePageHeaders() {
  return {
    ...browserPageHeaders(),
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36',
  }
}

async function fetchDouyinContent(url: string): Promise<WebContent> {
  const headers = browserPageHeaders()
  const discoveredUrls = [url]
  let videoId = douyinVideoIdFromUrl(url)
  let initialResult: Awaited<ReturnType<typeof fetchLimited>> | undefined
  let lastError: unknown
  let bestResult: WebContent | undefined

  const originalTarget = new URL(url)
  const shouldInspectOriginal = !videoId || /\/(?:jingxuan|note(?:\/|$))/.test(originalTarget.pathname) || hostMatches(originalTarget.hostname, 'v.douyin.com')
  if (shouldInspectOriginal) {
    try {
      initialResult = await fetchLimited(url, MAX_HTML_BYTES, { headers })
      discoveredUrls.push(...initialResult.redirects, initialResult.url)
      videoId = discoveredUrls.map(douyinVideoIdFromUrl).find(Boolean) || douyinVideoIdFromHtml(initialResult.body)
      const parsed = parseDouyinPage(initialResult.url, initialResult.body)
      const canonicalUrl = videoId ? douyinCanonicalUrl(videoId, discoveredUrls) : parsed.social?.canonicalUrl || initialResult.url
      if (parsed.social) parsed.social.canonicalUrl = canonicalUrl
      bestResult = { title: parsed.title, content: parsed.social?.bodyText || '', canonicalUrl, thumbnailUrl: parsed.thumbnailUrl, social: parsed.social }
      if (usefulDouyinSocial(parsed.social)) return bestResult
    } catch (error) { lastError = error }
  }

  const noteUrl = videoId ? discoveredUrls.find((value) => {
    try { return new URL(value).pathname.includes(`/note/${videoId}`) } catch { return false }
  }) : undefined
  const targets = [
    ...(noteUrl ? [noteUrl] : []),
    ...(videoId && noteUrl ? [`https://www.douyin.com/share/note/${videoId}`] : []),
    ...(videoId ? [`https://www.douyin.com/video/${videoId}`, `https://www.douyin.com/share/video/${videoId}`, `https://www.iesdouyin.com/share/video/${videoId}/`] : []),
    url,
  ].filter((target, index, values) => values.indexOf(target) === index && target !== initialResult?.url)

  for (const target of targets) {
    try {
      const targetHeaders = /\/share\/(?:note|video)\//i.test(new URL(target).pathname) ? douyinMobilePageHeaders() : headers
      const result = await fetchLimited(target, MAX_HTML_BYTES, { headers: targetHeaders })
      discoveredUrls.push(...result.redirects, result.url)
      videoId ||= discoveredUrls.map(douyinVideoIdFromUrl).find(Boolean) || douyinVideoIdFromHtml(result.body)
      const parsed = parseDouyinPage(result.url, result.body)
      const canonicalUrl = videoId ? douyinCanonicalUrl(videoId, discoveredUrls) : parsed.social?.canonicalUrl || result.url
      if (parsed.social) parsed.social.canonicalUrl = canonicalUrl
      const candidate: WebContent = {
        title: parsed.title,
        content: parsed.social?.bodyText || '',
        canonicalUrl,
        thumbnailUrl: parsed.thumbnailUrl,
        social: parsed.social,
      }
      if (!bestResult || candidate.content.length > bestResult.content.length || candidate.social?.contentBlocks.length > (bestResult.social?.contentBlocks.length || 0)) bestResult = candidate
      if (usefulDouyinSocial(parsed.social)) return candidate
    } catch (error) { lastError = error }
  }

  if (bestResult && usefulDouyinSocial(bestResult.social)) return bestResult
  if (lastError instanceof ScrapeError && !videoId) throw lastError
  throw new ScrapeError('NO_READABLE_CONTENT', videoId
    ? '已识别抖音作品 ID，但未能读取公开正文；上游可能返回了安全验证页'
    : '无法从抖音短链或精选页识别作品 ID', 422, true)
}

function isXiaohongshuMediaHost(hostname: string) {
  return /(?:^|\.)xhscdn\.(?:com|net)$/i.test(hostname)
}

async function fetchMediaLimited(rawUrl: string, range?: string | null) {
  let target: URL
  try { target = new URL(rawUrl) } catch { throw new ScrapeError('INVALID_URL', '图片 URL 格式无效', 400, false) }
  if (!['http:', 'https:'].includes(target.protocol) || !isXiaohongshuMediaHost(target.hostname)) {
    throw new ScrapeError('MEDIA_URL_REJECTED', '仅支持小红书图片地址', 400, false)
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(target.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'video/mp4,video/*;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: 'https://www.xiaohongshu.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          ...(range ? { Range: range } : {}),
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new ScrapeError('FETCH_TIMEOUT', '图片请求超时', 504, true)
      throw new ScrapeError('UPSTREAM_ERROR', '无法访问小红书图片', 502, true)
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new ScrapeError('UPSTREAM_ERROR', '图片重定向缺少目标地址', 502, true)
      if (redirect === MAX_REDIRECTS) throw new ScrapeError('TOO_MANY_REDIRECTS', '图片重定向次数过多', 502, true)
      const next = new URL(location, target)
      if (!isXiaohongshuMediaHost(next.hostname)) throw new ScrapeError('MEDIA_URL_REJECTED', '图片重定向目标不是小红书图片地址', 400, false)
      target = next
      continue
    }
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) throw new ScrapeError('CONTENT_NOT_FOUND', '图片不存在或已失效', response.status, false)
      if (response.status === 429) throw new ScrapeError('RATE_LIMITED', '图片请求频率受限，请稍后重试', 429, true)
      throw new ScrapeError('UPSTREAM_ERROR', `图片上游返回 HTTP ${response.status}`, 502, true)
    }
    const declared = Number(response.headers.get('content-length') || 0)
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const isVideo = /^video\//i.test(contentType) || /\.mp4(?:[?#]|$)/i.test(target.toString())
    if (isVideo) {
      return {
        response,
        contentType,
        contentLength: response.headers.get('content-length'),
        contentRange: response.headers.get('content-range'),
        acceptRanges: response.headers.get('accept-ranges'),
      }
    }
    if (declared > MAX_MEDIA_BYTES) throw new ScrapeError('RESPONSE_TOO_LARGE', '图片超过大小限制', 413, false)
    if (!response.body) throw new ScrapeError('EMPTY_RESPONSE', '图片响应为空', 502, true)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > MAX_MEDIA_BYTES) {
          await reader.cancel()
          throw new ScrapeError('RESPONSE_TOO_LARGE', '图片超过大小限制', 413, false)
        }
        chunks.push(next.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return { bytes, contentType }
  }
  throw new ScrapeError('TOO_MANY_REDIRECTS', '图片重定向次数过多', 502, true)
}

async function fetchWebContent(url: string): Promise<WebContent> {
  const requestedHost = validateTarget(url).hostname.toLowerCase()
  if (hostMatches(requestedHost, 'bilibili.com')) return fetchBilibiliMetadata(url)
  if (hostMatches(requestedHost, 'vimeo.com')) return fetchVimeoMetadata(url)
  if (isDouyinHost(requestedHost)) return fetchDouyinContent(url)
  if (isFeishuHost(requestedHost)) return fetchFeishuPage(url)
  const platformRequest = isXiaohongshuHost(requestedHost) || isDouyinHost(requestedHost) || isInstagramHost(requestedHost) || isFeishuHost(requestedHost)
  let result = await fetchLimited(url, MAX_HTML_BYTES, {
    headers: platformRequest ? browserPageHeaders(isInstagramHost(requestedHost) ? 'en-US,en;q=0.9' : undefined) : { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  })
  if (isInstagramHost(requestedHost) && /update your browser|browser that isn.t supported/i.test(result.body)) {
    const target = new URL(result.url)
    if (/\/(?:p|reel|tv)\//i.test(target.pathname) && !/\/embed(?:\/captioned)?\/?$/i.test(target.pathname)) {
      target.pathname = `${target.pathname.replace(/\/+$/, '')}/embed/captioned/`
      result = await fetchLimited(target.toString(), MAX_HTML_BYTES, { headers: browserPageHeaders('en-US,en;q=0.9') })
    }
  }
  const finalUrl = result.url
  const contentType = result.response.headers.get('content-type') || ''
  const isHtml = isHtmlContentType(contentType) || (!contentType && looksLikeHtml(result.body))
  const isPlainText = isPlainTextContentType(contentType) || (!contentType && !isHtml)
  if (!isHtml && !isPlainText) {
    throw new ScrapeError('UNSUPPORTED_CONTENT_TYPE', '当前内容解析服务仅支持 HTML 和纯文本网页', 415, false)
  }

  if (isPlainText) {
    const content = result.body.replace(/\r\n/g, '\n').trim().slice(0, MAX_EXTRACTED_TEXT_CHARS)
    if (!content) throw new ScrapeError('NO_READABLE_CONTENT', '网页没有可供提取的文本内容', 422, false)
    return { title: new URL(finalUrl).hostname, content, canonicalUrl: finalUrl }
  }

  const hostname = new URL(finalUrl).hostname.toLowerCase()
  if (isXiaohongshuHost(hostname)) {
    const social = parseSocialPage(finalUrl, result.body)
    return { title: social.title, content: social.social ? social.social.bodyText : htmlToText(result.body), canonicalUrl: finalUrl, thumbnailUrl: social.thumbnailUrl, social: social.social }
  }
  if (isInstagramHost(hostname) || isInstagramHost(requestedHost)) {
    const social = parseInstagramPage(finalUrl, result.body)
    if (!social.social) throw new ScrapeError('ACCESS_RESTRICTED', 'Instagram 内容未公开或需要登录后访问', 403, false)
    return { title: social.title, content: social.social.bodyText, canonicalUrl: finalUrl, thumbnailUrl: social.thumbnailUrl, social: social.social }
  }
  const content = htmlToText(result.body)
  const title = findMetaContent(result.body, ['og:title', 'twitter:title']) || firstMatch(result.body, /<title[^>]*>([\s\S]*?)<\/title>/i) || new URL(finalUrl).hostname
  if (looksLikeAccessChallengePage(title, content)) throw new ScrapeError('UPSTREAM_CHALLENGE', '上游站点返回了人机验证页，未将其作为内容导入', 502, true)
  if (!content) throw new ScrapeError('NO_READABLE_CONTENT', '网页没有可供提取的正文内容', 422, false)
  const canonicalUrl = resolveRemoteUrl(findCanonicalHref(result.body), finalUrl) || finalUrl
  const thumbnailUrl = resolveRemoteUrl(findMetaContent(result.body, ['og:image', 'twitter:image']), finalUrl)
  return { title, content, canonicalUrl, thumbnailUrl }
}

async function fetchYouTubeMetadata(videoId: string): Promise<YouTubeMetadata> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
  let lastError: unknown
  for (const metadataEndpoint of [endpoint, `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`]) {
    try {
      const result = await fetchLimited(metadataEndpoint, MAX_TEXT_BYTES, { headers: { Accept: 'application/json' } })
      const payload = JSON.parse(result.body) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown }
      const title = stringValue(payload.title)
      if (title) return { title, authorName: stringValue(payload.author_name) || undefined, thumbnailUrl: stringValue(payload.thumbnail_url) || undefined }
    } catch (error) { lastError = error }
  }
  try {
    const { page, player } = await fetchYouTubePlayerBundle(videoId)
    const details = findNestedRecord(player, (record) => Boolean(record.videoDetails))?.videoDetails as Record<string, unknown> | undefined
    const pageBody = page?.body || ''
    const title = stringValue(details?.title) || findMetaContent(pageBody, ['og:title', 'twitter:title']) || firstMatch(pageBody, /<title[^>]*>([\s\S]*?)<\/title>/i)
    if (title) return { title, authorName: stringValue(details?.author) || undefined, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }
  } catch (error) { lastError = error }
  if (lastError instanceof ScrapeError) throw lastError
  throw new ScrapeError('NO_READABLE_CONTENT', '无法读取 YouTube 视频标题', 422, true)
}

interface YouTubeCaptionTrack {
  languageCode?: string
  name?: string
  kind?: string
  baseUrl?: string
}

function findBalancedJsonAfterMarker(source: string, marker: string) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return undefined
  const start = source.indexOf('{', markerIndex + marker.length)
  if (start < 0) return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return undefined
}

function findNestedRecord(value: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedRecord(item, predicate)
      if (found) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  if (predicate(record)) return record
  for (const child of Object.values(record)) {
    const found = findNestedRecord(child, predicate)
    if (found) return found
  }
  return undefined
}

function parseYouTubePlayerResponse(html: string) {
  for (const marker of ['ytInitialPlayerResponse =', 'var ytInitialPlayerResponse =', 'playerResponse =']) {
    const json = findBalancedJsonAfterMarker(html, marker)
    if (!json) continue
    try { return JSON.parse(json) as Record<string, unknown> } catch { /* continue */ }
  }
  return undefined
}

async function fetchYouTubeWatchPage(videoId: string) {
  const endpoints = [
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?hl=zh-CN`,
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=zh-CN`,
  ]
  let lastError: unknown
  for (const endpoint of endpoints) {
    try {
      return await fetchLimited(endpoint, MAX_HTML_BYTES, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' } })
    } catch (error) { lastError = error }
  }
  if (lastError) throw lastError
  throw new ScrapeError('UPSTREAM_ERROR', '无法访问 YouTube 视频页面', 502, true)
}

async function fetchYouTubeAndroidPlayer(videoId: string) {
  const endpoint = new URL('https://www.youtube.com/youtubei/v1/player')
  endpoint.searchParams.set('prettyPrint', 'false')
  const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `com.google.android.youtube/${YOUTUBE_ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`,
      'X-Youtube-Client-Name': '3',
      'X-Youtube-Client-Version': YOUTUBE_ANDROID_CLIENT_VERSION,
    },
    body: JSON.stringify({
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: YOUTUBE_ANDROID_CLIENT_VERSION,
          hl: 'zh-CN',
          gl: 'US',
        },
      },
    }),
  })
  try {
    return JSON.parse(result.body) as Record<string, unknown>
  } catch {
    throw new ScrapeError('UPSTREAM_ERROR', 'YouTube 播放器响应解析失败', 502, true)
  }
}

async function fetchYouTubePlayerBundle(videoId: string) {
  // YouTube's legacy timedtext list and WEB_EMBEDDED_PLAYER paths can still
  // expose caption tracks whose bodies are empty. The Android player response
  // currently supplies usable signed srv3 tracks without a signed-in session.
  try {
    const androidPlayer = await fetchYouTubeAndroidPlayer(videoId)
    const hasAndroidDetails = Boolean(findNestedRecord(androidPlayer, (record) => Boolean(record.videoDetails)))
    const hasAndroidCaptions = Boolean(findNestedRecord(androidPlayer, (record) => Array.isArray(record.captionTracks)))
    if (hasAndroidDetails || hasAndroidCaptions) return { page: undefined, player: androidPlayer }
  } catch {
    // Keep the web embedded player as a compatibility fallback.
  }

  const page = await fetchYouTubeWatchPage(videoId)
  const embeddedPlayer = parseYouTubePlayerResponse(page.body)
  const hasDetails = Boolean(findNestedRecord(embeddedPlayer, (record) => Boolean(record.videoDetails)))
  const hasCaptions = Boolean(findNestedRecord(embeddedPlayer, (record) => Array.isArray(record.captionTracks)))
  if (hasDetails && hasCaptions) return { page, player: embeddedPlayer }

  const apiKey = firstMatch(page.body, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)
  const clientVersion = firstMatch(page.body, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)
  if (!apiKey || !clientVersion) return { page, player: embeddedPlayer }
  const endpoint = new URL('https://www.youtube.com/youtubei/v1/player')
  endpoint.searchParams.set('key', apiKey)
  try {
    const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.youtube-nocookie.com',
        Referer: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
        'X-Youtube-Client-Name': '56',
        'X-Youtube-Client-Version': clientVersion,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion, clientScreen: 'EMBED', hl: 'zh-CN', gl: 'US' },
          thirdParty: { embedUrl: 'https://cnote.local/' },
        },
      }),
    })
    return { page, player: JSON.parse(result.body) as Record<string, unknown> }
  } catch {
    return { page, player: embeddedPlayer }
  }
}

function chooseYouTubeCaptionTrack(tracks: YouTubeCaptionTrack[]) {
  return tracks.find((track) => /^zh(?:-|$)/i.test(track.languageCode || ''))
    || tracks.find((track) => /^en(?:-|$)/i.test(track.languageCode || ''))
    || tracks[0]
}

function parseYouTubeTranscript(body: string) {
  const xmlSegments = Array.from(
    body.matchAll(/<(text|p|s)\b[^>]*>([\s\S]*?)<\/\1>/g),
    (match) => htmlFragmentToText(match[2]),
  ).filter(Boolean)
  if (xmlSegments.length) return xmlSegments.join('\n')

  try {
    const payload = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> }
    return (payload.events || [])
      .map((event) => (event.segs || []).map((segment) => segment.utf8 || '').join(''))
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

async function fetchYouTubeTrackText(track: YouTubeCaptionTrack, videoId: string) {
  let trackUrl = track.baseUrl
  if (!trackUrl && track.languageCode) {
    const endpoint = new URL('https://www.youtube.com/api/timedtext')
    endpoint.searchParams.set('v', videoId)
    endpoint.searchParams.set('lang', track.languageCode)
    if (track.name) endpoint.searchParams.set('name', track.name)
    if (track.kind) endpoint.searchParams.set('kind', track.kind)
    trackUrl = endpoint.toString()
  }
  if (!trackUrl) return ''
  const subtitles = await fetchLimited(trackUrl, MAX_TEXT_BYTES, {
    headers: { Accept: 'application/json,text/xml,application/xml,text/plain;q=0.9,*/*;q=0.5' },
  })
  return parseYouTubeTranscript(subtitles.body)
}

async function fetchYouTubeTimedTextTracks(videoId: string) {
  const endpoint = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`
  const result = await fetchLimited(endpoint, MAX_TEXT_BYTES, { headers: { Accept: 'text/xml,application/xml,text/plain;q=0.9,*/*;q=0.5' } })
  return Array.from(result.body.matchAll(/<track\b[^>]*\/?>/gi), (match) => {
    const attributes = parseHtmlAttributes(match[0])
    return {
      languageCode: attributes.lang_code || attributes.lang,
      name: attributes.name,
      kind: attributes.kind,
    } satisfies YouTubeCaptionTrack
  }).filter((track) => track.languageCode)
}

async function fetchYouTubeWatchTracks(videoId: string) {
  const { page, player } = await fetchYouTubePlayerBundle(videoId)
  const captionRecord = findNestedRecord(player, (record) => Array.isArray(record.captionTracks))
  if (captionRecord?.captionTracks && Array.isArray(captionRecord.captionTracks)) return captionRecord.captionTracks as YouTubeCaptionTrack[]
  const captionMatch = page?.body.match(/"captionTracks":\s*(\[[\s\S]*?\])/)
  if (!captionMatch) return []
  try { return JSON.parse(captionMatch[1]) as YouTubeCaptionTrack[] } catch { throw new ScrapeError('UPSTREAM_ERROR', 'YouTube 字幕信息解析失败', 502, true) }
}

async function fetchYouTubeSubtitles(videoId: string): Promise<{ subtitles: string; warning?: string }> {
  let timedTextError: unknown
  try {
    const tracks = await fetchYouTubeTimedTextTracks(videoId)
    const track = chooseYouTubeCaptionTrack(tracks)
    if (track) {
      const subtitles = await fetchYouTubeTrackText(track, videoId)
      if (subtitles) return { subtitles }
    }
  } catch (error) {
    timedTextError = error
  }

  try {
    const tracks = await fetchYouTubeWatchTracks(videoId)
    const track = chooseYouTubeCaptionTrack(tracks)
    if (!track) {
      if (timedTextError instanceof ScrapeError && timedTextError.code === 'RATE_LIMITED') throw timedTextError
      return { subtitles: '', warning: '该 YouTube 视频没有可用字幕，已保留视频元数据。' }
    }
    const subtitles = await fetchYouTubeTrackText(track, videoId)
    return subtitles
      ? { subtitles }
      : (() => { throw new ScrapeError('UPSTREAM_ERROR', 'YouTube 返回了字幕轨道，但字幕正文为空，请稍后重试。', 502, true) })()
  } catch (error) {
    if (error instanceof ScrapeError && error.code === 'RATE_LIMITED' && timedTextError instanceof ScrapeError) throw timedTextError
    throw error
  }
}

function scrapeErrorShape(error: unknown): ScrapeErrorShape {
  return error instanceof ScrapeError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: 'UPSTREAM_ERROR', message: 'YouTube 字幕获取失败', retryable: true }
}

async function fetchYouTubeContent(videoId: string): Promise<YouTubeTranscriptResult> {
  const [metadataResult, transcriptResult] = await Promise.allSettled([
    fetchYouTubeMetadata(videoId),
    fetchYouTubeSubtitles(videoId),
  ])
  const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : {}
  if (transcriptResult.status === 'fulfilled') return { ...metadata, ...transcriptResult.value }
  return { ...metadata, subtitles: '', transcriptError: scrapeErrorShape(transcriptResult.reason) }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const url = new URL(request.url)
    try {
      assertRequestAccess(request, env)
      if (url.pathname === '/v1/health') return new Response(JSON.stringify({ ...SERVICE_INFO, timestamp: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } })
      if (url.pathname === '/health') return new Response(JSON.stringify({ status: 'ok', version: SERVICE_INFO.version, timestamp: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } })

      if (url.pathname === '/v1/media/xiaohongshu' && request.method === 'GET') {
        const sourceUrl = url.searchParams.get('url') || ''
        const media = await fetchMediaLimited(sourceUrl, request.headers.get('Range'))
        if ('response' in media) {
          return new Response(media.response.body, {
            status: media.response.status,
            headers: {
              'Content-Type': media.contentType,
              ...(media.contentLength ? { 'Content-Length': media.contentLength } : {}),
              ...(media.contentRange ? { 'Content-Range': media.contentRange } : {}),
              'Accept-Ranges': media.acceptRanges || 'bytes',
              'Cache-Control': 'public, max-age=3600',
              ...corsHeaders(request, env),
            },
          })
        }
        return new Response(media.bytes, {
          headers: {
            'Content-Type': media.contentType,
            'Cache-Control': 'public, max-age=3600',
            ...corsHeaders(request, env),
          },
        })
      }

      const versionedYouTubeMatch = url.pathname.match(/^\/v1\/youtube\/([^/]+)\/transcript$/)
      if (versionedYouTubeMatch || url.pathname.startsWith('/youtube/')) {
        if (request.method !== 'GET') return new Response(JSON.stringify({ code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET', retryable: false }), { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } })
        const videoId = decodeURIComponent(versionedYouTubeMatch?.[1] || url.pathname.slice('/youtube/'.length)).trim()
        if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new ScrapeError('INVALID_CONTENT', 'YouTube 视频 ID 无效', 400, false)
        return new Response(JSON.stringify({ videoId, ...(await fetchYouTubeContent(videoId)) }), { headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } })
      }
      if ((url.pathname === '/v1/web/extract' || url.pathname === '/scrape') && request.method === 'POST') {
        let body: { url?: string }
        try { body = await request.json() as { url?: string } } catch { throw new ScrapeError('INVALID_CONTENT', '请求体不是有效 JSON', 400, false) }
        if (!body.url) throw new ScrapeError('INVALID_URL', '缺少 URL', 400, false)
        return new Response(JSON.stringify(await fetchWebContent(body.url)), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) } })
      }
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found', retryable: false }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } })
    } catch (error) {
      return errorResponse(error, request, env)
    }
  },
}
