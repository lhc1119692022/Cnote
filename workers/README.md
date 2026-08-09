# Cloudflare Workers for Cnote

This directory contains Cloudflare Workers for API proxy and web scraping.

## Workers

### 1. AI API Proxy (`src/proxy.ts`)
Proxies AI API requests to avoid CORS issues.

**Supported providers:**
- OpenAI
- Anthropic
- DeepSeek
- Google (Gemini)
- xAI
- Groq
- OpenRouter

**Usage:**
```
https://api.cnote.app/proxy/{provider}/{endpoint}
```

Example:
```bash
curl -X POST https://api.cnote.app/proxy/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### 2. Web Scraper (`src/scraper.ts`)
Provides web content extraction and YouTube subtitle fetching.

**Endpoints:**

- `GET /youtube/{videoId}` - Extract YouTube subtitles
- `POST /scrape` - Extract web page content

**Usage:**
```bash
# YouTube subtitles
curl https://scraper.cnote.app/youtube/dQw4w9WgXcQ

# Web scraping
curl -X POST https://scraper.cnote.app/scrape \
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

# Deploy scraper separately
wrangler deploy --config wrangler-scraper.toml
```

## Configuration

- `wrangler.toml` - Configuration for API proxy worker
- `wrangler-scraper.toml` - Configuration for scraper worker

## Environment Variables

No environment variables required for basic functionality. Can be configured in Cloudflare dashboard if needed.
