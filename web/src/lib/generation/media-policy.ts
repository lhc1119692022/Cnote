export type MediaTransport = 'auto' | 'inline' | 'presign' | 'multipart' | 'custom' | 'public-url'

export function resolveMediaTransport(transport: MediaTransport, providerPath?: string, customConfigured = false): Exclude<MediaTransport, 'auto'> {
  if (transport !== 'auto') return transport
  if (providerPath) return 'presign'
  return customConfigured ? 'custom' : 'public-url'
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
