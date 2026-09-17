import type { WebContents } from 'electron'

export function applyBrowserPresentation(host: WebContents, guest: WebContents | undefined, input: unknown) {
  if (!guest || guest.isDestroyed() || guest.hostWebContents !== host) {
    throw new Error('Browser view does not belong to this window')
  }
  const viewport = input as { width?: number; height?: number; scale?: number } | null
  if (!viewport || ![viewport.width, viewport.height, viewport.scale].every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Invalid browser presentation')
  }
  const { width, height, scale } = viewport as { width: number; height: number; scale: number }
  if (width < 1 || height < 1 || width > 100000 || height > 100000 || scale < 0.1 || scale > 4) {
    throw new Error('Browser presentation out of range')
  }
  guest.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: 0, height: 0 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width: Math.round(width), height: Math.round(height) },
    scale,
  })
}
