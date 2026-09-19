const { app, BrowserWindow } = require('electron')
const base = process.argv[2]
app.setPath('userData', process.argv[3])
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await window.loadURL(`${base}/__media-test`)
    const result = await window.webContents.executeJavaScript(`import('/scripts/helpers/media-runtime-cases.ts').then(module => module.runMediaRuntimeCases())`)
    console.log(JSON.stringify(result, null, 2))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
