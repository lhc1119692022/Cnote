const port = Number(process.env.CNOTE_DEVTOOLS_PORT || 9222)

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('CNOTE_DEVTOOLS_PORT must be a positive integer')
}

if (typeof WebSocket === 'undefined') {
  throw new Error('This smoke test requires a Node runtime with global WebSocket support.')
}

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
const target = targets.find((item) => item.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error(`No page target is available on DevTools port ${port}.`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextCommandId = 0

function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const commandId = ++nextCommandId
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation timed out: ${expression}`)), 5_000)
    const handleMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== commandId) return
      clearTimeout(timeout)
      socket.removeEventListener('message', handleMessage)
      if (message.error) {
        reject(new Error(message.error.message || 'CDP evaluation failed'))
        return
      }
      const result = message.result?.result
      if (result?.subtype === 'error' || result?.description?.startsWith('Error')) {
        reject(new Error(result.description || 'Renderer evaluation failed'))
        return
      }
      resolve(result?.value)
    }
    socket.addEventListener('message', handleMessage)
    socket.send(JSON.stringify({
      id: commandId,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
}

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out.')), 5_000)
  socket.addEventListener('open', () => {
    clearTimeout(timeout)
    resolve()
  }, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const bodyText = String(await evaluate('document.body.innerText'))
const mountedCanvas = await evaluate(`Boolean(
  document.querySelector('[data-cnote-canvas="engine"]') &&
  document.querySelector('button[aria-label="添加节点"]') &&
  document.querySelector('button[aria-label="保存"]')
)`)
const mountedWorkspace = bodyText.includes('创建 Flow') || mountedCanvas
if (!mountedWorkspace) {
  throw new Error(`Packaged renderer did not mount the Cnote workspace. Body text: ${bodyText.slice(0, 500)}`)
}

const windowControls = await evaluate(`Boolean(
  document.querySelector('[data-testid="cnote-window-titlebar"]') &&
  document.querySelector('[data-testid="cnote-window-close"]')
)`)
if (!windowControls) {
  throw new Error('Cnote workspace did not mount its desktop window controls.')
}

const browserBridge = await evaluate('Boolean(window.cnoteDesktop?.browser?.popout)')
const nativeBrowserEnabled = await evaluate(`typeof document.createElement('webview').loadURL === 'function'`)
if (!nativeBrowserEnabled) throw new Error('Native webview support is disabled in the actual desktop window.')
const browserPresentation = await evaluate('typeof window.cnoteDesktop?.browser?.setPresentation === "function"')
if (!browserPresentation) throw new Error('Browser presentation bridge is unavailable; restart the desktop main process.')
if (!browserBridge) {
  throw new Error('Desktop browser bridge is not available in the packaged renderer.')
}

const desktopBridge = await evaluate(`({
  storage: Boolean(window.cnoteDesktop?.storage?.read && window.cnoteDesktop?.storage?.write && window.cnoteDesktop?.storage?.remove),
  sessionFlush: Boolean(window.cnoteDesktop?.session?.onFlushRequest && window.cnoteDesktop?.session?.notifyFlushed),
  popoutSession: Boolean(window.cnoteDesktop?.browser?.popoutSession),
  networkAbort: Boolean(window.cnoteDesktop?.network?.abort),
  storageLocation: Boolean(window.cnoteDesktop?.system?.getStorageLocation && window.cnoteDesktop?.system?.restart),
})`)
if (!desktopBridge?.storage) throw new Error('Desktop storage bridge is not available in the renderer.')
if (!desktopBridge?.sessionFlush) throw new Error('Desktop session flush bridge is not available in the renderer.')
if (!desktopBridge?.popoutSession) throw new Error('Desktop popoutSession bridge is not available in the renderer.')
if (!desktopBridge?.networkAbort) throw new Error('Desktop network.abort bridge is not available in the renderer.')
if (!desktopBridge?.storageLocation) throw new Error('Desktop storage-location bridge is not available in the renderer.')

socket.close()
console.log('Packaged renderer and webview browser bridge smoke test passed.')
