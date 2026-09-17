import type { NetworkRequest, NetworkStreamResponse } from './types'

export class NetworkStreamRegistry {
  private readonly entries = new Map<string, { owner: number; controller: AbortController; stream?: NetworkStreamResponse; reading: boolean }>()

  constructor(private readonly openRequest: (input: NetworkRequest) => Promise<NetworkStreamResponse>) {}

  async open(owner: number, input: NetworkRequest, prepare: () => Promise<Record<string, string>>) {
    if (!input.requestId) throw new Error('流式请求缺少请求标识')
    const key = owner + ':' + input.requestId
    if (this.entries.has(key)) throw new Error('流式请求标识重复')
    const entry = { owner, controller: new AbortController(), reading: false } as { owner: number; controller: AbortController; stream?: NetworkStreamResponse; reading: boolean }
    this.entries.set(key, entry)
    try {
      const headers = await prepare()
      if (entry.controller.signal.aborted) throw new Error('桌面网络请求已停止')
      const stream = await this.openRequest({ ...input, headers, signal: entry.controller.signal })
      entry.stream = stream
      if (entry.controller.signal.aborted) { await stream.cancel(); throw new Error('桌面网络请求已停止') }
      return { status: stream.status, statusText: stream.statusText, headers: stream.headers, url: stream.url }
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }

  async read(owner: number, requestId: string) {
    const key = owner + ':' + requestId
    const entry = this.entries.get(key)
    if (!entry?.stream) throw new Error('流式请求已关闭')
    if (entry.reading) throw new Error('不允许并发读取同一流式请求')
    entry.reading = true
    try {
      const chunk = await entry.stream.read()
      if (chunk === null) await this.abort(owner, requestId)
      return chunk
    } catch (error) {
      await this.abort(owner, requestId)
      throw error
    } finally { entry.reading = false }
  }

  async abort(owner: number, requestId: string) {
    const key = owner + ':' + requestId
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    entry.controller.abort()
    await entry.stream?.cancel()
    return true
  }

  async closeOwner(owner: number) {
    await Promise.all([...this.entries].filter(([, entry]) => entry.owner === owner).map(([key]) => this.abort(owner, key.slice(String(owner).length + 1))))
  }
}
