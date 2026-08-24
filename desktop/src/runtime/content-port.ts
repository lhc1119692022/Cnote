import type { ContentParseInput, ContentPort, ParsedPageContent } from './types'

const PARSER_ID = 'cnote-native-html'
const PARSER_VERSION = '1.0.0'
const MAX_HTML_BYTES = 12 * 1024 * 1024

function decodeEntities(value: string) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function cleanText(value: string) {
  return decodeEntities(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'i'))
  return match ? decodeEntities(match[1] || match[2] || '') : ''
}

function toAbsoluteUrl(value: string, baseUrl: string) {
  if (!value) return ''
  try {
    return new URL(value, baseUrl || undefined).toString()
  } catch {
    return value
  }
}

function stripMarkup(html: string) {
  return cleanText(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<\/div\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

export class NativeContentPort implements ContentPort {
  async parseHtml(input: ContentParseInput): Promise<ParsedPageContent> {
    const html = String(input.html || '')
    const warnings: string[] = []
    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
      warnings.push('HTML 超过 12 MiB，已截断后解析。')
    }
    const source = html.slice(0, MAX_HTML_BYTES)
    const baseUrl = String(input.url || '')
    const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    const descriptionMatch = source.match(/<meta\b[^>]*name=["']description["'][^>]*>/i)
    const title = cleanText(String(input.title || (titleMatch ? titleMatch[1] : '') || baseUrl))
    const description = descriptionMatch ? cleanText(attribute(descriptionMatch[0], 'content')) : undefined

    const headings: Array<{ level: number; text: string }> = []
    for (const match of source.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const text = stripMarkup(match[2])
      if (text) headings.push({ level: Number(match[1]), text })
    }

    const links: Array<{ text: string; url: string }> = []
    for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const url = toAbsoluteUrl(attribute(match[1], 'href'), baseUrl)
      const text = stripMarkup(match[2])
      if (url && text) links.push({ text, url })
      if (links.length >= 500) break
    }

    let text = stripMarkup(source)
    if (!text && input.title) text = cleanText(input.title)
    if (!text) warnings.push('页面没有提取到正文文本。')

    return {
      url: baseUrl,
      title,
      ...(description ? { description } : {}),
      text,
      headings,
      links,
      parserId: PARSER_ID,
      parserVersion: PARSER_VERSION,
      warnings,
    }
  }
}
