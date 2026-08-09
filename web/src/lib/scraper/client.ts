/**
 * Web Scraper 客户端
 * 用于网页内容抓取和 YouTube 字幕提取
 */

export interface ScraperConfig {
  baseURL: string
}

export interface WebContent {
  title: string
  content: string
}

export interface YouTubeSubtitles {
  videoId: string
  subtitles: string
}

export class ScraperClient {
  private baseURL: string

  constructor(config: ScraperConfig) {
    this.baseURL = config.baseURL
  }

  /**
   * 提取网页内容
   */
  async scrapeWeb(url: string): Promise<WebContent> {
    const response = await fetch(`${this.baseURL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to scrape web content')
    }

    return response.json()
  }

  /**
   * 提取 YouTube 字幕
   */
  async fetchYouTubeSubtitles(videoId: string): Promise<YouTubeSubtitles> {
    const response = await fetch(`${this.baseURL}/youtube/${videoId}`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to fetch YouTube subtitles')
    }

    return response.json()
  }

  /**
   * 从 YouTube URL 提取视频 ID
   */
  static extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
      /youtube\.com\/embed\/([^&\s]+)/,
      /youtube\.com\/v\/([^&\s]+)/,
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
      const response = await fetch(`${this.baseURL}/health`)
      return response.ok
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }
}
