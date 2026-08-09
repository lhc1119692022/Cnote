// CORS 检测工具
// 通过 OPTIONS 预检请求自动检测 API 是否需要代理

interface CORSDetectionResult {
  needsProxy: boolean
  error?: string
}

/**
 * 检测 API 端点是否支持 CORS
 * @param baseURL API 基础 URL
 * @returns 是否需要代理
 */
export async function detectCORS(baseURL: string): Promise<CORSDetectionResult> {
  try {
    // 发送 OPTIONS 预检请求
    const response = await fetch(baseURL, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    })

    // 检查是否允许跨域
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
    const allowMethods = response.headers.get('Access-Control-Allow-Methods')

    if (allowOrigin && (allowOrigin === '*' || allowOrigin === window.location.origin)) {
      if (allowMethods && allowMethods.includes('POST')) {
        return { needsProxy: false }
      }
    }

    // CORS 不支持，需要代理
    return { needsProxy: true }
  } catch (error) {
    // 网络错误或 CORS 阻止，需要代理
    return {
      needsProxy: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 批量检测多个 API 端点
 * @param urls API 端点列表
 * @returns 检测结果映射
 */
export async function batchDetectCORS(
  urls: string[]
): Promise<Record<string, CORSDetectionResult>> {
  const results = await Promise.all(urls.map((url) => detectCORS(url)))
  return Object.fromEntries(urls.map((url, i) => [url, results[i]]))
}

/**
 * 缓存 CORS 检测结果（15 分钟有效期）
 */
const corsCache = new Map<string, { result: CORSDetectionResult; timestamp: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 分钟

export async function detectCORSCached(baseURL: string): Promise<CORSDetectionResult> {
  const cached = corsCache.get(baseURL)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result
  }

  const result = await detectCORS(baseURL)
  corsCache.set(baseURL, { result, timestamp: Date.now() })
  return result
}
