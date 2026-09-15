/**
 * Browser session / tab lifecycle.
 *
 * Store is the source of truth. Adapter talks to an already-mounted webview.
 * Missing session/tab always throws — callers must not swallow existence checks.
 */

import { nanoid } from 'nanoid'
import type { BrowserSession, BrowserTab, Capture, CaptureMedia } from '@/domain'
import { useRuntimeStore, type RuntimeStore } from '@/stores/runtime-store'
import type { BrowserAdapter } from './browser-adapter'
import type { ContentParser } from './content-service'

export type RuntimeStoreGetter = () => RuntimeStore

export interface BrowserSessionManagerOptions {
  adapter: BrowserAdapter
  contentParser: ContentParser
  getStore?: RuntimeStoreGetter
}

export class BrowserSessionManager {
  private readonly adapter: BrowserAdapter
  private readonly contentParser: ContentParser
  private readonly getStore: RuntimeStoreGetter

  constructor(options: BrowserSessionManagerOptions) {
    this.adapter = options.adapter
    this.contentParser = options.contentParser
    this.getStore = options.getStore ?? (() => useRuntimeStore.getState())
  }

  createSession(partition?: string): BrowserSession {
    return this.getStore().createSession(partition)
  }

  addTab(sessionId: string, url: string): BrowserTab {
    this.requireSession(sessionId)
    return this.getStore().addTab(sessionId, url)
  }

  activateTab(sessionId: string, tabId: string): void {
    this.requireTab(sessionId, tabId)
    this.getStore().setSessionActiveTab(sessionId, tabId)
  }

  closeTab(sessionId: string, tabId: string): void {
    this.requireTab(sessionId, tabId)
    this.getStore().removeTab(sessionId, tabId)
  }

  /**
   * Desktop: adapter.loadURL. iframe 分支不要走此方法，由 React 改 tab.url 驱动。
   * 成功前只标 loading，不改 url；失败只标 error，不把错误写入 title。
   */
  async navigate(sessionId: string, tabId: string, url: string): Promise<void> {
    this.requireTab(sessionId, tabId)
    const trimmed = url.trim()
    if (!trimmed) throw new Error('导航地址无效')

    const store = this.getStore()
    store.updateTab(sessionId, tabId, { status: 'loading' })

    try {
      const view = this.adapter.getView(sessionId, tabId)
      if (!view) throw new Error('浏览器视图尚未挂载')
      await view.loadURL(trimmed)
      store.updateTab(sessionId, tabId, {
        status: 'ready',
        url: view.getURL() || trimmed,
      })
    } catch (error) {
      store.updateTab(sessionId, tabId, { status: 'error' })
      throw error instanceof Error ? error : new Error('页面导航失败')
    }
  }

  /**
   * capture → parse HTML → Capture（媒体暂以 url 引用；本地化资产留给 stage 6）。
   */
  async captureTab(sessionId: string, tabId: string): Promise<Capture> {
    const { tab } = this.requireTab(sessionId, tabId)
    const page = await this.adapter.capture(sessionId, tabId)
    const parsed = await this.contentParser.parse({
      html: page.html,
      url: page.url || tab.url,
      title: page.title || tab.title,
    })

    const media: CaptureMedia[] = page.media.map((item) => ({
      kind: 'url',
      url: item.url,
      mimeType: item.kind === 'video' ? 'video/*' : 'image/*',
    }))

    const capture: Capture = {
      id: nanoid(),
      sessionId,
      url: parsed.url || page.url || tab.url,
      title: parsed.title || page.title || tab.title,
      html: page.html,
      text: parsed.text || page.text || '',
      media,
      headings: parsed.headings,
      links: parsed.links,
      fetchedAt: Date.now(),
    }

    this.getStore().putCapture(capture)
    return capture
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.getStore().sessions[sessionId]
    if (!session) throw new Error('浏览器会话不存在')
    return session
  }

  private requireTab(sessionId: string, tabId: string): { session: BrowserSession; tab: BrowserTab } {
    const session = this.requireSession(sessionId)
    const tab = session.tabs.find((item) => item.id === tabId)
    if (!tab) throw new Error('浏览器标签不存在')
    return { session, tab }
  }
}
