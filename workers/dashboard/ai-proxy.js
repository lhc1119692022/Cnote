/**
 * Cnote AI 跨域代理
 *
 * 只在 Cnote 提示“第三方 API 跨域错误”时使用。
 * 复制整份脚本到 Cloudflare，只修改下面 3 项。
 */

/* ==================== ① 必填：第三方 API 原接口地址 ==================== */
// 把 Cnote 中原本填写、但出现跨域错误的接口地址完整粘贴到引号里。
// 只填原接口地址，不要填 Worker 地址，也不要额外添加 /v1/models 等路径。
globalThis.CNOTE_PROXY_UPSTREAM_URL = "";

/* ==================== ② 建议：给 Worker 加访问校验 ==================== */
// 请求头名称不懂就保持不变；部署后，Cnote 里也填写同一个名称。
globalThis.CNOTE_PROXY_HEADER_NAME = "X-Cnote-Access";

// 填一段只有你知道的长字符串；部署后，Cnote 的“请求头值”也填同一串。
// 留空也能使用，但知道 Worker 地址的人都可以调用它。
globalThis.CNOTE_PROXY_HEADER_VALUE = "";

/* ==================== 以下内容不用修改 ==================== */

// src/proxy.ts
var dashboardProxyConfig = globalThis;
var DEFAULT_PROXY_HEADER_NAME = "X-Cnote-Access";
function proxyConfig(env) {
  return {
    upstreamURL: env.CN_PROXY_UPSTREAM_URL?.trim() || dashboardProxyConfig.CNOTE_PROXY_UPSTREAM_URL?.trim() || "",
    headerName: env.CN_PROXY_HEADER_NAME?.trim() || dashboardProxyConfig.CNOTE_PROXY_HEADER_NAME?.trim() || DEFAULT_PROXY_HEADER_NAME,
    headerValue: env.CN_PROXY_HEADER_VALUE || dashboardProxyConfig.CNOTE_PROXY_HEADER_VALUE || ""
  };
}
function getCorsHeaders(env) {
  const allowedHeaders = ["Content-Type", "Authorization", "x-api-key", "x-goog-api-key", "anthropic-version"];
  const customHeaderName = proxyConfig(env).headerName;
  if (customHeaderName && !allowedHeaders.some((name) => name.toLowerCase() === customHeaderName.toLowerCase())) {
    new Headers({ [customHeaderName]: "validation" });
    allowedHeaders.push(customHeaderName);
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": allowedHeaders.join(", "),
    "Access-Control-Max-Age": "86400"
  };
}
var ALLOWED_ENDPOINTS = /* @__PURE__ */ new Set([
  "v1/models",
  "v1/chat/completions",
  "v1/responses",
  "v1/messages",
  "v1beta/openai/models",
  "v1beta/openai/chat/completions",
  "v1beta/models"
]);
function isAllowedEndpoint(endpoint) {
  if (ALLOWED_ENDPOINTS.has(endpoint))
    return true;
  return /^v1beta\/models\/[A-Za-z0-9._-]+:(?:generateContent|streamGenerateContent)$/.test(endpoint);
}
function requestEndpoint(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "proxy" && parts.length >= 3)
    return parts.slice(2).join("/");
  return parts.join("/");
}
function buildTargetURL(upstreamURL, endpoint, search) {
  if (!upstreamURL)
    throw new Error("\u8BF7\u5148\u5728\u811A\u672C\u9876\u90E8\u586B\u5199\u7B2C\u4E09\u65B9 API \u539F\u63A5\u53E3\u5730\u5740");
  let base;
  try {
    base = new URL(upstreamURL);
  } catch {
    throw new Error("\u811A\u672C\u9876\u90E8\u7684\u7B2C\u4E09\u65B9 API \u539F\u63A5\u53E3\u5730\u5740\u683C\u5F0F\u4E0D\u6B63\u786E");
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("\u7B2C\u4E09\u65B9 API \u539F\u63A5\u53E3\u5730\u5740\u5FC5\u987B\u662F\u5B8C\u6574\u7684 http \u6216 https \u5730\u5740\uFF0C\u4E14\u4E0D\u8981\u5E26\u67E5\u8BE2\u53C2\u6570\u6216 #");
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  let endpointPath = `/${endpoint}`;
  const endpointVersion = endpointPath.match(/^\/(v\d+(?:beta\d*)?)\//i)?.[1];
  if (endpointVersion && basePath.toLowerCase().endsWith(`/${endpointVersion.toLowerCase()}`)) {
    endpointPath = endpointPath.slice(endpointVersion.length + 1);
  } else if (/\/v\d+(?:beta\d*)?\/openai$/i.test(basePath) && endpointPath.startsWith("/v1/")) {
    endpointPath = endpointPath.slice(3);
  }
  const target = new URL(`${base.origin}${basePath}${endpointPath}`);
  target.search = search;
  return target;
}
var MAX_PROXY_REQUEST_BYTES = 20 * 1024 * 1024;
async function readRequestBodyLimited(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_PROXY_REQUEST_BYTES)
    throw new Error("PROXY_REQUEST_TOO_LARGE");
  if (!request.body)
    return void 0;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done)
        break;
      total += next.value.byteLength;
      if (total > MAX_PROXY_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("PROXY_REQUEST_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
function errorResponse(status, message, corsHeaders) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
function assertProxyAccess(request, env) {
  const { headerName, headerValue } = proxyConfig(env);
  if (!headerValue)
    return;
  if (request.headers.get(headerName) !== headerValue)
    throw new Error("\u4EE3\u7406\u8BBF\u95EE\u5934\u65E0\u6548");
}
var proxy_default = {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    try {
      assertProxyAccess(request, env);
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            version: "1.0.0"
          }),
          {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }
      const endpoint = requestEndpoint(path);
      if (endpoint) {
        if (!["GET", "POST"].includes(request.method))
          return errorResponse(405, "\u4EE3\u7406\u4EC5\u652F\u6301 GET \u548C POST", corsHeaders);
        if (!isAllowedEndpoint(endpoint))
          return errorResponse(404, "\u6B64 AI \u7AEF\u70B9\u672A\u5F00\u653E\u4EE3\u7406", corsHeaders);
        const target = buildTargetURL(proxyConfig(env).upstreamURL, endpoint, url.search);
        const headers = new Headers(request.headers);
        const body = request.method === "POST" ? await readRequestBodyLimited(request) : void 0;
        const proxyHeaderName = proxyConfig(env).headerName;
        if (proxyHeaderName)
          headers.delete(proxyHeaderName);
        headers.delete("Host");
        headers.delete("Origin");
        headers.delete("Referer");
        headers.delete("Cookie");
        headers.delete("Content-Length");
        const proxyRequest = new Request(target.toString(), {
          method: request.method,
          headers,
          body
        });
        const response = await fetch(proxyRequest, { redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("Location");
          if (!location || new URL(location, target).origin !== target.origin)
            return errorResponse(502, "\u4E0A\u6E38\u8DE8\u57DF\u91CD\u5B9A\u5411\u5DF2\u62D2\u7EDD", corsHeaders);
        }
        const responseHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          responseHeaders.set(key, value);
        });
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders
        });
      }
      return new Response(
        JSON.stringify({
          error: "Not found",
          message: "\u8BF7\u5728 Cnote \u4E2D\u586B\u5199\u8FD9\u4E2A Worker \u7684\u6839\u5730\u5740\uFF0C\u4E0D\u8981\u8FFD\u52A0\u5176\u4ED6\u8DEF\u5F84"
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    } catch (error) {
      const unauthorized = error instanceof Error && error.message === "\u4EE3\u7406\u8BBF\u95EE\u5934\u65E0\u6548";
      const tooLarge = error instanceof Error && error.message === "PROXY_REQUEST_TOO_LARGE";
      const configurationError = error instanceof Error && (error.message.includes("\u7B2C\u4E09\u65B9 API \u539F\u63A5\u53E3\u5730\u5740") || error.message.includes("\u5B8C\u6574\u7684 http \u6216 https \u5730\u5740"));
      if (!unauthorized && !tooLarge && !configurationError)
        console.error("Proxy error:", error);
      return new Response(
        JSON.stringify({
          error: unauthorized ? "Unauthorized" : tooLarge ? "Request too large" : "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error"
        }),
        {
          status: unauthorized ? 401 : tooLarge ? 413 : 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }
  }
};
export {
  proxy_default as default
};
