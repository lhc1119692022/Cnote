/**
 * Cloudflare Worker: AI API 代理
 * 解决浏览器 CORS 限制，代理 AI 服务请求
 */

interface Env {
  CN_PROXY_ROUTES?: string
  CN_PROXY_UPSTREAM_URL?: string
  CN_PROXY_HEADER_NAME?: string
  CN_PROXY_HEADER_VALUE?: string
}

interface DashboardProxyConfig {
  CNOTE_PROXY_ROUTES?: Record<string, string>
  CNOTE_PROXY_UPSTREAM_URL?: string
  CNOTE_PROXY_HEADER_NAME?: string
  CNOTE_PROXY_HEADER_VALUE?: string
}

const dashboardProxyConfig = globalThis as typeof globalThis & DashboardProxyConfig

const DEFAULT_PROXY_HEADER_NAME = 'X-Cnote-Access'

function configuredProxyRoutes(env: Env) {
  let rawRoutes: unknown = dashboardProxyConfig.CNOTE_PROXY_ROUTES || {}
  if (env.CN_PROXY_ROUTES?.trim()) {
    try {
      rawRoutes = JSON.parse(env.CN_PROXY_ROUTES)
    } catch {
      throw new Error('CN_PROXY_ROUTES 必须是正确的 JSON 对象')
    }
  }
  if (!rawRoutes || typeof rawRoutes !== 'object' || Array.isArray(rawRoutes)) {
    throw new Error('AI 代理线路配置格式不正确')
  }

  const routes: Record<string, string> = {}
  for (const [rawName, rawURL] of Object.entries(rawRoutes)) {
    const name = rawName.trim()
    const upstreamURL = typeof rawURL === 'string' ? rawURL.trim() : ''
    if (!upstreamURL) continue
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error(`线路名称“${name}”只能使用字母、数字、短横线和下划线`)
    routes[name] = upstreamURL
  }

  // 兼容上一版单线路配置及命令行环境变量。
  const legacyUpstreamURL = env.CN_PROXY_UPSTREAM_URL?.trim() || dashboardProxyConfig.CNOTE_PROXY_UPSTREAM_URL?.trim() || ''
  if (legacyUpstreamURL && Object.keys(routes).length === 0) routes.default = legacyUpstreamURL
  return routes
}

function proxyHeaderName(env: Env) {
  return env.CN_PROXY_HEADER_NAME?.trim() || dashboardProxyConfig.CNOTE_PROXY_HEADER_NAME?.trim() || DEFAULT_PROXY_HEADER_NAME
}

function proxyConfig(env: Env) {
  return {
    routes: configuredProxyRoutes(env),
    headerName: proxyHeaderName(env),
    headerValue: env.CN_PROXY_HEADER_VALUE || dashboardProxyConfig.CNOTE_PROXY_HEADER_VALUE || '',
  }
}

function getCorsHeaders(env: Env) {
  const allowedHeaders = ['Content-Type', 'Authorization', 'x-api-key', 'x-goog-api-key', 'anthropic-version']
  const customHeaderName = proxyHeaderName(env)
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

function proxyRequest(pathname: string, routes: Record<string, string>) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'proxy' && parts.length >= 3) {
    return { routeName: decodeURIComponent(parts[1]), endpoint: parts.slice(2).join('/') }
  }
  const routeNames = Object.keys(routes)
  // 兼容上一版直接填写 Worker 根地址的单线路渠道。
  if (routeNames.length === 1 && parts.length > 0) return { routeName: routeNames[0], endpoint: parts.join('/') }
  return undefined
}

function cnoteInterfaceAddresses(origin: string, routes: Record<string, string>) {
  return Object.keys(routes).map((name) => ({
    name,
    address: `${origin}/proxy/${encodeURIComponent(name)}`,
  }))
}

function setupResponse(url: URL, routes: Record<string, string>, corsHeaders: Record<string, string>) {
  const addresses = cnoteInterfaceAddresses(url.origin, routes)
  const lines = addresses.length > 0
    ? [
        'Cnote AI 跨域代理已运行。',
        '',
        '请把下面对应线路的完整地址复制到 Cnote 的“接口地址”：',
        ...addresses.map((item) => `${item.name}: ${item.address}`),
        '',
        '不要删掉 /proxy/线路名，也不要再追加 /v1/models 等路径。',
      ]
    : [
        '尚未配置第三方 API 线路。',
        '请回到 Worker 脚本顶部填写 CNOTE_PROXY_ROUTES 后重新部署。',
      ]
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders },
  })
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

function assertProxyAccess(request: Request, config: ReturnType<typeof proxyConfig>) {
  const { headerName, headerValue } = config
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
      const url = new URL(request.url)
      const path = url.pathname
      const config = proxyConfig(env)

      if (path === '/' && request.method === 'GET') return setupResponse(url, config.routes, corsHeaders)

      // 健康检查
      if (path === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            channels: cnoteInterfaceAddresses(url.origin, config.routes),
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        )
      }

      assertProxyAccess(request, config)
      const targetRequest = proxyRequest(path, config.routes)
      if (targetRequest) {
        if (!['GET', 'POST'].includes(request.method)) return errorResponse(405, '代理仅支持 GET 和 POST', corsHeaders)
        if (!isAllowedEndpoint(targetRequest.endpoint)) return errorResponse(404, '此 AI 端点未开放代理', corsHeaders)
        const upstreamURL = config.routes[targetRequest.routeName]
        if (!upstreamURL) return errorResponse(404, `没有找到线路“${targetRequest.routeName}”，请检查 Cnote 接口地址末尾的线路名`, corsHeaders)
        const target = buildTargetURL(upstreamURL, targetRequest.endpoint, url.search)

        // 构建目标 URL
        const headers = new Headers(request.headers)
        const body = request.method === 'POST' ? await readRequestBodyLimited(request) : undefined
        const proxyHeaderName = config.headerName
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
          message: Object.keys(config.routes).length > 1
            ? '请使用 Worker 地址/proxy/线路名；打开 Worker 根地址可查看已经拼好的完整地址'
            : '打开 Worker 根地址，复制页面中已经拼好的 Cnote 接口地址',
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
        || error.message.includes('线路')
        || error.message.includes('CN_PROXY_ROUTES')
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
