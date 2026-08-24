const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const [logoPath, outputPath] = process.argv.slice(2)
const sizes = [16, 32, 48, 64, 128, 256]

app.disableHardwareAcceleration()

if (!logoPath || !outputPath) {
  throw new Error('Usage: render-logo-pngs.cjs <logo.svg> <output.json>')
}
if (path.resolve(logoPath) === path.resolve(outputPath)) {
  throw new Error('Logo renderer refuses to overwrite its SVG input.')
}
if (!/<svg\b/i.test(fs.readFileSync(logoPath, 'utf8'))) {
  throw new Error(`Logo renderer input is not an SVG: ${logoPath}`)
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    width: 1024,
    height: 1024,
    webPreferences: { sandbox: true },
  })
  await window.loadFile(logoPath)
  await window.webContents.insertCSS('html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const source = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  window.destroy()

  const images = Object.fromEntries(sizes.map((size) => [
    String(size), source.resize({ width: size, height: size, quality: 'best' }).toPNG().toString('base64'),
  ]))
  fs.writeFileSync(outputPath, JSON.stringify(images), 'utf8')
  app.quit()
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  app.exit(1)
})
