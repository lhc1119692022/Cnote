import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'

export interface DesktopFetchOptions {
  stream?: boolean
  /** Header name -> SafeStorage secret name. Values never enter the renderer job payload. */
  secretRefs?: Record<string, string>
  /** Maximum time for the native request, including response body download. */
  timeoutMs?: number
}

interface NativeNetworkOutput {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyBase64: string
  url: string
}

function hasNativeDesktop() {
  return typeof window !== 'undefined' && Boolean(window.cnoteDesktop?.jobs?.enqueueNative)
}

function hasDirectNativeNetwork() {
  return typeof window !== 'undefined' && Boolean(window.cnoteDesktop?.network?.request)
}

function supportsNativeNetwork(url: string) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function appendHeaders(target: Headers, source?: HeadersInit) {
  if (!source) return
  if (source instanceof Headers) {
    source.forEach((value, key) => target.set(key, value))
    return
  }
  if (Array.isArray(source)) {
    source.forEach(([key, value]) => target.set(key, value))
    return
  }
  Object.entries(source).forEach(([key, value]) => target.set(key, value))
}

function bytesFromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function abortError() {
  return new DOMException('执行已停止', 'AbortError')
}

function nativeAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /(?:AbortError|operation was aborted|request was aborted)/i.test(error.message)
}

async function normalizeBody(url: string, init: RequestInit) {
  const body = init.body
  if (body === undefined || body === null || typeof body === 'string' || body instanceof Uint8Array) {
    return { body: body as string | Uint8Array | undefined, headers: new Headers(init.headers) }
  }

  const request = new Request(url, { method: init.method || 'GET', headers: init.headers, body })
  return {
    body: new Uint8Array(await request.arrayBuffer()),
    headers: new Headers(request.headers),
  }
}

/**
 * Route desktop requests through Electron's native network worker. The web
 * preview still uses the browser fetch path, so this helper keeps one API
 * contract for both runtimes.
 */
async function performDesktopFetch(input: RequestInfo | URL, init: RequestInit = {}, options: DesktopFetchOptions = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const headers = new Headers()
  appendHeaders(headers, input instanceof Request ? input.headers : undefined)
  appendHeaders(headers, init.headers)

  const normalized = await normalizeBody(url, { ...init, headers })
  const secretRefs = options.secretRefs
  // Electron's native network stack intentionally accepts only HTTP(S).
  // Local renderer resources such as blob/data URLs must stay on browser fetch
  // so exports and generation references work in the desktop app as well.
  if (!supportsNativeNetwork(url)) return fetch(input, { ...init, headers })
  if (hasDirectNativeNetwork()) {
    if (options.stream) return openDesktopStream(url, { ...init, headers: normalized.headers, body: normalized.body as BodyInit | undefined }, options)
    if (init.signal?.aborted) throw abortError()
    const requestId = crypto.randomUUID()
    const request = window.cnoteDesktop!.network.request({
      url,
      requestId,
      method: init.method || 'GET',
      headers: Object.fromEntries(normalized.headers.entries()),
      secretRefs,
      body: normalized.body,
      timeoutMs: options.timeoutMs ?? 300_000,
    })
    let abortReject: ((reason: unknown) => void) | undefined
    const abortPromise = init.signal
      ? new Promise<never>((_resolve, reject) => { abortReject = reject })
      : undefined
    const abortNativeRequest = () => {
      abortReject?.(abortError())
      const abort = window.cnoteDesktop?.network.abort
      if (abort) void abort(requestId).catch(() => undefined)
    }
    init.signal?.addEventListener('abort', abortNativeRequest, { once: true })
    try {
      const output = await (abortPromise ? Promise.race([request, abortPromise]) : request)
      if (init.signal?.aborted) throw abortError()
      return new Response(output.body as unknown as BodyInit, {
      status: output.status,
      statusText: output.statusText,
      headers: output.headers,
      })
    } catch (error) {
      if (init.signal?.aborted || nativeAbortError(error)) {
        if (init.signal?.aborted) throw abortError()
        throw new Error('桌面网络请求超时或被原生网络层中止')
      }
      throw error
    } finally {
      init.signal?.removeEventListener('abort', abortNativeRequest)
    }
  }

  if (!hasNativeDesktop()) return fetch(input, { ...init, headers })
  if (options.stream) throw new Error('当前桌面版本不支持流式回复，请更新并重启桌面端。')

  const output = await runDesktopNativeJob<NativeNetworkOutput>({
    kind: 'native:network-request',
    input: {
      url,
      method: init.method || 'GET',
      headers: Object.fromEntries(normalized.headers.entries()),
      secretRefs: options.secretRefs,
      body: normalized.body,
      timeoutMs: options.timeoutMs ?? 300_000,
    },
    }, init.signal || undefined)

  return new Response(bytesFromBase64(output.bodyBase64), {
    status: output.status,
    statusText: output.statusText,
    headers: output.headers,
  })
}

export function desktopNativeAvailable() {
  return hasDirectNativeNetwork() || hasNativeDesktop()
}

export async function desktopFetch(input: RequestInfo | URL, init: RequestInit = {}, options: DesktopFetchOptions = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!supportsNativeNetwork(url) || !desktopNativeAvailable()) return performDesktopFetch(input, init, options)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  appendHeaders(headers, init.headers)
  const secretRefs = Object.fromEntries(Object.entries(options.secretRefs || {}).map(([header, name]) => [header.toLowerCase(), name]))
  const temporarySecrets: string[] = []
  const secrets = window.cnoteDesktop?.secrets
  try {
    for (const [header, value] of [...headers.entries()]) {
      if (secretRefs[header]) {
        headers.delete(header)
      } else if (/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-goog-api-key)$/i.test(header)) {
        if (!secrets) throw new Error('桌面密钥存储不可用，请更新或重启桌面端。')
        const name = 'cnote:request:' + crypto.randomUUID()
        temporarySecrets.push(name)
        await secrets.set(name, value)
        secretRefs[header] = name
        headers.delete(header)
      }
    }
    if (init.signal?.aborted) throw abortError()
    return await performDesktopFetch(url, { ...init, headers }, { ...options, secretRefs })
  } finally {
    await Promise.all(temporarySecrets.map((name) => secrets!.delete(name)))
  }
}

async function openDesktopStream(url: string, init: RequestInit, options: DesktopFetchOptions) {
  const network = window.cnoteDesktop!.network
  if (!network.openStream || !network.readStream) throw new Error('当前桌面版本不支持流式回复，请更新并重启桌面端。')
  if (init.signal?.aborted) throw abortError()
  const requestId = crypto.randomUUID()
  let finished = false
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let rejectOpen: (error: unknown) => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => { rejectOpen = reject })
  const cleanup = () => {
    finished = true
    init.signal?.removeEventListener('abort', stop)
  }
  const stop = () => {
    if (finished) return
    const error = abortError()
    rejectOpen(error)
    controller?.error(error)
    cleanup()
    void network.abort(requestId).catch(() => undefined)
  }
  init.signal?.addEventListener('abort', stop, { once: true })
  try {
    const metadata = await Promise.race([network.openStream({
      url, requestId, method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)),
      secretRefs: options.secretRefs, body: init.body as string | Uint8Array | undefined, timeoutMs: options.timeoutMs ?? 300_000,
    }), aborted])
    if (init.signal?.aborted) throw abortError()
    if ([204, 205, 304].includes(metadata.status)) {
      cleanup()
      await network.abort(requestId)
      return new Response(null, metadata)
    }
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value },
      async pull(value) {
        try {
          const chunk = await network.readStream!(requestId)
          if (finished) return
          if (chunk === null) { cleanup(); value.close() }
          else value.enqueue(new Uint8Array(chunk))
        } catch (error) {
          if (finished) return
          cleanup()
          value.error(init.signal?.aborted ? abortError() : error)
          await network.abort(requestId).catch(() => undefined)
        }
      },
      async cancel() { cleanup(); await network.abort(requestId).catch(() => undefined) },
    })
    return new Response(body, metadata)
  } catch (error) {
    cleanup()
    await network.abort(requestId).catch(() => undefined)
    throw error
  }
}
