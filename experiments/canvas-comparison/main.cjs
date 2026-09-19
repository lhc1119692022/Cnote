const { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

app.setPath('userData', path.join(__dirname, 'profile', `run-${process.pid}`))
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const smoke = process.argv.includes('--smoke')
const selectedGroup = process.argv.find(value => value.startsWith('--group='))?.split('=')[1]
const windowed = process.argv.includes('--windowed')
const jobs = new Map()
const utilityPending = new Map()
const token = crypto.randomBytes(24).toString('hex')
const now = () => performance.timeOrigin + performance.now()
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let windowHandle
let utilityHandle
let server
let baseUrl

async function readPacket(job) {
  if (job.cancelled || job.sequence >= job.count) return null
  const target = job.startedAt + (job.rate ? job.sequence * 1000 / job.rate : 0)
  if (target > now()) await delay(target - now())
  if (job.cancelled) return null
  const sequence = job.sequence++
  return Buffer.from(JSON.stringify({ sequence, sentAt: now(), text: job.text }) + '\n')
}

function createJob(input) {
  const id = crypto.randomUUID()
  const job = { id, ...input, sequence: 0, startedAt: now() + 30, text: '汉😀'.repeat(Math.ceil(input.bytes / 7)), cancelled: false }
  jobs.set(id, job)
  return job
}

function channelPump(job, port) {
  let credits = 0
  let pumping = false
  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (credits > 0 && !job.cancelled) {
        credits--
        const packet = await readPacket(job)
        if (!packet) { port.postMessage({ done: true }); jobs.delete(job.id); break }
        port.postMessage({ bytes: packet })
      }
    } finally { pumping = false }
  }
  port.on('message', ({ data }) => { credits += data.credit || 0; void pump() })
  port.start()
}

function createCases() {
  const cases = []
  const repetitions = smoke ? 1 : 5
  const frames = smoke ? 12 : 45
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const count of smoke ? [30] : [100, 300]) {
      for (const variant of ['current-model', 'shared-transform', 'reactflow-11', 'reactflow-lifted', 'production-current']) {
        for (const action of smoke ? ['zoom'] : ['pan', 'zoom', 'drag']) cases.push({ group: 'engine', variant, count, action, repeat, frames })
      }
      for (const variant of ['zoom', 'transform']) {
        for (const action of smoke ? ['zoom'] : ['pan', 'zoom']) cases.push({ group: 'scale', variant, count, action, repeat, frames })
      }
      for (const variant of ['plain', 'gradient', 'noise', 'combined']) cases.push({ group: 'material', variant, count, action: 'pan', repeat, frames })
    }
    for (const count of smoke ? [30] : [12, 24, 100, 300]) {
      for (const heavy of smoke ? [false] : [false, true]) {
        for (const variant of ['current-pin', 'all', 'threshold24-global', 'adaptive-pin']) cases.push({ group: 'virtual', variant, count, heavy, repeat, frames })
      }
    }
    for (const rate of smoke ? [200] : [20, 60, 200, 0]) {
      for (const bytes of smoke ? [128] : [128, 4096]) {
        for (const variant of ['ipc-pull', 'message-port', 'http']) cases.push({ group: 'transport', variant, rate, bytes, count: rate ? Math.max(12, Math.round(rate * 0.3)) : 256, repeat })
      }
    }
    for (const megabytes of smoke ? [1] : [0.1, 1, 8, 32]) {
      for (const variant of ['renderer', 'worker', 'utility']) cases.push({ group: 'isolation', variant, megabytes, repeat })
    }
    for (const count of smoke ? [30] : [100, 300]) {
      for (const variant of ['production-current', 'production-batched']) cases.push({ group: 'production-update', variant, count, action: 'drag', repeat, frames })
      for (const heavy of smoke ? [true] : [false, true]) {
        for (const variant of ['current-pin', 'all', 'threshold24-global', 'adaptive-pin']) cases.push({ group: 'virtual-steady', variant, count, heavy, repeat, frames })
      }
    }
  }
  let seed = 190926
  for (let index = cases.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const target = seed % (index + 1)
    ;[cases[index], cases[target]] = [cases[target], cases[index]]
  }
  return selectedGroup ? cases.filter(item => item.group === selectedGroup) : cases
}

async function start() {
  await app.whenReady()
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, baseUrl || 'http://127.0.0.1')
    if (url.pathname === '/stream') {
      if (request.headers['x-bench-token'] !== token || (request.headers.origin && request.headers.origin !== baseUrl)) { response.writeHead(403); response.end(); return }
      const job = jobs.get(url.searchParams.get('id'))
      if (!job) { response.writeHead(404); response.end(); return }
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
      response.on('close', () => { job.cancelled = true; jobs.delete(job.id) })
      let packet
      while ((packet = await readPacket(job))) {
        if (!response.write(packet)) await new Promise(resolve => {
          const finish = () => { response.removeListener('drain', finish); response.removeListener('close', finish); resolve() }
          response.once('drain', finish)
          response.once('close', finish)
        })
      }
      response.end()
      return
    }
    if (url.pathname === '/guest') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><body style="margin:0"><button id="button" style="position:absolute;left:30px;top:25px;width:160px;height:45px" onclick="window.clicks=(window.clicks||0)+1">Guest click</button><input id="input" style="position:absolute;left:30px;top:90px;width:160px" value="preserved"><script>window.clicks=0</script></body></html>')
      return
    }
    const file = path.join(__dirname, 'build', url.pathname === '/' ? 'index.html' : path.basename(url.pathname))
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  utilityHandle = utilityProcess.fork(path.join(__dirname, 'utility.cjs'), [], { stdio: 'pipe', serviceName: 'Cnote isolated benchmark' })
  utilityHandle.on('message', data => { utilityPending.get(data.id)?.(data); utilityPending.delete(data.id) })
  windowHandle = new BrowserWindow({ width: 1440, height: 900, title: 'Cnote isolated comparison — synthetic data', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: false, offscreen: !windowed } })
  if (windowed) windowHandle.showInactive()
  if (!windowed) windowHandle.webContents.setFrameRate(60)
  let paintCount = 0
  windowHandle.webContents.on('paint', () => { paintCount++ })
  windowHandle.webContents.on('console-message', (_event, details) => { if (details?.level === 'error') console.error('Renderer:', details.message) })
  windowHandle.webContents.on('render-process-gone', (_event, details) => { console.error(details); app.exit(2) })
  windowHandle.webContents.debugger.attach('1.3')
  ipcMain.handle('bench:metrics', async () => {
    const metrics = await windowHandle.webContents.debugger.sendCommand('Performance.getMetrics')
    return { ...Object.fromEntries(metrics.metrics.map(item => [item.name, item.value])), paintCount }
  })
  ipcMain.handle('bench:prepare', (event, input) => {
    const job = createJob(input)
    if (input.variant === 'message-port') {
      const { port1, port2 } = new MessageChannelMain()
      job.port = port1
      channelPump(job, port1)
      event.sender.postMessage('bench:port', { id: job.id }, [port2])
    }
    return { id: job.id, url: `${baseUrl}/stream?id=${job.id}`, token }
  })
  ipcMain.handle('bench:read', async (_event, id) => {
    const job = jobs.get(id)
    if (!job) return null
    const packet = await readPacket(job)
    if (!packet) jobs.delete(id)
    return packet ? Array.from(packet) : null
  })
  ipcMain.handle('bench:cancel', (_event, id) => {
    const job = jobs.get(id)
    if (job) { job.cancelled = true; job.port?.close(); jobs.delete(id) }
    return { outstanding: jobs.size }
  })
  ipcMain.handle('bench:utility', (_event, entities) => new Promise(resolve => {
    const id = crypto.randomUUID()
    utilityPending.set(id, resolve)
    utilityHandle.postMessage({ id, entities })
  }))
  ipcMain.handle('bench:click', async (_event, point) => {
    await windowHandle.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await windowHandle.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  })
  await windowHandle.loadURL(baseUrl)
  await windowHandle.webContents.debugger.sendCommand('Performance.enable')
  console.log('Fixture loaded; warming up')
  const evaluate = expression => windowHandle.webContents.executeJavaScript(expression)
  if (!await evaluate('Boolean(window.runCase)')) throw new Error('Fixture did not initialize')
  const sourceHashes = Object.fromEntries(['main.cjs', 'run.mjs', 'fixture.jsx', 'fixture.css', 'preload.cjs', 'utility.cjs', 'processor.cjs', 'package-lock.json'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]))
  const result = { recordedAt: new Date().toISOString(), smoke, seed: 190926, sourceHashes, environment: { platform: process.platform, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramGiB: os.totalmem() / 2 ** 30, versions: process.versions, gpu: await app.getGPUInfo('basic'), gpuFeatures: app.getGPUFeatureStatus(), viewport: await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState})'), renderer: `${windowed ? 'normal window (showInactive)' : 'offscreen 60Hz'}; requested 1440x900; backgroundThrottling=false; production React` }, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim(), rows: [], failures: [], capabilities: [] }
  const destination = path.join(__dirname, 'results/latest.json')
  const save = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await fs.promises.writeFile(destination, JSON.stringify(result, null, 2)); return }
      catch (error) { if (attempt === 3) throw error; await delay(50 * (attempt + 1)) }
    }
  }
  await evaluate('window.warmup()')
  const cases = createCases()
  for (const [index, input] of cases.entries()) {
    try {
      const row = await evaluate(`window.runCase(${JSON.stringify(input)})`)
      result.rows.push({ ...input, ...row })
      if (row.correct === false) result.failures.push({ input, message: 'correctness assertion failed', row })
    } catch (error) { result.failures.push({ input, message: String(error) }) }
    await save()
    if (index % 10 === 0 || index === cases.length - 1) console.log(`BENCH ${index + 1}/${cases.length} ${input.group} ${input.variant}; failures=${result.failures.length}`)
  }
  result.capabilities.push(await evaluate('window.checkCapabilities()'))
  result.transportChecks = await evaluate('window.checkTransport()')
  result.animation = await evaluate('window.compareAnimations()')
  result.httpUnauthorizedStatus = (await fetch(`${baseUrl}/stream?id=invalid`)).status
  result.httpWrongOriginStatus = (await fetch(`${baseUrl}/stream?id=invalid`, { headers: { 'X-Bench-Token': token, Origin: 'https://untrusted.invalid' } })).status
  result.outstandingJobs = jobs.size
  result.paintCount = paintCount
  result.completedAt = new Date().toISOString()
  await save()
  fs.copyFileSync(destination, path.join(__dirname, 'results', `${smoke ? 'smoke' : selectedGroup || 'full'}${windowed ? '-windowed' : ''}-${Date.now()}.json`))
  console.log(`FINISHED rows=${result.rows.length} failures=${result.failures.length} paints=${paintCount}`)
  windowHandle.destroy()
  utilityHandle.kill()
  await new Promise(resolve => server.close(resolve))
  app.exit(result.failures.length ? 1 : 0)
}

start().catch(error => { console.error(error); utilityHandle?.kill(); server?.close(); app.exit(2) })
