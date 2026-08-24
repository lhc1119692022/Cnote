const port = Number(process.env.CNOTE_DEVTOOLS_PORT || 9223)

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
if (!bodyText.includes('创建 Flow') || !bodyText.includes('控制台')) {
  throw new Error(`Packaged renderer did not mount the Cnote workspace. Body text: ${bodyText.slice(0, 500)}`)
}

const smokeId = `smoke-native-view-${Date.now()}`
await evaluate(`window.cnoteDesktop.browser.createSession({id:${JSON.stringify(smokeId)},name:'Smoke',persistent:false,url:'about:blank'})`)
await evaluate(`window.cnoteDesktop.browser.mountSession(${JSON.stringify(smokeId)},{x:0,y:0,width:320,height:240})`)
const mounted = await evaluate(`window.cnoteDesktop.browser.listSessions().then((items) => items.find((item) => item.id === ${JSON.stringify(smokeId)}))`)
if (!mounted || mounted.presentation !== 'embedded' || !mounted.visible) {
  throw new Error(`Native browser session was not embedded: ${JSON.stringify(mounted)}`)
}

const capture = await evaluate(`window.cnoteDesktop.browser.capture(${JSON.stringify(smokeId)})`)
if (capture?.url !== 'about:blank' || typeof capture?.html !== 'string') {
  throw new Error(`Native browser capture failed: ${JSON.stringify(capture)}`)
}

await evaluate(`window.cnoteDesktop.browser.unmountSession(${JSON.stringify(smokeId)})`)
const closeResult = await evaluate(`Promise.race([window.cnoteDesktop.browser.closeSession(${JSON.stringify(smokeId)}).then(() => 'closed'), new Promise((resolve) => setTimeout(() => resolve('timeout'), 1_000))])`)
if (closeResult !== 'closed') {
  throw new Error(`Native browser session close did not complete: ${closeResult}`)
}
socket.close()
console.log('Packaged renderer and embedded native browser smoke test passed.')
