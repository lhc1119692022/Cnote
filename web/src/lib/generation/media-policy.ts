export type MediaTransport = 'inline' | 'custom'

export function normalizeMediaTransport(transport: unknown): MediaTransport | undefined {
  return transport === 'inline' || transport === 'custom' ? transport : undefined
}

export function resolveMediaTransport(transport: unknown, customConfigured = false): MediaTransport {
  const selected = normalizeMediaTransport(transport)
  if (!selected) throw new Error('请在生成渠道中选择本地素材传输方式')
  if (selected === 'custom' && !customConfigured) throw new Error('请先在“本地存储”中配置自定义媒体存储')
  return selected
}

export function mediaTransportStatus(transport: MediaTransport | undefined, customConfigured = false) {
  let resolved: MediaTransport
  try { resolved = resolveMediaTransport(transport, customConfigured) } catch (error) {
    return { canTestUpload: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (resolved === 'inline') return { canTestUpload: false, message: '本地素材编码为 Data URL；需渠道明确支持，不经过存储服务。' }
  return { canTestUpload: true, message: '使用“本地存储”中的自定义媒体存储配置上传。' }
}

export const MAX_INLINE_REQUEST_BYTES = 128 * 1024 * 1024

export function assertInlineRequestSize(body: string) {
  if (new TextEncoder().encode(body).byteLength > MAX_INLINE_REQUEST_BYTES) {
    throw new Error('请求编码后超过 128 MiB，请减少素材或改用公网 HTTPS 地址')
  }
}

export function signedMediaExpiry(value: string): number | undefined {
  try {
    const url = new URL(value)
    const date = url.searchParams.get('X-Amz-Date')
    const duration = url.searchParams.get('X-Amz-Expires')
    if (date && duration && /^\d{8}T\d{6}Z$/.test(date)) {
      const start = Date.parse(date.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'))
      return start + Number(duration) * 1000
    }
  } catch { return undefined }
  return undefined
}

export function assertMediaLifetime(expiresAt?: number, now = Date.now()) {
  if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= now + 60 * 60 * 1000)) {
    throw new Error('素材读取地址已过期或剩余有效期不足一小时，请重新上传或更换地址')
  }
}
