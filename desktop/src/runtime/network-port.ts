import { net } from 'electron'
import { Readable } from 'node:stream'
import type { NetworkPort, NetworkRequest, NetworkResponse, NetworkStreamResponse } from './types'

function normalizeHeaders(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function fetchNativeResponse(input: NetworkRequest, signal: AbortSignal) {
  return new Promise<{ status: number; statusText: string; headers: Headers; url: string; body: ReadableStream<Uint8Array> }>((resolve, reject) => {
    const request = net.request({ url: input.url, method: input.method ?? 'GET', redirect: 'follow' })
    const stop = () => { reject(new DOMException('The operation was aborted.', 'AbortError')); request.abort() }
    signal.addEventListener('abort', stop, { once: true })
    request.on('close', () => signal.removeEventListener('abort', stop))
    request.on('error', reject)
    request.on('response', response => {
      try {
        const headers = new Headers()
        for (const [name, values] of Object.entries(response.headers)) {
          const value = Array.isArray(values) ? values.join(', ') : values
          headers.set(name, /[^\u0000-\u00ff]/.test(value) ? Buffer.from(value, 'utf8').toString('latin1') : value)
        }
        resolve({ status: response.statusCode, statusText: /^[\x20-\x7e]*$/.test(response.statusMessage) ? response.statusMessage : '', headers, url: input.url, body: Readable.toWeb(response as unknown as Readable) as ReadableStream<Uint8Array> })
      } catch (error) { reject(error); request.abort() }
    })
    if (signal.aborted) { stop(); return }
    try {
      for (const [name, value] of Object.entries(input.headers || {})) request.setHeader(name, value)
      if (input.body !== undefined) request.write(input.body instanceof Uint8Array ? Buffer.from(input.body) : input.body)
      request.end()
    } catch (error) { reject(error); request.abort() }
  })
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
      const response = await fetchNativeResponse(input, controller.signal)

      const reader = response.body?.getReader()
      let received = 0
      let finished = false
      return {
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        url: response.url,
        async read() {
          try {
            if (controller.signal.aborted) throw new Error(input.signal?.aborted ? '桌面网络请求已停止' : '网络请求超时或被中止')
            if (finished) return null
            const result = reader ? await reader.read() : { done: true, value: undefined }
            if (controller.signal.aborted) throw new Error(input.signal?.aborted ? '桌面网络请求已停止' : '网络请求超时或被中止')
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
