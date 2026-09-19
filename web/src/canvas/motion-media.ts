export function preserveMotionMedia(root: HTMLElement) {
  const restores: Array<() => void> = []
  for (const video of root.querySelectorAll('video')) {
    if (video.paused || video.ended) continue
    video.pause()
    restores.push(() => { if (video.isConnected) void video.play().catch(() => undefined) })
  }
  return () => {
    for (const restore of restores) restore()
  }
}
