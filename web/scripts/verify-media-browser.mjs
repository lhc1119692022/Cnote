import { createServer } from 'vite'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
let memoryTimer
let memoryPending = Promise.resolve()
let peakWorkingSetBytes = 0
let memorySamples = 0
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
  if (process.platform === 'win32') {
    let sampling = false
    const sample = () => {
      if (sampling) return
      sampling = true
      memoryPending = promisify(execFile)('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$sum = (Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like ('*' + $env:CNOTE_TEST_PROFILE + '*') } | Measure-Object -Property WorkingSetSize -Sum).Sum; Write-Output $sum"], { env: { ...process.env, CNOTE_TEST_PROFILE: userData }, windowsHide: true, timeout: 5000 }).then(({ stdout }) => {
        const bytes = Number(stdout.trim())
        if (Number.isFinite(bytes) && bytes > 0) { memorySamples++; peakWorkingSetBytes = Math.max(peakWorkingSetBytes, bytes) }
      }).catch(() => undefined).finally(() => { sampling = false })
    }
    sample()
    memoryTimer = setInterval(sample, 300)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__media-test` })
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (state.result.value === 'complete') break
    await new Promise((done) => setTimeout(done, 100))
  }
  const result = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/media-runtime-cases.ts').then(module => module.runMediaRuntimeCases())", awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  console.log(JSON.stringify({ browser: 'Chromium', ...result.result.value }, null, 2))
  const ui = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/media-ui-cases.tsx').then(module => module.runMediaUiCases())", awaitPromise: true, returnByValue: true })
  if (ui.exceptionDetails) throw new Error(ui.exceptionDetails.exception?.description || JSON.stringify(ui.exceptionDetails))
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = join(userData, 'video-input-ui.png')
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify({ ui: ui.result.value, screenshotPath }, null, 2))
  await send('Runtime.evaluate', { expression: "document.documentElement.classList.add('dark')" })
  const darkScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  const darkScreenshotPath = join(userData, 'video-input-ui-dark.png')
  await writeFile(darkScreenshotPath, Buffer.from(darkScreenshot.data, 'base64'))
  console.log(JSON.stringify({ darkScreenshotPath }))
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__media-test` })
  await new Promise((done) => setTimeout(done, 500))
  const cutSetup = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/cut-ui-cases.tsx').then(module => module.setupCutUi())", awaitPromise: true, returnByValue: true })
  if (cutSetup.exceptionDetails) throw new Error(cutSetup.exceptionDetails.exception?.description || JSON.stringify(cutSetup.exceptionDetails))
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 450, y: 90, button: 'right', buttons: 2, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 450, y: 280, button: 'right', buttons: 2 })
  await new Promise((done) => setTimeout(done, 80))
  const cutPreview = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/cut-ui-cases.tsx').then(module => module.assertCutPreview())", awaitPromise: true, returnByValue: true })
  if (cutPreview.exceptionDetails) throw new Error(cutPreview.exceptionDetails.exception?.description || JSON.stringify(cutPreview.exceptionDetails))
  const cutScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  const cutScreenshotPath = join(userData, 'cut-preview.png')
  await writeFile(cutScreenshotPath, Buffer.from(cutScreenshot.data, 'base64'))
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 450, y: 280, button: 'right', buttons: 0, clickCount: 1 })
  const cutCommit = await send('Runtime.evaluate', { expression: "import('/scripts/helpers/cut-ui-cases.tsx').then(module => module.assertCutCommit())", awaitPromise: true, returnByValue: true })
  if (cutCommit.exceptionDetails) throw new Error(cutCommit.exceptionDetails.exception?.description || JSON.stringify(cutCommit.exceptionDetails))
  console.log(JSON.stringify({ cutting: cutCommit.result.value, cutScreenshotPath }))
  clearInterval(memoryTimer)
  await memoryPending
  console.log(JSON.stringify({ memorySamples, sampledPeakBrowserWorkingSetBytes: peakWorkingSetBytes, measurement: 'Entire isolated browser process tree during fixtures and UI tests; not a single-image incremental allocation' }, null, 2))
} finally {
  clearInterval(memoryTimer)
  await memoryPending
  closeBrowser?.()
  await new Promise((done) => setTimeout(done, 150))
  socket?.close()
  browser?.kill()
  await server.close()
}
