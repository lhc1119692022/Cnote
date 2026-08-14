export type CloudflareWorkerTemplate = 'ai-proxy' | 'content-service'

const templatePaths: Record<CloudflareWorkerTemplate, string> = {
  'ai-proxy': `${import.meta.env.BASE_URL}cloudflare-worker-scripts/ai-proxy.js`,
  'content-service': `${import.meta.env.BASE_URL}cloudflare-worker-scripts/content-service.js`,
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export function createAccessSecret(length = 32) {
  return Array.from(randomBytes(length), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function scriptString(value: string) {
  return JSON.stringify(value).slice(1, -1)
}

export async function createCloudflareWorkerScript(
  template: CloudflareWorkerTemplate,
  values: Record<string, string>,
) {
  const response = await fetch(templatePaths[template])
  if (!response.ok) throw new Error('预制脚本尚未生成，请刷新页面后重试。')
  let source = await response.text()
  for (const [key, value] of Object.entries(values)) {
    source = source.split(`__${key}__`).join(scriptString(value))
  }
  return source
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('浏览器未允许复制，请手动复制脚本。')
}
