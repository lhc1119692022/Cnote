/**
 * Cnote AI 跨域代理：Cloudflare 控制台粘贴版
 *
 * 可操作配置区（只需修改下面两行）：
 * 1. 请求头名称建议保留为 X-Cnote-Access。
 * 2. 请求头值请改成自己生成的长随机字符串。
 * 3. 两项都留空会关闭额外访问校验；只填写一项会导致 Worker 拒绝请求。
 * 4. 不要把 AI 服务商的 API Key 写进此脚本。API Key 仍由 Cnote 随请求发送。
 *
 * 随机值生成方法：在任意浏览器开发者工具的 Console 中执行下面一行，
 * 然后把输出结果粘贴到 CNOTE_PROXY_HEADER_VALUE：
 * Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
 *
 * 更安全的做法是在 Cloudflare Worker 的“设置 → 变量和机密”中配置：
 * CN_PROXY_HEADER_NAME（文本）与 CN_PROXY_HEADER_VALUE（机密）。
 * 环境变量的优先级高于下面的粘贴版配置。
 */
globalThis.CNOTE_PROXY_HEADER_NAME = "";
globalThis.CNOTE_PROXY_HEADER_VALUE = "";

// src/proxy.ts
var dashboardProxyConfig = globalThis;
function proxyAccessConfig(env) {
  return {
    headerName: env.CN_PROXY_HEADER_NAME?.trim() || dashboardProxyConfig.CNOTE_PROXY_HEADER_NAME?.trim() || "",
    headerValue: env.CN_PROXY_HEADER_VALUE || dashboardProxyConfig.CNOTE_PROXY_HEADER_VALUE || ""
  };
}
var SUPPORTED_PROVIDERS = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com",
  xai: "https://api.x.ai",
  groq: "https://api.groq.com",
  openrouter: "https://openrouter.ai/api"
};
function getCorsHeaders(env) {
  const allowedHeaders = ["Content-Type", "Authorization", "x-api-key", "x-goog-api-key", "anthropic-version"];
  const customHeaderName = proxyAccessConfig(env).headerName;
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
  const { headerName, headerValue } = proxyAccessConfig(env);
  if (!headerName && !headerValue)
    return;
  if (!headerName || !headerValue)
    throw new Error("CN_PROXY_HEADER_NAME \u548C CN_PROXY_HEADER_VALUE \u5FC5\u987B\u540C\u65F6\u914D\u7F6E");
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
      const pathParts = path.split("/").filter(Boolean);
      if (pathParts[0] === "proxy" && pathParts.length >= 2) {
        if (!["GET", "POST"].includes(request.method))
          return errorResponse(405, "\u4EE3\u7406\u4EC5\u652F\u6301 GET \u548C POST", corsHeaders);
        const provider = pathParts[1];
        const endpoint = pathParts.slice(2).join("/");
        if (!SUPPORTED_PROVIDERS[provider]) {
          return new Response(
            JSON.stringify({
              error: "Unsupported provider",
              supported: Object.keys(SUPPORTED_PROVIDERS)
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }
        if (!isAllowedEndpoint(endpoint))
          return errorResponse(404, "\u6B64 AI \u7AEF\u70B9\u672A\u5F00\u653E\u4EE3\u7406", corsHeaders);
        const target = new URL(`${SUPPORTED_PROVIDERS[provider]}/${endpoint}`);
        target.search = url.search;
        const headers = new Headers(request.headers);
        const body = request.method === "POST" ? await readRequestBodyLimited(request) : void 0;
        const proxyHeaderName = proxyAccessConfig(env).headerName;
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
          message: "Use /proxy/{provider}/{endpoint} to proxy AI API requests",
          providers: Object.keys(SUPPORTED_PROVIDERS)
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
      if (!unauthorized && !tooLarge)
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
