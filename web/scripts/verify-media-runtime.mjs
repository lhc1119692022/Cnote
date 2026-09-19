import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('../../desktop/node_modules/electron')
const root = fileURLToPath(new URL('../', import.meta.url))
const userData = await mkdtemp(join(tmpdir(), 'cnote-media-runtime-'))
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{ name: 'media-test-surface', configureServer(instance) {
    instance.middlewares.use('/__media-test', (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><body>Media runtime tests</body></html>')
    })
  } }],
})
try {
  await server.listen()
  const address = server.httpServer.address()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.__COMPAT_LAYER
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [fileURLToPath(new URL('./helpers/media-runtime-electron.cjs', import.meta.url)), `http://127.0.0.1:${address.port}`, userData, `--user-data-dir=${userData}`, '--enable-logging=stderr'], { env: { ...env, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    const timer = setTimeout(() => { child.kill(); reject(new Error('Media runtime tests timed out')) }, 180_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
  if (exitCode !== 0) { console.error(`Electron media runtime exited with code ${exitCode}`); process.exitCode = 1 }
} finally { await server.close() }
