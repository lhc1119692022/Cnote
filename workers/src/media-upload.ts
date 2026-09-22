/**
 * Optional media storage gateway for user-configured reference uploads.
 *
 * POST /upload  (multipart field: file, optional checksum)
 * GET  /media/{sha256}
 * GET  /usage (token protected)
 * GET  /objects (token protected, paginated)
 * DELETE /media/{sha256} (manual cleanup, token protected)
 */

interface Env {
  MEDIA_BUCKET: R2Bucket
  CN_MEDIA_UPLOAD_TOKEN?: string
  MEDIA_PUBLIC_BASE_URL?: string
  MEDIA_MAX_BYTES?: string
}

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin')
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
    Vary: 'Origin',
  }
}

function json(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  })
}

function configuredToken(env: Env) {
  return env.CN_MEDIA_UPLOAD_TOKEN?.trim() || ''
}

function authorized(request: Request, env: Env) {
  const expected = configuredToken(env)
  if (!expected) return false
  const header = request.headers.get('Authorization') || ''
  return header.startsWith('Bearer ') && header.slice(7).trim() === expected
}

function maxBytes(env: Env) {
  const value = Number.parseInt(env.MEDIA_MAX_BYTES || '', 10)
  return Number.isFinite(value) && value > 0 ? Math.min(value, 500 * 1024 * 1024) : DEFAULT_MAX_BYTES
}

function safeChecksum(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/^sha256-/i, '').toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined
}

async function checksumOf(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function mediaKey(checksum: string) {
  return `sha256-${checksum}`
}

function publicURL(request: Request, env: Env, key: string) {
  const base = (env.MEDIA_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '')
  return `${base}/media/${encodeURIComponent(key)}`
}

function mediaKeyFromPath(pathname: string) {
  const prefix = pathname.startsWith('/objects/') ? '/objects/' : '/media/'
  if (!pathname.startsWith(prefix)) return undefined
  const value = decodeURIComponent(pathname.slice(prefix.length)).trim()
  return /^sha256-[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined
}

function listLimit(url: URL) {
  const value = Number.parseInt(url.searchParams.get('limit') || '', 10)
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 1000) : 100
}

function objectShape(request: Request, env: Env, object: R2Object) {
  const metadata = object.customMetadata || {}
  return {
    key: object.key,
    size: object.size,
    uploaded: object.uploaded?.toISOString(),
    etag: object.etag,
    originalName: metadata.originalName,
    checksum: metadata.checksum,
    url: publicURL(request, env, object.key),
  }
}

async function usage(env: Env) {
  let cursor: string | undefined
  let objectCount = 0
  let totalBytes = 0
  let truncated = false
  // R2 exposes aggregate data through list(); walk pages for a small personal
  // bucket without adding another database or durable object.
  for (let page = 0; page < 100; page += 1) {
    const result = await env.MEDIA_BUCKET.list({ limit: 1000, ...(cursor ? { cursor } : {}) })
    result.objects.forEach((object) => {
      objectCount += 1
      totalBytes += object.size
    })
    if (!result.truncated || !result.cursor) break
    cursor = result.cursor
    if (page === 99) truncated = true
  }
  return { objectCount, totalBytes, truncated, measuredAt: new Date().toISOString() }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(request, { ok: true, uploadConfigured: Boolean(configuredToken(env)) })
    }

    if (request.method === 'GET' && url.pathname === '/usage') {
      if (!authorized(request, env)) return json(request, { error: 'Unauthorized' }, 401)
      return json(request, await usage(env))
    }

    if (request.method === 'GET' && url.pathname === '/objects') {
      if (!authorized(request, env)) return json(request, { error: 'Unauthorized' }, 401)
      const result = await env.MEDIA_BUCKET.list({
        limit: listLimit(url),
        include: ['customMetadata'],
        ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') || undefined } : {}),
      })
      return json(request, {
        objects: result.objects.map((object) => objectShape(request, env, object)),
        cursor: result.truncated ? result.cursor : undefined,
      })
    }

    const key = mediaKeyFromPath(url.pathname)
    if ((request.method === 'GET' || request.method === 'HEAD') && key) {
      const object = await env.MEDIA_BUCKET.get(key)
      if (!object) return new Response('Not found', { status: 404, headers: corsHeaders(request) })
      const headers = new Headers(corsHeaders(request))
      object.writeHttpMetadata(headers)
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      headers.set('ETag', object.httpEtag)
      headers.set('Content-Length', String(object.size))
      // Kacang/Doubao fetchers send Range and reject HTTP 206. Always serve the
      // complete object as 200, and make the body non-rangeable so the runtime
      // does not convert this response into Partial Content.
      headers.set('Accept-Ranges', 'none')
      if (request.method === 'HEAD' || !object.body) return new Response(null, { status: 200, headers })
      return new Response(object.body, { status: 200, headers })
    }

    if ((request.method === 'POST' && url.pathname === '/upload') || (request.method === 'DELETE' && key)) {
      if (!authorized(request, env)) return json(request, { error: 'Unauthorized' }, 401)
    }

    if (request.method === 'DELETE' && key) {
      await env.MEDIA_BUCKET.delete(key)
      return json(request, { deleted: true, key })
    }

    if (request.method === 'POST' && url.pathname === '/upload') {
      const declaredLength = Number.parseInt(request.headers.get('Content-Length') || '', 10)
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes(env) + 1024 * 1024) {
        return json(request, { error: 'File is too large' }, 413)
      }
      let form: FormData
      try {
        form = await request.formData()
      } catch {
        return json(request, { error: 'Expected multipart form data' }, 400)
      }
      const entry = form.get('file')
      if (!(entry instanceof File)) return json(request, { error: 'Missing file field' }, 400)
      if (entry.size > maxBytes(env)) return json(request, { error: 'File is too large' }, 413)

      const declaredChecksum = safeChecksum(form.get('checksum'))
      const checksum = await checksumOf(entry)
      if (declaredChecksum && declaredChecksum !== checksum) {
        return json(request, { error: 'Checksum mismatch' }, 400)
      }
      const key = mediaKey(checksum)
      const existing = await env.MEDIA_BUCKET.head(key)
      if (existing) return json(request, { url: publicURL(request, env, key), key, checksum, reused: true })
      await env.MEDIA_BUCKET.put(key, entry.stream(), {
        httpMetadata: {
          contentType: entry.type || 'application/octet-stream',
          contentDisposition: 'inline',
        },
        customMetadata: {
          originalName: entry.name.slice(0, 240),
          checksum,
        },
      })
      return json(request, { url: publicURL(request, env, key), key, checksum })
    }

    return json(request, { error: 'Not found' }, 404)
  },
}
