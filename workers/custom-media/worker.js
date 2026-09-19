const PREFIX = "media/";
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_REMAINING_MS = 48 * 60 * 60 * 1000;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, Range",
"access-control-expose-headers": "Content-Length, ETag, X-Cnote-Expires-At, X-Cnote-Retention-Source",
  "access-control-max-age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(status, message) {
  return json({ error: message }, status);
}

function authorized(request, env) {
  const token = env.CN_MEDIA_TOKEN;
  if (!token) return false;

  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function safeFileName(value) {
  const name = String(value || "upload")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return name || "upload";
}

async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function createObjectKey(checksum, mediaType) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const typeHash = await digest(new TextEncoder().encode(mediaType));
  return PREFIX + day + "/sha256-" + checksum + "-" + typeHash.slice(0, 16);
}

function expiryOf(object) {
  const uploaded = new Date(object.uploaded).getTime();
  return Number.isFinite(uploaded) ? uploaded + RETENTION_MS : undefined;
}

function objectResult(url, object, reused) {
  return {
    url: publicUrl(url, object.key), key: object.key, size: object.size,
    checksum: object.customMetadata?.checksum,
    contentType: object.httpMetadata?.contentType,
    expiresAt: expiryOf(object), retentionSource: "configured-14-day-policy", reused,
  };
}

function keyFromPath(pathname) {
  const raw = pathname.slice("/media/".length);

  if (!raw) return null;

  let key;

  try {
    key = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (!key.startsWith(PREFIX)) return null;
  if (key.includes("\0")) return null;

  return key;
}

function publicUrl(url, key) {
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `${url.origin}/media/${encodedKey}`;
}

function storedContentType(type) {
  if (
    type.startsWith("image/") &&
    type !== "image/svg+xml"
  ) {
    return type;
  }

  if (type.startsWith("video/")) return type;
  if (type.startsWith("audio/")) return type;

  return "application/octet-stream";
}

function objectResponseHeaders(object) {
  const headers = new Headers(CORS_HEADERS);

  object.writeHttpMetadata(headers);

  if (object.httpEtag) {
    headers.set("etag", object.httpEtag);
  }

  // Kacang/Doubao fetchers send Range and reject HTTP 206. Always advertise a
  // complete file so upstream reference downloads stay on HTTP 200.
  headers.set("accept-ranges", "none");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-length", String(object.size));
  headers.delete("content-range");
  headers.set("cache-control", "no-store");
  const expiresAt = expiryOf(object);
  if (expiresAt) headers.set("x-cnote-expires-at", String(expiresAt));
  headers.set("x-cnote-retention-source", "configured-14-day-policy");

  return headers;
}

async function uploadFile(request, env, url) {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    return errorResponse(415, "Expected multipart/form-data");
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "Invalid multipart body");
  }

  const value = form.get("file");

  if (!(value instanceof File)) {
    return errorResponse(400, 'Missing file field "file"');
  }

  if (value.size === 0) {
    return errorResponse(400, "File is empty");
  }

  if (value.size > MAX_UPLOAD_BYTES) {
    return errorResponse(
      413,
      `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB limit`,
    );
  }

  const originalName = value.name || "upload";
  const bytes = await value.arrayBuffer();
  const checksum = await digest(bytes);
  const declaredChecksum = form.get("checksum");
  if (declaredChecksum && declaredChecksum !== checksum) return errorResponse(400, "Checksum mismatch");
  const mediaType = storedContentType(value.type || "");
  const objectKey = await createObjectKey(checksum, mediaType);
  const existing = await env.MEDIA_BUCKET.head(objectKey);
  if (existing && expiryOf(existing) > Date.now() + MIN_REMAINING_MS) return json(objectResult(url, existing, true));
  const stored = await env.MEDIA_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: mediaType, contentDisposition: 'inline; filename="' + safeFileName(originalName) + '"', cacheControl: "no-store" },
    customMetadata: { originalName: originalName.slice(0, 255), purpose: "generation", checksum },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  const object = stored || await env.MEDIA_BUCKET.head(objectKey);
  if (!object || !(expiryOf(object) > Date.now() + MIN_REMAINING_MS)) return errorResponse(409, "Concurrent upload incomplete; retry preparation");
  return json(objectResult(url, object, !stored));
}

async function prepareMedia(request, env, url) {
  let body;
  try { body = await request.json(); } catch { return errorResponse(400, "Expected JSON"); }
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key.startsWith(PREFIX) || key.includes("\0")) return errorResponse(400, "Invalid media key");
  const head = await env.MEDIA_BUCKET.head(key);
  if (!head) return errorResponse(404, "Media not found");
  if (expiryOf(head) > Date.now() + MIN_REMAINING_MS) return json(objectResult(url, head, true));
  if (head.size > MAX_UPLOAD_BYTES) return errorResponse(413, "Media is too large to renew");
  const oldObject = await env.MEDIA_BUCKET.get(key);
  if (!oldObject) return errorResponse(404, "Media not found");
  const bytes = await oldObject.arrayBuffer();
  const checksum = await digest(bytes);
  const mediaType = storedContentType(oldObject.httpMetadata?.contentType || "");
  const newKey = await createObjectKey(checksum, mediaType);
  if (newKey === key) return errorResponse(409, "Cannot establish safe retention period");
  const stored = await env.MEDIA_BUCKET.put(newKey, bytes, {
    httpMetadata: { ...oldObject.httpMetadata, cacheControl: "no-store", contentType: mediaType },
    customMetadata: { ...oldObject.customMetadata, checksum },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  const renewed = stored || await env.MEDIA_BUCKET.head(newKey);
  if (!renewed || !(expiryOf(renewed) > Date.now() + MIN_REMAINING_MS)) return errorResponse(409, "Renewal incomplete");
  return json({ ...objectResult(url, renewed, !stored), renewed: true });
}

async function serveMedia(request, env, url) {
  const key = keyFromPath(url.pathname);

  if (!key) {
    return errorResponse(400, "Invalid media key");
  }

  if (request.method === "HEAD") {
    const object = await env.MEDIA_BUCKET.head(key);

    if (!object) {
      return errorResponse(404, "Media not found");
    }

    return new Response(null, {
      status: 200,
      headers: objectResponseHeaders(object),
    });
  }

  const object = await env.MEDIA_BUCKET.get(key);

  if (!object) {
    return errorResponse(404, "Media not found");
  }

  const headers = objectResponseHeaders(object);
  if (!object.body) {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body.pipeThrough(new TransformStream()), {
    status: 200,
    headers,
  });
}

async function getUsage(env) {
  let cursor;
  let objectCount = 0;
  let totalBytes = 0;

  do {
    const page = await env.MEDIA_BUCKET.list({
      prefix: PREFIX,
      limit: 1000,
      cursor,
    });

    for (const object of page.objects) {
      objectCount += 1;
      totalBytes += object.size;
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return json({
    objectCount,
    totalBytes,
  });
}

async function listObjects(env, url) {
  const requestedLimit = Number(
    url.searchParams.get("limit") || "100",
  );

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 1000)
    : 100;

  const page = await env.MEDIA_BUCKET.list({
    prefix: PREFIX,
    limit,
    cursor: url.searchParams.get("cursor") || undefined,
    include: ["customMetadata"],
  });

  return json({
    objects: page.objects.map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded
        ? object.uploaded.toISOString()
        : undefined,
      etag: object.httpEtag,
      originalName: object.customMetadata?.originalName,
      checksum: object.customMetadata?.checksum,
      url: publicUrl(url, object.key),
    })),
    cursor: page.truncated ? page.cursor : undefined,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    try {
      if (
        url.pathname === "/health" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          storageConfigured: Boolean(env.MEDIA_BUCKET),
          uploadConfigured: Boolean(env.CN_MEDIA_TOKEN),
          version: "1.1.0",
          retentionDays: 14,
          minimumRemainingHours: 48,
          capabilities: ["content-deduplication", "prepare-media"],
          timestamp: new Date().toISOString(),
        });
      }

      if (url.pathname === "/upload") {
        if (request.method !== "POST") {
          return errorResponse(405, "Method not allowed");
        }

        if (!authorized(request, env)) {
          return errorResponse(401, "Unauthorized");
        }

        return uploadFile(request, env, url);
      }

      if (url.pathname === "/prepare") {
        if (request.method !== "POST") return errorResponse(405, "Method not allowed");
        if (!authorized(request, env)) return errorResponse(401, "Unauthorized");
        return prepareMedia(request, env, url);
      }

      if (url.pathname === "/usage") {
        if (request.method !== "GET") {
          return errorResponse(405, "Method not allowed");
        }

        if (!authorized(request, env)) {
          return errorResponse(401, "Unauthorized");
        }

        return getUsage(env);
      }

      if (url.pathname === "/objects") {
        if (request.method !== "GET") {
          return errorResponse(405, "Method not allowed");
        }

        if (!authorized(request, env)) {
          return errorResponse(401, "Unauthorized");
        }

        return listObjects(env, url);
      }

      if (url.pathname.startsWith("/media/")) {
        if (
          request.method === "GET" ||
          request.method === "HEAD"
        ) {
          return serveMedia(request, env, url);
        }

        if (request.method === "DELETE") {
          if (!authorized(request, env)) {
            return errorResponse(401, "Unauthorized");
          }

          const key = keyFromPath(url.pathname);

          if (!key) {
            return errorResponse(400, "Invalid media key");
          }

          await env.MEDIA_BUCKET.delete(key);

          return json({
            ok: true,
            key,
          });
        }

        return errorResponse(405, "Method not allowed");
      }

      return errorResponse(404, "Not found");
    } catch (error) {
      console.error("media gateway error", error);
      return errorResponse(500, "Storage service error");
    }
  },
};
