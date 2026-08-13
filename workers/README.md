# Cloudflare Workers for Cnote

This directory contains optional, user-deployed Cloudflare Workers for Cnote.
AI API proxy and content parsing are separate services. Cnote does not require
the project maintainer to operate either service for all users.

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

Example:
```bash
curl -X POST https://YOUR_AI_PROXY.workers.dev/proxy/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### 2. Content Service (`src/scraper.ts`)
Provides web content extraction and YouTube subtitle fetching. It does not
proxy AI API requests and does not bypass login-gated, private, or blocked
content.

Deploy it to your own Cloudflare account:

```bash
npx wrangler login
npm run deploy
# Optional abuse protection:
npx wrangler secret put CN_CONTENT_TOKEN
```

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
