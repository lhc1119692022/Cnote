/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 图片优化配置
  images: {
    unoptimized: true,
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
};

module.exports = nextConfig;
