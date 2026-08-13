import { env } from '@/config/env'
import { ScraperClient, ScraperRequestError, type ContentServiceCapabilities } from '@/lib/scraper'
import { useContentServiceStore } from '@/stores/use-content-service-store'

export type ContentServiceCapability = keyof ContentServiceCapabilities

export function getContentServiceClient(capability?: ContentServiceCapability) {
  const settings = useContentServiceStore.getState()
  const baseURL = settings.enabled && settings.baseURL ? settings.baseURL : env.scraperURL
  if (!baseURL) {
    throw new ScraperRequestError('尚未配置内容解析服务', {
      code: 'SERVICE_NOT_CONFIGURED',
      retryable: false,
    })
  }
  const capabilityValue = capability ? settings.capabilities?.[capability] : undefined
  const capabilityAvailable = Array.isArray(capabilityValue) ? capabilityValue.length > 0 : capabilityValue !== false
  if (capability && settings.capabilities && !capabilityAvailable) {
    throw new ScraperRequestError('当前内容解析服务不支持此功能', {
      code: 'SERVICE_CAPABILITY_UNAVAILABLE',
      retryable: false,
    })
  }
  return new ScraperClient({ baseURL, accessToken: settings.accessToken })
}

export function tryGetContentServiceClient() {
  try {
    return getContentServiceClient()
  } catch {
    return undefined
  }
}
