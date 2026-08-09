/**
 * Cloudflare Worker: 网页抓取服务
 * 提供网页内容抓取、YouTube 字幕提取等功能
 */

interface Env {
  // 可以在这里定义环境变量
}

// CORS 头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

// YouTube 字幕提取
async function fetchYouTubeSubtitles(videoId: string): Promise<string> {
  try {
    // 获取视频页面
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
    const response = await fetch(videoUrl)
    const html = await response.text()

    // 提取字幕轨道信息
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/s)
    if (!captionMatch) {
      throw new Error('No captions found')
    }

    const captionTracks = JSON.parse(captionMatch[1])
    if (captionTracks.length === 0) {
      throw new Error('No caption tracks available')
    }

    // 优先选择中文字幕，否则选择第一个
    const track =
      captionTracks.find((t: any) => t.languageCode === 'zh' || t.languageCode === 'zh-CN') ||
      captionTracks[0]

    // 获取字幕内容
    const subtitleResponse = await fetch(track.baseUrl)
    const subtitleXml = await subtitleResponse.text()

    // 解析 XML 提取文本
    const textMatches = subtitleXml.matchAll(/<text[^>]*>(.*?)<\/text>/g)
    const texts: string[] = []
    for (const match of textMatches) {
      const text = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      texts.push(text)
    }

    return texts.join('\n')
  } catch (error) {
    throw new Error(`Failed to fetch YouTube subtitles: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// 网页内容提取
async function fetchWebContent(url: string): Promise<{ title: string; content: string }> {
  try {
    const response = await fetch(url)
    const html = await response.text()

    // 提取标题
    const titleMatch = html.match(/<title>(.*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled'

    // 简单的内容提取（移除脚本和样式）
    let content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // 限制内容长度
    if (content.length > 50000) {
      content = content.substring(0, 50000) + '...'
    }

    return { title, content }
  } catch (error) {
    throw new Error(`Failed to fetch web content: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      })
    }

    try {
      const url = new URL(request.url)
      const path = url.pathname

      // 健康检查
      if (path === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        )
      }

      // YouTube 字幕提取
      // GET /youtube/{videoId}
      if (path.startsWith('/youtube/')) {
        const videoId = path.split('/')[2]
        if (!videoId) {
          return new Response(
            JSON.stringify({ error: 'Missing video ID' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS,
              },
            }
          )
        }

        const subtitles = await fetchYouTubeSubtitles(videoId)
        return new Response(
          JSON.stringify({ videoId, subtitles }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        )
      }

      // 网页内容提取
      // POST /scrape with { url: string }
      if (path === '/scrape' && request.method === 'POST') {
        const body = await request.json<{ url: string }>()
        if (!body.url) {
          return new Response(
            JSON.stringify({ error: 'Missing URL' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS,
              },
            }
          )
        }

        const result = await fetchWebContent(body.url)
        return new Response(
          JSON.stringify(result),
          {
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        )
      }

      // 未匹配的路径
      return new Response(
        JSON.stringify({
          error: 'Not found',
          message: 'Available endpoints: GET /youtube/{videoId}, POST /scrape',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      )
    } catch (error) {
      console.error('Scraper error:', error)

      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      )
    }
  },
}
