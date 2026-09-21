export interface VideoModelIdentity {
  family: 'seedance' | 'wan' | 'minimax-h3' | 'grok-video'
  version: string
}

export function normalizeVideoModelName(modelId: string) {
  return modelId.normalize('NFKC').toLowerCase().replace(/[‐‑‒–—−]/g, '-').trim()
}

export function identifyVideoModel(modelId?: string): VideoModelIdentity | undefined {
  const name = normalizeVideoModelName(modelId || '')
  const patterns: Array<{ family: VideoModelIdentity['family']; pattern: RegExp }> = [
    { family: 'seedance', pattern: /(?:^|[^a-z0-9])(?:seedance|doubao|sd|s)(?:[-_.\s]|\p{Script=Han}){0,16}v?(\d+)(?:[._-](\d+))?(?=$|[^a-z0-9.]|(?:fast|mini|pro|max|turbo)(?=$|[^a-z]))/gu },
    { family: 'wan', pattern: /(?:^|[^a-z0-9])(?:wan|万相)(?:[-_.\s]|\p{Script=Han}){0,16}v?(\d+)(?:[._-](\d+))?(?=$|[^a-z0-9.]|(?:fast|mini|pro|max|turbo)(?=$|[^a-z]))/gu },
    { family: 'minimax-h3', pattern: /(?:^|[^a-z0-9])(?:minimax[-_.\s]*)?h[-_.\s]?(\d+)(?:[._](\d+))?(?=$|[^a-z0-9.]|(?:fast|mini|pro|max|turbo)(?=$|[^a-z]))/g },
    { family: 'grok-video', pattern: /(?:^|[^a-z0-9])grok[-_.\s]+imagine[-_.\s]+video(?:[-_.\s]+v?(\d+)(?:[._-](\d+))?)?(?=$|[^a-z0-9.])/g },
  ]
  const candidates = new Map<string, VideoModelIdentity>()
  for (const { family, pattern } of patterns) {
    for (const match of name.matchAll(pattern)) {
      if (match[1] === '720' || match[1] === '1080') continue
      const minorVersion = match[2] === '720' || match[2] === '1080' ? undefined : match[2]
      const compactVersion = family === 'seedance' && !minorVersion
        ? ({ '20': '2.0', '25': '2.5' } as Record<string, string>)[match[1]]
        : undefined
      const version = compactVersion || `${match[1] || '1'}.${minorVersion || '0'}`
      candidates.set(`${family}:${version}`, { family, version })
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined
}
