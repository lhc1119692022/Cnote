import { net } from 'electron'
import type { NetworkPort, NetworkRequest, NetworkResponse, NetworkStreamResponse } from './types'

function normalizeHeaders(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export class NativeNetworkPort implements NetworkPort {
  async request(input: NetworkRequest): Promise<NetworkResponse> {
    const stream = await this.openStream(input)
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const chunk = await stream.read()
        if (chunk === null) break
        chunks.push(chunk)
      }
      return { status: stream.status, statusText: stream.statusText, headers: stream.headers, url: stream.url, body: Buffer.concat(chunks) }
    } finally {
      await stream.cancel()
    }
  }

  async openStream(input: NetworkRequest): Promise<NetworkStreamResponse> {
    const maxResponseBytes = 256 * 1024 * 1024
    const timeoutMs = Math.max(1_000, input.timeoutMs ?? 300_000)
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    input.signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (input.signal?.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromCaller)
    }
    try {
      // Use Chromium's network stack so desktop requests follow the user's
      // configured proxy and connection settings. Node's undici fetch ignores
      // the system proxy on Windows, which makes otherwise reachable services
      // fail with a generic `fetch failed` error.
      const response = await net.fetch(input.url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        body: (input.body instanceof Uint8Array ? Buffer.from(input.body) : input.body) as BodyInit | undefined,
        signal: controller.signal,
        redirect: 'follow',
      })

      const reader = response.body?.getReader()
      let received = 0
      let finished = false
      return {
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        url: response.url,
        async read() {
          if (finished) return null
          try {
            if (controller.signal.aborted) throw new Error(input.signal?.aborted ? '桌面网络请求已停止' : '网络请求超时或被中止')
            const result = reader ? await reader.read() : { done: true, value: undefined }
            if (result.done) { finished = true; cleanup(); return null }
            received += result.value!.byteLength
            if (received > maxResponseBytes) throw new Error('Native network response 超过 256 MiB。')
            return result.value!
          } catch (error) {
            finished = true
            controller.abort()
            cleanup()
            await reader?.cancel().catch(() => undefined)
            throw error
          }
        },
        async cancel() {
          finished = true
          controller.abort()
          cleanup()
          await reader?.cancel().catch(() => undefined)
        },
      }
    } catch (error) {
      cleanup()
      if (input.signal?.aborted) throw error
      if (controller.signal.aborted) throw new Error(`网络请求超时或被中止（${Math.round(timeoutMs / 1000)} 秒）`)
      throw error
    }
  }
}
