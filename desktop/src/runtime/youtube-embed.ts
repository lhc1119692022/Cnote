export function youtubeEmbedHeaders(ownerId: number, details: { webContentsId?: number; resourceType: string; url: string; requestHeaders: Record<string, string> }): Record<string, string> {
  const headers = { ...details.requestHeaders }
  if (details.webContentsId !== ownerId || details.resourceType !== 'subFrame') return headers
  const url = new URL(details.url)
  if (url.protocol !== 'https:' || !['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) || !url.pathname.startsWith('/embed/')) return headers
  if (!Object.keys(headers).some(name => name.toLowerCase() === 'referer' && /^https?:\/\//i.test(headers[name]))) {
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'referer') delete headers[name]
    headers.Referer = 'https://com.cnote.desktop/'
  }
  return headers
}
