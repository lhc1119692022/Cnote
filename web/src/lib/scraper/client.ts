/** Web Scraper 客户端：统一承载远程解析和稳定错误码。 */

import type { SocialPayload } from '@/types/flow'

export interface ScraperConfig {
  baseURL: string
  accessToken?: string
}

export interface ContentServiceCapabilities {
  webPage: boolean
  youtubeTranscript: boolean
  social: string[]
  documentProxy: boolean
}

export interface ContentServiceHealth {
  status: 'ok'
  service: string
  version: string
  timestamp?: string
  capabilities: ContentServiceCapabilities
}

export interface WebContent {
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

export interface ScraperErrorBody {
  code?: string
  message?: string
  retryable?: boolean
}

export class ScraperRequestError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status?: number

  constructor(message: string, options: { code?: string; retryable?: boolean; status?: number } = {}) {
    super(message)
    this.name = 'ScraperRequestError'
    this.code = options.code || 'SCRAPER_REQUEST_FAILED'
    this.retryable = options.retryable ?? true
    this.status = options.status
  }
}

export interface YouTubeSubtitles {
  videoId: string
  subtitles: string
  title?: string
  authorName?: string
  thumbnailUrl?: string
  warning?: string
  transcriptError?: ScraperErrorBody
}

export class ScraperClient {
  private baseURL: string
  private accessToken?: string

  constructor(config: ScraperConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, '')
    this.accessToken = config.accessToken?.trim() || undefined
  }

  private async request<T>(path: string, init?: RequestInit, timeoutMs = 45_000): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = new Headers(init?.headers)
      if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`)
      const response = await fetch(`${this.baseURL}${path}`, { ...init, headers, signal: controller.signal })
      const body = await response.text()
      let parsed: T | ScraperErrorBody | null = null
      try { parsed = body ? JSON.parse(body) as T | ScraperErrorBody : null } catch { parsed = null }
      if (!response.ok) {
        const error = (parsed && typeof parsed === 'object' ? parsed : {}) as ScraperErrorBody
        throw new ScraperRequestError(error.message || `抓取服务请求失败（${response.status}）`, {
          code: error.code,
          retryable: error.retryable,
          status: response.status,
        })
      }
      if (parsed === null) throw new ScraperRequestError('抓取服务返回了空响应', { code: 'EMPTY_RESPONSE', status: response.status })
      return parsed as T
    } catch (error) {
      if (error instanceof ScraperRequestError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ScraperRequestError('抓取服务请求超时', { code: 'SCRAPER_TIMEOUT', retryable: true })
      }
      throw new ScraperRequestError(error instanceof Error ? error.message : '无法连接抓取服务', { code: 'SCRAPER_NETWORK_ERROR', retryable: true })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  /**
   * 提取网页内容
   */
  async scrapeWeb(url: string, options?: { timeoutMs?: number }): Promise<WebContent> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }
    try {
      return await this.request<WebContent>('/v1/web/extract', init, options?.timeoutMs)
    } catch (error) {
      if (!(error instanceof ScraperRequestError) || error.status !== 404) throw error
      return this.request<WebContent>('/scrape', init, options?.timeoutMs)
    }
  }

  async fetchXiaohongshuMedia(url: string, options?: { timeoutMs?: number }): Promise<Blob> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), options?.timeoutMs ?? 30_000)
    try {
      const headers = new Headers()
      if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`)
      const response = await fetch(`${this.baseURL}/v1/media/xiaohongshu?url=${encodeURIComponent(url)}`, { headers, signal: controller.signal })
      if (!response.ok) {
        let message = `图片读取失败（${response.status}）`
        try {
          const body = await response.json() as ScraperErrorBody
          if (body.message) message = body.message
        } catch { /* keep status fallback */ }
        throw new ScraperRequestError(message, { code: 'MEDIA_FETCH_FAILED', retryable: response.status >= 500, status: response.status })
      }
      return await response.blob()
    } catch (error) {
      if (error instanceof ScraperRequestError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') throw new ScraperRequestError('图片读取超时', { code: 'SCRAPER_TIMEOUT', retryable: true })
      throw new ScraperRequestError(error instanceof Error ? error.message : '无法读取小红书图片', { code: 'SCRAPER_NETWORK_ERROR', retryable: true })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  xiaohongshuMediaUrl(url: string) {
    return `${this.baseURL}/v1/media/xiaohongshu?url=${encodeURIComponent(url)}`
  }

  /**
   * 提取 YouTube 字幕
   */
  async fetchYouTubeSubtitles(videoId: string): Promise<YouTubeSubtitles> {
    try {
      return await this.request<YouTubeSubtitles>(`/v1/youtube/${encodeURIComponent(videoId)}/transcript`)
    } catch (error) {
      if (!(error instanceof ScraperRequestError) || error.status !== 404) throw error
      return this.request<YouTubeSubtitles>(`/youtube/${encodeURIComponent(videoId)}`)
    }
  }

  async getHealth(): Promise<ContentServiceHealth> {
    try {
      return await this.request<ContentServiceHealth>('/v1/health', undefined, 10_000)
    } catch (error) {
      if (!(error instanceof ScraperRequestError) || error.status !== 404) throw error
      const legacy = await this.request<{ status: 'ok'; version?: string; timestamp?: string }>('/health', undefined, 10_000)
      return {
        status: 'ok',
        service: 'cnote-content-service',
        version: legacy.version || 'legacy',
        timestamp: legacy.timestamp,
        capabilities: { webPage: true, youtubeTranscript: true, social: ['xiaohongshu'], documentProxy: false },
      }
    }
  }

  /**
   * 从 YouTube URL 提取视频 ID
   */
  static extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([^&\s/?]+)/i,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }

    return null
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      return (await this.getHealth()).status === 'ok'
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }
}
