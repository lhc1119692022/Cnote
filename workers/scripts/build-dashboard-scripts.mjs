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
 * 复制整份脚本到 Cloudflare，只修改下面 3 项。
 */

/* ==================== ① 必填：第三方 API 原接口地址 ==================== */
// 把 Cnote 中原本填写、但出现跨域错误的接口地址完整粘贴到引号里。
// 只填原接口地址，不要填 Worker 地址，也不要额外添加 /v1/models 等路径。
globalThis.CNOTE_PROXY_UPSTREAM_URL = "";

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
 * 复制整份脚本到 Cloudflare，部署前先填写下面的访问令牌。
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
