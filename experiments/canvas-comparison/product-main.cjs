const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const directory = path.join(__dirname, 'build/product')
const smoke = process.argv.includes('--smoke')
app.setPath('userData', path.join(__dirname, 'profile', `product-${process.pid}`))
app.on('window-all-closed', () => {})
let windowHandle
let server
const result = { recordedAt: new Date().toISOString(), rows: [], guests: [], failures: [], sourceHashes: JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) }
const timeout = setTimeout(() => { result.failures.push('Global 12 minute timeout'); finish(1) }, 720000)
function finish(code) {
  clearTimeout(timeout)
  fs.writeFileSync(path.join(__dirname, 'results', `product-${smoke ? 'smoke-' : ''}${Date.now()}.json`), JSON.stringify(result, null, 2))
  windowHandle?.destroy()
  server?.close()
  app.exit(code)
}
app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/guest') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Offline test</title><input aria-label="state"><p>Local browser fixture</p>'); return }
    const filename = path.join(directory, pathname === '/' ? 'index.html' : path.basename(pathname))
    if (!fs.existsSync(filename)) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') || filename.endsWith('.mjs') ? 'text/javascript' : 'text/html')
    response.end(fs.readFileSync(filename))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const browserSession of [session.defaultSession, session.fromPartition('product-fixture')]) {
    browserSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin + '/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') && details.url !== 'about:blank' }))
  }
  windowHandle = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false } })
  windowHandle.webContents.on('render-process-gone', (_event, details) => { result.failures.push(details); finish(1) })
  windowHandle.webContents.on('console-message', details => { if (details.level === 'error') { result.failures.push(details.message); console.log('Renderer:', details.message.slice(0, 300)) } })
  await windowHandle.loadURL(origin)
  windowHandle.showInactive()
  result.environment = { cpu: os.cpus()[0].model, totalMemoryGiB: os.totalmem() / 2 ** 30, versions: process.versions, gpu: app.getGPUFeatureStatus(), viewport: await windowHandle.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})') }
  const evaluate = expression => windowHandle.webContents.executeJavaScript(expression)
  const conditions = []
  for (const count of smoke ? [30] : [30, 100, 300]) {
    for (const action of smoke ? ['drag', 'mixed'] : ['drag', 'pan', 'zoom', 'stream', 'mixed']) {
      for (const variant of action === 'drag' ? ['immediate', 'frame-single', 'batch-only', 'optimized'] : ['immediate', 'optimized']) conditions.push({ count, action, variant })
    }
  }
  for (let repeat = 0; repeat < (smoke ? 1 : 5); repeat++) {
    const ordered = repeat % 2 ? [...conditions].reverse() : conditions
    for (const condition of ordered) {
      const row = await evaluate(`window.runProductCase(${JSON.stringify({ ...condition, frames: smoke ? 5 : 30 })})`)
      result.rows.push({ ...row, repeat })
      console.log(`PRODUCT ${result.rows.length}: ${condition.count} ${condition.action} ${condition.variant} ${row.frameP95.toFixed(1)}ms`)
    }
  }
  let guestCount = 0
  for (const target of smoke ? [1] : [1, 10, 50]) {
    while (guestCount < target) {
      if (os.freemem() < 2 * 2 ** 30) { result.guests.push({ target, guestCount, stopped: 'Less than 2 GiB system memory available; do not exhaust user machine' }); break }
      await evaluate(`window.addGuest(${guestCount})`)
      guestCount++
    }
    await new Promise(resolve => setTimeout(resolve, 400))
    const restored = await evaluate('window.verifyGuests()')
    const metrics = app.getAppMetrics()
    result.guests.push({ target, guestCount, restored, rendererProcesses: metrics.filter(metric => metric.type === 'Tab').length, workingSetMiB: metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024, freeSystemGiB: os.freemem() / 2 ** 30 })
    if (guestCount !== target) break
  }
  console.log(`PRODUCT DONE ${result.rows.length} rows; ${guestCount} guests; failures=${result.failures.length}`)
  finish(result.failures.length ? 1 : 0)
}).catch(error => { result.failures.push(String(error.stack || error)); console.error(error); finish(1) })
