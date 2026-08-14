import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const workersRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(workersRoot, 'dashboard')

await mkdir(outputDirectory, { recursive: true })

const scripts = [
  {
    entry: path.join(workersRoot, 'src', 'proxy.ts'),
    outfile: path.join(outputDirectory, 'ai-proxy.js'),
    banner: `/**
 * Cnote AI 跨域代理
 *
 * 只在 Cnote 提示“第三方 API 跨域错误”时使用。
 *
 * 地址怎么填（先看）：
 * 1. 下面左边是“线路名”，右边填写这个第三方 API 原接口地址。
 * 2. 部署后，Cnote 接口地址 = Worker 地址/proxy/线路名。
 * 3. 直接打开 Worker 根地址，页面会列出已经拼好的完整地址，复制即可。
 */

/* ==================== ① 必填：第三方 API 线路 ==================== */
// 只用一个第三方接口就填 api-1；需要更多接口就继续填写 api-2，或照着再加一行。
// 原接口地址不要额外添加 /v1/models、/v1/responses 等请求路径。
globalThis.CNOTE_PROXY_ROUTES = {
  "api-1": "", // Cnote 接口地址：Worker 地址/proxy/api-1
  "api-2": "", // Cnote 接口地址：Worker 地址/proxy/api-2
};

/* ==================== ② 建议：给 Worker 加访问校验 ==================== */
// 请求头名称不懂就保持不变；部署后，Cnote 里也填写同一个名称。
globalThis.CNOTE_PROXY_HEADER_NAME = "X-Cnote-Access";

// 填一段只有你知道的长字符串；部署后，Cnote 的“请求头值”也填同一串。
// 留空也能使用，但知道 Worker 地址的人都可以调用它。
globalThis.CNOTE_PROXY_HEADER_VALUE = "";

/* ==================== 以下内容不用修改 ==================== */`,
  },
  {
    entry: path.join(workersRoot, 'src', 'scraper.ts'),
    outfile: path.join(outputDirectory, 'content-service.js'),
    banner: `/**
 * Cnote 内容解析服务
 *
 * 地址怎么填（先看）：
 * 1. 部署后，直接打开 Cloudflare 给你的 Worker 根地址。
 * 2. 页面会显示已经准备好的“服务地址”，完整复制到 Cnote 即可。
 * 3. 服务地址不要追加 /v1/health 或其他路径。
 */

/* ==================== 部署前先填：访问令牌 ==================== */
// 在引号里填一段只有你知道的长字符串，建议至少 32 位。
globalThis.CNOTE_CONTENT_TOKEN = "";

// ↑ 部署后，把同一串内容粘贴到 Cnote → 设置 → 内容解析服务 → 访问令牌。
// 留空也能使用，但知道 Worker 地址的人都可以调用它。
/* ==================== 以下内容不用修改 ==================== */`,
  },
]

for (const script of scripts) {
  await build({
    entryPoints: [script.entry],
    outfile: script.outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: script.banner },
  })
}
