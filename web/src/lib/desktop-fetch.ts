import { runDesktopNativeJob } from '@/lib/desktop-native-jobs'

export interface DesktopFetchOptions {
  /** Header name -> SafeStorage secret name. Values never enter the renderer job payload. */
  secretRefs?: Record<string, string>
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
export async function desktopFetch(input: RequestInfo | URL, init: RequestInit = {}, options: DesktopFetchOptions = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const headers = new Headers()
  appendHeaders(headers, input instanceof Request ? input.headers : undefined)
  appendHeaders(headers, init.headers)

  const normalized = await normalizeBody(url, { ...init, headers })
  const secretRefs = options.secretRefs
  const hasSensitiveHeader = [...headers.keys()].some((name) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name))
  // Electron's native network stack intentionally accepts only HTTP(S).
  // Local renderer resources such as blob/data URLs must stay on browser fetch
  // so exports and generation references work in the desktop app as well.
  if (!supportsNativeNetwork(url)) return fetch(input, { ...init, headers })
  // The direct Electron bridge is the primary desktop transport. It accepts
  // in-memory credentials as well as SafeStorage references, which is needed
  // for newly edited channels before their persisted configuration settles.
  if (hasDirectNativeNetwork()) {
    const output = await window.cnoteDesktop!.network.request({
      url,
      method: init.method || 'GET',
      headers: Object.fromEntries(normalized.headers.entries()),
      secretRefs,
      body: normalized.body,
      timeoutMs: 300_000,
    })
    return new Response(output.body as unknown as BodyInit, {
      status: output.status,
      statusText: output.statusText,
      headers: output.headers,
    })
  }

  // Older desktop bridges only expose the persisted Native Job API. That API
  // deliberately rejects inline sensitive headers because job checkpoints are
  // durable. Keep an unsaved credential usable in that compatibility runtime;
  // current desktop builds always take the direct branch above.
  if (hasNativeDesktop() && hasSensitiveHeader && !Object.keys(secretRefs || {}).length) {
    return fetch(input, { ...init, headers })
  }

  if (!hasNativeDesktop()) return fetch(input, { ...init, headers })

  const output = await runDesktopNativeJob<NativeNetworkOutput>({
    kind: 'native:network-request',
    input: {
      url,
      method: init.method || 'GET',
      headers: Object.fromEntries(normalized.headers.entries()),
      secretRefs: options.secretRefs,
      body: normalized.body,
      timeoutMs: 300_000,
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
