/**
 * Cloudflare Worker: AI API 代理
 * 解决浏览器 CORS 限制，代理 AI 服务请求
 */

interface Env {
  // 可以在这里定义环境变量
}

// 支持的 AI 提供商
const SUPPORTED_PROVIDERS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  google: 'https://generativelanguage.googleapis.com',
  xai: 'https://api.x.ai',
  groq: 'https://api.groq.com',
  openrouter: 'https://openrouter.ai/api',
}

// CORS 头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
  'Access-Control-Max-Age': '86400',
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

      // 代理 AI API 请求
      // 路径格式: /proxy/{provider}/{endpoint}
      const pathParts = path.split('/').filter(Boolean)
      if (pathParts[0] === 'proxy' && pathParts.length >= 2) {
        const provider = pathParts[1] as keyof typeof SUPPORTED_PROVIDERS
        const endpoint = pathParts.slice(2).join('/')

        if (!SUPPORTED_PROVIDERS[provider]) {
          return new Response(
            JSON.stringify({
              error: 'Unsupported provider',
              supported: Object.keys(SUPPORTED_PROVIDERS),
            }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS,
              },
            }
          )
        }

        // 构建目标 URL
        const targetUrl = `${SUPPORTED_PROVIDERS[provider]}/${endpoint}`

        // 转发请求
        const headers = new Headers(request.headers)
        headers.set('Host', new URL(SUPPORTED_PROVIDERS[provider]).host)
        headers.delete('Origin')
        headers.delete('Referer')

        const proxyRequest = new Request(targetUrl, {
          method: request.method,
          headers,
          body: request.body,
        })

        const response = await fetch(proxyRequest)

        // 复制响应头并添加 CORS
        const responseHeaders = new Headers(response.headers)
        Object.entries(CORS_HEADERS).forEach(([key, value]) => {
          responseHeaders.set(key, value)
        })

        // 处理流式响应
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          })
        }

        // 普通响应
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        })
      }

      // 未匹配的路径
      return new Response(
        JSON.stringify({
          error: 'Not found',
          message: 'Use /proxy/{provider}/{endpoint} to proxy AI API requests',
          providers: Object.keys(SUPPORTED_PROVIDERS),
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
      console.error('Proxy error:', error)

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
