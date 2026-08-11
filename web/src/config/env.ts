/**
 * 环境配置
 * 用于配置 API 端点和服务 URL
 */

export const env = {
  // Web Scraper 端点
  scraperURL: import.meta.env.VITE_SCRAPER_URL || 'https://scraper.cnote.app',

  // 开发模式
  isDev: import.meta.env.DEV,

  // 生产模式
  isProd: import.meta.env.PROD,
}
