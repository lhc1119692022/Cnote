import { nanoid } from 'nanoid'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker'
import { getContentServiceClient } from '@/lib/content-service'
import { ScraperClient, ScraperRequestError } from '@/lib/scraper'
import { checksumText, deleteLocalResource, loadLocalResourceBlob, storeLocalResource } from '@/lib/resource-storage'
import type {
  ContentCategory,
  ContentNodeData,
  ContentPayload,
  ContentPreview,
  ContentSource,
  ContentSubtype,
  ContentUrlProvider,
  DataPayload,
  DocumentPayload,
  MindmapPayload,
  MindmapTreeNode,
  ParseWarning,
  SocialPayload,
} from '@/types/flow'

export type ContentImportInput =
  | { kind: 'file'; file: File | Blob; fileName?: string; clipboardImage?: boolean }
  | { kind: 'text'; text: string }

export interface ParsedContent {
  category: ContentCategory
  subtype: ContentSubtype
  source: ContentSource
  payload: ContentPayload
  preview: ContentPreview
  warnings?: ParseWarning[]
  partial?: boolean
}

export const CONTENT_FILE_ACCEPT_BY_CATEGORY: Record<ContentCategory, string> = {
  text: '.txt,.md,.markdown,text/plain,text/markdown',
  video: 'video/*,audio/*,.mp4,.webm,.mov,.m4v,.mp3,.m4a,.aac,.wav,.flac,.oga',
  social: '',
  document: '.txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf',
  data: '.csv,.tsv,.xlsx,text/csv,text/tab-separated-values',
  presentation: '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mindmap: '.md,.markdown,.xmind,.mindnode,.pos,text/markdown',
  image: 'image/*',
}

export const CONTENT_FILE_ACCEPT = [...new Set(
  Object.values(CONTENT_FILE_ACCEPT_BY_CATEGORY)
    .flatMap((value) => value.split(','))
    .filter(Boolean),
)].join(',')

export function getContentFileAccept(category?: ContentCategory | null) {
  return category ? CONTENT_FILE_ACCEPT_BY_CATEGORY[category] || CONTENT_FILE_ACCEPT : CONTENT_FILE_ACCEPT
}

const markdownExtensions = new Set(['md', 'markdown'])

interface UrlClassification {
  provider: ContentUrlProvider
  category: ContentCategory
  subtype: ContentSubtype
  badge: string
  playback?: 'video' | 'audio' | 'embed' | 'preview'
  socialPlatform?: SocialPayload['platform']
}

function extensionOf(fileName = '') { return fileName.split('.').pop()?.toLowerCase() || '' }
function isSingleUrl(value: string) {
  try {
    const trimmed = value.trim()
    if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) return false
    const url = new URL(trimmed)
    return Boolean(url.hostname)
  } catch { return false }
}

function sharedSocialUrl(value: string, hint?: ContentCategory) {
  const trimmed = value.trim()
  if (isSingleUrl(trimmed)) return trimmed
  if (hint !== 'social') return null

  const urls = Array.from(trimmed.matchAll(/https?:\/\/[^\s<>"'`]+/gi), (match) => match[0].replace(/[,.!?;:，。！？；：、】【》〉）】」』]+$/u, ''))
    .filter((candidate) => isSingleUrl(candidate))
  const xiaohongshuUrl = urls.find((candidate) => {
    const host = new URL(candidate).hostname.toLowerCase()
    return hostMatches(host, 'xiaohongshu.com', 'xhslink.com')
  })

  return xiaohongshuUrl || (urls.length === 1 ? urls[0] : null)
}

function normalizedUrl(value: string) {
  const url = new URL(value.trim())
  url.hash = ''
  return url.toString()
}

function hostMatches(host: string, ...domains: string[]) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function classifyUrl(value: string, hint?: ContentCategory): UrlClassification {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  if (/\.(png|jpe?g|gif|webp|avif|svg)(?:$|\/)/.test(path)) return { provider: 'generic', category: 'image', subtype: 'image', badge: '图片 URL' }
  if (/\.(mp4|webm|mov|m4v)(?:$|\/)/.test(path)) return { provider: 'generic', category: 'video', subtype: 'direct-video', badge: '视频 URL', playback: 'video' }
  if (/\.(mp3|m4a|aac|wav|flac|oga)(?:$|\/)/.test(path)) return { provider: 'podcast', category: 'video', subtype: 'podcast', badge: '音频', playback: 'audio' }

  if (hostMatches(host, 'youtube.com', 'youtu.be')) return { provider: 'youtube', category: 'video', subtype: 'youtube', badge: 'YouTube', playback: 'embed' }
  if (hostMatches(host, 'bilibili.com', 'b23.tv')) return { provider: 'bilibili', category: 'video', subtype: 'bilibili', badge: 'Bilibili', playback: 'preview' }
  if (hostMatches(host, 'vimeo.com')) return { provider: 'vimeo', category: 'video', subtype: 'vimeo', badge: 'Vimeo', playback: 'preview' }
  if (hostMatches(host, 'open.spotify.com', 'podcasts.apple.com', 'ximalaya.com', 'lizhi.fm', 'qingting.fm', 'pod.link', 'anchor.fm')) return { provider: 'podcast', category: 'video', subtype: 'podcast', badge: '播客', playback: 'preview' }

  if (hostMatches(host, 'xiaohongshu.com', 'xhslink.com')) return { provider: 'xiaohongshu', category: 'social', subtype: 'xiaohongshu', badge: '小红书', socialPlatform: 'xiaohongshu' }
  if (hostMatches(host, 'weibo.com', 'weibo.cn')) return { provider: 'weibo', category: 'social', subtype: 'weibo', badge: '微博', socialPlatform: 'weibo' }
  if (hostMatches(host, 'douyin.com', 'iesdouyin.com')) return { provider: 'douyin', category: 'social', subtype: 'douyin', badge: '抖音', socialPlatform: 'douyin' }
  if (hostMatches(host, 'instagram.com')) return { provider: 'instagram', category: 'social', subtype: 'instagram', badge: 'Instagram', socialPlatform: 'instagram' }

  if (hostMatches(host, 'docs.google.com') && path.startsWith('/spreadsheets/')) return { provider: 'google-sheets', category: 'data', subtype: 'google-sheets', badge: 'Google Sheets' }
  if (hostMatches(host, 'docs.google.com') && path.startsWith('/presentation/')) return { provider: 'google-slides', category: 'presentation', subtype: 'google-slides', badge: 'Google Slides' }
  if (hostMatches(host, 'feishu.cn', 'larksuite.com')) {
    if (/\/(?:sheets|base)\//.test(path)) return { provider: 'feishu-sheets', category: 'data', subtype: 'feishu-sheets', badge: '飞书表格' }
    if (/\/(?:slides|presentation)\//.test(path)) return { provider: 'feishu-slides', category: 'presentation', subtype: 'feishu-slides', badge: '飞书幻灯片' }
    return { provider: 'feishu-doc', category: 'document', subtype: 'feishu-doc', badge: '飞书文档' }
  }
  if (hostMatches(host, 'notion.so', 'notion.site', 'notion.com')) {
    if (hint === 'data' || /\/database\//.test(path)) return { provider: 'notion-database', category: 'data', subtype: 'notion-database', badge: 'Notion Database' }
    return { provider: 'notion', category: 'document', subtype: 'notion', badge: 'Notion' }
  }
  if (hostMatches(host, 'processon.com')) return { provider: 'processon', category: 'mindmap', subtype: 'processon', badge: 'ProcessOn' }
  if (hostMatches(host, 'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com', 'ghost.io', 'juejin.cn', 'cnblogs.com', 'dev.to', 'zhuanlan.zhihu.com')) return { provider: 'blog', category: 'document', subtype: 'blog', badge: '博客' }

  if (hint === 'video') return { provider: 'generic', category: 'video', subtype: 'remote-video', badge: '视频链接', playback: 'preview' }
  if (hint === 'social') return { provider: 'generic', category: 'social', subtype: 'social-post', badge: '社媒链接', socialPlatform: 'generic' }
  if (hint === 'data') return { provider: 'generic', category: 'data', subtype: 'online-data', badge: '在线数据' }
  if (hint === 'presentation') return { provider: 'generic', category: 'presentation', subtype: 'online-presentation', badge: '在线演示文稿' }
  if (hint === 'mindmap') return { provider: 'generic', category: 'mindmap', subtype: 'online-mindmap', badge: '在线思维导图' }
  if (hint === 'image') return { provider: 'generic', category: 'image', subtype: 'image', badge: '图片链接' }
  return { provider: 'generic', category: 'document', subtype: 'web-page', badge: '网页' }
}

function previewOnlyWarning(label: string): ParseWarning {
  return { code: 'PREVIEW_ONLY', message: `已识别为${label}，当前提供链接与网页预览，尚未进行平台级深度解析。` }
}

async function scrapePreview(url: string) {
  try {
    return { page: await getContentServiceClient('webPage').scrapeWeb(url, { timeoutMs: 5_000 }) }
  } catch (error) {
    return { page: null, error }
  }
}

function remoteServiceWarning(error: unknown, subject: string): ParseWarning {
  if (error instanceof ScraperRequestError) {
    if (error.code === 'SERVICE_NOT_CONFIGURED') {
      return { code: error.code, message: `尚未配置内容解析服务，已保留${subject}；可在设置中连接你自己的服务后重新识别。` }
    }
    if (error.code === 'SERVICE_CAPABILITY_UNAVAILABLE') {
      return { code: error.code, message: `当前内容解析服务不支持${subject}，请更新服务后重新识别。` }
    }
    return { code: error.code, message: `${subject}获取失败：${error.message}` }
  }
  return { code: 'SERVICE_UNREACHABLE', message: `${subject}获取失败，已保留原始链接，可稍后重新识别。` }
}

function formatMediaDuration(duration?: number) {
  if (!duration || duration < 1) return undefined
  const totalSeconds = Math.round(duration)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function looksLikeMarkdownMindmap(text: string) {
  return /```mermaid\s+[\s\S]*?\bmindmap\b/i.test(text)
}

function mermaidLabel(value: string) {
  return value
    .replace(/\s+::icon\([^)]*\)\s*$/i, '')
    .replace(/^\s*(?:[-+])\s*/, '')
    .trim()
}

function mermaidNodeText(value: string) {
  const trimmed = mermaidLabel(value)
  const wrapped = trimmed.match(/^(?:[\w-]+\s*)?\(\((.*?)\)\)$/) || trimmed.match(/^\(\((.*?)\)\)$/)
  if (wrapped) return mermaidLabel(wrapped[1])
  const bracketed = trimmed.match(/^(?:[\w-]+\s*)?(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})$/)
  return mermaidLabel(bracketed?.[1] || bracketed?.[2] || bracketed?.[3] || trimmed)
}

function mermaidToMindmap(markdown: string): MindmapPayload {
  const source = markdown.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] || markdown
  const lines = source.split(/\r?\n/)
  const mindmapIndex = lines.findIndex((line) => /^\s*mindmap\s*$/i.test(line))
  const root: MindmapTreeNode = { id: nanoid(), text: '思维导图', children: [] }
  if (mindmapIndex < 0) return { kind: 'mindmap', root, sourceMarkdown: markdown }

  const stack: Array<{ depth: number; node: MindmapTreeNode }> = []
  for (const rawLine of lines.slice(mindmapIndex + 1)) {
    if (!rawLine.trim() || /^\s*%%/.test(rawLine)) continue
    const indentation = rawLine.match(/^\s*/)?.[0].replace(/\t/g, '  ').length || 0
    const text = mermaidNodeText(rawLine.trim())
    if (!text) continue
    const depth = Math.max(0, Math.floor(indentation / 2))
    const node: MindmapTreeNode = { id: nanoid(), text, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else root.children.push(node)
    stack.push({ depth, node })
  }
  if (root.children.length === 1) return { kind: 'mindmap', root: root.children[0], sourceMarkdown: markdown }
  return { kind: 'mindmap', root, sourceMarkdown: markdown }
}

function markdownHeadings(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    return match ? [{ level: match[1].length, text: match[2].trim() }] : []
  })
}

export function markdownPlainText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*|```$/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

export function markdownToMindmap(markdown: string): MindmapPayload {
  const nonEmptyLines = markdown.split(/\r?\n/).filter((line) => line.trim())
  const usesMarkdownStructure = nonEmptyLines.some((line) => /^(#{1,6})\s+(.+)$/.test(line) || /^(\s*)[-*+]\s+(.+)$/.test(line))
  if (!usesMarkdownStructure && nonEmptyLines.length) {
    const root: MindmapTreeNode = { id: nanoid(), text: nonEmptyLines[0].trim(), children: [] }
    const stack: Array<{ depth: number; node: MindmapTreeNode }> = [{ depth: 0, node: root }]
    for (const rawLine of nonEmptyLines.slice(1)) {
      const indentation = rawLine.match(/^[\t ]*/)?.[0] || ''
      const spaces = indentation.replace(/\t/g, '  ').length
      const depth = Math.floor(spaces / 2) + 1
      const node: MindmapTreeNode = { id: nanoid(), text: rawLine.trim(), children: [] }
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
      ;(stack[stack.length - 1]?.node || root).children.push(node)
      stack.push({ depth, node })
    }
    return { kind: 'mindmap', root, sourceMarkdown: markdown }
  }
  const virtualRoot: MindmapTreeNode = { id: nanoid(), text: '思维导图', children: [] }
  const stack: Array<{ depth: number; node: MindmapTreeNode }> = [{ depth: -1, node: virtualRoot }]
  let currentHeadingDepth = -1
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^(#{1,6})\s+(.+)$/)
    const list = rawLine.match(/^(\s*)[-*+]\s+(.+)$/)
    if (!heading && !list) continue
    const depth = heading
      ? heading[1].length - 1
      : Math.max(1, currentHeadingDepth + 1) + Math.floor((list?.[1].replace(/\t/g, '  ').length || 0) / 2)
    const text = (heading?.[2] || list?.[2] || '').trim()
    if (!text) continue
    const node: MindmapTreeNode = { id: nanoid(), text, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    ;(stack[stack.length - 1]?.node || virtualRoot).children.push(node)
    stack.push({ depth, node })
    if (heading) currentHeadingDepth = depth
  }
  if (virtualRoot.children.length === 1) return { kind: 'mindmap', root: virtualRoot.children[0], sourceMarkdown: markdown }
  return { kind: 'mindmap', root: virtualRoot, sourceMarkdown: markdown }
}

function parseDelimited(text: string, delimiter: string): unknown[][] {
  const rows: unknown[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

async function parsePdf(blob: Blob): Promise<DocumentPayload> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  try {
    const pages: Array<{ page: number; text: string }> = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push({ page: pageNumber, text: content.items.map((item: any) => item.str || '').join(' ').trim() })
    }
    const plainText = pages.map((page) => page.text).join('\n\n').trim()
    return { kind: 'document', plainText, pageCount: pdf.numPages, pages }
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()
  }
}

async function parsePptx(blob: Blob, title: string) {
  const JSZip = (await import('jszip')).default
  const archive = await JSZip.loadAsync(await blob.arrayBuffer())
  const slideFiles = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((first, second) => Number(first.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(second.match(/slide(\d+)\.xml/i)?.[1] || 0))
  const slides = await Promise.all(slideFiles.map(async (name, index) => {
    const xml = await archive.file(name)?.async('string') || ''
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const text = Array.from(document.getElementsByTagNameNS('*', 't'))
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean)
      .join('\n')
    const lines = text.split(/\r?\n/).filter(Boolean)
    return { index: index + 1, title: lines[0], text }
  }))
  return {
    kind: 'presentation' as const,
    title,
    slideCount: slides.length,
    outline: slides.map((slide) => slide.title || `第 ${slide.index} 页`),
    slides,
  }
}

async function parseDocx(blob: Blob): Promise<DocumentPayload> {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })
  return { kind: 'document', plainText: result.value.trim() }
}

async function parseWorkbook(blob: Blob): Promise<DataPayload> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const workbook = await readXlsxFile(blob)
  const sheets = workbook.map(({ sheet: name, data: rows }) => {
    const columns = (rows[0] || []).map((value, index) => String(value ?? `列 ${index + 1}`))
    const dataRows = rows.slice(1).map((row) => row.map((value) => value instanceof Date ? value.toISOString() : value ?? ''))
    return { name, columns, rows: dataRows.slice(0, 200), totalRows: dataRows.length, truncated: dataRows.length > 200 }
  })
  return { kind: 'data', sheets }
}

async function sourceFromFile(file: File | Blob, fileName: string, clipboardImage = false): Promise<{ source: ContentSource; blob: Blob }> {
  const stored = await storeLocalResource(file)
  return {
    blob: file,
    source: clipboardImage
      ? { kind: 'clipboard-image', resourceId: stored.resourceId, checksum: stored.checksum, mimeType: stored.mimeType, size: stored.size }
      : { kind: 'file', resourceId: stored.resourceId, checksum: stored.checksum, fileName, mimeType: stored.mimeType, size: stored.size, lastModified: file instanceof File ? file.lastModified : undefined },
  }
}

function detectFile(file: Blob, fileName: string, hint?: ContentCategory) {
  const ext = extensionOf(fileName)
  const mime = file.type.toLowerCase()
  if (mime.startsWith('image/') || /^(png|jpe?g|gif|webp|svg|avif)$/.test(ext)) return { category: 'image' as const, subtype: 'image' as const }
  if (mime.startsWith('video/') || /^(mp4|webm|mov|avi|mkv)$/.test(ext)) return { category: 'video' as const, subtype: 'local-video' as const }
  if (mime.startsWith('audio/') || /^(mp3|m4a|aac|wav|flac|oga|ogg)$/.test(ext)) return { category: 'video' as const, subtype: 'podcast' as const }
  if (mime === 'application/pdf' || ext === 'pdf') return { category: 'document' as const, subtype: 'pdf' as const }
  if (ext === 'docx' || mime.includes('wordprocessingml')) return { category: 'document' as const, subtype: 'docx' as const }
  if (ext === 'xls' || mime === 'application/vnd.ms-excel') {
    throw Object.assign(new Error('旧式 XLS 文件不再直接解析，请先另存为 XLSX 后重新导入。'), { code: 'UNSUPPORTED_TYPE' })
  }
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return { category: 'data' as const, subtype: 'xlsx' as const }
  if (ext === 'csv' || mime === 'text/csv') return { category: 'data' as const, subtype: 'csv' as const }
  if (ext === 'tsv' || mime === 'text/tab-separated-values') return { category: 'data' as const, subtype: 'csv' as const }
  if (ext === 'ppt' || mime === 'application/vnd.ms-powerpoint') return { category: 'presentation' as const, subtype: 'ppt' as const }
  if (ext === 'pptx' || mime.includes('presentationml')) return { category: 'presentation' as const, subtype: 'pptx' as const }
  if (ext === 'xmind') return { category: 'mindmap' as const, subtype: 'xmind' as const }
  if (ext === 'mindnode') return { category: 'mindmap' as const, subtype: 'mindnode' as const }
  if (ext === 'pos') return { category: 'mindmap' as const, subtype: 'processon' as const }
  if (markdownExtensions.has(ext) || mime === 'text/markdown') {
    if (hint === 'mindmap') return { category: 'mindmap' as const, subtype: 'markdown-mindmap' as const }
    return { category: hint === 'document' ? 'document' as const : 'text' as const, subtype: 'markdown' as const }
  }
  if (mime.startsWith('text/') || ext === 'txt') return { category: hint === 'document' ? 'document' as const : 'text' as const, subtype: 'plain-text' as const }
  return null
}

export async function detectAndParseContent(
  input: ContentImportInput,
  categoryHint?: ContentCategory,
  onDetected?: (detected: { category: ContentCategory; subtype: ContentSubtype }) => void,
): Promise<ParsedContent> {
  if (input.kind === 'file') {
    const fileName = input.fileName || (input.file instanceof File ? input.file.name : 'clipboard-image')
    const detected = detectFile(input.file, fileName, categoryHint)
    if (!detected) throw Object.assign(new Error('暂不支持此文件类型'), { code: 'UNSUPPORTED_TYPE' })
    onDetected?.(detected)
    const { source, blob } = await sourceFromFile(input.file, fileName, input.clipboardImage)
    try {
      let payload: ContentPayload
      const warnings: ParseWarning[] = []
      let resolvedSubtype: ContentSubtype = detected.subtype
      if (detected.subtype === 'pdf') {
        payload = await parsePdf(blob)
        if (!(payload as DocumentPayload).plainText) warnings.push({ code: 'OCR_REQUIRED', message: '该 PDF 没有可提取的文本层，可能需要 OCR。' })
      } else if (detected.subtype === 'docx') payload = await parseDocx(blob)
      else if (detected.subtype === 'xlsx') payload = await parseWorkbook(blob)
      else if (detected.subtype === 'csv') {
        const text = await blob.text()
        const delimiter = extensionOf(fileName) === 'tsv' ? '\t' : ','
        const rows = parseDelimited(text, delimiter)
        const columns = (rows[0] || []).map((value, index) => String(value || `列 ${index + 1}`))
        payload = { kind: 'data', sheets: [{ name: fileName, columns, rows: rows.slice(1, 201), totalRows: Math.max(0, rows.length - 1), truncated: rows.length > 201 }] }
      } else if (detected.category === 'presentation') {
        if (detected.subtype === 'pptx') {
          payload = await parsePptx(blob, fileName)
          if (!(payload as { slideCount?: number }).slideCount) warnings.push({ code: 'EMPTY_PRESENTATION', message: '已读取演示文稿，但没有找到可展示的页面文本。' })
        } else {
          payload = { kind: 'presentation', title: fileName }
          warnings.push({ code: 'LEGACY_PRESENTATION', message: '旧版 PPT 文件无法直接提取页面内容，建议另存为 PPTX 后重新导入。' })
        }
      } else if (detected.subtype === 'xmind' || detected.subtype === 'mindnode' || detected.subtype === 'processon') {
        payload = { kind: 'mindmap', root: { id: nanoid(), text: fileName, children: [] } }
        warnings.push(previewOnlyWarning('思维导图文件'))
      } else if (detected.category === 'text' || detected.category === 'document' || detected.category === 'mindmap') {
        const text = await blob.text()
        const autoDetectedMindmap = !categoryHint && detected.subtype === 'markdown' && looksLikeMarkdownMindmap(text)
        const resolvedCategory = detected.category === 'mindmap' || autoDetectedMindmap ? 'mindmap' : detected.category
        const isMermaidMindmap = resolvedCategory === 'mindmap' && looksLikeMarkdownMindmap(text)
        if (autoDetectedMindmap) onDetected?.({ category: 'mindmap', subtype: 'mermaid-mindmap' })
        if (isMermaidMindmap) resolvedSubtype = 'mermaid-mindmap'
        payload = resolvedCategory === 'mindmap'
          ? isMermaidMindmap ? mermaidToMindmap(text) : markdownToMindmap(text)
          : resolvedCategory === 'text'
            ? { kind: 'text', value: text, format: detected.subtype === 'markdown' ? 'markdown' : 'plain' }
            : { kind: 'document', rawText: text, plainText: detected.subtype === 'markdown' ? markdownPlainText(text) : text, headings: detected.subtype === 'markdown' ? markdownHeadings(text) : undefined }
        if (resolvedCategory !== detected.category) {
          return {
            category: resolvedCategory,
            subtype: resolvedSubtype,
            source,
            payload,
            preview: { title: fileName, badge: resolvedSubtype.toUpperCase(), meta: [formatBytes(blob.size)] },
            warnings,
            partial: warnings.length > 0,
          }
        }
      } else if (detected.category === 'image') payload = { kind: 'image' }
      else payload = { kind: 'video', provider: 'local', playback: detected.subtype === 'podcast' ? 'audio' : 'video' }
      return {
        category: detected.category,
        subtype: resolvedSubtype,
        source,
        payload,
        preview: { title: fileName, badge: resolvedSubtype.toUpperCase(), meta: [formatBytes(blob.size)] },
        warnings,
        partial: warnings.length > 0,
      }
    } catch (error) {
      const resourceId = source.kind === 'file' || source.kind === 'clipboard-image' ? source.resourceId : undefined
      await deleteLocalResource(resourceId)
      throw error
    }
  }

  const text = input.text.trim()
  if (!text) throw Object.assign(new Error('剪贴板中没有可导入的内容'), { code: 'INVALID_CONTENT' })
  const url = categoryHint !== 'text' ? sharedSocialUrl(text, categoryHint) : null
  if (url) {
    const normalized = normalizedUrl(url)
    const classification = classifyUrl(normalized, categoryHint)
    const source: ContentSource = { kind: 'url', originalUrl: text, normalizedUrl: normalized, provider: classification.provider }
    onDetected?.({ category: classification.category, subtype: classification.subtype })

    if (classification.provider === 'youtube') {
      const videoId = ScraperClient.extractVideoId(normalized)
      if (!videoId) throw Object.assign(new Error('无法识别 YouTube 视频 ID'), { code: 'INVALID_CONTENT' })
      return {
        category: 'video', subtype: 'youtube', source,
        payload: { kind: 'video', provider: 'youtube', playback: 'embed', url: normalized, title: `YouTube ${videoId}`, transcriptStatus: 'loading' },
        preview: { title: 'YouTube 视频', thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, badge: 'YouTube' },
      }
    }
    if (classification.provider === 'xiaohongshu' || classification.provider === 'douyin' || classification.provider === 'instagram') {
      try {
        const page = await getContentServiceClient('social').scrapeWeb(normalized)
        const platform = classification.socialPlatform || 'generic'
        const payload: SocialPayload = page.social || { kind: 'social', platform, canonicalUrl: normalized, title: page.title || `${classification.badge}内容`, bodyText: page.content || '', contentBlocks: page.content ? [{ type: 'text', text: page.content }] : [] }
        const warnings = page.social ? undefined : [{ code: 'REMOTE_PARSE_PARTIAL', message: '已读取页面正文，但未获得完整的作者、发布时间、互动数据和媒体结构。' }]
        return { category: 'social', subtype: classification.subtype, source, payload, preview: { title: payload.title, description: payload.bodyText.slice(0, 160), thumbnailUrl: page.thumbnailUrl, badge: classification.badge, meta: [payload.author?.name, payload.publishedAt].filter(Boolean) as string[] }, warnings, partial: !page.social }
      } catch (error) {
        const payload: SocialPayload = { kind: 'social', platform: classification.socialPlatform || 'generic', canonicalUrl: normalized, title: `${classification.badge}内容`, bodyText: '', contentBlocks: [] }
        return {
          category: 'social', subtype: classification.subtype, source, payload,
          preview: { title: `${classification.badge}内容`, description: '已保留原始链接', badge: classification.badge },
          warnings: [remoteServiceWarning(error, `${classification.badge}内容`)], partial: true,
        }
      }
    }
    if (classification.provider === 'bilibili' || classification.provider === 'vimeo') {
      try {
        const page = await getContentServiceClient('webPage').scrapeWeb(normalized, { timeoutMs: 8_000 })
        const title = page.title || (classification.provider === 'bilibili' ? 'Bilibili 视频' : 'Vimeo 视频')
        return {
          category: 'video', subtype: classification.subtype, source,
          payload: {
            kind: 'video', provider: classification.provider, playback: 'preview', url: page.canonicalUrl || normalized,
            title, duration: page.duration, width: page.width, height: page.height,
          },
          preview: {
            title,
            description: page.content.slice(0, 160),
            thumbnailUrl: page.thumbnailUrl,
            badge: classification.badge,
            meta: [page.authorName, formatMediaDuration(page.duration)].filter(Boolean) as string[],
          },
        }
      } catch (error) {
        const parsedUrl = new URL(normalized)
        const idFallback = parsedUrl.pathname.split('/').filter(Boolean).pop() || parsedUrl.hostname
        return {
          category: 'video', subtype: classification.subtype, source,
          payload: { kind: 'video', provider: classification.provider, playback: 'preview', url: normalized, title: idFallback },
          preview: { title: idFallback, description: '已保留原始链接', badge: classification.badge },
          warnings: [remoteServiceWarning(error, `${classification.badge} 视频信息`)], partial: true,
        }
      }
    }

    const parsedUrl = new URL(normalized)
    const titleFallback = parsedUrl.pathname.split('/').filter(Boolean).pop() || parsedUrl.hostname
    const isDirectImage = classification.category === 'image' && /\.(png|jpe?g|gif|webp|avif|svg)(?:$|\/)/.test(parsedUrl.pathname.toLowerCase())
    if (classification.category === 'image') {
      const preview = isDirectImage ? { page: null, error: undefined } : await scrapePreview(normalized)
      const page = preview.page
      const warnings = isDirectImage ? undefined : [preview.error ? remoteServiceWarning(preview.error, '图片页面预览') : previewOnlyWarning('图片页面')]
      return {
        category: 'image',
        subtype: 'image',
        source,
        payload: { kind: 'image' },
        preview: {
          title: page?.title || titleFallback || '图片',
          description: page?.content.slice(0, 160),
          thumbnailUrl: isDirectImage ? normalized : page?.thumbnailUrl,
          badge: classification.badge,
        },
        warnings,
        partial: !isDirectImage,
      }
    }

    if (classification.category === 'video' && classification.playback !== 'preview') {
      const isAudio = classification.playback === 'audio'
      return {
        category: 'video',
        subtype: classification.subtype,
        source,
        payload: { kind: 'video', provider: isAudio ? 'podcast' : 'direct', playback: classification.playback, url: normalized },
        preview: {
          title: titleFallback || (isAudio ? '音频' : '视频'),
          badge: classification.badge,
        },
      }
    }

    const preview = await scrapePreview(normalized)
    const page = preview.page
    const title = page?.title || (classification.provider === 'notion' ? 'Notion 文档' : titleFallback)
    const description = page?.content.slice(0, 160) || ''
    const warnings = preview.error
      ? [remoteServiceWarning(preview.error, classification.badge)]
      : classification.provider === 'feishu-doc' && page?.content
        ? undefined
        : [previewOnlyWarning(classification.badge)]

    if (classification.category === 'video') {
      const provider = classification.provider === 'podcast' ? 'podcast' : 'generic'
      return { category: 'video', subtype: classification.subtype, source, payload: { kind: 'video', provider, playback: 'preview', url: normalized, title }, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: true }
    }
    if (classification.category === 'social') {
      const payload: SocialPayload = {
        kind: 'social',
        platform: classification.socialPlatform || 'generic',
        canonicalUrl: page?.canonicalUrl || normalized,
        title,
        bodyText: page?.content || '',
        contentBlocks: page?.content ? [{ type: 'text', text: page.content }] : [],
      }
      return { category: 'social', subtype: classification.subtype, source, payload, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: true }
    }
    if (classification.category === 'data') {
      return { category: 'data', subtype: classification.subtype, source, payload: { kind: 'data', sheets: [] }, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: true }
    }
    if (classification.category === 'presentation') {
      return { category: 'presentation', subtype: classification.subtype, source, payload: { kind: 'presentation', title }, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: true }
    }
    if (classification.category === 'mindmap') {
      return { category: 'mindmap', subtype: classification.subtype, source, payload: { kind: 'mindmap', root: { id: nanoid(), text: title, children: [] } }, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: true }
    }
    return { category: 'document', subtype: classification.subtype, source, payload: { kind: 'document', rawText: page?.content || '', plainText: page?.content || '' }, preview: { title, description, thumbnailUrl: page?.thumbnailUrl, badge: classification.badge }, warnings, partial: Boolean(warnings?.length) }
  }

  const checksum = await checksumText(text)
  const source: ContentSource = { kind: 'text', text, checksum, mimeType: 'text/plain' }
  const isMindmap = categoryHint === 'mindmap' || (!categoryHint && looksLikeMarkdownMindmap(text))
  const isMarkdown = isMindmap || /(^|\n)#{1,6}\s+|(^|\n)\s*[-*+]\s+/m.test(text)
  if (isMindmap) {
    const subtype = looksLikeMarkdownMindmap(text) ? 'mermaid-mindmap' : 'markdown-mindmap'
    onDetected?.({ category: 'mindmap', subtype })
    return {
      category: 'mindmap',
      subtype,
      source,
      payload: looksLikeMarkdownMindmap(text) ? mermaidToMindmap(text) : markdownToMindmap(text),
      preview: { title: 'Markdown 思维导图', badge: '思维导图' },
    }
  }
  const subtype = isMarkdown ? 'markdown' : 'plain-text'
  if (categoryHint === 'document') {
    onDetected?.({ category: 'document', subtype })
    const payload: DocumentPayload = { kind: 'document', rawText: text, plainText: isMarkdown ? markdownPlainText(text) : text, headings: isMarkdown ? markdownHeadings(text) : undefined }
    return { category: 'document', subtype, source: { ...source, mimeType: isMarkdown ? 'text/markdown' : 'text/plain' }, payload, preview: { title: isMarkdown ? 'Markdown 文档' : '文本文档', badge: isMarkdown ? 'Markdown' : 'TXT', meta: [`${text.length} 字符`] } }
  }
  onDetected?.({ category: 'text', subtype })
  return {
    category: 'text',
    subtype,
    source: { ...source, mimeType: isMarkdown ? 'text/markdown' : 'text/plain' },
    payload: { kind: 'text', value: text, format: isMarkdown ? 'markdown' : 'plain' },
    preview: { title: '文本', badge: isMarkdown ? 'Markdown' : '文本', meta: [`${text.length} 字符`] },
  }
}

export async function resolveSourceBlob(source: ContentSource | null) {
  if (!source || (source.kind !== 'file' && source.kind !== 'clipboard-image')) return null
  return loadLocalResourceBlob(source.resourceId)
}

export function emptyContentData(label = '内容'): ContentNodeData {
  return { schemaVersion: 2, label, category: null, subtype: null, state: 'empty', source: null }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
