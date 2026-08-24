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
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    input.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, input.timeoutMs ?? 30_000))

    try {
      const response = await fetch(input.url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        body: (input.body instanceof Uint8Array ? Buffer.from(input.body) : input.body) as BodyInit | undefined,
        signal: controller.signal,
        redirect: 'follow',
      })

      return {
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        body: new Uint8Array(await response.arrayBuffer()),
        url: response.url,
      }
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}
