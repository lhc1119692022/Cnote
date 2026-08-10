import { toJpeg } from 'html-to-image'

export async function captureFlowThumbnail(): Promise<string | undefined> {
  const canvas = document.querySelector<HTMLElement>('.react-flow')
  if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return undefined

  const rootStyle = getComputedStyle(document.documentElement)
  const backgroundColor = rootStyle.getPropertyValue('--background').trim()
  const scale = Math.min(1, 640 / canvas.clientWidth)
  const canvasWidth = Math.round(canvas.clientWidth * scale)
  const canvasHeight = Math.round(canvas.clientHeight * scale)

  try {
    return await toJpeg(canvas, {
      backgroundColor,
      canvasWidth,
      canvasHeight,
      pixelRatio: 1,
      quality: 0.72,
      skipFonts: true,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true
        return !node.classList.contains('react-flow__attribution')
      },
    })
  } catch (error) {
    console.error('生成缩略图失败:', error)
    return undefined
  }
}