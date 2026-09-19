const { app, BrowserWindow, session, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const os = require('node:os')
const visibilitySwitches = ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']
for (const flag of visibilitySwitches) app.commandLine.appendSwitch(flag)
const smoke = process.argv.includes('--smoke')
const guestsOnly = process.argv.includes('--guests')
const count = Number(process.argv.find(argument => argument.startsWith('--count='))?.split('=')[1] || 30)
if (![30, 100, 300].includes(count)) throw new Error('Use a 30, 100 or 300 node shard')
const directory = path.join(__dirname, 'build/final-product')
const filename = path.join(__dirname, 'results', `final-product-${guestsOnly ? 'guests' : smoke ? 'smoke' : count}-${Date.now()}.json`)
app.setPath('userData', path.join(__dirname, 'profile', `final-product-${process.pid}`))
app.on('window-all-closed', () => {})
let server
let windowHandle
let origin
let stream
const result = { recordedAt: new Date().toISOString(), count, smoke, guestsOnly, rows: [], guests: [], failures: [], manifest: JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) }
const checkpoint = () => fs.writeFileSync(filename, JSON.stringify(result, null, 2))
async function bounded(operation, label, milliseconds = 30000) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
const timeout = setTimeout(() => { result.failures.push('Shard exceeded 12 minute limit; checkpoint retained'); finish(1) }, 720000)
function finish(code) { clearTimeout(timeout); checkpoint(); windowHandle?.destroy(); server?.close(); console.log(`RESULT ${filename}`); app.exit(code) }
function prepare() { stream = { ready: false, queue: [], waiter: null, response: null, readCalls: 0, chunks: 0, bytes: 0 }; return true }
function push(count, done) {
  const packets = Array.from({ length: count }, () => `data: ${JSON.stringify({ choices: [{ delta: { content: ' text' } }] })}\n\n`)
  if (done) packets.push('data: [DONE]\n\n')
  for (const packet of packets) {
    const bytes = [...Buffer.from(packet)]
    stream.bytes += bytes.length
    if (!packet.includes('[DONE]')) stream.chunks++
    if (stream.response) stream.response.write(packet)
    else if (stream.waiter) { const resolve = stream.waiter; stream.waiter = null; resolve(bytes) }
    else stream.queue.push(bytes)
  }
  if (done) {
    if (stream.response) stream.response.end()
    else if (stream.waiter) { stream.waiter(null); stream.waiter = null }
    else stream.queue.push(null)
  }
}
ipcMain.handle('fixture:prepare', prepare)
ipcMain.handle('fixture:push', (_event, count, done) => push(count, done))
ipcMain.handle('fixture:stats', () => ({ ready: stream?.ready || false, readCalls: stream?.readCalls || 0, chunks: stream?.chunks || 0, bytes: stream?.bytes || 0 }))
ipcMain.handle('fixture:open', (_event, options) => {
  if (options.url !== `${origin}/v1/chat/completions`) throw new Error('Only the local fixture URL is allowed')
  stream.ready = true; stream.requestId = options.requestId
  return { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } }
})
ipcMain.handle('fixture:read', (_event, requestId) => {
  if (requestId !== stream.requestId) throw new Error('Wrong fixture stream')
  stream.readCalls++
  if (stream.queue.length) return stream.queue.shift()
  return new Promise(resolve => { stream.waiter = resolve })
})
ipcMain.handle('fixture:abort', () => { stream?.waiter?.(null); if (stream) stream.waiter = null })

app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/v1/chat/completions') {
      request.resume(); response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); response.flushHeaders()
      stream.ready = true; stream.response = response; return
    }
    if (pathname === '/guest') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Local guest</title><input aria-label="state"><p>Offline browser fixture</p>'); return }
    const requested = path.resolve(directory, '.' + pathname)
    if (!requested.startsWith(directory + path.sep) || !fs.existsSync(requested) || fs.statSync(requested).isDirectory()) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', requested.endsWith('.css') ? 'text/css' : /\.m?js$/.test(requested) ? 'text/javascript' : 'text/html')
    response.end(fs.readFileSync(requested))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  for (const browserSession of [session.defaultSession, session.fromPartition('final-fixture')]) browserSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin + '/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') && details.url !== 'about:blank' }))
  result.environment = { cpu: os.cpus()[0].model, totalMemoryGiB: os.totalmem() / 2 ** 30, versions: process.versions, gpu: app.getGPUFeatureStatus(), visibilitySwitches, renderer: 'normal inactive window; backgroundThrottling=false; production profiling React', requestedWindow: { width: 1440, height: 900 } }
  const createWindow = async mode => {
    windowHandle?.destroy()
    windowHandle = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, 'final-product-preload.cjs'), contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false, additionalArguments: mode === 'desktop' ? ['--fixture-desktop'] : [] } })
    windowHandle.webContents.on('console-message', details => { if (details.level === 'error') { result.failures.push(details.message); console.log('Renderer:', details.message.slice(0, 240)) } })
    windowHandle.showInactive()
  }
  if (guestsOnly) {
    await createWindow('web'); await windowHandle.loadURL(`${origin}/after/index.html`)
    let guestCount = 0
    for (const target of [1, 10, 50]) {
      while (guestCount < target && os.freemem() >= 2 * 2 ** 30) { await windowHandle.webContents.executeJavaScript(`window.addGuest(${guestCount})`); guestCount++ }
      const restored = await windowHandle.webContents.executeJavaScript('window.verifyGuests()')
      await new Promise(resolve => setTimeout(resolve, 400))
      const metrics = app.getAppMetrics()
      result.guests.push({ target, guestCount, restored, stopped: target !== guestCount, freeSystemGiB: os.freemem() / 2 ** 30, workingSetMiB: metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024, cpuPercent: metrics.reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0), rendererProcesses: metrics.filter(metric => metric.type === 'Tab').length })
      checkpoint(); console.log(`GUESTS ${guestCount}/${target}`)
      if (target !== guestCount) break
    }
  } else for (const mode of ['web', 'desktop']) {
    await createWindow(mode)
    for (let repeat = 0; repeat < (smoke ? 1 : 5); repeat++) for (const action of smoke ? ['drag', 'stream'] : ['drag', 'pan', 'zoom', 'stream', 'mixed']) for (const version of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      result.currentCase = { count, mode, repeat, action, version, stage: 'load', startedAt: new Date().toISOString() }
      checkpoint()
      await bounded(windowHandle.loadURL(`${origin}/${version}/index.html?repeat=${repeat}&action=${action}&mode=${mode}`), 'Fixture navigation')
      windowHandle.showInactive()
      windowHandle.moveTop()
      const readiness = await bounded(windowHandle.webContents.executeJavaScript('({ready:typeof window.runFinalProductCase, errors:window.fixtureErrors, page:document.body.innerHTML.slice(0,500), viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState}})'), 'Fixture readiness')
      if (readiness.ready !== 'function') throw new Error(JSON.stringify(readiness))
      if (readiness.viewport.visibility !== 'visible') throw new Error('Fixture window must be visible before measuring animation frames')
      result.currentCase.stage = 'measure'
      result.currentCase.viewport = readiness.viewport
      checkpoint()
      const row = await bounded(windowHandle.webContents.executeJavaScript(`window.runFinalProductCase(${JSON.stringify({ count, action, frames: smoke ? 5 : 20 })})`), 'Fixture measurement')
      result.rows.push({ ...row, mode, version, repeat, viewport: readiness.viewport })
      result.currentCase = null
      if (smoke && mode === 'web' && version === 'after' && action === 'drag') fs.writeFileSync(path.join(__dirname, 'results', 'final-product-preview.png'), (await windowHandle.webContents.capturePage()).toPNG())
      checkpoint(); console.log(`FINAL ${count} ${result.rows.length}: ${mode} ${action} ${version} ${row.frameP95.toFixed(1)}ms`)
    }
  }
  finish(result.failures.length ? 1 : 0)
}).catch(async error => {
  result.failures.push(String(error.stack || error))
  if (windowHandle && !windowHandle.isDestroyed()) {
    result.failureWindow = { loading: windowHandle.webContents.isLoading(), destroyed: windowHandle.webContents.isDestroyed(), bounds: windowHandle.getBounds() }
    try { result.failureRenderer = await bounded(windowHandle.webContents.executeJavaScript('({readyState:document.readyState,visibility:document.visibilityState,errors:window.fixtureErrors,mounted:document.querySelectorAll("[data-content-node]").length})'), 'Failure diagnostics', 2000) } catch (diagnosticError) { result.failureRenderer = String(diagnosticError) }
  }
  console.error(error)
  finish(1)
})
