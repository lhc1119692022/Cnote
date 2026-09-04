import { net } from 'electron'
import type { NetworkPort, NetworkRequest, NetworkResponse } from './types'

function normalizeHeaders(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export class NativeNetworkPort implements NetworkPort {
  async request(input: NetworkRequest): Promise<NetworkResponse> {
    const maxResponseBytes = 256 * 1024 * 1024
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    input.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, input.timeoutMs ?? 30_000))

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

      const body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength > maxResponseBytes) throw new Error('Native network response 超过 256 MiB。')
      return {
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        body,
        url: response.url,
      }
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}
