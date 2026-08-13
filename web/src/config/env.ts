/**
 * 环境配置
 * 用于配置 API 端点和服务 URL
 */

export const env = {
  // 部署者可提供默认内容解析服务；普通用户可在设置中覆盖。
  // 默认留空，避免开源部署无意中把所有用户流量发送到项目维护者的服务。
  scraperURL: import.meta.env.VITE_SCRAPER_URL || '',

  // 开发模式
  isDev: import.meta.env.DEV,

  // 生产模式
  isProd: import.meta.env.PROD,
}
