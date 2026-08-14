import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '..')
const outputDirectory = path.join(webRoot, 'public', 'cloudflare-worker-scripts')

await mkdir(outputDirectory, { recursive: true })

const templates = [
  {
    entry: path.join(repositoryRoot, 'workers', 'src', 'proxy.ts'),
    outfile: path.join(outputDirectory, 'ai-proxy.js'),
    banner: [
      '// Cnote AI 代理配置：留空表示不启用额外访问请求头。',
      'globalThis.CNOTE_PROXY_HEADER_NAME = "__CNOTE_PROXY_HEADER_NAME__";',
      'globalThis.CNOTE_PROXY_HEADER_VALUE = "__CNOTE_PROXY_HEADER_VALUE__";',
    ].join('\n'),
  },
  {
    entry: path.join(repositoryRoot, 'workers', 'src', 'scraper.ts'),
    outfile: path.join(outputDirectory, 'content-service.js'),
    banner: [
      '// Cnote 内容解析服务配置：留空表示不启用访问令牌。',
      'globalThis.CNOTE_CONTENT_TOKEN = "__CNOTE_CONTENT_TOKEN__";',
    ].join('\n'),
  },
]

for (const template of templates) {
  await build({
    entryPoints: [template.entry],
    outfile: template.outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: template.banner },
  })
}
