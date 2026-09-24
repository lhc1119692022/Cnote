import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const executable = process.env.CNOTE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const userData = await mkdtemp(join(tmpdir(), 'cnote-media-browser-'))
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{ name: 'media-test-surface', configureServer(instance) {
    instance.middlewares.use('/__media-test', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(await instance.transformIndexHtml('/__media-test', '<!doctype html><html><body>Media runtime tests</body></html>'))
    })
  } }],
})
let browser
let socket
let closeBrowser
try {
  await server.listen()
  const address = server.httpServer.address()
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let exitCode
  browser.on('exit', (code) => { exitCode = code })
  browser.on('error', (error) => console.error(error))
  let debugPort
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exitCode !== undefined && exitCode !== 0) throw new Error(`Test browser exited: ${exitCode}`)
    try { debugPort = (await readFile(join(userData, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await new Promise((done) => setTimeout(done, 100)) }
  }
  if (!debugPort) throw new Error('Test browser did not expose its debugging endpoint')
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const page = tabs.find((tab) => tab.type === 'page')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result) }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 150_000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  closeBrowser = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }))
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__media-test` })
  await new Promise(resolve => setTimeout(resolve, 500))
  const result = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/rh-ui-cases.tsx').then(m => m.runRHUiCases())", awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  console.log(JSON.stringify(result.result.value))
  const screenshot = await send('Page.captureScreenshot')
  await writeFile(join(tmpdir(), 'cnote-rh-ui.png'), Buffer.from(screenshot.data, 'base64'))
} finally {
  closeBrowser?.()
  socket?.close()
  await server.close()
  browser?.kill()
}
