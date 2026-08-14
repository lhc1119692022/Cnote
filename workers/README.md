# Cloudflare Workers for Cnote

This directory contains optional, user-deployed Cloudflare Workers for Cnote.
AI API proxy and content parsing are separate services. Cnote does not require
the project maintainer to operate either service for all users.

Chinese deployment tutorials and dashboard-ready scripts:

- [AI proxy deployment guide](../docs/AI_PROXY_WORKER.md) · [`dashboard/ai-proxy.js`](./dashboard/ai-proxy.js)
- [Content service deployment guide](../docs/CONTENT_SERVICE_WORKER.md) · [`dashboard/content-service.js`](./dashboard/content-service.js)

## Workers

### 1. Optional AI API Proxy (`src/proxy.ts`)
This is a separate, optional example for users who choose to operate their own
AI API proxy. Cnote neither deploys it nor sends API keys through a shared
Cnote endpoint.

**Supported providers:**
- OpenAI
- Anthropic
- DeepSeek
- Google (Gemini)
- xAI
- Groq
- OpenRouter

After deploying your own copy, its usage is:
```
https://YOUR_AI_PROXY.workers.dev/proxy/{provider}/{endpoint}
```

The proxy accepts only `GET`, `POST`, and CORS preflight requests. Request
bodies are limited to 20 MiB. Its endpoint allowlist covers model listing,
Chat Completions, Responses, Anthropic Messages, and the Gemini OpenAI-compatible
model/chat paths; other upstream paths are rejected.

Example:
```bash
curl -X POST https://YOUR_AI_PROXY.workers.dev/proxy/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

Deploy it independently with `npm run deploy:proxy`. To require a custom
request header, configure both variables; leaving both unset keeps the proxy
unprotected:

```bash
npx wrangler secret put CN_PROXY_HEADER_NAME --config wrangler-proxy.toml
npx wrangler secret put CN_PROXY_HEADER_VALUE --config wrangler-proxy.toml
npm run deploy:proxy
```

For example, store `X-Cnote-Proxy-Key` as the name and a random secret as the
value, then include `X-Cnote-Proxy-Key: YOUR_SECRET` in every request. The
header name and value must be configured together. Only enable this mode when
your calling client can add the custom header.

### 2. Content Service (`src/scraper.ts`)
Provides web content extraction and YouTube subtitle fetching. It does not
proxy AI API requests and does not bypass login-gated, private, or blocked
content.

Deploy it to your own Cloudflare account without a Key (the default):

```bash
npx wrangler login
npm run deploy
```

Or require a Bearer Key:

```bash
npx wrangler secret put CN_CONTENT_TOKEN
npm run deploy
```

Enter a random secret at the prompt, then save the same value in Cnote → 设置 →
内容解析服务. Requests must carry `Authorization: Bearer YOUR_SECRET`.

Then paste the resulting `workers.dev` URL into Cnote → 设置 → 内容解析服务.

**Endpoints:**

- `GET /v1/health` - Version and capability negotiation
- `GET /v1/youtube/{videoId}/transcript` - Extract YouTube subtitles
- `POST /v1/web/extract` - Extract web page content

Legacy routes `/health`, `/youtube/{videoId}` and `/scrape` remain available
for older Cnote builds.

**Usage:**
```bash
# YouTube subtitles (replace with your own Worker URL)
curl https://YOUR_WORKER.workers.dev/v1/youtube/dQw4w9WgXcQ/transcript

# Web scraping
curl -X POST https://YOUR_WORKER.workers.dev/v1/web/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## Development

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Deploy to Cloudflare
npm run deploy

# The optional, separately configured AI proxy
npm run deploy:proxy

# Run offline Content Service contract tests
npm run test:contract
```

## Configuration

- `wrangler.toml` - Default configuration for the Content Service
- `wrangler-scraper.toml` - Backward-compatible Content Service configuration
- `wrangler-proxy.toml` - Optional, separately deployed AI proxy

## Environment Variables

Optional Cloudflare variables:

- `CN_CONTENT_TOKEN`: require `Authorization: Bearer ...` on requests.
- `SCRAPER_ALLOWED_ORIGINS`: comma-separated list of allowed Cnote origins.

The AI proxy in `src/proxy.ts` is intentionally separate. Configure AI
channels directly in Cnote with an official endpoint or a proxy you operate
and trust. Do not reuse the content parsing Worker as an AI API proxy.
