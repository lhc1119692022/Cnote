import { toJpeg, toPng } from 'html-to-image'

function canvasRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cnote-canvas="engine"]')
}

function shouldCaptureNode(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return true
  return !node.closest('[data-canvas-chrome]')
}

export async function captureCanvasThumbnail(options?: { format?: 'jpeg' | 'png' }): Promise<string | undefined> {
  const canvas = canvasRoot()
  if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return undefined

  const rootStyle = getComputedStyle(document.documentElement)
  const backgroundColor = rootStyle.getPropertyValue('--background').trim() || '#ffffff'
  const format = options?.format ?? 'jpeg'

  try {
    if (format === 'png') {
      const maxWidth = 1600
      const scale = Math.min(1, maxWidth / canvas.clientWidth)
      return await toPng(canvas, {
        backgroundColor,
        canvasWidth: Math.round(canvas.clientWidth * scale),
        canvasHeight: Math.round(canvas.clientHeight * scale),
        pixelRatio: 1,
        skipFonts: true,
        filter: shouldCaptureNode,
      })
    }

    const scale = Math.min(1, 640 / canvas.clientWidth)
    return await toJpeg(canvas, {
      backgroundColor,
      canvasWidth: Math.round(canvas.clientWidth * scale),
      canvasHeight: Math.round(canvas.clientHeight * scale),
      pixelRatio: 1,
      quality: 0.72,
      skipFonts: true,
      filter: shouldCaptureNode,
    })
  } catch (error) {
    console.error('生成画布缩略图失败:', error)
    return undefined
  }
}
