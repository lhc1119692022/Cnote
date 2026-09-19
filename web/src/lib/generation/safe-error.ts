export function safeGenerationError(value: unknown) {
  return String(value || '生成服务返回失败')
    .replace(/https?:\/\/[^\s"'<>（）()]+/gi, '[媒体地址已隐藏]')
    .replace(/data:[^\s"']+/gi, '[内联内容已隐藏]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[密钥已隐藏]')
    .slice(0, 2000)
}
