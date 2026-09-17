const LOAD_ERRORS: Record<string, string> = {
  ERR_CONNECTION_REFUSED: '无法连接到网站，请检查地址或稍后刷新',
  ERR_NAME_NOT_RESOLVED: '无法找到网站，请检查网址',
  ERR_INTERNET_DISCONNECTED: '网络已断开，请连接后刷新',
  ERR_CONNECTION_TIMED_OUT: '连接超时，请稍后刷新',
  ERR_TIMED_OUT: '页面加载超时，请稍后刷新',
}

export function browserErrorMessage(error: unknown, fallback: string): string {
  const message = typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = message.match(/\bERR_[A-Z_]+\b/)?.[0]
  if (code) return `${LOAD_ERRORS[code] || fallback}（${code}）`
  if (!message.trim() || message.includes('Error invoking remote method') || message.includes('\n') || message.length > 180) return fallback
  return message
}
