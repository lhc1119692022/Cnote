import { clampZoom } from './viewport'

export function browserChromeStyle(zoom: number) {
  return { zoom: clampZoom(zoom), minWidth: 0 }
}
