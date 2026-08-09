import type { CORSDetectResult } from '@/types/api'

/**
 * CORS 检测工具
 * 自动检测 API 是否支持 CORS
 */

/**
 * 检测 API 是否支持 CORS
 * @param baseUrl API Base URL
 * @returns 是否需要使用 Proxy
 */
export async function detectCORS(baseUrl: string): Promise<CORSDetectResult> {
  try {
    // 发送 OPTIONS 预检请求
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 秒超时

    const response = await fetch(baseUrl, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 检查 CORS 头
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
    const allowMethods = response.headers.get('Access-Control-Allow-Methods')
    const allowHeaders = response.headers.get('Access-Control-Allow-Headers')

    // 判断是否支持 CORS
    const supportsWildcard = allowOrigin === '*'
    const supportsOrigin = allowOrigin === window.location.origin
    const supportsMethods = allowMethods?.includes('POST')
    const supportsHeaders =
      allowHeaders?.includes('authorization') || allowHeaders?.includes('*')

    if (
      (supportsWildcard || supportsOrigin) &&
      supportsMethods &&
      supportsHeaders
    ) {
      return { needsProxy: false }
    } else {
      return { needsProxy: true }
    }
  } catch (error: any) {
    // 任何错误都认为需要 Proxy
    // 包括：网络错误、超时、CORS 阻止等
    console.warn('CORS detection failed, will use proxy:', error.message)
    return {
      needsProxy: true,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
    }
  }
}

/**
 * 批量检测多个 URL 的 CORS 支持
 */
export async function detectCORSBatch(
  urls: string[]
): Promise<Map<string, CORSDetectResult>> {
  const results = new Map<string, CORSDetectResult>()

  await Promise.all(
    urls.map(async url => {
      const result = await detectCORS(url)
      results.set(url, result)
    })
  )

  return results
}

/**
 * 获取推荐的连接方式（供 UI 显示）
 */
export function getConnectionModeLabel(needsProxy: boolean): string {
  return needsProxy ? '通过代理' : '直接连接'
}

/**
 * 获取连接状态图标
 */
export function getConnectionModeIcon(needsProxy: boolean): string {
  return needsProxy ? '🔄' : '⚡'
}

/**
 * 缓存 CORS 检测结果（避免重复检测）
 */
const corsCache = new Map<string, { result: CORSDetectResult; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 分钟

export async function detectCORSWithCache(baseUrl: string): Promise<CORSDetectResult> {
  const now = Date.now()
  const cached = corsCache.get(baseUrl)

  // 使用缓存的结果
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.result
  }

  // 重新检测
  const result = await detectCORS(baseUrl)
  corsCache.set(baseUrl, { result, timestamp: now })

  return result
}

/**
 * 清除 CORS 检测缓存
 */
export function clearCORSCache(baseUrl?: string): void {
  if (baseUrl) {
    corsCache.delete(baseUrl)
  } else {
    corsCache.clear()
  }
}
