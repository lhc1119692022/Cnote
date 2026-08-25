import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { DesktopRuntime } from './runtime/desktop-runtime'
import type { NativeJobRequest, NativeNetworkJobRequest, RuntimeInfo } from './runtime/types'

const currentDir = __dirname
let runtime: DesktopRuntime | null = null
let mainWindow: BrowserWindow | null = null
let rendererHealthTimer: NodeJS.Timeout | null = null
let emergencyRendererShown = false

function getRuntime() {
  if (!runtime) throw new Error('Desktop runtime is not ready')
  return runtime
}

function isDevelopmentMode() {
  return process.argv.includes('--dev') || Boolean(process.env.CNOTE_WEB_DEV_SERVER)
}

function getWebRuntime(): RuntimeInfo['webRuntime'] {
  if (process.env.CNOTE_WEB_DEV_SERVER) return 'development-server'
  if (existsSync(path.join(currentDir, '../../web/dist/index.html')) || existsSync(path.join(process.resourcesPath, 'web/dist/index.html'))) return 'built-web'
  return 'fallback'
}

function getRuntimeInfo(): RuntimeInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    desktopVersion: '0.1.0',
    userDataPath: app.getPath('userData'),
    webRuntime: getWebRuntime(),
  }
}

function getAppIconPath() {
  const candidates = [
    path.join(currentDir, '../packaging/resources/icon.ico'),
    path.join(process.resourcesPath, 'packaging/resources/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('window:state-changed', { maximized: mainWindow.isMaximized() })
  } catch {
    // Window state notifications are best-effort during teardown.
  }
}

function sendToMainWindow(channel: string, ...args: unknown[]) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(channel, ...args)
  } catch {
    // The renderer can disappear between an event and its IPC delivery.
  }
}

function clearRendererHealthTimer() {
  if (!rendererHealthTimer) return
  clearTimeout(rendererHealthTimer)
  rendererHealthTimer = null
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

async function showEmergencyRenderer(window: BrowserWindow, reason: string) {
  if (window.isDestroyed() || emergencyRendererShown) return
  emergencyRendererShown = true
  clearRendererHealthTimer()
  const message = escapeHtml(reason || 'Cnote 页面资源加载失败。')
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>Cnote</title>
        <style>
          :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
          * { box-sizing: border-box; }
          html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #f7f7f8; color: #18181b; }
          body { display: flex; flex-direction: column; }
          .titlebar { display: flex; height: 44px; flex: 0 0 44px; border-bottom: 1px solid #e4e4e7; background: #fff; -webkit-app-region: drag; }
          .title { display: flex; flex: 1; align-items: center; padding: 0 16px; font-size: 13px; font-weight: 650; }
          .controls { display: flex; -webkit-app-region: no-drag; }
          button { width: 46px; height: 44px; border: 0; background: transparent; color: #71717a; cursor: pointer; font: inherit; }
          button:hover { background: #f4f4f5; color: #18181b; }
          button.close:hover { background: #c42b1c; color: #fff; }
          .content { display: flex; flex: 1; min-height: 0; align-items: center; justify-content: center; padding: 24px; }
          .panel { width: min(520px, 100%); padding: 32px; border: 1px solid #e4e4e7; border-radius: 14px; background: #fff; text-align: center; box-shadow: 0 10px 30px rgb(24 24 27 / 0.06); }
          h1 { margin: 0; font-size: 18px; }
          p { margin: 10px 0 0; color: #71717a; font-size: 13px; line-height: 1.7; }
          code { display: block; margin-top: 12px; color: #a16207; font-size: 11px; overflow-wrap: anywhere; }
          .actions { display: flex; justify-content: center; gap: 8px; margin-top: 22px; }
          .action { width: auto; height: auto; padding: 9px 14px; border: 1px solid #d4d4d8; border-radius: 8px; background: #fff; color: #18181b; }
          .action.primary { border-color: #18181b; background: #18181b; color: #fff; }
          .action:hover { background: #f4f4f5; }
          .action.primary:hover { background: #27272a; color: #fff; }
        </style>
      </head>
      <body>
        <header class="titlebar">
          <div class="title">Cnote</div>
          <div class="controls">
            <button aria-label="最小化 Cnote" onclick="window.cnoteDesktop?.window.minimize()">&#8722;</button>
            <button aria-label="最大化 Cnote" onclick="window.cnoteDesktop?.window.toggleMaximize()">&#9633;</button>
            <button class="close" aria-label="关闭 Cnote" onclick="window.cnoteDesktop?.window.close()">&#10005;</button>
          </div>
        </header>
        <main class="content">
          <section class="panel">
            <h1>Cnote 暂时无法显示</h1>
            <p>桌面界面加载失败。可以重新加载一次，或直接关闭 Cnote。</p>
            <code>${message}</code>
            <div class="actions">
              <button class="action primary" onclick="window.cnoteDesktop?.window.reload()">重新加载</button>
              <button class="action" onclick="window.cnoteDesktop?.window.close()">关闭 Cnote</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  `)}`)
}

function scheduleRendererHealthCheck(window: BrowserWindow) {
  clearRendererHealthTimer()
  rendererHealthTimer = setTimeout(() => {
    rendererHealthTimer = null
    if (window.isDestroyed() || emergencyRendererShown) return
    void window.webContents.executeJavaScript(`({
      rootChildren: document.getElementById('root')?.childElementCount || 0,
      hasWindowChrome: Boolean(document.querySelector('[data-testid="cnote-window-titlebar"]')),
    })`, true).then((state) => {
      if (window.isDestroyed() || emergencyRendererShown) return
      if (!state?.rootChildren || !state.hasWindowChrome) {
        void showEmergencyRenderer(window, '桌面界面入口资源未能完成加载。')
      }
    }).catch((error) => {
      void showEmergencyRenderer(window, error instanceof Error ? error.message : '桌面界面检查失败。')
    })
  }, 5_000)
}

function registerIpcHandlers() {
  getRuntime().ports.browser.onSessionUpdated((session) => {
    sendToMainWindow('browser:session-updated', session)
  })
  getRuntime().ports.jobs.onUpdated((job) => {
    sendToMainWindow('jobs:updated', job)
  })
  ipcMain.handle('runtime:get-info', () => getRuntimeInfo())
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    sendWindowState()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })
  ipcMain.handle('window:reload', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    emergencyRendererShown = false
    clearRendererHealthTimer()
    await loadRenderer(mainWindow)
  })
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))

  ipcMain.handle('browser:create-session', (_event, options) => getRuntime().ports.browser.createSession(options))
  ipcMain.handle('browser:list-sessions', () => getRuntime().ports.browser.listSessions())
  ipcMain.handle('browser:mount-session', (_event, id: unknown, bounds: unknown) =>
    getRuntime().ports.browser.mountSession(assertString(id, 'session id'), assertBounds(bounds)))
  ipcMain.handle('browser:unmount-session', (_event, id: unknown) =>
    getRuntime().ports.browser.unmountSession(assertString(id, 'session id')))
  ipcMain.handle('browser:set-visible', (_event, id: unknown, visible: unknown) =>
    getRuntime().ports.browser.setSessionVisible(assertString(id, 'session id'), assertBoolean(visible, 'visible')))
  ipcMain.handle('browser:set-bounds', (_event, id: unknown, bounds: unknown) =>
    getRuntime().ports.browser.setSessionBounds(assertString(id, 'session id'), assertBounds(bounds)))
  ipcMain.handle('browser:show-session', (_event, id: unknown) => getRuntime().ports.browser.showSession(assertString(id, 'session id')))
  ipcMain.handle('browser:popout-session', (_event, id: unknown) => getRuntime().ports.browser.popoutSession(assertString(id, 'session id')))
  ipcMain.handle('browser:navigate', (_event, id: unknown, url: unknown) =>
    getRuntime().ports.browser.navigate(assertString(id, 'session id'), assertString(url, 'url')))
  ipcMain.handle('browser:reload', (_event, id: unknown) => getRuntime().ports.browser.reload(assertString(id, 'session id')))
  ipcMain.handle('browser:capture', (_event, id: unknown) => getRuntime().ports.browser.capture(assertString(id, 'session id')))
  ipcMain.handle('browser:close-session', (_event, id: unknown) => getRuntime().ports.browser.closeSession(assertString(id, 'session id')))
  ipcMain.handle('content:parse-html', (_event, input: unknown) => getRuntime().ports.content.parseHtml(assertContentParseInput(input)))
  ipcMain.handle('network:request', async (_event, input: unknown) => {
    const request = assertNativeNetworkRequest(input)
    const secretValues: Record<string, string> = {}
    for (const secretName of Object.values(request.secretRefs || {})) {
      const value = await getRuntime().ports.secrets.get(secretName)
      if (value) secretValues[secretName] = value
    }
    const headers = { ...(request.headers || {}) }
    Object.entries(request.secretRefs || {}).forEach(([header, secretName]) => {
      const value = secretValues[secretName]
      if (!value) throw new Error(`SecretStore 中未找到请求头密钥：${secretName}`)
      Object.keys(headers).filter((name) => name.toLowerCase() === header.toLowerCase()).forEach((name) => delete headers[name])
      headers[header] = value
    })
    return getRuntime().ports.network.request({ ...request, headers })
  })
  ipcMain.handle('system:open-file', (_event, request: unknown) => getRuntime().ports.system.openFile(assertOpenFileRequest(request)))
  ipcMain.handle('system:save-file', (_event, request: unknown) => getRuntime().ports.system.saveFile(assertSaveFileRequest(request)))

  ipcMain.handle('jobs:list', () => getRuntime().ports.jobs.list())
  ipcMain.handle('jobs:create', (_event, kind: unknown, checkpoint: unknown) =>
    getRuntime().ports.jobs.create(assertString(kind, 'job kind'), checkpoint))
  ipcMain.handle('jobs:enqueue-native', (_event, request: unknown) =>
    getRuntime().ports.nativeJobs.enqueue(assertNativeJobRequest(request)))
  ipcMain.handle('jobs:update', (_event, id: unknown, update: unknown) =>
    getRuntime().ports.jobs.update(assertString(id, 'job id'), assertJobUpdate(update)))
  ipcMain.handle('jobs:cancel', async (_event, id: unknown) => {
    const jobId = assertString(id, 'job id')
    const job = (await getRuntime().ports.jobs.list()).find((item) => item.id === jobId)
    return job?.kind.startsWith('native:')
      ? getRuntime().ports.nativeJobs.cancel(jobId)
      : getRuntime().ports.jobs.cancel(jobId)
  })

  ipcMain.handle('secret:has', (_event, name: unknown) => getRuntime().ports.secrets.has(assertString(name, 'secret name')))
  ipcMain.handle('secret:set', (_event, name: unknown, value: unknown) =>
    getRuntime().ports.secrets.set(assertString(name, 'secret name'), assertString(value, 'secret value')))
  ipcMain.handle('secret:delete', (_event, name: unknown) => getRuntime().ports.secrets.delete(assertString(name, 'secret name')))

  ipcMain.handle('shell:open-external', (_event, url: unknown) => {
    const value = assertString(url, 'url')
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) links may be opened externally')
    return shell.openExternal(parsed.toString())
  })
}

function assertString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

function assertBounds(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Browser view bounds are required')
  const bounds = value as Record<string, unknown>
  const result = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  if (Object.values(result).some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('Browser view bounds are invalid')
  }
  return result as { x: number; y: number; width: number; height: number }
}

function assertContentParseInput(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Content parse input is required')
  const input = value as Record<string, unknown>
  if (typeof input.html !== 'string') throw new Error('Content parse HTML is required')
  return {
    html: input.html,
    url: typeof input.url === 'string' ? input.url : undefined,
    title: typeof input.title === 'string' ? input.title : undefined,
  }
}

function assertNativeJobRequest(value: unknown): NativeJobRequest {
  if (!value || typeof value !== 'object') throw new Error('Native Job request is required')
  const input = value as Record<string, unknown>
  if (input.kind === 'native:content-parse') {
    return { kind: 'native:content-parse', input: assertContentParseInput(input.input) }
  }
  if (input.kind !== 'native:network-request' || !input.input || typeof input.input !== 'object') {
    throw new Error('Unsupported Native Job kind')
  }
  const request = input.input as Record<string, unknown>
  if (typeof request.url !== 'string' || !request.url.trim()) throw new Error('Native network URL is required')
  const parsed = new URL(request.url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Native network only supports HTTP(S)')
  if (request.method !== undefined && (typeof request.method !== 'string' || !/^[A-Za-z]+$/.test(request.method))) {
    throw new Error('Native network method is invalid')
  }
  const headers = normalizeHeadersInput(request.headers)
  const secretRefs = normalizeSecretRefs(request.secretRefs)
  const secretRefHeaders = new Set(Object.keys(secretRefs).map((header) => header.toLowerCase()))
  const sensitiveHeader = Object.keys(headers || {}).find((header) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(header) && !secretRefHeaders.has(header.toLowerCase()))
  if (sensitiveHeader) throw new Error(`敏感请求头“${sensitiveHeader}”必须通过 SecretStore 引用。`)
  if (request.body !== undefined && typeof request.body !== 'string' && !(request.body instanceof Uint8Array)) {
    throw new Error('Native network body is invalid')
  }
  if (request.body !== undefined && (typeof request.body === 'string' ? Buffer.byteLength(request.body, 'utf8') : request.body.byteLength) > 256 * 1024 * 1024) {
    throw new Error('Native network body 超过 256 MiB。')
  }
  if (request.timeoutMs !== undefined && (typeof request.timeoutMs !== 'number' || !Number.isFinite(request.timeoutMs))) {
    throw new Error('Native network timeout is invalid')
  }
  return {
    kind: 'native:network-request',
    input: {
      url: parsed.toString(),
      method: typeof request.method === 'string' ? request.method.toUpperCase() : undefined,
      headers,
      secretRefs,
      body: request.body as string | Uint8Array | undefined,
      timeoutMs: typeof request.timeoutMs === 'number' ? Math.max(1_000, Math.min(300_000, request.timeoutMs)) : undefined,
    },
  }
}

function normalizeHeadersInput(value: unknown) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Native network headers are invalid')
  const result: Record<string, string> = {}
  Object.entries(value as Record<string, unknown>).forEach(([name, headerValue]) => {
    if (!name.trim() || typeof headerValue !== 'string') throw new Error('Native network headers are invalid')
    result[name] = headerValue
  })
  return result
}

function normalizeSecretRefs(value: unknown) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object') throw new Error('Native network secret references are invalid')
  const result: Record<string, string> = {}
  Object.entries(value as Record<string, unknown>).forEach(([header, secretName]) => {
    if (!header.trim() || typeof secretName !== 'string' || !secretName.trim()) throw new Error('Native network secret references are invalid')
    result[header] = secretName.trim()
  })
  return result
}

function normalizeDialogFilters(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item): item is { name: string; extensions: unknown[] } => Boolean(
      item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' && Array.isArray((item as { extensions?: unknown }).extensions),
    ))
    .map((item) => ({
      name: item.name,
      extensions: item.extensions.filter((extension): extension is string => typeof extension === 'string'),
    }))
}

function assertOpenFileRequest(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  return {
    title: typeof input.title === 'string' ? input.title : undefined,
    filters: normalizeDialogFilters(input.filters),
  }
}

function assertSaveFileRequest(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Save file request is required')
  const input = value as Record<string, unknown>
  if (typeof input.suggestedName !== 'string' || !(input.data instanceof Uint8Array)) {
    throw new Error('Save file request is invalid')
  }
  return {
    title: typeof input.title === 'string' ? input.title : undefined,
    suggestedName: input.suggestedName,
    filters: normalizeDialogFilters(input.filters),
    data: input.data,
  }
}

function assertJobUpdate(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Job update is required')
  const input = value as Record<string, unknown>
  const allowedStatuses = new Set(['queued', 'running', 'completed', 'failed', 'cancelled'])
  if (input.status !== undefined && (typeof input.status !== 'string' || !allowedStatuses.has(input.status))) {
    throw new Error('Job status is invalid')
  }
  if (input.retryCount !== undefined && (typeof input.retryCount !== 'number' || !Number.isFinite(input.retryCount))) {
    throw new Error('Job retry count is invalid')
  }
  if (input.resumeRequired !== undefined && typeof input.resumeRequired !== 'boolean') {
    throw new Error('Job resume flag is invalid')
  }
  return {
    ...(input.status === undefined ? {} : { status: input.status as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' }),
    ...(Object.prototype.hasOwnProperty.call(input, 'checkpoint') ? { checkpoint: input.checkpoint } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'error') ? { error: input.error === undefined ? undefined : String(input.error) } : {}),
    ...(input.retryCount === undefined ? {} : { retryCount: input.retryCount }),
    ...(input.resumeRequired === undefined ? {} : { resumeRequired: input.resumeRequired }),
  }
}

async function loadRenderer(window: BrowserWindow) {
  emergencyRendererShown = false
  clearRendererHealthTimer()
  const devServer = process.env.CNOTE_WEB_DEV_SERVER
  try {
    if (isDevelopmentMode() && devServer) {
      await window.loadURL(devServer)
      return
    }

    const builtIndexes = [
      path.join(currentDir, '../../web/dist/index.html'),
      path.join(process.resourcesPath, 'web/dist/index.html'),
    ]
    const builtIndex = builtIndexes.find((candidate) => existsSync(candidate))
    if (!builtIndex) {
      await showEmergencyRenderer(window, '没有找到 Web 构建产物，请先构建 Cnote。')
      return
    }
    await window.loadFile(builtIndex)
  } catch (error) {
    await showEmergencyRenderer(window, error instanceof Error ? error.message : String(error))
  }
}

function assertNativeNetworkRequest(value: unknown): NativeNetworkJobRequest {
  return (assertNativeJobRequest({ kind: 'native:network-request', input: value }) as Extract<NativeJobRequest, { kind: 'native:network-request' }>).input
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#111111',
    icon: getAppIconPath(),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDir, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: true,
    },
  })
  const window = mainWindow
  if (!window) return
  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('restore', sendWindowState)
  mainWindow.webContents.on('did-finish-load', () => scheduleRendererHealthCheck(mainWindow!))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || window.isDestroyed()) return
    void showEmergencyRenderer(window, `${errorDescription} (${errorCode})`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed()) return
    void showEmergencyRenderer(window, `渲染进程已退出：${details.reason}`)
  })
  getRuntime().attachHostWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) return { action: 'deny' }
      void shell.openExternal(parsed.toString())
    } catch {
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })
  await loadRenderer(mainWindow)
  mainWindow.on('close', () => {
    // Detach native browser views before Chromium destroys the host content
    // view. Waiting for `closed` can make removeChildView/setVisible throw.
    getRuntime().detachHostWindow()
  })
  mainWindow.on('closed', () => {
    clearRendererHealthTimer()
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  runtime = new DesktopRuntime()
  registerIpcHandlers()
  await getRuntime().ports.jobs.list()
  await getRuntime().ports.nativeJobs.start()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  runtime?.detachHostWindow()
  mainWindow = null
})

process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (mainWindow && !mainWindow.isDestroyed()) void showEmergencyRenderer(mainWindow, message)
  else dialog.showErrorBox('Cnote error', message)
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  // A rejected provider request or background job must not replace the whole
  // workspace with the emergency renderer. Keep the shell alive and leave the
  // owning feature responsible for presenting its own error state.
  console.error('Unhandled Cnote promise rejection:', message)
})
