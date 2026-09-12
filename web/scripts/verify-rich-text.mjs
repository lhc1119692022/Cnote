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
const { Editor } = require('@tiptap/core')
const { richTextExtensions, plainTextDocument, importMarkdownDocument } = load('lib/rich-text.ts')
const { RichTextEditor } = load('components/ui/rich-text-editor.tsx')
const imported = importMarkdownDocument('# 标题\n\n**粗体**和~~删除线~~\n\n- 列表\n\n> 引用\n\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |')
assert.equal(imported.format, 'tiptap-json')
assert(!('source' in imported))
const editor = new Editor({ extensions: richTextExtensions(), content: imported.json })
assert.match(editor.getHTML(), /<h1>标题<\/h1>/)
assert.match(editor.getHTML(), /<strong>粗体<\/strong>/)
assert.match(editor.getHTML(), /<s>删除线<\/s>/)
assert.match(editor.getHTML(), /<table/)
const saved = JSON.parse(JSON.stringify(imported))
const reopened = new Editor({ extensions: richTextExtensions(), content: saved.json })
assert.deepEqual(reopened.getJSON(), editor.getJSON())
editor.commands.setContent(plainTextDocument('**字面文本**').json)
assert(!editor.getHTML().includes('<strong>'))
editor.commands.setContent('<p><a href="javascript:alert(1)">危险链接</a><script>alert(1)</script>正文</p>')
assert(!editor.getHTML().includes('javascript:'))
assert(!editor.getHTML().includes('<script>'))
editor.destroy()
reopened.destroy()

let lastDocument
let commits = 0
function Harness() {
  const [doc, setDoc] = React.useState(plainTextDocument('测试文字'))
  return React.createElement(React.Fragment, null,
    React.createElement(RichTextEditor, { value: doc.plainText, document: doc, onChange: (_, next) => { lastDocument = next; setDoc(JSON.parse(JSON.stringify(next))) }, onCommit: () => { commits += 1 } }),
    React.createElement(RichTextEditor, { value: doc.plainText, document: doc, editable: false, toolbar: false }),
  )
}
const root = createRoot(document.getElementById('app'))
await act(async () => { root.render(React.createElement(Harness)); await new Promise(resolve => setTimeout(resolve, 30)) })
const editing = document.querySelector('.cnote-rich-text').editor
await act(async () => { editing.commands.setTextSelection({ from: 1, to: 5 }) })
await act(async () => { document.querySelector('button[aria-label="粗体"]').click() })
assert.equal(document.querySelectorAll('.cnote-rich-text strong').length, 2, 'both views reflect format-only updates')
assert.equal(lastDocument.plainText, '测试文字')
assert.equal(lastDocument.format, 'tiptap-json')
assert(!('source' in lastDocument))
assert.equal(editing.state.selection.from, 1, 'selection does not reset after store update')
await act(async () => { document.querySelector('button[aria-label="撤销"]').click() })
assert.equal(document.querySelectorAll('.cnote-rich-text strong').length, 0)
await act(async () => { document.querySelector('button[aria-label="重做"]').click() })
assert.equal(document.querySelectorAll('.cnote-rich-text strong').length, 2)
await act(async () => { editing.commands.insertContent('中文输入') })
assert.match(lastDocument.plainText, /中文输入/)
assert.equal(document.querySelectorAll('textarea').length, 0)
await act(async () => {
  editing.commands.selectAll()
  editing.view.someProp('handlePaste', handler => handler(editing.view, {
    clipboardData: { files: [], getData: type => type === 'text/plain' ? '# 粘贴标题\n\n**粘贴粗体**' : '' },
    preventDefault() {},
  }))
})
assert.match(editing.getHTML(), /<h1>粘贴标题<\/h1>/)
assert.match(editing.getHTML(), /<strong>粘贴粗体<\/strong>/)
await act(async () => { document.dispatchEvent(new window.Event('cnote:flush-node-editors')) })
assert.equal(commits, 1, 'flush saves dirty content')
await act(async () => { editing.commands.insertContent('保存') })
await act(async () => root.unmount())
assert.equal(commits, 2, 'unmount saves subsequent changes')
dom.window.close()
console.log('rich text: JSON persistence, import, formatting, two-view sync, selection, undo/redo, Chinese text, URL safety: PASS')
