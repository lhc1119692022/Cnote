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
 * Cnote AI 跨域代理：Cloudflare 控制台粘贴版
 *
 * 可操作配置区（只需修改下面两行）：
 * 1. 请求头名称建议保留为 X-Cnote-Access。
 * 2. 请求头值请改成自己生成的长随机字符串。
 * 3. 两项都留空会关闭额外访问校验；只填写一项会导致 Worker 拒绝请求。
 * 4. 不要把 AI 服务商的 API Key 写进此脚本。API Key 仍由 Cnote 随请求发送。
 *
 * 随机值生成方法：在任意浏览器开发者工具的 Console 中执行下面一行，
 * 然后把输出结果粘贴到 CNOTE_PROXY_HEADER_VALUE：
 * Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
 *
 * 更安全的做法是在 Cloudflare Worker 的“设置 → 变量和机密”中配置：
 * CN_PROXY_HEADER_NAME（文本）与 CN_PROXY_HEADER_VALUE（机密）。
 * 环境变量的优先级高于下面的粘贴版配置。
 */
globalThis.CNOTE_PROXY_HEADER_NAME = "";
globalThis.CNOTE_PROXY_HEADER_VALUE = "";`,
  },
  {
    entry: path.join(workersRoot, 'src', 'scraper.ts'),
    outfile: path.join(outputDirectory, 'content-service.js'),
    banner: `/**
 * Cnote 内容解析服务：Cloudflare 控制台粘贴版
 *
 * 可操作配置区（只需按需修改下面一行）：
 * 1. 填入长随机字符串即可启用访问令牌。
 * 2. 留空会允许任何人调用这个 Worker，不建议长期公开使用。
 * 3. Cnote“设置 → 内容解析服务”中的访问令牌必须与这里完全一致。
 *
 * 随机值生成方法：在任意浏览器开发者工具的 Console 中执行下面一行，
 * 然后把输出结果粘贴到 CNOTE_CONTENT_TOKEN：
 * Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
 *
 * 更安全的做法是在 Cloudflare Worker 的“设置 → 变量和机密”中配置：
 * CN_CONTENT_TOKEN（机密）。环境变量的优先级高于下面的粘贴版配置。
 * 如需限制允许访问的 Cnote 站点，还可配置 SCRAPER_ALLOWED_ORIGINS（文本），
 * 多个来源用英文逗号分隔，例如：https://example.com,http://localhost:5173
 */
globalThis.CNOTE_CONTENT_TOKEN = "";`,
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
