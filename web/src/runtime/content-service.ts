/**
 * Content parse adapter.
 *
 * Desktop uses native:content-parse. Web preview falls back to tag-stripping.
 * This module does not touch DOM or store.
 */

import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'

/** 与 desktop ParsedPageContent 对齐的最小接口（web 不直接依赖 desktop 包）。 */
export interface ParsedPageContent {
  url: string
  title: string
  description?: string
  text: string
  headings: Array<{ level: number; text: string }>
  links: Array<{ text: string; url: string }>
  parserId: string
  parserVersion: string
  warnings: string[]
}

export interface ContentParser {
  parse(input: { html: string; url?: string; title?: string }): Promise<ParsedPageContent>
}

export function desktopContentParser(): ContentParser {
  return {
    parse(input) {
      return runDesktopNativeJob<ParsedPageContent>({
        kind: 'native:content-parse',
        input: { html: input.html, url: input.url, title: input.title },
      })
    },
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 无桌面解析器时的文本降级，不做完整抽取。 */
export function passthroughContentParser(): ContentParser {
  return {
    async parse(input) {
      return {
        url: input.url ?? '',
        title: input.title ?? '',
        text: stripHtml(input.html),
        headings: [],
        links: [],
        parserId: 'cnote-passthrough',
        parserVersion: '1.0.0',
        warnings: ['无桌面解析器，使用文本降级'],
      }
    },
  }
}
