import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://cnote.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLInputElement', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof dom.window[key] === 'function' && key.includes('AnimationFrame') ? dom.window[key].bind(dom.window) : dom.window[key] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
const require = createRequire(import.meta.url)
const cache = new Map()
function load(relative) {
  const filename = fileURLToPath(new URL('../src/' + relative, import.meta.url))
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.endsWith('.css')) return {}
    if (name.startsWith('@/')) {
      const path = name.slice(2)
      return load(path + (existsSync(new URL('../src/' + path + '.ts', import.meta.url)) ? '.ts' : '.tsx'))
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { Dialog } = load('components/ui/dialog.tsx')
const { AppDialogHost } = load('components/ui/app-dialog-host.tsx')
const { askConfirmation, showMessage } = load('lib/app-dialog.ts')
const outside = document.createElement('button')
outside.textContent = 'outside'
document.body.append(outside)
let setOpen
function Harness() {
  const [open, updateOpen] = React.useState(false)
  setOpen = updateOpen
  return React.createElement(React.Fragment, null,
    React.createElement(Dialog, { open, onOpenChange: updateOpen }, React.createElement('input', { 'aria-label': '测试输入' })),
    React.createElement(AppDialogHost),
  )
}
const root = createRoot(document.getElementById('app'))
await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))))
for (let cycle = 0; cycle < 4; cycle++) {
  outside.focus()
  await act(async () => setOpen(true))
  const input = document.querySelector('[aria-label="测试输入"]')
  assert.equal(document.activeElement, input)
  outside.focus()
  assert.equal(document.activeElement, input, 'background cannot take focus')
  let result
  await act(async () => { result = askConfirmation('确认删除？') })
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 2)
  await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === '取消').click() })
  assert.equal(await result, false)
  assert.equal(document.activeElement, input, 'nested cancellation restores input')
  await act(async () => { result = askConfirmation('确认删除？') })
  await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === '确定').click() })
  assert.equal(await result, true)
  await act(async () => { showMessage('第一条'); showMessage('第二条') })
  assert.match(document.body.textContent, /第一条/)
  await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === '确定').click() })
  assert.match(document.body.textContent, /第二条/)
  await act(async () => { Array.from(document.querySelectorAll('button')).find(button => button.textContent === '确定').click() })
  assert.equal(document.activeElement, input)
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0)
  assert.equal(document.activeElement, outside)
}
await act(async () => root.unmount())
dom.window.close()
console.log('Dialog lifecycle: strict mode, first/repeated open, focus containment/restore, nested confirmation, cancel/accept, queued messages, Escape: PASS')
