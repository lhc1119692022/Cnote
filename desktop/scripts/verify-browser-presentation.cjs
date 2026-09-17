const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 60000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, webContents } = require('electron')
const { applyBrowserPresentation } = require('../dist/runtime/browser-presentation.js')
const { configureBrowserGuests } = require('../dist/runtime/browser-guest.js')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cnote-presentation-test-')))
const pause = () => new Promise(resolve => setTimeout(resolve, 100))
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<html><body style="margin:0;height:2000px"><button style="position:absolute;left:40px;top:40px;width:80px;height:40px" onclick="window.clicks=(window.clicks||0)+1">hit</button><p>Capture text</p></body></html>')
})
const timeout = setTimeout(() => { console.error('Browser presentation timed out'); app.exit(2) }, 50000)
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const host = new BrowserWindow({ show: false, width: 4000, height: 2400, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
  configureBrowserGuests(host.webContents)
  const popup = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:cnote-browser' } })
  await popup.loadURL(url)
  await host.loadURL('data:text/html,<body style="margin:0"></body>')
  const ids = await host.webContents.executeJavaScript(`(async () => {
    const guests = [];
    for (let index = 0; index < 2; index++) {
      const guest = document.createElement("webview");
      guest.id = "guest-" + index;
      guest.setAttribute("partition", "persist:cnote-browser");
      guest.style.cssText = "width:800px;height:500px";
      const ready = new Promise(resolve => guest.addEventListener("dom-ready", resolve, {once:true}));
      guest.src = ${JSON.stringify(url)}; document.body.append(guest); await ready; guests.push(guest);
    }
    return guests.map(guest => guest.getWebContentsId());
  })()`)
  const guest = webContents.fromId(ids[0])
  const sibling = webContents.fromId(ids[1])
  guest.setBackgroundThrottling(false)
  assert.equal(await guest.executeJavaScript('typeof require'), 'undefined')
  assert.equal(await guest.executeJavaScript('typeof window.cnoteDesktop'), 'undefined')
  await guest.executeJavaScript('document.cookie = "presentation_session=shared; path=/"')
  assert.throws(() => applyBrowserPresentation(popup.webContents, guest, {width:800,height:500,scale:1}), /belong/)
  for (const input of [null, {width:NaN,height:500,scale:1}, {width:800,height:500,scale:0.09}, {width:800,height:500,scale:4.1}]) {
    assert.throws(() => applyBrowserPresentation(host.webContents, guest, input))
  }
  for (const scale of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    await host.webContents.executeJavaScript(`document.getElementById("guest-0").style.cssText = "width:${800 * scale}px;height:${500 * scale}px"`)
    applyBrowserPresentation(host.webContents, guest, {width:800,height:500,scale})
    await pause()
    assert.equal(await guest.executeJavaScript('innerWidth'), 800, `logical width at ${scale}`)
    assert.equal(await guest.executeJavaScript('innerHeight'), 500, `logical height at ${scale}`)
    assert.equal(guest.getZoomFactor(), 1)
    assert.equal(sibling.getZoomFactor(), 1)
    assert.equal(await sibling.executeJavaScript('innerWidth'), 800)
    assert.equal(popup.webContents.getZoomFactor(), 1)
    assert.match(await popup.webContents.executeJavaScript('document.cookie'), /presentation_session=shared/)
    await guest.executeJavaScript('window.clicks = 0')
    guest.sendInputEvent({type:'mouseDown',x:Math.round(80 * scale),y:Math.round(60 * scale),button:'left',clickCount:1})
    guest.sendInputEvent({type:'mouseUp',x:Math.round(80 * scale),y:Math.round(60 * scale),button:'left',clickCount:1})
    await pause()
    assert.equal(await guest.executeJavaScript('window.clicks'), 1, `scaled button hit at ${scale}`)
    assert.match(await guest.executeJavaScript('document.body.innerText'), /Capture text/)
  }
  await guest.loadURL(url + 'next')
  applyBrowserPresentation(host.webContents, guest, {width:640,height:360,scale:0.5})
  await pause()
  assert.equal(await guest.executeJavaScript('innerWidth'), 640)
  assert.equal(await guest.executeJavaScript('innerHeight'), 360)
  assert.match(await guest.executeJavaScript('document.cookie'), /presentation_session=shared/)
  assert.equal(popup.webContents.getZoomFactor(), 1)
  const frameNavigation = await host.webContents.executeJavaScript(`(async () => {
    const view = document.getElementById("guest-0");
    const nextNavigation = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { view.removeEventListener("did-navigate-in-page", listener); reject(new Error("Frame navigation timed out")); }, 5000);
      const listener = event => { clearTimeout(timer); view.removeEventListener("did-navigate-in-page", listener); resolve({url:event.url,isMainFrame:event.isMainFrame}); };
      view.addEventListener("did-navigate-in-page", listener);
    });
    await view.executeJavaScript('(async () => { const frame = document.createElement("iframe"); frame.id = "navigation-child"; const ready = new Promise(resolve => frame.onload = resolve); frame.src = "/child"; document.body.append(frame); await ready; })()');
    const childNavigation = nextNavigation();
    await view.executeJavaScript('document.getElementById("navigation-child").contentWindow.location.hash = "child-anchor"');
    const child = await childNavigation;
    const mainNavigation = nextNavigation();
    await view.executeJavaScript('location.hash = "main-anchor"');
    return {child,main:await mainNavigation};
  })()`);
  assert.equal(frameNavigation.child.isMainFrame, false);
  assert.match(frameNavigation.child.url, /child#child-anchor$/);
  assert.equal(frameNavigation.main.isMainFrame, true);
  assert.match(frameNavigation.main.url, /next#main-anchor$/);
  clearTimeout(timeout)
  server.close()
  console.log('Browser presentation: seven zoom tiers, native guest hit mapping, sibling/popup isolation, capture text, ownership and subframe navigation: PASS')
  app.exit(0)
}).catch(error => { console.error(error); server.close(); app.exit(1) })
