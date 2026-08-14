/**
 * Cloudflare Worker: AI API 代理
 * 解决浏览器 CORS 限制，代理 AI 服务请求
 */

interface Env {
  CN_PROXY_UPSTREAM_URL?: string
  CN_PROXY_HEADER_NAME?: string
  CN_PROXY_HEADER_VALUE?: string
}

interface DashboardProxyConfig {
  CNOTE_PROXY_UPSTREAM_URL?: string
  CNOTE_PROXY_HEADER_NAME?: string
  CNOTE_PROXY_HEADER_VALUE?: string
}

const dashboardProxyConfig = globalThis as typeof globalThis & DashboardProxyConfig

const DEFAULT_PROXY_HEADER_NAME = 'X-Cnote-Access'

function proxyConfig(env: Env) {
  return {
    upstreamURL: env.CN_PROXY_UPSTREAM_URL?.trim() || dashboardProxyConfig.CNOTE_PROXY_UPSTREAM_URL?.trim() || '',
    headerName: env.CN_PROXY_HEADER_NAME?.trim() || dashboardProxyConfig.CNOTE_PROXY_HEADER_NAME?.trim() || DEFAULT_PROXY_HEADER_NAME,
    headerValue: env.CN_PROXY_HEADER_VALUE || dashboardProxyConfig.CNOTE_PROXY_HEADER_VALUE || '',
  }
}

function getCorsHeaders(env: Env) {
  const allowedHeaders = ['Content-Type', 'Authorization', 'x-api-key', 'x-goog-api-key', 'anthropic-version']
  const customHeaderName = proxyConfig(env).headerName
  if (customHeaderName && !allowedHeaders.some((name) => name.toLowerCase() === customHeaderName.toLowerCase())) {
    new Headers({ [customHeaderName]: 'validation' })
    allowedHeaders.push(customHeaderName)
  }
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': allowedHeaders.join(', '),
    'Access-Control-Max-Age': '86400',
  }
}

const ALLOWED_ENDPOINTS = new Set([
  'v1/models',
  'v1/chat/completions',
  'v1/responses',
  'v1/messages',
  'v1beta/openai/models',
  'v1beta/openai/chat/completions',
  'v1beta/models',
])

function isAllowedEndpoint(endpoint: string) {
  if (ALLOWED_ENDPOINTS.has(endpoint)) return true
  return /^v1beta\/models\/[A-Za-z0-9._-]+:(?:generateContent|streamGenerateContent)$/.test(endpoint)
}

function requestEndpoint(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  // 兼容旧版渠道中已经保存的 /proxy/任意名称 地址。
  if (parts[0] === 'proxy' && parts.length >= 3) return parts.slice(2).join('/')
  return parts.join('/')
}

function buildTargetURL(upstreamURL: string, endpoint: string, search: string) {
  if (!upstreamURL) throw new Error('请先在脚本顶部填写第三方 API 原接口地址')

  let base: URL
  try {
    base = new URL(upstreamURL)
  } catch {
    throw new Error('脚本顶部的第三方 API 原接口地址格式不正确')
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('第三方 API 原接口地址必须是完整的 http 或 https 地址，且不要带查询参数或 #')
  }

  const basePath = base.pathname.replace(/\/+$/, '')
  let endpointPath = `/${endpoint}`
  const endpointVersion = endpointPath.match(/^\/(v\d+(?:beta\d*)?)\//i)?.[1]
  if (endpointVersion && basePath.toLowerCase().endsWith(`/${endpointVersion.toLowerCase()}`)) {
    endpointPath = endpointPath.slice(endpointVersion.length + 1)
  } else if (/\/v\d+(?:beta\d*)?\/openai$/i.test(basePath) && endpointPath.startsWith('/v1/')) {
    endpointPath = endpointPath.slice(3)
  }

  const target = new URL(`${base.origin}${basePath}${endpointPath}`)
  target.search = search
  return target
}

const MAX_PROXY_REQUEST_BYTES = 20 * 1024 * 1024

async function readRequestBodyLimited(request: Request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (declaredLength > MAX_PROXY_REQUEST_BYTES) throw new Error('PROXY_REQUEST_TOO_LARGE')
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_PROXY_REQUEST_BYTES) {
        await reader.cancel()
        throw new Error('PROXY_REQUEST_TOO_LARGE')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function errorResponse(status: number, message: string, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function assertProxyAccess(request: Request, env: Env) {
  const { headerName, headerValue } = proxyConfig(env)
  if (!headerValue) return
  if (request.headers.get(headerName) !== headerValue) throw new Error('代理访问头无效')
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = getCorsHeaders(env)
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      })
    }

    try {
      assertProxyAccess(request, env)
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
              ...corsHeaders,
            },
          }
        )
      }

      const endpoint = requestEndpoint(path)
      if (endpoint) {
        if (!['GET', 'POST'].includes(request.method)) return errorResponse(405, '代理仅支持 GET 和 POST', corsHeaders)
        if (!isAllowedEndpoint(endpoint)) return errorResponse(404, '此 AI 端点未开放代理', corsHeaders)
        const target = buildTargetURL(proxyConfig(env).upstreamURL, endpoint, url.search)

        // 构建目标 URL
        const headers = new Headers(request.headers)
        const body = request.method === 'POST' ? await readRequestBodyLimited(request) : undefined
        const proxyHeaderName = proxyConfig(env).headerName
        if (proxyHeaderName) headers.delete(proxyHeaderName)
        headers.delete('Host')
        headers.delete('Origin')
        headers.delete('Referer')
        headers.delete('Cookie')
        headers.delete('Content-Length')

        const proxyRequest = new Request(target.toString(), {
          method: request.method,
          headers,
          body,
        })

        const response = await fetch(proxyRequest, { redirect: 'manual' })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location')
          if (!location || new URL(location, target).origin !== target.origin) return errorResponse(502, '上游跨域重定向已拒绝', corsHeaders)
        }

        // 复制响应头并添加 CORS
        const responseHeaders = new Headers(response.headers)
        Object.entries(corsHeaders).forEach(([key, value]) => {
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
          message: '请在 Cnote 中填写这个 Worker 的根地址，不要追加其他路径',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      )
    } catch (error) {
      const unauthorized = error instanceof Error && error.message === '代理访问头无效'
      const tooLarge = error instanceof Error && error.message === 'PROXY_REQUEST_TOO_LARGE'
      const configurationError = error instanceof Error && (
        error.message.includes('第三方 API 原接口地址')
        || error.message.includes('完整的 http 或 https 地址')
      )
      if (!unauthorized && !tooLarge && !configurationError) console.error('Proxy error:', error)

      return new Response(
        JSON.stringify({
          error: unauthorized ? 'Unauthorized' : tooLarge ? 'Request too large' : 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: unauthorized ? 401 : tooLarge ? 413 : 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      )
    }
  },
}
