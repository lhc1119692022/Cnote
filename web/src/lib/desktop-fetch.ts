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
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))

  const normalized = await normalizeBody(url, { ...init, headers })
  const secretRefs = options.secretRefs
  const hasSensitiveHeader = [...headers.keys()].some((name) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name))
  if (!hasDirectNativeNetwork() && (!hasNativeDesktop() || (!Object.keys(secretRefs || {}).length && hasSensitiveHeader))) {
    return fetch(input, { ...init, headers })
  }

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
