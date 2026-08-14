/**
 * API Key 本地混淆存储
 * 使用 XOR + Base64 避免直接以明文显示，不提供密码学保护
 * 随机生成并保存在同一站点的设备标识仅作为混淆因子
 */

/**
 * 生成设备指纹
 */
function getDeviceId(): string {
  const key = 'cnote-device-id'
  let deviceId = localStorage.getItem(key)

  if (!deviceId) {
    // 生成新的设备 ID
    deviceId = Array.from({ length: 32 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('')
    localStorage.setItem(key, deviceId)
  }

  return deviceId
}

/**
 * XOR 混淆/还原
 */
function xorCipher(text: string, key: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(
      text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
    )
  }
  return result
}

/**
 * 混淆 API Key
 */
export function encryptAPIKey(apiKey: string): string {
  const deviceId = getDeviceId()
  const encrypted = xorCipher(apiKey, deviceId)
  return btoa(encrypted)
}

/**
 * 还原 API Key
 */
export function decryptAPIKey(encryptedKey: string): string {
  try {
    const deviceId = getDeviceId()
    const encrypted = atob(encryptedKey)
    return xorCipher(encrypted, deviceId)
  } catch (error) {
    console.error('Failed to decrypt API key:', error)
    return ''
  }
}

/**
 * 验证 API Key 格式
 */
export function validateAPIKey(apiKey: string, provider: string): boolean {
  if (!apiKey || apiKey.trim().length === 0) {
    return false
  }

  // 基础格式验证
  const patterns: Record<string, RegExp> = {
    openai: /^sk-[A-Za-z0-9-_]{32,}$/,
    anthropic: /^sk-ant-[A-Za-z0-9-_]{32,}$/,
    google: /^[A-Za-z0-9-_]{32,}$/,
    deepseek: /^sk-[A-Za-z0-9]{32,}$/,
  }

  const pattern = patterns[provider.toLowerCase()]
  if (pattern) {
    return pattern.test(apiKey)
  }

  // 对于自定义提供商，只检查长度
  return apiKey.length >= 20
}

/**
 * 隐藏 API Key（用于显示）
 */
export function maskAPIKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) {
    return '***'
  }

  const visibleStart = 4
  const visibleEnd = 4
  const maskedLength = apiKey.length - visibleStart - visibleEnd

  return (
    apiKey.slice(0, visibleStart) +
    '*'.repeat(Math.min(maskedLength, 20)) +
    apiKey.slice(-visibleEnd)
  )
}

/**
 * 安全清除 API Key（从内存中）
 */
export function clearAPIKey(apiKey: string): void {
  // 注意：JavaScript 无法直接清除内存
  // 这里只是将字符串重写为空字符
  if (typeof apiKey === 'string') {
    apiKey = ''
  }
}
