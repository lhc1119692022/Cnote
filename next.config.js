/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // 输出为独立应用（用于 Electron）
  output: 'export',

  // 图片优化配置
  images: {
    unoptimized: true,
  },

  // 国际化配置
  i18n: {
    locales: ['en', 'zh'],
    defaultLocale: 'en',
  },

  // Webpack 配置
  webpack: (config, { isServer }) => {
    // 处理 better-sqlite3
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    return config;
  },

  // 实验性功能
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

module.exports = nextConfig;
