// Cnote 内容解析服务配置：留空表示不启用访问令牌。
globalThis.CNOTE_CONTENT_TOKEN = "__CNOTE_CONTENT_TOKEN__";

// ../workers/src/scraper.ts
var dashboardContentConfig = globalThis;
function contentAccessToken(env) {
  return env.CN_CONTENT_TOKEN || dashboardContentConfig.CNOTE_CONTENT_TOKEN || "";
}
var MAX_HTML_BYTES = 4 * 1024 * 1024;
var MAX_TEXT_BYTES = 2 * 1024 * 1024;
var MAX_MEDIA_BYTES = 12 * 1024 * 1024;
var MAX_REQUEST_BODY_BYTES = 16 * 1024;
var MAX_EXTRACTED_TEXT_CHARS = 1e5;
var FETCH_TIMEOUT_MS = 15e3;
var MAX_REDIRECTS = 8;
var YOUTUBE_ANDROID_CLIENT_VERSION = "20.10.38";
function splitSetCookieHeader(value) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim()).filter(Boolean);
}
function responseSetCookies(headers) {
  const enhanced = headers;
  const values = enhanced.getSetCookie?.();
  if (values?.length) return values;
  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}
function defaultCookiePath(pathname) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}
function cookieDomainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
var RedirectCookieJar = class {
  cookies = [];
  capture(headers, requestUrl) {
    for (const header of responseSetCookies(headers)) {
      const parts = header.split(";").map((part) => part.trim());
      const pair = parts.shift();
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name) continue;
      let domain = requestUrl.hostname.toLowerCase();
      let path = defaultCookiePath(requestUrl.pathname);
      let secure = false;
      let hostOnly = true;
      let expiresAt;
      for (const attribute of parts) {
        const attributeSeparator = attribute.indexOf("=");
        const key = (attributeSeparator >= 0 ? attribute.slice(0, attributeSeparator) : attribute).trim().toLowerCase();
        const attributeValue = attributeSeparator >= 0 ? attribute.slice(attributeSeparator + 1).trim() : "";
        if (key === "domain") {
          const candidate = attributeValue.toLowerCase().replace(/^\./, "");
          if (!candidate || !cookieDomainMatches(requestUrl.hostname.toLowerCase(), candidate)) continue;
          domain = candidate;
          hostOnly = false;
        } else if (key === "path" && attributeValue.startsWith("/")) path = attributeValue;
        else if (key === "secure") secure = true;
        else if (key === "max-age") {
          const seconds = Number(attributeValue);
          if (Number.isFinite(seconds)) expiresAt = Date.now() + seconds * 1e3;
        } else if (key === "expires" && expiresAt === void 0) {
          const timestamp = Date.parse(attributeValue);
          if (Number.isFinite(timestamp)) expiresAt = timestamp;
        }
      }
      const existingIndex = this.cookies.findIndex((cookie) => cookie.name === name && cookie.domain === domain && cookie.path === path);
      if (!value || expiresAt !== void 0 && expiresAt <= Date.now()) {
        if (existingIndex >= 0) this.cookies.splice(existingIndex, 1);
        continue;
      }
      const next = { name, value, domain, path, secure, hostOnly, expiresAt };
      if (existingIndex >= 0) this.cookies[existingIndex] = next;
      else this.cookies.push(next);
    }
  }
  header(target) {
    const now = Date.now();
    this.cookies = this.cookies.filter((cookie) => cookie.expiresAt === void 0 || cookie.expiresAt > now);
    const hostname = target.hostname.toLowerCase();
    return this.cookies.filter((cookie) => {
      if (cookie.secure && target.protocol !== "https:") return false;
      if (cookie.hostOnly ? cookie.domain !== hostname : !cookieDomainMatches(hostname, cookie.domain)) return false;
      return target.pathname === cookie.path || target.pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`);
    }).sort((left, right) => right.path.length - left.path.length).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
};
var CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
  "Access-Control-Max-Age": "86400"
};
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = env.SCRAPER_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) || [];
  const allowedOrigin = allowedOrigins.length === 0 ? "*" : origin && allowedOrigins.includes(origin) ? origin : void 0;
  return {
    ...CORS_HEADERS,
    ...allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {},
    Vary: "Origin"
  };
}
var SERVICE_INFO = {
  status: "ok",
  service: "cnote-content-service",
  version: "1.6.3",
  capabilities: {
    webPage: true,
    youtubeTranscript: true,
    social: ["xiaohongshu", "douyin", "instagram"],
    documentProxy: false
  }
};
var ScrapeError = class extends Error {
  code;
  retryable;
  status;
  constructor(code, message, status = 502, retryable = false) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
};
function errorResponse(error, request, env, fallbackStatus = 500) {
  const typed = error instanceof ScrapeError;
  const body = {
    code: typed ? error.code : "UPSTREAM_ERROR",
    message: typed ? error.message : "\u8FDC\u7A0B\u5185\u5BB9\u6293\u53D6\u5931\u8D25",
    retryable: typed ? error.retryable : true
  };
  return new Response(JSON.stringify(body), {
    status: typed ? error.status : fallbackStatus,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) }
  });
}
function assertRequestAccess(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = env.SCRAPER_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) || [];
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    throw new ScrapeError("ORIGIN_NOT_ALLOWED", "\u5F53\u524D\u7AD9\u70B9\u672A\u88AB\u5185\u5BB9\u89E3\u6790\u670D\u52A1\u6388\u6743", 403, false);
  }
  const accessToken = contentAccessToken(env);
  if (accessToken) {
    const authorization = request.headers.get("Authorization");
    if (authorization !== `Bearer ${accessToken}`) {
      throw new ScrapeError("UNAUTHORIZED", "\u5185\u5BB9\u89E3\u6790\u670D\u52A1\u8BBF\u95EE\u4EE4\u724C\u65E0\u6548", 401, false);
    }
  }
}
function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19) || a >= 224;
}
function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") return true;
  if (isPrivateIpv4(host)) return true;
  if (host.includes(":")) {
    const firstHextet = Number.parseInt(host.split(":")[0] || "0", 16);
    const isLinkLocal = Number.isFinite(firstHextet) && firstHextet >= 65152 && firstHextet <= 65215;
    const isUniqueLocal = Number.isFinite(firstHextet) && firstHextet >= 64512 && firstHextet <= 65023;
    const isMulticast = Number.isFinite(firstHextet) && firstHextet >= 65280;
    const normalized = host.replace(/:{2,}/, (match) => match === "::" ? ":0:".repeat(7) : match);
    const isLoopback = host === "::1" || normalized === "0:0:0:0:0:0:0:1";
    if (host.startsWith("::ffff:") || isLoopback || host === "::" || isLinkLocal || isUniqueLocal || isMulticast) return true;
  }
  return false;
}
function validateTarget(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new ScrapeError("INVALID_URL", "URL \u683C\u5F0F\u65E0\u6548", 400);
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new ScrapeError("URL_REJECTED", "\u4EC5\u652F\u6301\u516C\u5F00 http/https URL", 400);
  if (isPrivateHostname(target.hostname)) throw new ScrapeError("SSRF_BLOCKED", "\u51FA\u4E8E\u5B89\u5168\u539F\u56E0\u62D2\u7EDD\u8BBF\u95EE\u8BE5\u5730\u5740", 403);
  return target;
}
async function readBodyLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new ScrapeError("RESPONSE_TOO_LARGE", "\u4E0A\u6E38\u54CD\u5E94\u8D85\u8FC7\u5927\u5C0F\u9650\u5236", 413);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ScrapeError("RESPONSE_TOO_LARGE", "\u4E0A\u6E38\u54CD\u5E94\u8D85\u8FC7\u5927\u5C0F\u9650\u5236", 413);
      }
      result += decoder.decode(next.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
async function readRequestBodyLimited(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new ScrapeError("REQUEST_TOO_LARGE", "\u8BF7\u6C42\u4F53\u8D85\u8FC7\u5927\u5C0F\u9650\u5236", 413, false);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ScrapeError("REQUEST_TOO_LARGE", "\u8BF7\u6C42\u4F53\u8D85\u8FC7\u5927\u5C0F\u9650\u5236", 413, false);
      }
      result += decoder.decode(next.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
async function readBytesLimited(response, maxBytes, label) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new ScrapeError("RESPONSE_TOO_LARGE", `${label}\u8D85\u8FC7\u5927\u5C0F\u9650\u5236`, 413, false);
  if (!response.body) throw new ScrapeError("EMPTY_RESPONSE", `${label}\u54CD\u5E94\u4E3A\u7A7A`, 502, true);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ScrapeError("RESPONSE_TOO_LARGE", `${label}\u8D85\u8FC7\u5927\u5C0F\u9650\u5236`, 413, false);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function fetchLimited(rawUrl, maxBytes, init, cookieJar) {
  let target = validateTarget(rawUrl);
  const redirects = [];
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      const headers = new Headers(init?.headers);
      const cookie = cookieJar?.header(target);
      if (cookie) headers.set("Cookie", cookie);
      response = await fetch(target.toString(), { ...init, headers, redirect: "manual", signal: controller.signal });
      cookieJar?.capture(response.headers, target);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ScrapeError("UPSTREAM_ERROR", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u7F3A\u5C11\u76EE\u6807\u5730\u5740", 502, true);
        if (redirect === MAX_REDIRECTS) throw new ScrapeError("TOO_MANY_REDIRECTS", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", 502, true);
        target = validateTarget(new URL(location, target).toString());
        redirects.push(target.toString());
        continue;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new ScrapeError("ACCESS_RESTRICTED", "\u4E0A\u6E38\u5185\u5BB9\u9700\u8981\u767B\u5F55\u6216\u62D2\u7EDD\u8BBF\u95EE", response.status, false);
        if (response.status === 404 || response.status === 410) throw new ScrapeError("CONTENT_NOT_FOUND", "\u5185\u5BB9\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u5220\u9664", response.status, false);
        if (response.status === 429) throw new ScrapeError("RATE_LIMITED", "\u4E0A\u6E38\u8BF7\u6C42\u9891\u7387\u53D7\u9650\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", 429, true);
        if (response.status === 412) throw new ScrapeError("UPSTREAM_CHALLENGE", "\u4E0A\u6E38\u7AD9\u70B9\u8981\u6C42\u5B89\u5168\u9A8C\u8BC1\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u516C\u5F00\u5185\u5BB9", 502, true);
        throw new ScrapeError("UPSTREAM_ERROR", `\u4E0A\u6E38\u8FD4\u56DE HTTP ${response.status}`, 502, true);
      }
      return { url: target.toString(), redirects, response, body: await readBodyLimited(response, maxBytes) };
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new ScrapeError("FETCH_TIMEOUT", "\u4E0A\u6E38\u8BF7\u6C42\u8D85\u65F6", 504, true);
      throw new ScrapeError("UPSTREAM_ERROR", "\u65E0\u6CD5\u8BBF\u95EE\u4E0A\u6E38\u5185\u5BB9", 502, true);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ScrapeError("TOO_MANY_REDIRECTS", "\u4E0A\u6E38\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", 502, true);
}
function decodeHtml(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)));
}
function firstMatch(html, pattern) {
  return decodeHtml(html.match(pattern)?.[1]?.trim() || "");
}
function findBalancedJsonAt(source, start) {
  if (source[start] !== "{" && source[start] !== "[") return void 0;
  const opening = source[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return void 0;
}
function parseJavaScriptString(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return void 0;
  let end = start + 1;
  let escaped = false;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) break;
  }
  if (end >= source.length) return void 0;
  const literal = source.slice(start, end + 1);
  try {
    if (quote === '"') return { value: JSON.parse(literal), end: end + 1 };
    const content = literal.slice(1, -1);
    return {
      value: content.replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\\'"bnrtfv0]))/g, (_, unicode, hex, escape) => {
        if (unicode) return String.fromCodePoint(Number.parseInt(unicode, 16));
        if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
        return { b: "\b", n: "\n", r: "\r", t: "	", f: "\f", v: "\v", 0: "\0" }[escape] || escape;
      }),
      end: end + 1
    };
  } catch {
    return void 0;
  }
}
function parseEmbeddedJson(source) {
  try {
    return JSON.parse(source);
  } catch {
  }
  let normalized = "";
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; ) {
    const char = source[index];
    if (quoted) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      normalized += char;
      index += 1;
      continue;
    }
    const unsupported = source.slice(index).match(/^-?Infinity\b|^(?:undefined|NaN)\b/);
    if (unsupported) {
      normalized += "null";
      index += unsupported[0].length;
      continue;
    }
    normalized += char;
    index += 1;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return void 0;
  }
}
function parseInitialStateExpression(source, start) {
  const expression = source.slice(start).trimStart();
  if (expression.startsWith("{") || expression.startsWith("[")) {
    const json = findBalancedJsonAt(expression, 0);
    if (!json) return void 0;
    return parseEmbeddedJson(json);
  }
  const match = expression.match(/^JSON\.parse\(\s*(decodeURIComponent\(\s*)?/);
  if (!match) return void 0;
  const stringStart = match[0].length;
  const stringLiteral = parseJavaScriptString(expression, stringStart);
  if (!stringLiteral) return void 0;
  try {
    return parseEmbeddedJson(match[1] ? decodeURIComponent(stringLiteral.value) : stringLiteral.value);
  } catch {
    return void 0;
  }
}
function parseJsonScripts(html) {
  const values = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = parseHtmlAttributes(`<script${match[1]}>`);
    const body = match[2].trim();
    if (attributes.type?.toLowerCase() === "application/ld+json") {
      try {
        values.push(JSON.parse(body));
      } catch {
      }
    }
    if (attributes.id === "__INITIAL_STATE__" || attributes.id === "__NEXT_DATA__" || attributes.id === "__UNIVERSAL_DATA_FOR_REHYDRATION__") {
      const state = parseInitialStateExpression(body, 0);
      if (state) values.push(state);
      else {
        try {
          values.push(JSON.parse(body));
        } catch {
        }
      }
    }
    if (attributes.id === "RENDER_DATA") {
      try {
        values.push(JSON.parse(decodeURIComponent(body)));
      } catch {
      }
    }
    for (const assignment of body.matchAll(/(?:window\.)?(?:__INITIAL_STATE__|__SSR_DATA__|_SSR_DATA|_ROUTER_DATA)\s*=\s*/g)) {
      const state = parseInitialStateExpression(body, assignment.index + assignment[0].length);
      if (state) values.push(state);
    }
  }
  return values;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function stringValue(value) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}
function numberValue(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function socialImageItems(record) {
  const raw = record.imageList || record.imagesList || record.images || record.image_list || record.imageInfoList;
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}
function findSocialCandidates(value, candidates = [], depth = 0) {
  if (depth > 15 || !value || typeof value !== "object") return candidates;
  if (Array.isArray(value)) {
    value.forEach((item) => findSocialCandidates(item, candidates, depth + 1));
    return candidates;
  }
  const record = value;
  const hasText = Boolean(stringValue(record.itemTitle || record.item_title || record.title) || stringValue(record.desc) || stringValue(record.description));
  const hasMedia = socialImageItems(record).length > 0 || Boolean(record.video || record.media);
  if (hasText && hasMedia) candidates.push(record);
  Object.values(record).forEach((child) => findSocialCandidates(child, candidates, depth + 1));
  return candidates;
}
function xiaohongshuNoteId(url) {
  return url.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/i)?.[1] || "";
}
function socialCandidateScore(candidate, noteId) {
  const candidateId = stringValue(candidate.noteId || candidate.note_id || candidate.id);
  const metadata = asRecord(candidate.interactInfo || candidate.interact || candidate.statistics || candidate.stats);
  return socialImageItems(candidate).length * 100 + (stringValue(candidate.title) ? 20 : 0) + (stringValue(candidate.desc || candidate.description) ? 10 : 0) + (asRecord(candidate.user || candidate.author || candidate.creator) ? 5 : 0) + (Array.isArray(candidate.tagList || candidate.tags || candidate.topics) ? 3 : 0) + (metadata ? 3 : 0) + (noteId && candidateId === noteId ? 1e4 : 0);
}
function mediaFrom(value) {
  if (typeof value === "string" && value.trim()) return { url: normalizeMediaUrl(value.trim()) };
  const record = asRecord(value);
  if (!record) return null;
  const listedUrl = (Array.isArray(record.urlList) ? record.urlList : Array.isArray(record.url_list) ? record.url_list : []).map(stringValue).find(Boolean);
  const infoList = Array.isArray(record.infoList) ? record.infoList : Array.isArray(record.info_list) ? record.info_list : Array.isArray(record.urlInfoList) ? record.urlInfoList : [];
  const nested = infoList.map(asRecord).filter((item) => Boolean(item && stringValue(item.urlDefault || item.url || item.urlPre || item.urlPreload || item.src || item.fileUrl))).sort((left, right) => mediaVariantScore(right) - mediaVariantScore(left))[0] || record;
  const source = asRecord(nested) || record;
  const url = stringValue(source.urlDefault || source.url || source.urlPre || source.urlPreload || source.src || source.fileUrl || source.originUrl || source.origin_url) || listedUrl;
  if (!url) return null;
  return { url: normalizeMediaUrl(url), mimeType: stringValue(source.mimeType || source.type) || void 0, width: numberValue(record.width || source.width), height: numberValue(record.height || source.height) };
}
function mediaVariantScore(value) {
  const scene = stringValue(value.imageScene || value.image_scene || value.scene);
  if (/(?:origin|default|dft)/i.test(scene)) return 3;
  if (/(?:preview|prv|thumbnail|thumb)/i.test(scene)) return 1;
  return 2;
}
function videoMediaFrom(value) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (current, key = "", depth = 0, inherited) => {
    if (depth > 10 || current === null || current === void 0 || seen.has(current)) return;
    if (typeof current === "string") {
      const raw = current.trim();
      if (!raw || !/^(?:https?:)?\/\//i.test(raw)) return;
      const lowerKey = key.toLowerCase();
      const lowerUrl = raw.toLowerCase();
      const looksLikeVideo = /(?:video|stream|master|play|h26|av1|url)/i.test(lowerKey) || /(?:\.mp4|\.m3u8|video|stream|vod|h26)(?:[/?#]|$)/i.test(lowerUrl);
      if (!looksLikeVideo) return;
      candidates.push({
        resource: { url: normalizeMediaUrl(raw), mimeType: /\.m3u8(?:[?#]|$)/i.test(raw) ? "application/vnd.apple.mpegurl" : "video/mp4", ...inherited },
        score: (/master/i.test(lowerKey) ? 100 : 0) + (/h264/i.test(lowerKey) ? 40 : 0) + (/h265|hevc/i.test(lowerKey) ? 20 : 0) + (/\.mp4(?:[?#]|$)/i.test(raw) ? 30 : 0)
      });
      return;
    }
    if (typeof current !== "object") return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key, depth + 1, inherited));
      return;
    }
    const record = current;
    const dimensions = {
      width: numberValue(record.width || record.videoWidth || record.video_width) || inherited?.width,
      height: numberValue(record.height || record.videoHeight || record.video_height) || inherited?.height
    };
    Object.entries(record).forEach(([childKey, child]) => visit(child, childKey, depth + 1, dimensions));
  };
  visit(value);
  return candidates.sort((left, right) => right.score - left.score)[0]?.resource || null;
}
function normalizeMediaUrl(value) {
  if (value.startsWith("//")) return `https:${value}`;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && /(?:^|\.)xhscdn\.(?:com|net)$/i.test(url.hostname)) url.protocol = "https:";
    return url.toString();
  } catch {
    return value;
  }
}
function livePhotoFrom(value) {
  const record = asRecord(value);
  if (!record) return null;
  const image = mediaFrom(record.image || record.photo || record.imageInfo || record.imageUrl || record.cover || record.coverUrl || record.photoInfo);
  const motionVideo = mediaFrom(record.motionVideo || record.motion || record.video || record.videoInfo || record.videoUrl || record.motionVideoUrl || record.videoInfoList);
  return image ? { image, motionVideo: motionVideo || void 0 } : null;
}
function socialPublishedAt(candidate) {
  const raw = candidate.time || candidate.createTime || candidate.publishedAt || candidate.publishTime || candidate.lastUpdateTime || candidate.last_update_time;
  const rawNumber = numberValue(raw);
  const date = rawNumber && rawNumber > 1e8 ? new Date((rawNumber < 1e11 ? rawNumber * 1e3 : rawNumber) + 8 * 60 * 60 * 1e3) : void 0;
  const dateText = date && !Number.isNaN(date.getTime()) ? `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}` : stringValue(raw);
  const location = stringValue(candidate.ipLocation || candidate.ip_location || candidate.location || candidate.ipLocationName);
  return [dateText, location].filter(Boolean).join(" ") || void 0;
}
function socialBodyText(value, topics) {
  if (!value || topics.length === 0) return value;
  const withoutTopicMarkup = value.replace(/#([^#\n]+?)\[话题\]#/g, "").replace(/#([^#\n]+?)#/g, (match, name) => topics.includes(name.trim()) ? "" : match);
  return withoutTopicMarkup.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}
function parseSocialPage(url, html) {
  const scripts = parseJsonScripts(html);
  const noteId = xiaohongshuNoteId(url);
  const candidate = scripts.flatMap((state) => findSocialCandidates(state)).sort((left, right) => socialCandidateScore(right, noteId) - socialCandidateScore(left, noteId))[0] || null;
  const title = stringValue(candidate?.title) || firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || "\u5C0F\u7EA2\u4E66\u5185\u5BB9";
  const thumbnailUrl = mediaFrom(candidate?.cover || candidate?.image || candidate?.coverUrl || candidate?.coverImage)?.url || firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || void 0;
  if (!candidate) return { title, thumbnailUrl };
  const user = asRecord(candidate.user || candidate.author || candidate.creator);
  const authorName = stringValue(user?.nickname || user?.nickName || user?.name);
  const imagesRaw = socialImageItems(candidate);
  const topicValues = Array.isArray(candidate.tagList || candidate.tags || candidate.topics) ? candidate.tagList || candidate.tags || candidate.topics : [];
  const topics = topicValues.map((item) => stringValue(asRecord(item)?.name || asRecord(item)?.tag || item)).filter(Boolean);
  const bodyText = socialBodyText(stringValue(candidate.desc || candidate.description || candidate.content || candidate.text), topics);
  const liveRaw = candidate.livePhoto || candidate.live_photo || candidate.livePhotos || candidate.live_photo_list || asRecord(candidate.media)?.livePhoto || asRecord(candidate.media)?.live_photo;
  const livePhotos = (Array.isArray(liveRaw) ? liveRaw : liveRaw ? [liveRaw] : []).map(livePhotoFrom).filter((item) => Boolean(item));
  const liveImageUrls = new Set(livePhotos.map((item) => item.image.url));
  const images = imagesRaw.map(mediaFrom).filter((item) => Boolean(item) && !liveImageUrls.has(item.url));
  const videoValue = candidate.video || asRecord(candidate.media)?.video || candidate.videoInfo || candidate.video_info;
  const video = videoMediaFrom(videoValue) || mediaFrom(videoValue);
  const videoPoster = images[0] || mediaFrom(candidate.cover || candidate.image || candidate.coverUrl || candidate.coverImage);
  const blocks = [];
  if (bodyText) blocks.push({ type: "text", text: bodyText });
  images.forEach((resource) => blocks.push({ type: "image", resource }));
  livePhotos.forEach((item) => blocks.push({ type: "live-photo", image: item.image, motionVideo: item.motionVideo }));
  if (video) {
    const filteredImages = blocks.filter((block) => block.type !== "image");
    blocks.length = 0;
    blocks.push(...filteredImages, { type: "video", resource: video, poster: videoPoster || void 0 });
  }
  topics.forEach((name) => blocks.push({ type: "topic", name }));
  const interact = asRecord(candidate.interactInfo || candidate.interact || candidate.statistics || candidate.stats);
  const metrics = {
    likes: numberValue(candidate.likeCount || candidate.likedCount || candidate.likes || interact?.likeCount || interact?.likedCount || interact?.likes),
    collects: numberValue(candidate.collectCount || candidate.collectedCount || candidate.collects || interact?.collectCount || interact?.collectedCount || interact?.collects),
    comments: numberValue(candidate.commentCount || candidate.comments || interact?.commentCount || interact?.comments),
    shares: numberValue(candidate.shareCount || candidate.shares || interact?.shareCount || interact?.shares),
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const hasMetric = Object.values(metrics).some((value) => value !== void 0 && value !== metrics.capturedAt);
  const social = {
    kind: "social",
    platform: "xiaohongshu",
    canonicalUrl: url,
    title,
    bodyText,
    contentBlocks: blocks,
    author: authorName ? { id: stringValue(user?.userId || user?.id) || void 0, name: authorName, avatarUrl: mediaFrom(user?.avatar || user?.avatarUrl)?.url, profileUrl: stringValue(user?.homeLink || user?.profileUrl) || void 0 } : void 0,
    publishedAt: socialPublishedAt(candidate),
    metrics: hasMetric ? metrics : void 0,
    topics: topics.length ? topics : void 0
  };
  return { title, thumbnailUrl: thumbnailUrl || images[0]?.url, social };
}
function hashtagTopics(value) {
  return [...new Set(Array.from(value.matchAll(/#([^#\s，。！？、]{1,40})/g), (match) => match[1].trim()).filter(Boolean))];
}
function douyinDescriptionMetadata(value) {
  const matched = value.match(/\s+-\s+([^\r\n]{1,80}?)于(\d{8})发布在抖音(?:，|,|。|$)/);
  if (!matched || matched.index === void 0) return { bodyText: value.trim(), authorName: "" };
  return {
    bodyText: value.slice(0, matched.index).trim(),
    authorName: matched[1].trim()
  };
}
function parseDouyinPage(url, html) {
  const targetVideoId = douyinVideoIdFromUrl(url) || douyinVideoIdFromHtml(html);
  const candidate = parseJsonScripts(html).flatMap((state) => findSocialCandidates(state)).sort((left, right) => {
    const score = (record) => {
      const candidateId = stringValue(record.awemeId || record.aweme_id || record.groupId || record.group_id);
      return (targetVideoId && candidateId === targetVideoId ? 1e4 : 0) + (candidateId ? 200 : 0) + (stringValue(record.desc || record.description) ? 100 : 0) + (asRecord(record.author || record.authorInfo) ? 50 : 0) + (record.video ? 40 : 0) + socialImageItems(record).length * 10;
    };
    return score(right) - score(left);
  })[0] || null;
  const metaTitle = findMetaContent(html, ["og:title", "twitter:title"]);
  const documentTitle = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s*[-–—]\s*抖音\s*$/i, "");
  const metaDescription = findMetaContent(html, ["og:description", "twitter:description", "description"]);
  const descriptionMetadata = douyinDescriptionMetadata(metaDescription);
  const metaImage = resolveRemoteUrl(findMetaContent(html, ["og:image", "twitter:image"]), url);
  const bodyText = stringValue(candidate?.desc || candidate?.description || candidate?.content || candidate?.text) || descriptionMetadata.bodyText;
  const author = asRecord(candidate?.author || candidate?.authorInfo || candidate?.user || candidate?.creator);
  const authorName = stringValue(author?.nickname || author?.name || author?.uniqueId || author?.unique_id) || descriptionMetadata.authorName;
  const imagesValue = candidate?.images || asRecord(candidate?.imagePostInfo || candidate?.image_post_info)?.images;
  const images = (Array.isArray(imagesValue) ? imagesValue : imagesValue ? [imagesValue] : []).map((item) => mediaFrom(asRecord(item)?.displayImage || asRecord(item)?.display_image || item)).filter((item) => Boolean(item));
  const videoValue = candidate?.video || candidate?.videoInfo || candidate?.video_info;
  const video = videoMediaFrom(videoValue) || mediaFrom(videoValue);
  const poster = mediaFrom(asRecord(videoValue)?.cover || asRecord(videoValue)?.dynamicCover || candidate?.cover) || images[0] || (metaImage ? { url: metaImage } : null);
  const title = stringValue(candidate?.itemTitle || candidate?.item_title || candidate?.title) || metaTitle || documentTitle || bodyText.split("\n")[0]?.slice(0, 80) || (authorName ? `${authorName}\u7684\u6296\u97F3\u5185\u5BB9` : "\u6296\u97F3\u5185\u5BB9");
  if (!candidate && !bodyText && !metaTitle && !documentTitle) return { title: "\u6296\u97F3\u5185\u5BB9", thumbnailUrl: metaImage };
  const canonicalUrl = resolveRemoteUrl(findCanonicalHref(html), url) || url;
  const topics = hashtagTopics(bodyText);
  const blocks = [];
  if (bodyText) blocks.push({ type: "text", text: bodyText });
  images.forEach((resource) => blocks.push({ type: "image", resource }));
  if (video) blocks.push({ type: "video", resource: video, poster: poster || void 0 });
  topics.forEach((name) => blocks.push({ type: "topic", name }));
  const statistics = asRecord(candidate?.statistics || candidate?.stats);
  const metrics = {
    likes: numberValue(statistics?.diggCount || statistics?.digg_count || candidate?.diggCount),
    collects: numberValue(statistics?.collectCount || statistics?.collect_count || candidate?.collectCount),
    comments: numberValue(statistics?.commentCount || statistics?.comment_count || candidate?.commentCount),
    shares: numberValue(statistics?.shareCount || statistics?.share_count || candidate?.shareCount),
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const hasMetric = Object.entries(metrics).some(([key, value]) => key !== "capturedAt" && value !== void 0);
  return {
    title,
    thumbnailUrl: poster?.url || metaImage,
    social: {
      kind: "social",
      platform: "douyin",
      canonicalUrl,
      title,
      bodyText,
      contentBlocks: blocks,
      author: authorName ? { id: stringValue(author?.uid || author?.id || author?.secUid || author?.sec_uid) || void 0, name: authorName, avatarUrl: mediaFrom(author?.avatarThumb || author?.avatar_thumb || author?.avatar)?.url } : void 0,
      publishedAt: socialPublishedAt(candidate || {}),
      metrics: hasMetric ? metrics : void 0,
      topics: topics.length ? topics : void 0
    }
  };
}
function instagramCaption(value) {
  const quoted = value.match(/:\s*["“]([\s\S]*?)["”]\s*$/)?.[1];
  return decodeHtml((quoted || value).trim());
}
function parseInstagramPage(url, html) {
  const candidate = parseJsonScripts(html).map((state) => findNestedRecord(state, (record) => Boolean(record.edge_media_to_caption || record.caption) && Boolean(record.owner || record.user))).find(Boolean);
  const owner = asRecord(candidate?.owner || candidate?.user || candidate?.author);
  const captionEdges = asRecord(candidate?.edge_media_to_caption)?.edges;
  const firstCaption = Array.isArray(captionEdges) ? asRecord(asRecord(captionEdges[0])?.node) : null;
  const metaDescription = findMetaContent(html, ["og:description", "twitter:description", "description"]);
  const bodyText = stringValue(firstCaption?.text || asRecord(candidate?.caption)?.text || candidate?.caption) || instagramCaption(metaDescription);
  const authorName = stringValue(owner?.username || owner?.full_name || owner?.name);
  const metaTitle = findMetaContent(html, ["og:title", "twitter:title"]);
  const title = stringValue(candidate?.title) || metaTitle || (authorName ? `${authorName}\u7684 Instagram \u5185\u5BB9` : "Instagram \u5185\u5BB9");
  const imageUrl = stringValue(candidate?.display_url || candidate?.thumbnail_src) || resolveRemoteUrl(findMetaContent(html, ["og:image", "twitter:image"]), url);
  const videoUrl = stringValue(candidate?.video_url) || resolveRemoteUrl(findMetaContent(html, ["og:video:secure_url", "og:video"]), url);
  if (!candidate && !metaTitle && !metaDescription && !imageUrl) return { title: "Instagram \u5185\u5BB9" };
  const topics = hashtagTopics(bodyText);
  const blocks = [];
  if (bodyText) blocks.push({ type: "text", text: bodyText });
  if (videoUrl) blocks.push({ type: "video", resource: { url: videoUrl, mimeType: "video/mp4" }, poster: imageUrl ? { url: imageUrl } : void 0 });
  else if (imageUrl) blocks.push({ type: "image", resource: { url: imageUrl } });
  topics.forEach((name) => blocks.push({ type: "topic", name }));
  const metrics = {
    likes: numberValue(asRecord(candidate?.edge_media_preview_like)?.count || asRecord(candidate?.edge_liked_by)?.count),
    comments: numberValue(asRecord(candidate?.edge_media_to_parent_comment)?.count || asRecord(candidate?.edge_media_to_comment)?.count),
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const hasMetric = metrics.likes !== void 0 || metrics.comments !== void 0;
  return {
    title,
    thumbnailUrl: imageUrl,
    social: {
      kind: "social",
      platform: "instagram",
      canonicalUrl: url,
      title,
      bodyText,
      contentBlocks: blocks,
      author: authorName ? { id: stringValue(owner?.id) || void 0, name: authorName, avatarUrl: stringValue(owner?.profile_pic_url) || void 0 } : void 0,
      publishedAt: socialPublishedAt(candidate || {}),
      metrics: hasMetric ? metrics : void 0,
      topics: topics.length ? topics : void 0
    }
  };
}
function parseHtmlAttributes(tag) {
  const attributes = {};
  const source = tag.replace(/^<[a-z][\w:-]*\b/i, "").replace(/\/?\s*>$/, "");
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || "");
  }
  return attributes;
}
function findMetaContent(html, keys) {
  const expected = new Set(keys.map((key) => key.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    const key = (attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
    if (expected.has(key) && attributes.content?.trim()) return attributes.content.trim();
  }
  return "";
}
function findCanonicalHref(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    if (attributes.rel?.toLowerCase().split(/\s+/).includes("canonical") && attributes.href?.trim()) return attributes.href.trim();
  }
  return "";
}
function resolveRemoteUrl(value, baseUrl) {
  if (!value) return void 0;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return void 0;
  }
}
function htmlFragmentToText(html) {
  return decodeHtml(
    html.replace(/<!--([\s\S]*?)-->/g, "").replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/?(?:address|article|blockquote|div|figcaption|figure|h[1-6]|header|li|main|p|pre|section|table|tbody|td|th|thead|tr|ul|ol)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[\t\f\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  );
}
function stripNonContentElements(html) {
  return html.replace(/<!--([\s\S]*?)-->/g, "").replace(/<(?:script|style|noscript|template|svg|canvas|iframe|object|embed|form|nav|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|canvas|iframe|object|embed|form|nav|footer|aside|dialog)>/gi, "");
}
function extractTagBlocks(html, tagName, predicate) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, "gi");
  const blocks = [];
  for (const match of html.matchAll(pattern)) {
    if (!predicate || predicate(parseHtmlAttributes(`<${tagName}${match[1]}>`))) blocks.push(match[2]);
  }
  return blocks;
}
function mainContentHtml(html) {
  const cleaned = stripNonContentElements(html);
  const candidates = [
    ...extractTagBlocks(cleaned, "article").map((value) => ({ html: value, priority: 3 })),
    ...extractTagBlocks(cleaned, "main").map((value) => ({ html: value, priority: 3 })),
    ...extractTagBlocks(cleaned, "section", (attributes) => attributes.role?.toLowerCase() === "main").map((value) => ({ html: value, priority: 2 })),
    ...extractTagBlocks(cleaned, "div", (attributes) => {
      const selectorText = `${attributes.id || ""} ${attributes.class || ""} ${attributes.role || ""}`.toLowerCase();
      return attributes.role?.toLowerCase() === "main" || /\b(?:article|content|entry|main|post|story)\b/.test(selectorText);
    }).map((value) => ({ html: value, priority: 1 }))
  ];
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
  const usable = candidates.map((candidate) => ({ ...candidate, text: htmlFragmentToText(candidate.html) })).filter((candidate) => candidate.text.length >= (candidate.priority >= 2 ? 80 : 180)).sort((left, right) => {
    const priority = right.priority - left.priority;
    if (priority) return priority;
    return right.text.length - left.text.length;
  });
  return usable[0]?.html || body;
}
function htmlToText(html) {
  return htmlFragmentToText(mainContentHtml(html)).slice(0, MAX_EXTRACTED_TEXT_CHARS);
}
function documentTextFromState(value) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (current, key = "", depth = 0) => {
    if (depth > 18 || current === null || current === void 0) return [];
    if (typeof current === "string") {
      const text = decodeHtml(current).replace(/\r\n/g, "\n").trim();
      return /(?:text|content|title|heading|paragraph|body|value|name)/i.test(key) && text.length > 1 && !/^https?:\/\//i.test(text) ? [text] : [];
    }
    if (typeof current !== "object" || seen.has(current)) return [];
    seen.add(current);
    if (Array.isArray(current)) return current.flatMap((item) => visit(item, key, depth + 1));
    const record = current;
    const local = Object.entries(record).filter(([childKey]) => !/(?:i18n|locale|translation|config|style|css|icon|url|token|id)$/i.test(childKey)).flatMap(([childKey, child]) => visit(child, childKey, depth + 1));
    if (/(?:block|document|doc|page|content|body|paragraph|text|heading|title)/i.test(key) && local.length) {
      const joined = [...new Set(local)].join("\n").trim();
      if (joined.length >= 20) candidates.push(joined);
    }
    return local;
  };
  visit(value);
  return candidates.sort((left, right) => right.length - left.length)[0]?.slice(0, MAX_EXTRACTED_TEXT_CHARS) || "";
}
function feishuPageToken(url) {
  try {
    return new URL(url).pathname.match(/\/(?:docx|docs|wiki)\/([A-Za-z0-9_-]+)/i)?.[1];
  } catch {
    return void 0;
  }
}
function feishuMetaCache(html, token) {
  const marker = `"${token}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return void 0;
  const encryptedIndex = html.indexOf('"encrypted"', markerIndex + marker.length);
  if (encryptedIndex < 0 || encryptedIndex - markerIndex > 2e3) return void 0;
  const separator = html.indexOf(":", encryptedIndex + '"encrypted"'.length);
  if (separator < 0) return void 0;
  const valueOffset = html.slice(separator + 1).search(/["']/);
  if (valueOffset < 0) return void 0;
  return parseJavaScriptString(html, separator + 1 + valueOffset)?.value;
}
function feishuBlockText(block) {
  const data = asRecord(block.data) || block;
  const type = stringValue(data.type).toLowerCase();
  if (!/^(?:page|text|heading\d*|bullet|ordered|todo|quote|callout|code|equation|table_cell)$/.test(type)) return "";
  const textRecord = asRecord(data.text);
  const initial = asRecord(textRecord?.initialAttributedTexts);
  const textMap = asRecord(initial?.text);
  if (textMap) {
    const text = Object.entries(textMap).sort(([left], [right]) => Number(left) - Number(right)).map(([, value]) => stringValue(value)).join("").trim();
    if (text) return text;
  }
  return stringValue(data.text || data.title || data.name);
}
function parseFeishuClientVars(url, payload) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (!root || numberValue(root.code) !== 0 || !data) {
    throw new ScrapeError("ACCESS_RESTRICTED", stringValue(root?.msg) || "\u98DE\u4E66\u672A\u8FD4\u56DE\u53EF\u8BFB\u53D6\u7684\u516C\u5F00\u6587\u6863\u6570\u636E", 403, false);
  }
  const blockMap = asRecord(data.block_map);
  const sequence = Array.isArray(data.block_sequence) ? data.block_sequence.map(stringValue).filter(Boolean) : [];
  const pageId = stringValue(data.id) || feishuPageToken(url) || "";
  const content = sequence.filter((id) => id !== pageId).map((id) => asRecord(blockMap?.[id])).filter((block) => Boolean(block)).map(feishuBlockText).filter(Boolean).join("\n").trim().slice(0, MAX_EXTRACTED_TEXT_CHARS);
  const metaMap = asRecord(data.meta_map);
  const pageMeta = asRecord(metaMap?.[pageId]);
  const title = stringValue(pageMeta?.title) || feishuBlockText(asRecord(blockMap?.[pageId]) || {}) || "\u98DE\u4E66\u6587\u6863";
  if (!content) throw new ScrapeError("NO_READABLE_CONTENT", "\u98DE\u4E66\u6587\u6863\u6CA1\u6709\u53EF\u63D0\u53D6\u7684\u6587\u672C\u6B63\u6587", 422, false);
  return { title, content, canonicalUrl: url };
}
async function fetchFeishuPage(url) {
  const cookieJar = new RedirectCookieJar();
  const result = await fetchLimited(url, MAX_HTML_BYTES, { headers: browserPageHeaders() }, cookieJar);
  const token = feishuPageToken(result.url) || feishuPageToken(url);
  const encrypted = token ? feishuMetaCache(result.body, token) : void 0;
  if (token && encrypted) {
    const endpoint = new URL("/space/api/docx/pages/client_vars", result.url);
    endpoint.searchParams.set("id", token);
    endpoint.searchParams.set("mode", "7");
    endpoint.searchParams.set("limit", "239");
    const metadata = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: result.url,
        "User-Agent": browserPageHeaders()["User-Agent"],
        "ccm-meta": JSON.stringify({ [token]: encrypted })
      }
    }, cookieJar);
    return parseFeishuClientVars(result.url, parseJsonResponse(metadata.body, "\u98DE\u4E66\u6587\u6863"));
  }
  return parseFeishuPage(result.url, result.body);
}
function parseFeishuPage(url, html) {
  const title = findMetaContent(html, ["og:title", "twitter:title"]) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || "\u98DE\u4E66\u6587\u6863";
  const shellText = htmlToText(html);
  const embeddedText = parseJsonScripts(html).map(documentTextFromState).sort((left, right) => right.length - left.length)[0] || "";
  const restricted = /(?:登录飞书|扫码登录|sign in|log in|无权限|暂无权限|access denied)/i.test(shellText);
  const content = embeddedText.length > shellText.length ? embeddedText : shellText;
  if (restricted && content.length < 80) throw new ScrapeError("ACCESS_RESTRICTED", "\u98DE\u4E66\u6587\u6863\u672A\u516C\u5F00\u5206\u4EAB\u6216\u9700\u8981\u767B\u5F55\u540E\u8BBF\u95EE", 403, false);
  if (!content || /^(?:飞书|Feishu|Lark)$/i.test(content.trim())) throw new ScrapeError("NO_READABLE_CONTENT", "\u672A\u80FD\u8BFB\u53D6\u98DE\u4E66\u6587\u6863\u6B63\u6587\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u5F00\u542F\u516C\u5F00\u5206\u4EAB", 422, false);
  return {
    title,
    content,
    canonicalUrl: resolveRemoteUrl(findCanonicalHref(html), url) || url,
    thumbnailUrl: resolveRemoteUrl(findMetaContent(html, ["og:image", "twitter:image"]), url)
  };
}
function hostMatches(hostname, ...domains) {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
function secureRemoteUrl(value) {
  const url = stringValue(value);
  return url.startsWith("http://") ? `https://${url.slice("http://".length)}` : url || void 0;
}
function parseJsonResponse(body, subject) {
  try {
    return JSON.parse(body);
  } catch {
    throw new ScrapeError("UPSTREAM_ERROR", `${subject}\u5143\u6570\u636E\u54CD\u5E94\u89E3\u6790\u5931\u8D25`, 502, true);
  }
}
function extractBilibiliVideoId(url) {
  const match = new URL(url).pathname.match(/\/video\/(BV[0-9A-Za-z]{10}|av\d+)/i);
  return match?.[1];
}
async function fetchBilibiliMetadata(url) {
  const videoId = extractBilibiliVideoId(url);
  if (!videoId) throw new ScrapeError("INVALID_CONTENT", "\u65E0\u6CD5\u8BC6\u522B Bilibili \u89C6\u9891 ID", 400, false);
  const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
  endpoint.searchParams.set(videoId.toLowerCase().startsWith("av") ? "aid" : "bvid", videoId.replace(/^av/i, ""));
  const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    }
  });
  const payload = parseJsonResponse(result.body, "Bilibili");
  if (payload.code !== 0 || !payload.data) {
    const notFound = payload.code === -404;
    throw new ScrapeError(notFound ? "CONTENT_NOT_FOUND" : "UPSTREAM_ERROR", stringValue(payload.message) || "Bilibili \u672A\u8FD4\u56DE\u89C6\u9891\u5143\u6570\u636E", notFound ? 404 : 502, !notFound);
  }
  const data = payload.data;
  const owner = asRecord(data.owner);
  const dimension = asRecord(data.dimension);
  const title = stringValue(data.title) || videoId;
  const description = stringValue(data.desc);
  return {
    title,
    content: description === "-" ? "" : description,
    canonicalUrl: `https://www.bilibili.com/video/${encodeURIComponent(videoId)}/`,
    thumbnailUrl: secureRemoteUrl(data.pic),
    authorName: stringValue(owner?.name) || void 0,
    duration: numberValue(data.duration),
    width: numberValue(dimension?.width),
    height: numberValue(dimension?.height)
  };
}
function extractVimeoVideoId(url) {
  const pathSegments = new URL(url).pathname.split("/").filter(Boolean);
  return pathSegments.find((segment) => /^\d+$/.test(segment));
}
function vimeoConfigMetadata(payload, videoId) {
  const video = asRecord(payload.video);
  if (!video) return void 0;
  const owner = asRecord(video.owner);
  const thumbs = asRecord(video.thumbs);
  const thumbnail = thumbs ? Object.entries(thumbs).sort(([left], [right]) => Number(right) - Number(left)).map(([, value]) => stringValue(value)).find(Boolean) : "";
  const title = stringValue(video.title);
  if (!title) return void 0;
  return {
    title,
    content: "",
    canonicalUrl: `https://vimeo.com/${videoId}`,
    thumbnailUrl: secureRemoteUrl(thumbnail),
    authorName: stringValue(owner?.name) || void 0,
    duration: numberValue(video.duration),
    width: numberValue(video.width),
    height: numberValue(video.height)
  };
}
async function fetchVimeoMetadata(url) {
  const videoId = extractVimeoVideoId(url);
  if (!videoId) throw new ScrapeError("INVALID_CONTENT", "\u65E0\u6CD5\u8BC6\u522B Vimeo \u89C6\u9891 ID", 400, false);
  const headers = {
    Accept: "application/json,text/plain,*/*",
    Referer: "https://vimeo.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
  };
  let firstError;
  try {
    const result = await fetchLimited(`https://vimeo.com/api/v2/video/${encodeURIComponent(videoId)}.json`, MAX_TEXT_BYTES, { headers });
    const payload = parseJsonResponse(result.body, "Vimeo");
    const video = payload[0];
    const title = stringValue(video?.title);
    if (video && title) {
      return {
        title,
        content: htmlFragmentToText(stringValue(video.description)),
        canonicalUrl: stringValue(video.url) || `https://vimeo.com/${videoId}`,
        thumbnailUrl: secureRemoteUrl(video.thumbnail_large || video.thumbnail_medium || video.thumbnail_small),
        authorName: stringValue(video.user_name) || void 0,
        duration: numberValue(video.duration),
        width: numberValue(video.width),
        height: numberValue(video.height)
      };
    }
  } catch (error) {
    firstError = error;
  }
  try {
    const result = await fetchLimited(`https://player.vimeo.com/video/${encodeURIComponent(videoId)}/config`, MAX_TEXT_BYTES, { headers });
    const metadata = vimeoConfigMetadata(parseJsonResponse(result.body, "Vimeo"), videoId);
    if (metadata) return metadata;
  } catch (error) {
    if (!firstError) firstError = error;
  }
  if (firstError instanceof ScrapeError) throw firstError;
  throw new ScrapeError("NO_READABLE_CONTENT", "\u65E0\u6CD5\u8BFB\u53D6 Vimeo \u89C6\u9891\u5143\u6570\u636E", 422, true);
}
function looksLikeAccessChallengePage(title, content) {
  const sample = `${title}
${content.slice(0, 2e3)}`.toLowerCase();
  const explicitPhrases = [
    "verify to continue",
    "confirm that you're a human",
    "confirm that you are a human",
    "not a spambot",
    "checking if the site connection is secure",
    "needs to review the security of your connection",
    "\u4EBA\u673A\u9A8C\u8BC1",
    "\u5B89\u5168\u9A8C\u8BC1"
  ];
  if (explicitPhrases.some((phrase) => sample.includes(phrase))) return true;
  const genericSignals = ["captcha", "challenge-platform", "cf-chl-", "access denied", "security check"];
  return genericSignals.filter((signal) => sample.includes(signal)).length >= 2;
}
function isHtmlContentType(contentType) {
  return /(?:^|\s|;)text\/html(?:;|$)|application\/xhtml\+xml/i.test(contentType);
}
function isPlainTextContentType(contentType) {
  return /(?:^|\s|;)text\/plain(?:;|$)/i.test(contentType);
}
function looksLikeHtml(value) {
  return /^\s*<!doctype\s+html|^\s*<html\b|^\s*<body\b/i.test(value);
}
function isXiaohongshuHost(hostname) {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com") || hostname === "xhslink.com" || hostname.endsWith(".xhslink.com");
}
function isDouyinHost(hostname) {
  return hostMatches(hostname, "douyin.com", "iesdouyin.com");
}
function douyinVideoIdFromUrl(value) {
  try {
    const target = new URL(value);
    const queryId = target.searchParams.get("modal_id") || target.searchParams.get("aweme_id") || target.searchParams.get("video_id");
    if (queryId && /^\d{12,24}$/.test(queryId)) return queryId;
    return target.pathname.match(/\/(?:video|note|share\/(?:video|note))\/(\d{12,24})(?:\/|$)/i)?.[1] || "";
  } catch {
    return "";
  }
}
function douyinVideoIdFromHtml(html) {
  const patterns = [
    /["'](?:aweme_id|awemeId|video_id|videoId|modal_id)["']\s*:\s*["']?(\d{12,24})/i,
    /(?:aweme_id|video_id|modal_id)(?:%3D|=)(\d{12,24})/i,
    /\/(?:video|note|share\/(?:video|note))\/(\d{12,24})(?:[/?#"']|$)/i
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1] || "").find(Boolean) || "";
}
function usefulDouyinSocial(social) {
  if (!social) return false;
  return Boolean(
    social.bodyText.trim() || social.author?.name || social.contentBlocks.some((block) => block.type === "image" || block.type === "video" || block.type === "live-photo")
  );
}
function douyinCanonicalUrl(id, urls) {
  const isNote = urls.some((value) => {
    try {
      return new URL(value).pathname.includes(`/note/${id}`);
    } catch {
      return false;
    }
  });
  return `https://www.douyin.com/${isNote ? "note" : "video"}/${id}`;
}
function isInstagramHost(hostname) {
  return hostMatches(hostname, "instagram.com");
}
function isFeishuHost(hostname) {
  return hostMatches(hostname, "feishu.cn", "larksuite.com");
}
function browserPageHeaders(language = "zh-CN,zh;q=0.9,en;q=0.8") {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": language,
    "Cache-Control": "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  };
}
function douyinMobilePageHeaders() {
  return {
    ...browserPageHeaders(),
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36"
  };
}
async function fetchDouyinContent(url) {
  const headers = browserPageHeaders();
  const discoveredUrls = [url];
  let videoId = douyinVideoIdFromUrl(url);
  let initialResult;
  let lastError;
  let bestResult;
  const originalTarget = new URL(url);
  const shouldInspectOriginal = !videoId || /\/(?:jingxuan|note(?:\/|$))/.test(originalTarget.pathname) || hostMatches(originalTarget.hostname, "v.douyin.com");
  if (shouldInspectOriginal) {
    try {
      initialResult = await fetchLimited(url, MAX_HTML_BYTES, { headers });
      discoveredUrls.push(...initialResult.redirects, initialResult.url);
      videoId = discoveredUrls.map(douyinVideoIdFromUrl).find(Boolean) || douyinVideoIdFromHtml(initialResult.body);
      const parsed = parseDouyinPage(initialResult.url, initialResult.body);
      const canonicalUrl = videoId ? douyinCanonicalUrl(videoId, discoveredUrls) : parsed.social?.canonicalUrl || initialResult.url;
      if (parsed.social) parsed.social.canonicalUrl = canonicalUrl;
      bestResult = { title: parsed.title, content: parsed.social?.bodyText || "", canonicalUrl, thumbnailUrl: parsed.thumbnailUrl, social: parsed.social };
      if (usefulDouyinSocial(parsed.social)) return bestResult;
    } catch (error) {
      lastError = error;
    }
  }
  const noteUrl = videoId ? discoveredUrls.find((value) => {
    try {
      return new URL(value).pathname.includes(`/note/${videoId}`);
    } catch {
      return false;
    }
  }) : void 0;
  const targets = [
    ...noteUrl ? [noteUrl] : [],
    ...videoId && noteUrl ? [`https://www.douyin.com/share/note/${videoId}`] : [],
    ...videoId ? [`https://www.douyin.com/video/${videoId}`, `https://www.douyin.com/share/video/${videoId}`, `https://www.iesdouyin.com/share/video/${videoId}/`] : [],
    url
  ].filter((target, index, values) => values.indexOf(target) === index && target !== initialResult?.url);
  for (const target of targets) {
    try {
      const targetHeaders = /\/share\/(?:note|video)\//i.test(new URL(target).pathname) ? douyinMobilePageHeaders() : headers;
      const result = await fetchLimited(target, MAX_HTML_BYTES, { headers: targetHeaders });
      discoveredUrls.push(...result.redirects, result.url);
      videoId ||= discoveredUrls.map(douyinVideoIdFromUrl).find(Boolean) || douyinVideoIdFromHtml(result.body);
      const parsed = parseDouyinPage(result.url, result.body);
      const canonicalUrl = videoId ? douyinCanonicalUrl(videoId, discoveredUrls) : parsed.social?.canonicalUrl || result.url;
      if (parsed.social) parsed.social.canonicalUrl = canonicalUrl;
      const candidate = {
        title: parsed.title,
        content: parsed.social?.bodyText || "",
        canonicalUrl,
        thumbnailUrl: parsed.thumbnailUrl,
        social: parsed.social
      };
      if (!bestResult || candidate.content.length > bestResult.content.length || candidate.social?.contentBlocks.length > (bestResult.social?.contentBlocks.length || 0)) bestResult = candidate;
      if (usefulDouyinSocial(parsed.social)) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  if (bestResult && usefulDouyinSocial(bestResult.social)) return bestResult;
  if (lastError instanceof ScrapeError && !videoId) throw lastError;
  throw new ScrapeError("NO_READABLE_CONTENT", videoId ? "\u5DF2\u8BC6\u522B\u6296\u97F3\u4F5C\u54C1 ID\uFF0C\u4F46\u672A\u80FD\u8BFB\u53D6\u516C\u5F00\u6B63\u6587\uFF1B\u4E0A\u6E38\u53EF\u80FD\u8FD4\u56DE\u4E86\u5B89\u5168\u9A8C\u8BC1\u9875" : "\u65E0\u6CD5\u4ECE\u6296\u97F3\u77ED\u94FE\u6216\u7CBE\u9009\u9875\u8BC6\u522B\u4F5C\u54C1 ID", 422, true);
}
function isXiaohongshuMediaHost(hostname) {
  return /(?:^|\.)xhscdn\.(?:com|net)$/i.test(hostname);
}
async function fetchMediaLimited(rawUrl, range) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new ScrapeError("INVALID_URL", "\u56FE\u7247 URL \u683C\u5F0F\u65E0\u6548", 400, false);
  }
  if (!["http:", "https:"].includes(target.protocol) || !isXiaohongshuMediaHost(target.hostname)) {
    throw new ScrapeError("MEDIA_URL_REJECTED", "\u4EC5\u652F\u6301\u5C0F\u7EA2\u4E66\u56FE\u7247\u5730\u5740", 400, false);
  }
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(target.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "video/mp4,video/*;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://www.xiaohongshu.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          ...range ? { Range: range } : {}
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ScrapeError("UPSTREAM_ERROR", "\u5A92\u4F53\u91CD\u5B9A\u5411\u7F3A\u5C11\u76EE\u6807\u5730\u5740", 502, true);
        if (redirect === MAX_REDIRECTS) throw new ScrapeError("TOO_MANY_REDIRECTS", "\u5A92\u4F53\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", 502, true);
        const next = new URL(location, target);
        if (!isXiaohongshuMediaHost(next.hostname)) throw new ScrapeError("MEDIA_URL_REJECTED", "\u5A92\u4F53\u91CD\u5B9A\u5411\u76EE\u6807\u4E0D\u662F\u5C0F\u7EA2\u4E66\u5730\u5740", 400, false);
        await response.body?.cancel();
        target = next;
        continue;
      }
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) throw new ScrapeError("CONTENT_NOT_FOUND", "\u5A92\u4F53\u4E0D\u5B58\u5728\u6216\u5DF2\u5931\u6548", response.status, false);
        if (response.status === 429) throw new ScrapeError("RATE_LIMITED", "\u5A92\u4F53\u8BF7\u6C42\u9891\u7387\u53D7\u9650\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", 429, true);
        throw new ScrapeError("UPSTREAM_ERROR", `\u5A92\u4F53\u4E0A\u6E38\u8FD4\u56DE HTTP ${response.status}`, 502, true);
      }
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const isVideo = /^video\//i.test(contentType) || /\.mp4(?:[?#]|$)/i.test(target.toString());
      const bytes = await readBytesLimited(response, MAX_MEDIA_BYTES, isVideo ? "\u89C6\u9891" : "\u56FE\u7247");
      return {
        bytes,
        status: response.status,
        contentType,
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        acceptRanges: response.headers.get("accept-ranges")
      };
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new ScrapeError("FETCH_TIMEOUT", "\u5A92\u4F53\u8BF7\u6C42\u8D85\u65F6", 504, true);
      throw new ScrapeError("UPSTREAM_ERROR", "\u65E0\u6CD5\u8BBF\u95EE\u5C0F\u7EA2\u4E66\u5A92\u4F53", 502, true);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ScrapeError("TOO_MANY_REDIRECTS", "\u5A92\u4F53\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", 502, true);
}
async function fetchWebContent(url) {
  const requestedHost = validateTarget(url).hostname.toLowerCase();
  if (hostMatches(requestedHost, "bilibili.com")) return fetchBilibiliMetadata(url);
  if (hostMatches(requestedHost, "vimeo.com")) return fetchVimeoMetadata(url);
  if (isDouyinHost(requestedHost)) return fetchDouyinContent(url);
  if (isFeishuHost(requestedHost)) return fetchFeishuPage(url);
  const platformRequest = isXiaohongshuHost(requestedHost) || isDouyinHost(requestedHost) || isInstagramHost(requestedHost) || isFeishuHost(requestedHost);
  let result = await fetchLimited(url, MAX_HTML_BYTES, {
    headers: platformRequest ? browserPageHeaders(isInstagramHost(requestedHost) ? "en-US,en;q=0.9" : void 0) : { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }
  });
  if (isInstagramHost(requestedHost) && /update your browser|browser that isn.t supported/i.test(result.body)) {
    const target = new URL(result.url);
    if (/\/(?:p|reel|tv)\//i.test(target.pathname) && !/\/embed(?:\/captioned)?\/?$/i.test(target.pathname)) {
      target.pathname = `${target.pathname.replace(/\/+$/, "")}/embed/captioned/`;
      result = await fetchLimited(target.toString(), MAX_HTML_BYTES, { headers: browserPageHeaders("en-US,en;q=0.9") });
    }
  }
  const finalUrl = result.url;
  const contentType = result.response.headers.get("content-type") || "";
  const isHtml = isHtmlContentType(contentType) || !contentType && looksLikeHtml(result.body);
  const isPlainText = isPlainTextContentType(contentType) || !contentType && !isHtml;
  if (!isHtml && !isPlainText) {
    throw new ScrapeError("UNSUPPORTED_CONTENT_TYPE", "\u5F53\u524D\u5185\u5BB9\u89E3\u6790\u670D\u52A1\u4EC5\u652F\u6301 HTML \u548C\u7EAF\u6587\u672C\u7F51\u9875", 415, false);
  }
  if (isPlainText) {
    const content2 = result.body.replace(/\r\n/g, "\n").trim().slice(0, MAX_EXTRACTED_TEXT_CHARS);
    if (!content2) throw new ScrapeError("NO_READABLE_CONTENT", "\u7F51\u9875\u6CA1\u6709\u53EF\u4F9B\u63D0\u53D6\u7684\u6587\u672C\u5185\u5BB9", 422, false);
    return { title: new URL(finalUrl).hostname, content: content2, canonicalUrl: finalUrl };
  }
  const hostname = new URL(finalUrl).hostname.toLowerCase();
  if (isXiaohongshuHost(hostname)) {
    const social = parseSocialPage(finalUrl, result.body);
    return { title: social.title, content: social.social ? social.social.bodyText : htmlToText(result.body), canonicalUrl: finalUrl, thumbnailUrl: social.thumbnailUrl, social: social.social };
  }
  if (isInstagramHost(hostname) || isInstagramHost(requestedHost)) {
    const social = parseInstagramPage(finalUrl, result.body);
    if (!social.social) throw new ScrapeError("ACCESS_RESTRICTED", "Instagram \u5185\u5BB9\u672A\u516C\u5F00\u6216\u9700\u8981\u767B\u5F55\u540E\u8BBF\u95EE", 403, false);
    return { title: social.title, content: social.social.bodyText, canonicalUrl: finalUrl, thumbnailUrl: social.thumbnailUrl, social: social.social };
  }
  const content = htmlToText(result.body);
  const title = findMetaContent(result.body, ["og:title", "twitter:title"]) || firstMatch(result.body, /<title[^>]*>([\s\S]*?)<\/title>/i) || new URL(finalUrl).hostname;
  if (looksLikeAccessChallengePage(title, content)) throw new ScrapeError("UPSTREAM_CHALLENGE", "\u4E0A\u6E38\u7AD9\u70B9\u8FD4\u56DE\u4E86\u4EBA\u673A\u9A8C\u8BC1\u9875\uFF0C\u672A\u5C06\u5176\u4F5C\u4E3A\u5185\u5BB9\u5BFC\u5165", 502, true);
  if (!content) throw new ScrapeError("NO_READABLE_CONTENT", "\u7F51\u9875\u6CA1\u6709\u53EF\u4F9B\u63D0\u53D6\u7684\u6B63\u6587\u5185\u5BB9", 422, false);
  const canonicalUrl = resolveRemoteUrl(findCanonicalHref(result.body), finalUrl) || finalUrl;
  const thumbnailUrl = resolveRemoteUrl(findMetaContent(result.body, ["og:image", "twitter:image"]), finalUrl);
  return { title, content, canonicalUrl, thumbnailUrl };
}
async function fetchYouTubeMetadata(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  let lastError;
  for (const metadataEndpoint of [endpoint, `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`]) {
    try {
      const result = await fetchLimited(metadataEndpoint, MAX_TEXT_BYTES, { headers: { Accept: "application/json" } });
      const payload = JSON.parse(result.body);
      const title = stringValue(payload.title);
      if (title) return { title, authorName: stringValue(payload.author_name) || void 0, thumbnailUrl: stringValue(payload.thumbnail_url) || void 0 };
    } catch (error) {
      lastError = error;
    }
  }
  try {
    const { page, player } = await fetchYouTubePlayerBundle(videoId);
    const details = findNestedRecord(player, (record) => Boolean(record.videoDetails))?.videoDetails;
    const pageBody = page?.body || "";
    const title = stringValue(details?.title) || findMetaContent(pageBody, ["og:title", "twitter:title"]) || firstMatch(pageBody, /<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title) return { title, authorName: stringValue(details?.author) || void 0, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  } catch (error) {
    lastError = error;
  }
  if (lastError instanceof ScrapeError) throw lastError;
  throw new ScrapeError("NO_READABLE_CONTENT", "\u65E0\u6CD5\u8BFB\u53D6 YouTube \u89C6\u9891\u6807\u9898", 422, true);
}
function findBalancedJsonAfterMarker(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return void 0;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return void 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return void 0;
}
function findNestedRecord(value, predicate) {
  if (!value || typeof value !== "object") return void 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedRecord(item, predicate);
      if (found) return found;
    }
    return void 0;
  }
  const record = value;
  if (predicate(record)) return record;
  for (const child of Object.values(record)) {
    const found = findNestedRecord(child, predicate);
    if (found) return found;
  }
  return void 0;
}
function parseYouTubePlayerResponse(html) {
  for (const marker of ["ytInitialPlayerResponse =", "var ytInitialPlayerResponse =", "playerResponse ="]) {
    const json = findBalancedJsonAfterMarker(html, marker);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
    }
  }
  return void 0;
}
async function fetchYouTubeWatchPage(videoId) {
  const endpoints = [
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?hl=zh-CN`,
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=zh-CN`
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      return await fetchLimited(endpoint, MAX_HTML_BYTES, { headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36" } });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new ScrapeError("UPSTREAM_ERROR", "\u65E0\u6CD5\u8BBF\u95EE YouTube \u89C6\u9891\u9875\u9762", 502, true);
}
async function fetchYouTubeAndroidPlayer(videoId) {
  const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
  endpoint.searchParams.set("prettyPrint", "false");
  const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `com.google.android.youtube/${YOUTUBE_ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`,
      "X-Youtube-Client-Name": "3",
      "X-Youtube-Client-Version": YOUTUBE_ANDROID_CLIENT_VERSION
    },
    body: JSON.stringify({
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: YOUTUBE_ANDROID_CLIENT_VERSION,
          hl: "zh-CN",
          gl: "US"
        }
      }
    })
  });
  try {
    return JSON.parse(result.body);
  } catch {
    throw new ScrapeError("UPSTREAM_ERROR", "YouTube \u64AD\u653E\u5668\u54CD\u5E94\u89E3\u6790\u5931\u8D25", 502, true);
  }
}
async function fetchYouTubePlayerBundle(videoId) {
  try {
    const androidPlayer = await fetchYouTubeAndroidPlayer(videoId);
    const hasAndroidDetails = Boolean(findNestedRecord(androidPlayer, (record) => Boolean(record.videoDetails)));
    const hasAndroidCaptions = Boolean(findNestedRecord(androidPlayer, (record) => Array.isArray(record.captionTracks)));
    if (hasAndroidDetails || hasAndroidCaptions) return { page: void 0, player: androidPlayer };
  } catch {
  }
  const page = await fetchYouTubeWatchPage(videoId);
  const embeddedPlayer = parseYouTubePlayerResponse(page.body);
  const hasDetails = Boolean(findNestedRecord(embeddedPlayer, (record) => Boolean(record.videoDetails)));
  const hasCaptions = Boolean(findNestedRecord(embeddedPlayer, (record) => Array.isArray(record.captionTracks)));
  if (hasDetails && hasCaptions) return { page, player: embeddedPlayer };
  const apiKey = firstMatch(page.body, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const clientVersion = firstMatch(page.body, /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
  if (!apiKey || !clientVersion) return { page, player: embeddedPlayer };
  const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
  endpoint.searchParams.set("key", apiKey);
  try {
    const result = await fetchLimited(endpoint.toString(), MAX_TEXT_BYTES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.youtube-nocookie.com",
        Referer: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
        "X-Youtube-Client-Name": "56",
        "X-Youtube-Client-Version": clientVersion
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion, clientScreen: "EMBED", hl: "zh-CN", gl: "US" },
          thirdParty: { embedUrl: "https://cnote.local/" }
        }
      })
    });
    return { page, player: JSON.parse(result.body) };
  } catch {
    return { page, player: embeddedPlayer };
  }
}
function chooseYouTubeCaptionTrack(tracks) {
  return tracks.find((track) => /^zh(?:-|$)/i.test(track.languageCode || "")) || tracks.find((track) => /^en(?:-|$)/i.test(track.languageCode || "")) || tracks[0];
}
function parseYouTubeTranscript(body) {
  const xmlSegments = Array.from(
    body.matchAll(/<(text|p|s)\b[^>]*>([\s\S]*?)<\/\1>/g),
    (match) => htmlFragmentToText(match[2])
  ).filter(Boolean);
  if (xmlSegments.length) return xmlSegments.join("\n");
  try {
    const payload = JSON.parse(body);
    return (payload.events || []).map((event) => (event.segs || []).map((segment) => segment.utf8 || "").join("")).map((line) => line.trim()).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}
async function fetchYouTubeTrackText(track, videoId) {
  let trackUrl = track.baseUrl;
  if (!trackUrl && track.languageCode) {
    const endpoint = new URL("https://www.youtube.com/api/timedtext");
    endpoint.searchParams.set("v", videoId);
    endpoint.searchParams.set("lang", track.languageCode);
    if (track.name) endpoint.searchParams.set("name", track.name);
    if (track.kind) endpoint.searchParams.set("kind", track.kind);
    trackUrl = endpoint.toString();
  }
  if (!trackUrl) return "";
  const subtitles = await fetchLimited(trackUrl, MAX_TEXT_BYTES, {
    headers: { Accept: "application/json,text/xml,application/xml,text/plain;q=0.9,*/*;q=0.5" }
  });
  return parseYouTubeTranscript(subtitles.body);
}
async function fetchYouTubeTimedTextTracks(videoId) {
  const endpoint = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  const result = await fetchLimited(endpoint, MAX_TEXT_BYTES, { headers: { Accept: "text/xml,application/xml,text/plain;q=0.9,*/*;q=0.5" } });
  return Array.from(result.body.matchAll(/<track\b[^>]*\/?>/gi), (match) => {
    const attributes = parseHtmlAttributes(match[0]);
    return {
      languageCode: attributes.lang_code || attributes.lang,
      name: attributes.name,
      kind: attributes.kind
    };
  }).filter((track) => track.languageCode);
}
async function fetchYouTubeWatchTracks(videoId) {
  const { page, player } = await fetchYouTubePlayerBundle(videoId);
  const captionRecord = findNestedRecord(player, (record) => Array.isArray(record.captionTracks));
  if (captionRecord?.captionTracks && Array.isArray(captionRecord.captionTracks)) return captionRecord.captionTracks;
  const captionMatch = page?.body.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
  if (!captionMatch) return [];
  try {
    return JSON.parse(captionMatch[1]);
  } catch {
    throw new ScrapeError("UPSTREAM_ERROR", "YouTube \u5B57\u5E55\u4FE1\u606F\u89E3\u6790\u5931\u8D25", 502, true);
  }
}
async function fetchYouTubeSubtitles(videoId) {
  let timedTextError;
  try {
    const tracks = await fetchYouTubeTimedTextTracks(videoId);
    const track = chooseYouTubeCaptionTrack(tracks);
    if (track) {
      const subtitles = await fetchYouTubeTrackText(track, videoId);
      if (subtitles) return { subtitles };
    }
  } catch (error) {
    timedTextError = error;
  }
  try {
    const tracks = await fetchYouTubeWatchTracks(videoId);
    const track = chooseYouTubeCaptionTrack(tracks);
    if (!track) {
      if (timedTextError instanceof ScrapeError && timedTextError.code === "RATE_LIMITED") throw timedTextError;
      return { subtitles: "", warning: "\u8BE5 YouTube \u89C6\u9891\u6CA1\u6709\u53EF\u7528\u5B57\u5E55\uFF0C\u5DF2\u4FDD\u7559\u89C6\u9891\u5143\u6570\u636E\u3002" };
    }
    const subtitles = await fetchYouTubeTrackText(track, videoId);
    return subtitles ? { subtitles } : (() => {
      throw new ScrapeError("UPSTREAM_ERROR", "YouTube \u8FD4\u56DE\u4E86\u5B57\u5E55\u8F68\u9053\uFF0C\u4F46\u5B57\u5E55\u6B63\u6587\u4E3A\u7A7A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", 502, true);
    })();
  } catch (error) {
    if (error instanceof ScrapeError && error.code === "RATE_LIMITED" && timedTextError instanceof ScrapeError) throw timedTextError;
    throw error;
  }
}
function scrapeErrorShape(error) {
  return error instanceof ScrapeError ? { code: error.code, message: error.message, retryable: error.retryable } : { code: "UPSTREAM_ERROR", message: "YouTube \u5B57\u5E55\u83B7\u53D6\u5931\u8D25", retryable: true };
}
async function fetchYouTubeContent(videoId) {
  const [metadataResult, transcriptResult] = await Promise.allSettled([
    fetchYouTubeMetadata(videoId),
    fetchYouTubeSubtitles(videoId)
  ]);
  const metadata = metadataResult.status === "fulfilled" ? metadataResult.value : {};
  if (transcriptResult.status === "fulfilled") return { ...metadata, ...transcriptResult.value };
  return { ...metadata, subtitles: "", transcriptError: scrapeErrorShape(transcriptResult.reason) };
}
var scraper_default = {
  async fetch(request, env, _ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      assertRequestAccess(request, env);
      if (url.pathname === "/v1/health") return new Response(JSON.stringify({ ...SERVICE_INFO, timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
      if (url.pathname === "/health") return new Response(JSON.stringify({ status: "ok", version: SERVICE_INFO.version, timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
      if (url.pathname === "/v1/media/xiaohongshu" && request.method === "GET") {
        const sourceUrl = url.searchParams.get("url") || "";
        const media = await fetchMediaLimited(sourceUrl, request.headers.get("Range"));
        return new Response(media.bytes, {
          status: media.status,
          headers: {
            "Content-Type": media.contentType,
            ...media.contentRange ? { "Content-Range": media.contentRange } : {},
            ...media.acceptRanges ? { "Accept-Ranges": media.acceptRanges } : {},
            "Cache-Control": "public, max-age=3600",
            ...corsHeaders(request, env)
          }
        });
      }
      const versionedYouTubeMatch = url.pathname.match(/^\/v1\/youtube\/([^/]+)\/transcript$/);
      if (versionedYouTubeMatch || url.pathname.startsWith("/youtube/")) {
        if (request.method !== "GET") return new Response(JSON.stringify({ code: "METHOD_NOT_ALLOWED", message: "\u4EC5\u652F\u6301 GET", retryable: false }), { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
        const videoId = decodeURIComponent(versionedYouTubeMatch?.[1] || url.pathname.slice("/youtube/".length)).trim();
        if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new ScrapeError("INVALID_CONTENT", "YouTube \u89C6\u9891 ID \u65E0\u6548", 400, false);
        return new Response(JSON.stringify({ videoId, ...await fetchYouTubeContent(videoId) }), { headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
      }
      if ((url.pathname === "/v1/web/extract" || url.pathname === "/scrape") && request.method === "POST") {
        let body;
        let rawBody = "";
        try {
          rawBody = await readRequestBodyLimited(request, MAX_REQUEST_BODY_BYTES);
        } catch (error) {
          throw error;
        }
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new ScrapeError("INVALID_CONTENT", "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON", 400, false);
        }
        if (!body.url) throw new ScrapeError("INVALID_URL", "\u7F3A\u5C11 URL", 400, false);
        if (body.url.length > 8192) throw new ScrapeError("INVALID_URL", "URL \u957F\u5EA6\u8D85\u8FC7\u9650\u5236", 400, false);
        return new Response(JSON.stringify(await fetchWebContent(body.url)), { headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) } });
      }
      return new Response(JSON.stringify({ code: "NOT_FOUND", message: "Not found", retryable: false }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(request, env) } });
    } catch (error) {
      return errorResponse(error, request, env);
    }
  }
};
export {
  scraper_default as default
};
