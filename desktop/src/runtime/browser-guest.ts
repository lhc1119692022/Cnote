import type { WebContents } from 'electron'

function allowedUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.href === 'about:blank'
  } catch {
    return false
  }
}

export function configureBrowserGuests(host: WebContents) {
  host.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.nodeIntegrationInWorker = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.webSecurity = true
    preferences.allowRunningInsecureContent = false
    preferences.webviewTag = false
    if (params.partition !== 'persist:cnote-browser' || !allowedUrl(params.src)) event.preventDefault()
  })
  host.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (allowedUrl(url)) void guest.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!allowedUrl(url)) event.preventDefault()
    })
    guest.on('will-redirect', (event, url) => {
      if (!allowedUrl(url)) event.preventDefault()
    })
  })
}
