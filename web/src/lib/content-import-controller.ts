import { nanoid } from 'nanoid'
import { detectAndParseContent, markdownPlainText, markdownToMindmap, resolveSourceBlob, type ContentImportInput } from '@/lib/content-import'
import { checksumText, deleteLocalResource } from '@/lib/resource-storage'
import { useFlowStore } from '@/stores/use-flow-store'
import { getContentServiceClient } from '@/lib/content-service'
import { ScraperClient, ScraperRequestError } from '@/lib/scraper'
import type { BrowserNodeData, ContentCategory, ContentNodeData, ContentSource, ParseError } from '@/types/flow'
import type { Node } from 'reactflow'
import { getNodeMediaItems, type ContentMediaKind } from '@/lib/content-media'

const categoryLabels: Record<ContentCategory, string> = {
  text: '文本', video: '视频', social: '社媒', document: '文档', data: '数据', presentation: '演示文稿', mindmap: '思维导图', image: '图片',
}

function isGeneratedContentLabel(value: unknown) {
  if (typeof value !== 'string') return false
  const escapedLabels = Object.values(categoryLabels).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^(?:内容|${escapedLabels.join('|')})节点?(?: \\(\\d+\\))?$`).test(value)
}

function isGeneratedYouTubeTitle(value: unknown, videoId: string) {
  return typeof value !== 'string' || !value.trim() || value === 'YouTube 视频' || value === `YouTube ${videoId}`
}

async function fetchPublicYouTubeMetadata(videoId: string, sourceUrl: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const endpoint = new URL('https://noembed.com/embed')
    endpoint.searchParams.set('url', sourceUrl)
    const response = await fetch(endpoint, { signal: controller.signal })
    if (!response.ok) return undefined
    const payload = await response.json() as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown }
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    if (!title || title === `YouTube ${videoId}`) return undefined
    return {
      title,
      authorName: typeof payload.author_name === 'string' ? payload.author_name.trim() || undefined : undefined,
      thumbnailUrl: typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url.trim() || undefined : undefined,
    }
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timeout)
  }
}

function localResourceId(source?: ContentSource | null) {
  return source?.kind === 'file' || source?.kind === 'clipboard-image' ? source.resourceId : undefined
}

function inferTextFormat(value: string) {
  return /(^|\n)#{1,6}\s+|(^|\n)\s*[-*+]\s+/m.test(value) ? 'markdown' as const : 'plain' as const
}

// The connection callback and the unsynced-text effect can both request a
// refresh for the same target. Serialize each target to keep graph updates
// outside React Flow's active connection transaction.
const textRefreshPromises = new Map<string, Promise<boolean>>()

export function extractTextFromNode(node?: Node) {
  if (!node) return ''
  const data = node.data || {}
  if (node.type === 'content') {
    const payload = (data as ContentNodeData).payload
    if (payload?.kind === 'text') return payload.value
    if (payload?.kind === 'document') return payload.plainText || payload.rawText || ''
    if (payload?.kind === 'social') {
      const blockText = payload.contentBlocks.flatMap((block) => {
        if (block.type === 'text') return block.text.trim() ? [block.text.trim()] : []
        if (block.type === 'mention') return [`@${block.name}`]
        if (block.type === 'link') return [block.title || block.url]
        return []
      })
      const topicText = payload.topics?.length ? payload.topics.map((topic) => `#${topic}`).join(' ') : ''
      const attribution = [payload.author?.name, payload.publishedAt].filter(Boolean).join(' · ')
      const metrics = payload.metrics
        ? [
            payload.metrics.likes !== undefined ? `赞 ${payload.metrics.likes}` : '',
            payload.metrics.collects !== undefined ? `藏 ${payload.metrics.collects}` : '',
            payload.metrics.comments !== undefined ? `评 ${payload.metrics.comments}` : '',
            payload.metrics.shares !== undefined ? `转 ${payload.metrics.shares}` : '',
          ].filter(Boolean).join(' · ')
        : ''
      return Array.from(new Set([payload.title, payload.bodyText, ...blockText, topicText, attribution, metrics].map((value) => value.trim()).filter(Boolean))).join('\n\n')
    }
    if (payload?.kind === 'video') {
      return [payload.title, payload.transcript]
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean)
        .join('\n\n')
    }
    if (payload?.kind === 'presentation') return payload.slides?.map((slide) => slide.text).filter(Boolean).join('\n\n') || payload.outline?.join('\n') || ''
    if (payload?.kind === 'mindmap') {
      const lines: string[] = []
      const visit = (item: typeof payload.root, depth: number) => {
        lines.push(`${'  '.repeat(depth)}${item.text}`)
        item.children.forEach((child) => visit(child, depth + 1))
      }
      visit(payload.root, 0)
      return lines.join('\n')
    }
    if (payload?.kind === 'data') {
      return payload.sheets.flatMap((sheet) => [sheet.columns.join('\t'), ...sheet.rows.map((row) => row.join('\t'))]).join('\n')
    }
    const source = (data as ContentNodeData).source
    if (source?.kind === 'text') return source.text
    return ''
  }
  if (node.type === 'ai') return data.output || [...(data.messages || [])].reverse().find((message: { role?: string }) => message.role === 'assistant')?.content || ''
  if (node.type === 'browser') {
    const browserData = data as BrowserNodeData
    const url = String(browserData.confirmedUrl || browserData.url || '').trim()
    const text = String(browserData.snapshot?.text || browserData.extractedContent || '').trim()
    const outputMode = browserData.outputMode || (browserData.extractedContent ? 'text' : 'url')
    if (outputMode === 'url') return url
    if (outputMode === 'text') return text
    return [url, text].filter(Boolean).join('\n\n')
  }
  if (node.type === 'sticky') return data.content || ''
  return typeof data.text === 'string' ? data.text : ''
}

/** Whether a node kind is a supported source for a downstream text node. */
export function canNodeOutputText(node?: Node) {
  if (!node) return false
  if (node.type === 'ai' || node.type === 'browser') return true
  if (node.type !== 'content') return false

  const data = node.data as ContentNodeData
  if (['text', 'social', 'document', 'mindmap', 'data'].includes(data.category || '')) return true
  // Video nodes only participate when backed by a URL; local media is not a
  // text source until a separate transcript pipeline explicitly exposes one.
  return data.category === 'video' && data.source?.kind === 'url'
}

export function canNodeOutputMedia(node: Node | undefined, kind: ContentMediaKind) {
  return getNodeMediaItems(node, kind).length > 0
}

/** Materialize connected media as the target node's own resource collection. */
export function refreshMediaFromUpstream(nodeId: string, kind: ContentMediaKind) {
  const flowStore = useFlowStore.getState()
  const target = flowStore.nodes.find((node) => node.id === nodeId)
  if (!target || target.type !== 'content' || target.data?.category !== kind) return false

  const items = flowStore.edges
    .filter((edge) => edge.target === nodeId)
    .flatMap((edge) => getNodeMediaItems(flowStore.nodes.find((node) => node.id === edge.source), kind))
  const seen = new Set<string>()
  const resources = items.filter((item) => item.resource.url && !seen.has(item.resource.url) && Boolean(seen.add(item.resource.url)))
  if (!resources.length) return false

  const data = target.data as ContentNodeData
  const countLabel = `${resources.length} 个${kind === 'image' ? '图片' : '视频'}资源`
  const payload = kind === 'image'
    ? { kind: 'image' as const, resources, activeResourceIndex: 0, alt: resources[0]?.label }
    : { kind: 'video' as const, provider: 'direct' as const, playback: 'video' as const, resources, activeResourceIndex: 0, title: resources[0]?.label }
  flowStore.updateNode(nodeId, {
    type: 'content',
    data: {
      ...data,
      schemaVersion: 2,
      category: kind,
      subtype: kind === 'image' ? 'image' : 'remote-video',
      state: 'ready',
      source: null,
      payload,
      preview: { title: resources[0]?.label || `${kind === 'image' ? '图片' : '视频'}资源`, badge: kind === 'image' ? '图片' : '视频', meta: [countLabel] },
      parse: undefined,
      resourceLost: false,
      disabled: false,
    } satisfies ContentNodeData,
  })
  flowStore.addToHistory()
  flowStore.saveCurrentFlow()
  return true
}

export function getUpstreamText(nodeId: string) {
  const { nodes, edges } = useFlowStore.getState()
  const sourceIds = edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)
  const entries = sourceIds.flatMap((sourceId) => {
    const source = nodes.find((node) => node.id === sourceId)
    if (!canNodeOutputText(source)) return []
    const text = extractTextFromNode(source).trim()
    return text ? [{ sourceId, text }] : []
  })
  return {
    sourceIds: entries.map((entry) => entry.sourceId),
    text: entries.map((entry) => entry.text).join('\n\n'),
    sourceSignature: entries.map((entry) => `${entry.sourceId}:${entry.text}`).join('\n---\n'),
  }
}

export function textNodeNeedsUpstreamRefresh(nodeId: string) {
  const { nodes, edges } = useFlowStore.getState()
  const target = nodes.find((node) => node.id === nodeId)
  if (target?.type !== 'content' || target.data?.category !== 'text') return false

  const upstream = getUpstreamText(nodeId)
  if (!upstream.text.trim()) return false
  const currentText = extractTextFromNode(target).trim()
  if (!currentText || !target.data?.upstreamSync) return true

  // Flows created before video text output was corrected stored the source URL
  // in their text node. Replace only that known legacy value, never a manual
  // user edit made after the first sync.
  const legacyUrls = edges
    .filter((edge) => edge.target === nodeId)
    .flatMap((edge) => {
      const source = nodes.find((node) => node.id === edge.source)
      if (source?.type !== 'content' || source.data?.payload?.kind !== 'video') return []
      const sourceUrl = source.data.source?.kind === 'url'
        ? source.data.source.normalizedUrl
        : source.data.payload.url
      return typeof sourceUrl === 'string' && sourceUrl.trim() ? [sourceUrl.trim()] : []
    })
  return legacyUrls.includes(currentText)
}

async function populateNodeTextOutput(nodeId: string) {
  const initial = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!initial || !canNodeOutputText(initial)) return false

  if (initial.type === 'browser') {
    const data = initial.data as BrowserNodeData
    const url = String(data.confirmedUrl || data.url || '').trim()
    if (!url) return false
    const outputMode = data.outputMode || (data.extractedContent ? 'text' : 'url')
    if (outputMode === 'url') return true
    if (data.extractedContent?.trim()) return true
    if (data.snapshot?.url === url && data.snapshot.text.trim()) return true

    try {
      const page = await getContentServiceClient('webPage').scrapeWeb(url, { timeoutMs: 5_000 })
      const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
      if (!current || current.type !== 'browser') return false
      useFlowStore.getState().updateNode(nodeId, {
        data: {
          ...current.data,
          snapshot: { url, title: page.title, text: page.content, fetchedAt: Date.now() },
        },
      })
      useFlowStore.getState().saveCurrentFlow()
      return Boolean(page.content.trim())
    } catch {
      return false
    }
  }

  if (initial.type === 'content') {
    const data = initial.data as ContentNodeData
    if (data.category === 'video' && data.source?.kind === 'url') {
      if (data.payload?.kind === 'video' && data.payload.provider === 'youtube' && !data.payload.transcript) {
        await refreshYouTubeTranscript(nodeId, { syncDownstream: false })
      }
      return true
    }
    if (data.category !== 'text' && data.source?.kind === 'url' && !extractTextFromNode(initial).trim()) {
      return reparseContentNode(nodeId)
    }
  }

  return Boolean(extractTextFromNode(initial).trim())
}

async function refreshTextFromUpstreamInternal(nodeId: string) {
  try {
    const sourceIds = useFlowStore.getState().edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => edge.source)
    await Promise.all(sourceIds.map((sourceId) => populateNodeTextOutput(sourceId)))
    const upstream = getUpstreamText(nodeId)
    if (!upstream.text) return false

    // Refresh is an explicit downstream sync action. It must replace existing
    // text instead of being mistaken for an in-progress manual edit.
    const saved = await saveTextContentToNode(nodeId, upstream.text, false, { overwrite: true })
    if (!saved) return false
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current) return false
    const sourceSignature = await checksumText(upstream.sourceSignature)
    const latest = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!latest) return false
    useFlowStore.getState().updateNode(nodeId, {
      data: {
        ...latest.data,
        upstreamSync: { sourceIds: upstream.sourceIds, sourceSignature, syncedAt: Date.now() },
      },
    })
    useFlowStore.getState().saveCurrentFlow()
    return true
  } catch (error) {
    console.warn('刷新上游文本失败:', error)
    return false
  }
}

export function refreshTextFromUpstream(nodeId: string) {
  const existing = textRefreshPromises.get(nodeId)
  if (existing) return existing
  const refresh = refreshTextFromUpstreamInternal(nodeId).finally(() => {
    if (textRefreshPromises.get(nodeId) === refresh) textRefreshPromises.delete(nodeId)
  })
  textRefreshPromises.set(nodeId, refresh)
  return refresh
}

export async function reparseContentNode(nodeId: string) {
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node || node.type !== 'content') return false
  const data = node.data as ContentNodeData
  if (!data.source && data.parse?.retryText) {
    await importContentIntoNode(nodeId, { kind: 'text', text: data.parse.retryText }, data.category || undefined)
    return true
  }
  if (data.source?.kind === 'url') {
    await importContentIntoNode(nodeId, { kind: 'text', text: data.source.normalizedUrl }, data.category || undefined)
    return true
  }
  if (data.source?.kind === 'text') {
    await importContentIntoNode(nodeId, { kind: 'text', text: data.source.text }, data.category || undefined)
    return true
  }
  if (data.source?.kind === 'file' || data.source?.kind === 'clipboard-image') {
    const blob = await resolveSourceBlob(data.source)
    if (!blob) return false
    await importContentIntoNode(nodeId, {
      kind: 'file',
      file: blob,
      fileName: data.source.kind === 'file' ? data.source.fileName : 'clipboard-image',
      clipboardImage: data.source.kind === 'clipboard-image',
    }, data.category || undefined)
    return true
  }
  return false
}

export async function refreshDownstreamTextNodes(sourceId: string) {
  const { nodes, edges } = useFlowStore.getState()
  const targetIds = Array.from(new Set(
    edges
      .filter((edge) => edge.source === sourceId)
      .map((edge) => edge.target)
      .filter((targetId) => {
        const target = nodes.find((node) => node.id === targetId)
        return target?.type === 'content' && target.data?.category === 'text'
      }),
  ))
  await Promise.all(targetIds.map((targetId) => refreshTextFromUpstream(targetId)))
}

function refreshDownstreamMediaNodes(sourceId: string) {
  const { nodes, edges } = useFlowStore.getState()
  edges.filter((edge) => edge.source === sourceId).forEach((edge) => {
    const target = nodes.find((node) => node.id === edge.target)
    if (target?.type === 'content' && (target.data?.category === 'image' || target.data?.category === 'video')) {
      refreshMediaFromUpstream(target.id, target.data.category)
    }
  })
}

export async function refreshYouTubeTranscript(
  nodeId: string,
  options?: { syncDownstream?: boolean },
) {
  const initial = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  const payload = initial?.data?.payload
  if (!initial || payload?.kind !== 'video' || payload.provider !== 'youtube' || !payload.url) return false
  const videoId = ScraperClient.extractVideoId(payload.url)
  if (!videoId) return false
  const sourceUrl = payload.url
  const publicMetadataPromise = fetchPublicYouTubeMetadata(videoId, sourceUrl)
  useFlowStore.getState().updateNode(nodeId, { data: { ...initial.data, payload: { ...payload, transcriptStatus: 'loading' } } })
  try {
    const [result, publicMetadata] = await Promise.all([
      getContentServiceClient('youtubeTranscript').fetchYouTubeSubtitles(videoId),
      publicMetadataPromise,
    ])
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current || current.data?.payload?.kind !== 'video' || current.data.payload.url !== sourceUrl) return false
    const transcriptError = result.transcriptError
    const warning = transcriptError
      ? {
          code: transcriptError.code || 'TRANSCRIPT_UNAVAILABLE',
          message: transcriptError.code === 'RATE_LIMITED'
            ? '字幕请求频率受限，可稍后点击刷新重试。'
            : `字幕获取失败：${transcriptError.message || '请稍后重试'}`,
        }
      : result.warning
        ? { code: 'TRANSCRIPT_UNAVAILABLE', message: result.warning }
        : undefined
    const nextTitle = result.title?.trim() || publicMetadata?.title
    const existingTitle = current.data.payload.title
    const updateTitle = Boolean(nextTitle && isGeneratedYouTubeTitle(existingTitle, videoId))
    const existingPreviewTitle = current.data.preview?.title
    const updatePreviewTitle = Boolean(nextTitle && isGeneratedYouTubeTitle(existingPreviewTitle, videoId))
    const transcriptStatus = transcriptError ? 'error' : warning ? 'unavailable' : 'ready'
    useFlowStore.getState().updateNode(nodeId, {
      data: {
        ...current.data,
        state: warning ? 'partial' : 'ready',
        payload: {
          ...current.data.payload,
          title: updateTitle ? nextTitle : existingTitle,
          transcript: result.subtitles,
          transcriptStatus,
        },
        preview: {
          ...current.data.preview,
          title: updatePreviewTitle ? nextTitle : existingPreviewTitle,
          thumbnailUrl: result.thumbnailUrl || publicMetadata?.thumbnailUrl || current.data.preview?.thumbnailUrl,
          meta: (result.authorName || publicMetadata?.authorName)
            ? Array.from(new Set([result.authorName || publicMetadata?.authorName || '', ...(current.data.preview?.meta || [])])).filter(Boolean)
            : current.data.preview?.meta,
        },
        parse: { ...current.data.parse, warnings: warning ? [warning] : undefined },
      },
    })
    useFlowStore.getState().saveCurrentFlow()
    if (options?.syncDownstream !== false && result.subtitles.trim()) {
      await refreshDownstreamTextNodes(nodeId)
    }
    return !warning
  } catch (error) {
    const publicMetadata = await publicMetadataPromise
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current || current.data?.payload?.kind !== 'video' || current.data.payload.url !== sourceUrl) return false
    const code = error instanceof ScraperRequestError ? error.code : 'SERVICE_UNREACHABLE'
    const message = error instanceof ScraperRequestError && error.code === 'SERVICE_NOT_CONFIGURED'
      ? '尚未配置内容解析服务；视频可以正常播放，字幕需要在设置中连接你自己的服务。'
      : error instanceof ScraperRequestError && error.code === 'SERVICE_CAPABILITY_UNAVAILABLE'
        ? '当前内容解析服务不支持 YouTube 字幕，请更新服务后重试。'
        : error instanceof ScraperRequestError && error.code === 'RATE_LIMITED'
          ? '字幕请求频率受限，可稍后点击刷新重试。'
          : `字幕获取失败：${error instanceof Error ? error.message : '内容解析服务不可达'}`
    useFlowStore.getState().updateNode(nodeId, {
      data: {
        ...current.data,
        state: 'partial',
        payload: {
          ...current.data.payload,
          title: publicMetadata?.title && isGeneratedYouTubeTitle(current.data.payload.title, videoId) ? publicMetadata.title : current.data.payload.title,
          transcriptStatus: code === 'SERVICE_NOT_CONFIGURED' ? 'unavailable' : 'error',
        },
        preview: {
          ...current.data.preview,
          title: publicMetadata?.title && isGeneratedYouTubeTitle(current.data.preview?.title, videoId) ? publicMetadata.title : current.data.preview?.title,
          thumbnailUrl: publicMetadata?.thumbnailUrl || current.data.preview?.thumbnailUrl,
          meta: publicMetadata?.authorName
            ? Array.from(new Set([publicMetadata.authorName, ...(current.data.preview?.meta || [])]))
            : current.data.preview?.meta,
        },
        parse: { ...current.data.parse, warnings: [{ code, message }] },
      },
    })
    useFlowStore.getState().saveCurrentFlow()
    return false
  }
}

export async function saveTextContentToNode(
  nodeId: string,
  value: string,
  richText = false,
  options?: { overwrite?: boolean },
) {
  const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!current) return false
  const format = richText ? 'rich-text' as const : inferTextFormat(value)
  const checksum = await checksumText(value)
  const latest = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!latest || latest.data?.state === 'detecting' || latest.data?.state === 'parsing' || (!options?.overwrite && latest.data?.payload?.kind === 'text' && latest.data.payload.value !== value)) return false
  const flowStore = useFlowStore.getState()
  flowStore.updateNode(nodeId, {
    type: 'content',
    data: {
      ...latest.data,
      schemaVersion: 2,
      label: latest.data?.label && !isGeneratedContentLabel(latest.data.label) ? latest.data.label : '文本节点',
      category: 'text',
      subtype: format === 'plain' ? 'plain-text' : 'markdown',
      state: value.trim() ? 'ready' : 'empty',
      source: value ? { kind: 'text', text: value, checksum, mimeType: format === 'plain' ? 'text/plain' : 'text/markdown' } : null,
      payload: {
        kind: 'text',
        value,
        format,
        document: richText ? { version: 1, source: value, format: 'markdown', plainText: markdownPlainText(value) } : undefined,
      },
      preview: { title: '文本', badge: richText ? '富文本' : format === 'markdown' ? 'Markdown' : '文本', meta: [`${markdownPlainText(value).length} 字符`] },
      parse: undefined,
      resourceLost: false,
      disabled: false,
    } satisfies ContentNodeData,
  })
  flowStore.addToHistory()
  flowStore.saveCurrentFlow()
  return true
}

export async function saveMindmapContentToNode(nodeId: string, sourceMarkdown: string) {
  const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!current) return
  const payload = markdownToMindmap(sourceMarkdown)
  const checksum = await checksumText(sourceMarkdown)
  const latest = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!latest || latest.data?.state === 'detecting' || latest.data?.state === 'parsing') return
  const flowStore = useFlowStore.getState()
  flowStore.updateNode(nodeId, {
    type: 'content',
    data: {
      ...latest.data,
      schemaVersion: 2,
      label: latest.data?.label && !isGeneratedContentLabel(latest.data.label) ? latest.data.label : '思维导图节点',
      category: 'mindmap',
      subtype: 'markdown-mindmap',
      state: sourceMarkdown.trim() ? 'ready' : 'empty',
      source: sourceMarkdown ? { kind: 'text', text: sourceMarkdown, checksum, mimeType: 'text/markdown' } : null,
      payload,
      preview: { title: payload.root.text || '无主题', badge: '思维导图', meta: [`${sourceMarkdown.split(/\r?\n/).filter((line) => line.trim()).length} 项`] },
      parse: undefined,
      resourceLost: false,
      disabled: false,
    } satisfies ContentNodeData,
  })
  flowStore.addToHistory()
  flowStore.saveCurrentFlow()
}

export async function importContentIntoNode(nodeId: string, input: ContentImportInput, categoryHint?: ContentCategory) {
  if (categoryHint === 'text' && input.kind === 'text') {
    await saveTextContentToNode(nodeId, input.text)
    return
  }
  const initial = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
  if (!initial) return
  const previousSource = initial.data?.source as ContentSource | null | undefined
  const previousRevision = Number(initial.data?.parse?.revision || 0)
  const revision = previousRevision + 1
  const requestId = nanoid()
  const startedAt = Date.now()
  useFlowStore.getState().updateNode(nodeId, {
    type: 'content',
    data: {
      ...initial.data,
      schemaVersion: 2,
      state: input.kind === 'file' ? 'importing' : 'detecting',
      category: categoryHint || initial.data?.category || null,
      subtype: null,
      parse: { requestId, revision, startedAt, progress: 0 },
      resourceLost: false,
      disabled: false,
    } satisfies ContentNodeData,
  })

  try {
    const result = await detectAndParseContent(input, categoryHint, (detected) => {
      const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
      if (!current || current.data?.parse?.requestId !== requestId) return
      useFlowStore.getState().updateNode(nodeId, { data: { ...current.data, category: detected.category, subtype: detected.subtype, state: 'parsing', parse: { ...current.data.parse, progress: 0.35 } } })
    })
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current || current.data?.parse?.requestId !== requestId || current.data?.parse?.revision !== revision) {
      await deleteLocalResource(localResourceId(result.source))
      return
    }
    const oldResourceId = localResourceId((current.data as ContentNodeData).source)
    const newResourceId = localResourceId(result.source)
    if (oldResourceId === newResourceId && newResourceId) {
      await deleteLocalResource(newResourceId)
    } else if (oldResourceId) {
      await deleteLocalResource(oldResourceId)
    }
    const flowStore = useFlowStore.getState()
    flowStore.updateNode(nodeId, {
      type: 'content',
      data: {
        ...current.data,
        label: current.data?.label && !isGeneratedContentLabel(current.data.label) ? current.data.label : `${categoryLabels[result.category]}节点`,
        category: result.category,
        subtype: result.subtype,
        state: result.partial ? 'partial' : 'ready',
        source: result.source,
        payload: result.payload,
        preview: result.preview,
        parse: { ...current.data.parse, parserId: result.subtype, parserVersion: '1.0.0', sourceChecksum: 'checksum' in result.source ? result.source.checksum : undefined, progress: 1, completedAt: Date.now(), warnings: result.warnings, error: undefined, retryText: undefined },
      } satisfies ContentNodeData,
    })
    flowStore.addToHistory()
    flowStore.saveCurrentFlow()
    void refreshDownstreamTextNodes(nodeId)
    refreshDownstreamMediaNodes(nodeId)
    if (result.payload.kind === 'video' && result.payload.provider === 'youtube' && !result.payload.transcript) {
      void refreshYouTubeTranscript(nodeId)
    }
  } catch (error) {
    const current = useFlowStore.getState().nodes.find((node) => node.id === nodeId)
    if (!current || current.data?.parse?.requestId !== requestId) return
    const typedError = typeof error === 'object' && error !== null ? error as { code?: unknown; retryable?: unknown } : undefined
    const code = typeof typedError?.code === 'string' ? typedError.code : 'PARSER_ERROR'
    const retryable = typeof typedError?.retryable === 'boolean' ? typedError.retryable : !['UNSUPPORTED_TYPE', 'INVALID_CONTENT'].includes(code)
    const parseError: ParseError = { code, message: error instanceof Error ? error.message : '内容解析失败', retryable }
    const retryText = input.kind === 'text' ? input.text : undefined
    useFlowStore.getState().updateNode(nodeId, {
      data: {
        ...current.data,
        source: previousSource || current.data.source,
        state: code === 'UNSUPPORTED_TYPE' ? 'unsupported' : 'error',
        parse: { ...current.data.parse, completedAt: Date.now(), error: parseError, retryText },
      },
    })
  }
}
