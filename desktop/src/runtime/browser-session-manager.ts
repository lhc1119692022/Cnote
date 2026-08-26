import { BrowserWindow } from 'electron'
import type { BrowserPort } from './types'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'about:'])

function assertNavigableUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Invalid browser URL')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Navigation protocol is not allowed: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function configureNavigation(webContents: Electron.WebContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    try {
      void webContents.loadURL(assertNavigableUrl(url))
    } catch {
      // Unsupported target URLs are denied.
    }
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    try {
      assertNavigableUrl(url)
    } catch {
      event.preventDefault()
    }
  })
}

export class BrowserSessionManager implements BrowserPort {
  popout(url: string, title = 'Cnote 浏览器') {
    const popup = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 480,
      title,
      webPreferences: {
        partition: 'persist:cnote-browser',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    popup.setMenuBarVisibility(false)
    configureNavigation(popup.webContents)
    popup.once('ready-to-show', () => popup.show())
    void popup.webContents.loadURL(assertNavigableUrl(url)).catch(() => popup.close())
  }
}
