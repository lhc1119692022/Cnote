import { desktopFetch } from '@/lib/desktop-fetch'
import { signedMediaExpiry } from './media-policy'

export const MEDIA_SAFETY_WINDOW_MS = 48 * 60 * 60 * 1000

export class MediaReadinessError extends Error {
  constructor(message: string, public readonly recoverable: boolean) {
    super(message)
    this.name = 'MediaReadinessError'
  }
}

export async function inspectMediaUrl(url: string, type?: 'image' | 'video' | 'audio', signal?: AbortSignal) {
  const signedExpiry = signedMediaExpiry(url)
  if (signedExpiry !== undefined && signedExpiry <= Date.now() + MEDIA_SAFETY_WINDOW_MS) {
    throw new MediaReadinessError('素材签名地址剩余有效期不足 48 小时', true)
  }
  let response: Response
  try {
    response = await desktopFetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', signal }, { timeoutMs: 30000 })
  } catch (error) {
    signal?.throwIfAborted()
    throw new MediaReadinessError('无法匿名检查素材地址，请检查网络或媒体服务；未重复上传', false)
  }
  if (!response.ok) throw new MediaReadinessError('素材地址检查失败（HTTP ' + response.status + '）', response.status === 404 || response.status === 410)
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!contentType || /text\/|application\/json/.test(contentType) || (type && !contentType.startsWith(type + '/') && contentType !== 'application/octet-stream')) {
    throw new MediaReadinessError('素材地址没有返回匹配的媒体类型', false)
  }
  if (response.headers.get('content-length') === '0') throw new MediaReadinessError('素材文件为空', false)
  const declaredExpiry = Number(response.headers.get('x-cnote-expires-at')) || undefined
  const expiry = signedExpiry === undefined ? declaredExpiry : declaredExpiry === undefined ? signedExpiry : Math.min(signedExpiry, declaredExpiry)
  if (expiry !== undefined && expiry <= Date.now() + MEDIA_SAFETY_WINDOW_MS) throw new MediaReadinessError('素材剩余保留期不足 48 小时，需要续存', true)
  return { expiresAt: expiry, retentionKnown: expiry !== undefined }
}
