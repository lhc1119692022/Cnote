import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const sourcePath = fileURLToPath(new URL('../src/scraper.ts', import.meta.url))
const bundled = await build({
  entryPoints: [sourcePath],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  target: 'es2022',
})
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
const { default: worker } = await import(moduleUrl)

const environment = {
  CN_CONTENT_TOKEN: 'contract-test-token',
  SCRAPER_ALLOWED_ORIGINS: 'https://app.example.test',
}
const allowedHeaders = {
  Origin: 'https://app.example.test',
  Authorization: 'Bearer contract-test-token',
}

async function request(path, init = {}) {
  return worker.fetch(new Request('https://worker.example.test' + path, init), environment, {})
}

async function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const health = await request('/v1/health', { headers: allowedHeaders })
assert.equal(health.status, 200)
assert.equal(health.headers.get('access-control-allow-origin'), 'https://app.example.test')
assert.equal((await health.json()).service, 'cnote-content-service')

const preflight = await request('/v1/web/extract', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://app.example.test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type, authorization',
  },
})
assert.equal(preflight.status, 204)
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.test')

const unauthenticated = await request('/v1/health', { headers: { Origin: 'https://app.example.test' } })
assert.equal(unauthenticated.status, 401)
assert.equal((await unauthenticated.json()).code, 'UNAUTHORIZED')

const wrongOrigin = await request('/v1/health', {
  headers: { Origin: 'https://untrusted.example.test', Authorization: 'Bearer contract-test-token' },
})
assert.equal(wrongOrigin.status, 403)
assert.equal((await wrongOrigin.json()).code, 'ORIGIN_NOT_ALLOWED')

const ssrf = await request('/v1/web/extract', {
  method: 'POST',
  headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'http://127.0.0.1/internal' }),
})
assert.equal(ssrf.status, 403)
assert.equal((await ssrf.json()).code, 'SSRF_BLOCKED')

const articleHtml = '<!doctype html><html><head>'
  + '<title>Fallback title</title>'
  + '<meta content="Readable article" property="og:title">'
  + '<meta property="og:image" content="/cover.png">'
  + '<link href="/canonical-story" rel="canonical">'
  + '</head><body><nav>Navigation that must not be included</nav>'
  + '<article><h1>Readable article</h1><p>This is the main article text. It is deliberately long enough to select the semantic article region instead of the page shell, navigation, or unrelated controls.</p><p>It also keeps paragraph boundaries for a useful AI input.</p></article>'
  + '<footer>Footer that must not be included</footer></body></html>'

await withMockedFetch(async (url) => {
  assert.equal(String(url), 'https://public.example.test/story')
  return new Response(articleHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://public.example.test/story' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'Readable article')
  assert.equal(payload.canonicalUrl, 'https://public.example.test/canonical-story')
  assert.equal(payload.thumbnailUrl, 'https://public.example.test/cover.png')
  assert.match(payload.content, /main article text/)
  assert.doesNotMatch(payload.content, /Navigation that must not be included/)
  assert.doesNotMatch(payload.content, /Footer that must not be included/)
})

await withMockedFetch(async () => new Response('PDF bytes', { headers: { 'Content-Type': 'application/pdf' } }), async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://public.example.test/report.pdf' }),
  })
  assert.equal(response.status, 415)
  assert.equal((await response.json()).code, 'UNSUPPORTED_CONTENT_TYPE')
})

await withMockedFetch(async () => new Response('Plain text source\nwith a second line.', { headers: { 'Content-Type': 'text/plain' } }), async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://public.example.test/notes.txt' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.content, 'Plain text source\nwith a second line.')
})

const douyinState = {
  awemeDetail: {
    aweme_id: '7480000000000000000',
    desc: '公开的抖音正文 #内容解析',
    author: { uid: 'douyin-user', nickname: '抖音作者', avatar_thumb: { url_list: ['https://douyin.example.test/avatar.webp'] } },
    video: {
      play_addr: { url_list: ['https://douyin.example.test/video.mp4'], width: 1080, height: 1920 },
      cover: { url_list: ['https://douyin.example.test/cover.webp'], width: 1080, height: 1920 },
    },
    statistics: { digg_count: 12, comment_count: 3, share_count: 2, collect_count: 4 },
  },
}
const douyinHtml = `<!doctype html><html><body><script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(douyinState))}</script></body></html>`

await withMockedFetch(async (url, init) => {
  assert.equal(String(url), 'https://www.douyin.com/video/7480000000000000000')
  assert.match(new Headers(init?.headers).get('user-agent') || '', /Chrome\/131/)
  return new Response(douyinHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.douyin.com/video/7480000000000000000' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.social.platform, 'douyin')
  assert.equal(payload.social.author.name, '抖音作者')
  assert.equal(payload.social.bodyText, '公开的抖音正文 #内容解析')
  assert.equal(payload.social.metrics.likes, 12)
  assert.equal(payload.social.contentBlocks.find((block) => block.type === 'video').resource.url, 'https://douyin.example.test/video.mp4')
})

const modalDouyinId = '7671652761380883752'
const modalDouyinState = {
  awemeDetail: {
    aweme_id: modalDouyinId,
    desc: '精选页 modal_id 对应的公开抖音正文',
    author: { uid: 'modal-user', nickname: '精选页作者' },
    video: { play_addr: { url_list: ['https://douyin.example.test/modal-video.mp4'] } },
  },
}
const modalDouyinHtml = `<!doctype html><html><body><script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(modalDouyinState))}</script></body></html>`

await withMockedFetch(async (url) => {
  assert.equal(String(url), `https://www.douyin.com/jingxuan?modal_id=${modalDouyinId}`)
  return new Response(modalDouyinHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.douyin.com/jingxuan?modal_id=${modalDouyinId}` }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.canonicalUrl, `https://www.douyin.com/video/${modalDouyinId}`)
  assert.equal(payload.social.author.name, '精选页作者')
  assert.equal(payload.social.bodyText, '精选页 modal_id 对应的公开抖音正文')
})

let modalDouyinFallbackFetchCount = 0
await withMockedFetch(async (url, init) => {
  modalDouyinFallbackFetchCount += 1
  if (modalDouyinFallbackFetchCount === 1) {
    assert.equal(String(url), `https://www.douyin.com/jingxuan?modal_id=${modalDouyinId}`)
    return new Response('<!doctype html><html><body>精选页外壳</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (modalDouyinFallbackFetchCount === 2) {
    assert.equal(String(url), `https://www.douyin.com/video/${modalDouyinId}`)
    return new Response('<!doctype html><html><body>视频页外壳</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  assert.equal(String(url), `https://www.douyin.com/share/video/${modalDouyinId}`)
  assert.match(new Headers(init?.headers).get('user-agent') || '', /Android 14.+Mobile/)
  return new Response(`<!doctype html><html><head>
    <title>Jeff Dean拂衣去，谷公公能否把“根”留住？ - 抖音</title>
    <meta name="description" content="Jeff Dean拂衣去，谷公公能否把“根”留住？ #ai新星计划 - 人民公园说AI于20260808发布在抖音，已经收获了341个喜欢，来抖音，记录美好生活！">
    <link rel="canonical" href="https://www.douyin.com/video/${modalDouyinId}">
  </head><body></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.douyin.com/jingxuan?modal_id=${modalDouyinId}` }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.canonicalUrl, `https://www.douyin.com/video/${modalDouyinId}`)
  assert.equal(payload.social.author.name, '人民公园说AI')
  assert.equal(payload.social.bodyText, 'Jeff Dean拂衣去，谷公公能否把“根”留住？ #ai新星计划')
  assert.equal(modalDouyinFallbackFetchCount, 3)
})

let douyinShortFetchCount = 0
await withMockedFetch(async (url) => {
  douyinShortFetchCount += 1
  if (douyinShortFetchCount === 1) {
    assert.equal(String(url), 'https://v.douyin.com/J71BFdamcjU/')
    return new Response(null, { status: 302, headers: { Location: 'https://www.douyin.com/note/7121322471499812099?previous_page=web_code_link' } })
  }
  assert.equal(String(url), 'https://www.douyin.com/note/7121322471499812099?previous_page=web_code_link')
  return new Response(`<!doctype html><html><head>
    <title>人生就是这样，不是得到，就是学到。所以来到你身边的人和事，都 - 抖音</title>
    <meta name="description" content="人生就是这样，不是得到，就是学到。所以来到你身边的人和事，都是来成全你的。每一次相遇，每一份遗憾都有意义！#正能量语录 #抖音图文来了 - 正能量语录于20220717发布在抖音，已经收获了8.3万个喜欢，来抖音，记录美好生活！">
    <link rel="canonical" href="https://www.douyin.com/note/7121322471499812099">
  </head><body></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://v.douyin.com/J71BFdamcjU/' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.canonicalUrl, 'https://www.douyin.com/note/7121322471499812099')
  assert.equal(payload.social.canonicalUrl, 'https://www.douyin.com/note/7121322471499812099')
  assert.equal(payload.social.platform, 'douyin')
  assert.equal(payload.social.author.name, '正能量语录')
  assert.equal(payload.social.bodyText, '人生就是这样，不是得到，就是学到。所以来到你身边的人和事，都是来成全你的。每一次相遇，每一份遗憾都有意义！#正能量语录 #抖音图文来了')
  assert.equal(douyinShortFetchCount, 2)
})

let douyinNoteFallbackFetchCount = 0
await withMockedFetch(async (url, init) => {
  douyinNoteFallbackFetchCount += 1
  if (douyinNoteFallbackFetchCount === 1) {
    assert.equal(String(url), 'https://v.douyin.com/NoteFallback/')
    return new Response(null, { status: 302, headers: { Location: 'https://www.douyin.com/note/7121322471499812099?previous_page=web_code_link' } })
  }
  if (douyinNoteFallbackFetchCount === 2) {
    assert.equal(String(url), 'https://www.douyin.com/note/7121322471499812099?previous_page=web_code_link')
    return new Response('<!doctype html><html><body>页面外壳</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  assert.equal(String(url), 'https://www.douyin.com/share/note/7121322471499812099')
  assert.match(new Headers(init?.headers).get('user-agent') || '', /Android 14.+Mobile/)
  const routerData = {
    loaderData: {
      'note_(id)/page': {
        videoInfoRes: {
          item_list: [{
            aweme_id: '7121322471499812099',
            desc: '人生就是这样，不是得到，就是学到。#正能量语录',
            author: { uid: 'positive-author', nickname: '正能量语录' },
            images: [
              { url_list: ['https://douyin.example.test/note-1.webp'], width: 1080, height: 1440 },
              { url_list: ['https://douyin.example.test/note-2.webp'], width: 1080, height: 1440 },
            ],
          }],
        },
      },
    },
  }
  return new Response(`<!doctype html><html><head>
    <title>人生就是这样，不是得到，就是学到 - 抖音</title>
    <meta name="description" content="人生就是这样，不是得到，就是学到。#正能量语录 - 正能量语录于20220717发布在抖音，已经收获了82949个喜欢，来抖音，记录美好生活！">
    <link rel="canonical" href="https://www.douyin.com/note/7121322471499812099">
  </head><body><script>window._ROUTER_DATA = ${JSON.stringify(routerData)}</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://v.douyin.com/NoteFallback/' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.canonicalUrl, 'https://www.douyin.com/note/7121322471499812099')
  assert.equal(payload.social.bodyText, '人生就是这样，不是得到，就是学到。#正能量语录')
  assert.equal(payload.social.author.name, '正能量语录')
  assert.deepEqual(
    payload.social.contentBlocks.filter((block) => block.type === 'image').map((block) => block.resource.url),
    ['https://douyin.example.test/note-1.webp', 'https://douyin.example.test/note-2.webp'],
  )
  assert.equal(douyinNoteFallbackFetchCount, 3)
})

const instagramEmbedHtml = '<!doctype html><html><head>'
  + '<meta property="og:title" content="Instagram post by public_author">'
  + '<meta property="og:description" content="public_author on Instagram: &quot;公开的 Instagram 正文 #Canvas&quot;">'
  + '<meta property="og:image" content="https://instagram.example.test/cover.jpg">'
  + '</head><body></body></html>'
let instagramFetchCount = 0

await withMockedFetch(async (url, init) => {
  instagramFetchCount += 1
  assert.equal(new Headers(init?.headers).get('accept-language'), 'en-US,en;q=0.9')
  if (instagramFetchCount === 1) {
    assert.equal(String(url), 'https://www.instagram.com/p/ABC123/')
    return new Response('<!doctype html><html><title>Update Your Browser</title><body>You’re using a web browser that isn’t supported by Facebook.</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  assert.equal(String(url), 'https://www.instagram.com/p/ABC123/embed/captioned/')
  return new Response(instagramEmbedHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.instagram.com/p/ABC123/' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.social.platform, 'instagram')
  assert.equal(payload.social.bodyText, '公开的 Instagram 正文 #Canvas')
  assert.equal(payload.thumbnailUrl, 'https://instagram.example.test/cover.jpg')
})

const feishuState = { page: { document: { title: '公开飞书方案', blocks: [{ paragraph: { text: '第一段公开正文' } }, { paragraph: { text: '第二段公开正文，长度足够用于内容节点和 AI 上游分析。' } }] } } }
const feishuHtml = `<!doctype html><html><head><meta property="og:title" content="公开飞书方案"></head><body><script>window.__SSR_DATA__ = ${JSON.stringify(feishuState)};</script></body></html>`

await withMockedFetch(async (url, init) => {
  assert.equal(String(url), 'https://example.feishu.cn/docx/public-token')
  assert.match(new Headers(init?.headers).get('user-agent') || '', /Chrome\/131/)
  return new Response(feishuHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.feishu.cn/docx/public-token' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, '公开飞书方案')
  assert.match(payload.content, /第一段公开正文/)
  assert.match(payload.content, /第二段公开正文/)
})

const feishuGuestToken = 'public-guest-token'
const feishuGuestHtml = '<!doctype html><html><head><title>Docs</title></head><body>'
  + `<script>window.metaCache = Object({"${feishuGuestToken}":{"ttl":10,"encrypted":"encrypted-public-meta"}});</script>`
  + '</body></html>'
const feishuClientVars = {
  code: 0,
  msg: 'success',
  data: {
    id: feishuGuestToken,
    block_sequence: [feishuGuestToken, 'heading-block', 'paragraph-block'],
    meta_map: { [feishuGuestToken]: { title: '访客公开飞书文档' } },
    block_map: {
      [feishuGuestToken]: { id: feishuGuestToken, data: { type: 'page', children: ['heading-block', 'paragraph-block'] } },
      'heading-block': { id: 'heading-block', data: { type: 'heading2', text: { initialAttributedTexts: { text: { 0: '公开标题' } } } } },
      'paragraph-block': { id: 'paragraph-block', data: { type: 'text', text: { initialAttributedTexts: { text: { 0: '通过飞书访客会话读取的公开正文。' } } } } },
    },
  },
}
let feishuGuestFetchCount = 0

await withMockedFetch(async (url, init) => {
  feishuGuestFetchCount += 1
  const target = new URL(String(url))
  const headers = new Headers(init?.headers)
  if (feishuGuestFetchCount === 1) {
    assert.equal(target.href, `https://my.feishu.cn/docx/${feishuGuestToken}`)
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://accounts.feishu.cn/guest?redirect_uri=${encodeURIComponent(target.href)}`,
        'Set-Cookie': 'passport_guest=guest-session; Domain=.feishu.cn; Path=/; Secure; HttpOnly',
      },
    })
  }
  if (feishuGuestFetchCount === 2) {
    assert.equal(target.hostname, 'accounts.feishu.cn')
    assert.match(headers.get('cookie') || '', /passport_guest=guest-session/)
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://my.feishu.cn/docx/${feishuGuestToken}?login_redirect_times=1`,
        'Set-Cookie': 'anonymous_session=public-reader; Domain=.feishu.cn; Path=/; Secure; HttpOnly',
      },
    })
  }
  if (feishuGuestFetchCount === 3) {
    assert.match(headers.get('cookie') || '', /anonymous_session=public-reader/)
    return new Response(null, { status: 302, headers: { Location: `https://my.feishu.cn/docx/${feishuGuestToken}` } })
  }
  if (feishuGuestFetchCount === 4) {
    assert.equal(target.pathname, `/docx/${feishuGuestToken}`)
    assert.match(headers.get('cookie') || '', /passport_guest=guest-session/)
    assert.match(headers.get('cookie') || '', /anonymous_session=public-reader/)
    return new Response(feishuGuestHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  assert.equal(target.pathname, '/space/api/docx/pages/client_vars')
  assert.equal(target.searchParams.get('id'), feishuGuestToken)
  assert.equal(target.searchParams.get('mode'), '7')
  assert.equal(target.searchParams.get('limit'), '239')
  assert.match(headers.get('cookie') || '', /anonymous_session=public-reader/)
  assert.equal(headers.get('ccm-meta'), JSON.stringify({ [feishuGuestToken]: 'encrypted-public-meta' }))
  return new Response(JSON.stringify(feishuClientVars), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST', headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://my.feishu.cn/docx/${feishuGuestToken}` }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, '访客公开飞书文档')
  assert.equal(payload.content, '公开标题\n通过飞书访客会话读取的公开正文。')
  assert.equal(feishuGuestFetchCount, 5)
})

await withMockedFetch(async (url, init) => {
  const target = new URL(String(url))
  assert.equal(target.origin + target.pathname, 'https://api.bilibili.com/x/web-interface/view')
  assert.equal(target.searchParams.get('bvid'), 'BV11zuZ6PEdb')
  const headers = new Headers(init?.headers)
  assert.equal(headers.get('referer'), 'https://www.bilibili.com/')
  assert.match(headers.get('user-agent') || '', /Mozilla\/5\.0/)
  return new Response(JSON.stringify({
    code: 0,
    message: 'OK',
    data: {
      bvid: 'BV11zuZ6PEdb',
      title: '什么都用blender只会害了你',
      desc: '-',
      pic: 'http://i2.hdslb.com/bfs/archive/cover.jpg',
      duration: 241,
      owner: { name: '笨学生只能这样咯' },
      dimension: { width: 1920, height: 1080 },
    },
  }), { headers: { 'Content-Type': 'application/json' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.bilibili.com/video/BV11zuZ6PEdb/?spm_id_from=test' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, '什么都用blender只会害了你')
  assert.equal(payload.content, '')
  assert.equal(payload.canonicalUrl, 'https://www.bilibili.com/video/BV11zuZ6PEdb/')
  assert.equal(payload.thumbnailUrl, 'https://i2.hdslb.com/bfs/archive/cover.jpg')
  assert.equal(payload.authorName, '笨学生只能这样咯')
  assert.equal(payload.duration, 241)
  assert.equal(payload.width, 1920)
  assert.equal(payload.height, 1080)
})

await withMockedFetch(async (url) => {
  const target = String(url)
  if (target === 'https://vimeo.com/api/v2/video/76979871.json') {
    return new Response(JSON.stringify([{
      id: 76979871,
      title: 'The New Vimeo Player',
      description: 'A <strong>real</strong> Vimeo description.',
      url: 'https://vimeo.com/76979871',
      thumbnail_large: 'https://i.vimeocdn.com/video/cover_640.jpg',
      user_name: 'Vimeo',
      duration: 62,
      width: 1280,
      height: 720,
    }]), { headers: { 'Content-Type': 'application/json' } })
  }
  throw new Error(`Unexpected Vimeo request: ${target}`)
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://vimeo.com/76979871' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'The New Vimeo Player')
  assert.equal(payload.content, 'A real Vimeo description.')
  assert.equal(payload.authorName, 'Vimeo')
  assert.equal(payload.duration, 62)
})

await withMockedFetch(async (url) => {
  const target = String(url)
  if (target === 'https://vimeo.com/api/v2/video/76979871.json') return new Response('Not found', { status: 404 })
  if (target === 'https://player.vimeo.com/video/76979871/config') {
    return new Response(JSON.stringify({
      video: {
        title: 'Vimeo config fallback',
        duration: 62,
        width: 1280,
        height: 720,
        owner: { name: 'Fallback owner' },
        thumbs: { 640: 'https://i.vimeocdn.com/video/fallback_640.jpg', 1280: 'https://i.vimeocdn.com/video/fallback_1280.jpg' },
      },
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  throw new Error(`Unexpected Vimeo fallback request: ${target}`)
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://vimeo.com/76979871' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'Vimeo config fallback')
  assert.equal(payload.thumbnailUrl, 'https://i.vimeocdn.com/video/fallback_1280.jpg')
  assert.equal(payload.authorName, 'Fallback owner')
})

const challengeHtml = '<!doctype html><html><head><title>Deneb</title></head><body><main><h1>Verify to continue</h1><p>To continue, please confirm that you\'re a human (and not a spambot). Checking if the site connection is secure.</p></main></body></html>'
await withMockedFetch(async () => new Response(challengeHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://challenge.example.test/video' }),
  })
  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.equal(payload.code, 'UPSTREAM_CHALLENGE')
  assert.match(payload.message, /人机验证页/)
})

const xiaohongshuNoteId = '6a715f640000000033034587'
const xiaohongshuImages = Array.from({ length: 11 }, (_, index) => ({
  infoList: [
    { urlDefault: `https://sns-img.example.test/preview-${index + 1}.webp`, imageScene: 'WB_PRV', width: 480, height: 640 },
    { urlDefault: `//sns-img.example.test/${index + 1}.webp`, imageScene: 'WB_DFT', width: 1080, height: 1440 },
  ],
}))
const xiaohongshuState = {
  noteDetailMap: {
    [xiaohongshuNoteId]: {
      noteId: xiaohongshuNoteId,
      title: '五百万在全球都认为是中产但在网上却是穷人',
      desc: '#贫富差距巨大[话题]# #成为有钱人[话题]# #人永远赚不到认知以外的钱[话题]#',
      imageList: xiaohongshuImages,
      user: { userId: 'user-1', nickname: '柯柯', avatar: 'https://sns-img.example.test/avatar.webp' },
      time: Date.UTC(2026, 7, 4) / 1000,
      ipLocation: '山东',
      tagList: ['贫富差距巨大', '成为有钱人', '人永远赚不到认知以外的钱', '钱生钱才是对钱最大的尊重', '贫穷限制了我的想象', '我的金钱观', '有钱人的思维', '互联网时代', '富人', '财富自由'].map((name) => ({ name })),
      interactInfo: { likedCount: '465', collectedCount: '165', commentCount: '365' },
    },
  },
}
const xiaohongshuJson = JSON.stringify(xiaohongshuState).replace(/}$/, ',"tracking":undefined}')
const xiaohongshuHtml = `<!doctype html><html><head><title>页面壳</title></head><body><script>window.__INITIAL_STATE__ = JSON.parse(decodeURIComponent("${encodeURIComponent(xiaohongshuJson)}"));</script></body></html>`

await withMockedFetch(async (url, init) => {
  assert.equal(String(url).startsWith(`https://www.xiaohongshu.com/explore/${xiaohongshuNoteId}`), true)
  assert.equal(new Headers(init?.headers).get('accept-language'), 'zh-CN,zh;q=0.9,en;q=0.8')
  return new Response(xiaohongshuHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}, async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.xiaohongshu.com/explore/${xiaohongshuNoteId}?xsec_token=public-token` }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, '五百万在全球都认为是中产但在网上却是穷人')
  assert.equal(payload.content, '')
  assert.equal(payload.social.author.name, '柯柯')
  assert.equal(payload.social.publishedAt, '08-04 山东')
  assert.deepEqual(payload.social.metrics, { likes: 465, collects: 165, comments: 365, capturedAt: payload.social.metrics.capturedAt })
  assert.equal(payload.social.topics.length, 10)
  assert.equal(payload.social.contentBlocks.filter((block) => block.type === 'text').length, 0)
  assert.equal(payload.social.contentBlocks.filter((block) => block.type === 'image').length, 11)
  assert.equal(payload.social.contentBlocks.filter((block) => block.type === 'image').at(-1).resource.url, 'https://sns-img.example.test/11.webp')
  assert.equal(payload.thumbnailUrl, 'https://sns-img.example.test/1.webp')
})

const xiaohongshuVideoNoteId = '6a7817dd000000002403d47a'
const xiaohongshuVideoState = {
  noteDetailMap: {
    [xiaohongshuVideoNoteId]: {
      noteId: xiaohongshuVideoNoteId,
      title: '视频帖子',
      desc: '视频正文 #Agent[话题]#',
      imageList: [{ infoList: [{ urlDefault: 'https://sns-webpic-qc.xhscdn.com/video-poster.webp', imageScene: 'WB_DFT', width: 1080, height: 1440 }] }],
      video: {
        media: {
          stream: {
            h264: [{ masterUrl: 'https://sns-video-qc.xhscdn.com/video/main.mp4', width: 1080, height: 1440 }],
          },
        },
      },
      tagList: [{ name: 'Agent' }],
    },
  },
}
const xiaohongshuVideoHtml = `<!doctype html><html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify(xiaohongshuVideoState)};</script></body></html>`

await withMockedFetch(async () => new Response(xiaohongshuVideoHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), async () => {
  const response = await request('/v1/web/extract', {
    method: 'POST',
    headers: { ...allowedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.xiaohongshu.com/explore/${xiaohongshuVideoNoteId}` }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.social.contentBlocks.filter((block) => block.type === 'image').length, 0)
  const videoBlock = payload.social.contentBlocks.find((block) => block.type === 'video')
  assert.equal(videoBlock.resource.url, 'https://sns-video-qc.xhscdn.com/video/main.mp4')
  assert.equal(videoBlock.resource.width, 1080)
  assert.equal(videoBlock.resource.height, 1440)
  assert.equal(videoBlock.poster.url, 'https://sns-webpic-qc.xhscdn.com/video-poster.webp')
})

await withMockedFetch(async (url, init) => {
  assert.equal(String(url), 'https://sns-webpic-qc.xhscdn.com/path/image.webp')
  const headers = new Headers(init?.headers)
  assert.equal(headers.get('referer'), 'https://www.xiaohongshu.com/')
  return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'image/webp' } })
}, async () => {
  const response = await request('/v1/media/xiaohongshu?url=' + encodeURIComponent('https://sns-webpic-qc.xhscdn.com/path/image.webp'), { headers: allowedHeaders })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/webp')
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [82, 73, 70, 70])
})

await withMockedFetch(async (url, init) => {
  assert.equal(String(url), 'https://sns-video-qc.xhscdn.com/video/main.mp4')
  assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-1023')
  return new Response(new Uint8Array([0, 1, 2, 3]), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/10000', 'Accept-Ranges': 'bytes' } })
}, async () => {
  const response = await request('/v1/media/xiaohongshu?url=' + encodeURIComponent('https://sns-video-qc.xhscdn.com/video/main.mp4'), { headers: { ...allowedHeaders, Range: 'bytes=0-1023' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/10000')
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
})

const rejectedMedia = await request('/v1/media/xiaohongshu?url=' + encodeURIComponent('https://example.test/image.webp'), { headers: allowedHeaders })
assert.equal(rejectedMedia.status, 400)
assert.equal((await rejectedMedia.json()).code, 'MEDIA_URL_REJECTED')

await withMockedFetch(async (url) => {
  const target = String(url)
  if (target.startsWith('https://www.youtube.com/oembed?')) {
    return new Response(JSON.stringify({
      title: 'A real YouTube title',
      author_name: 'Example channel',
      thumbnail_url: 'https://i.ytimg.com/vi/NMJIG_2N2a8/hqdefault.jpg',
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (target === 'https://www.youtube.com/api/timedtext?type=list&v=NMJIG_2N2a8') {
    return new Response('<transcript_list><track id="0" name="" lang_code="zh-CN" lang_original="中文" lang_translated="中文" lang_default="true"/></transcript_list>', { headers: { 'Content-Type': 'text/xml' } })
  }
  if (target === 'https://www.youtube.com/api/timedtext?v=NMJIG_2N2a8&lang=zh-CN') {
    return new Response('<transcript><text start="0" dur="1">第一行 &amp; 内容</text><text start="1" dur="1">第二行</text></transcript>', { headers: { 'Content-Type': 'text/xml' } })
  }
  throw new Error(`Unexpected YouTube request: ${target}`)
}, async () => {
  const response = await request('/v1/youtube/NMJIG_2N2a8/transcript', { headers: allowedHeaders })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'A real YouTube title')
  assert.equal(payload.authorName, 'Example channel')
  assert.equal(payload.thumbnailUrl, 'https://i.ytimg.com/vi/NMJIG_2N2a8/hqdefault.jpg')
  assert.equal(payload.subtitles, '第一行 & 内容\n第二行')
  assert.equal(payload.transcriptError, undefined)
})

await withMockedFetch(async (url) => {
  const target = String(url)
  if (target.startsWith('https://www.youtube.com/oembed?')) {
    return new Response(JSON.stringify({ title: 'Title survives transcript throttling' }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (target.startsWith('https://www.youtube.com/api/timedtext?') || target.startsWith('https://www.youtube.com/watch?') || target.startsWith('https://www.youtube-nocookie.com/embed/')) {
    return new Response('Too many requests', { status: 429 })
  }
  throw new Error(`Unexpected YouTube request: ${target}`)
}, async () => {
  const response = await request('/v1/youtube/NMJIG_2N2a8/transcript', { headers: allowedHeaders })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'Title survives transcript throttling')
  assert.equal(payload.subtitles, '')
  assert.equal(payload.transcriptError.code, 'RATE_LIMITED')
  assert.equal(payload.transcriptError.retryable, true)
})

await withMockedFetch(async (url, init) => {
  const target = String(url)
  if (target.startsWith('https://www.youtube.com/oembed?')) {
    return new Response(JSON.stringify({ title: 'Android fallback title' }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (target === 'https://www.youtube.com/api/timedtext?type=list&v=a1b2c3d4e5F') {
    return new Response('<transcript_list/>', { headers: { 'Content-Type': 'text/xml' } })
  }
  if (target === 'https://www.youtube-nocookie.com/embed/a1b2c3d4e5F?hl=zh-CN') {
    return new Response('<!doctype html><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Page player title"}};</script>', { headers: { 'Content-Type': 'text/html' } })
  }
  if (target === 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false') {
    const headers = new Headers(init?.headers)
    assert.equal(init?.method, 'POST')
    assert.equal(headers.get('x-youtube-client-name'), '3')
    assert.match(headers.get('user-agent') || '', /com\.google\.android\.youtube/)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.context.client.clientName, 'ANDROID')
    assert.equal(body.videoId, 'a1b2c3d4e5F')
    return new Response(JSON.stringify({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Android player title', author: 'Android channel' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            languageCode: 'zh-CN',
            baseUrl: 'https://www.youtube.com/api/timedtext?v=a1b2c3d4e5F&lang=zh-CN&fmt=srv3',
          }],
        },
      },
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (target === 'https://www.youtube.com/api/timedtext?v=a1b2c3d4e5F&lang=zh-CN&fmt=srv3') {
    return new Response('<?xml version="1.0"?><timedtext format="3"><body><p t="0" d="1000">Android 第一行</p><p t="1000" d="1000">Android 第二行</p></body></timedtext>', { headers: { 'Content-Type': 'text/xml' } })
  }
  throw new Error(`Unexpected Android fallback request: ${target}`)
}, async () => {
  const response = await request('/v1/youtube/a1b2c3d4e5F/transcript', { headers: allowedHeaders })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'Android fallback title')
  assert.equal(payload.subtitles, 'Android 第一行\nAndroid 第二行')
  assert.equal(payload.transcriptError, undefined)
})

const embeddedPlayer = '<!doctype html><html><head><meta property="og:title" content="Fallback player title"></head><body><script>'
  + 'var ytInitialPlayerResponse = {"videoDetails":{"title":"Player response title","author":"Player channel"},'
  + '"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"languageCode":"zh-CN","baseUrl":"https://www.youtube.com/api/timedtext?v=cCnQKvTKIww&lang=zh-CN"}]}}};'
  + '</script></body></html>'

await withMockedFetch(async (url) => {
  const target = String(url)
  if (target.startsWith('https://www.youtube.com/oembed?') || target.startsWith('https://noembed.com/embed?')) {
    return new Response('Unavailable', { status: 503 })
  }
  if (target === 'https://www.youtube.com/api/timedtext?type=list&v=cCnQKvTKIww') {
    return new Response('<transcript_list/>', { headers: { 'Content-Type': 'text/xml' } })
  }
  if (target === 'https://www.youtube-nocookie.com/embed/cCnQKvTKIww?hl=zh-CN') {
    return new Response(embeddedPlayer, { headers: { 'Content-Type': 'text/html' } })
  }
  if (target === 'https://www.youtube.com/api/timedtext?v=cCnQKvTKIww&lang=zh-CN') {
    return new Response('<transcript><text start="0">播放器字幕</text></transcript>', { headers: { 'Content-Type': 'text/xml' } })
  }
  throw new Error(`Unexpected player fallback request: ${target}`)
}, async () => {
  const response = await request('/v1/youtube/cCnQKvTKIww/transcript', { headers: allowedHeaders })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.title, 'Player response title')
  assert.equal(payload.authorName, 'Player channel')
  assert.equal(payload.subtitles, '播放器字幕')
})

console.log('Content Service contract tests passed.')
