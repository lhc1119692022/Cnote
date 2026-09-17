import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
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
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? name.slice(2) : join(dirname(relative), name).replaceAll('\\', '/')
      const suffix = ['.ts', '.tsx', '/index.ts'].find((extension) => existsSync(new URL('../src/' + path + extension, import.meta.url)))
      return load(path + suffix)
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
const toolbar = document.querySelector('[role="toolbar"][aria-label="文本格式"]')
assert.ok(toolbar.classList.contains('flex-wrap'))
assert.ok(!toolbar.classList.contains('overflow-x-auto'))
assert.equal(toolbar.querySelectorAll('button').length, 16)
for (const button of toolbar.querySelectorAll('button')) {
  assert.ok(button.classList.contains('shrink-0'))
  assert.equal(button.title, button.getAttribute('aria-label'))
}
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
const { StickyContent } = load('canvas/contents/StickyContent.tsx')
const { useGraphStore } = load('stores/graph-store.ts')
const stickyDoc = { id: 'sticky-flow', name: 'Sticky QA', title: 'Sticky QA', viewport: { x: 0, y: 0, zoom: 1 }, edges: [], createdAt: 1, updatedAt: 1, nodes: [{ id: 'sticky', kind: 'sticky', label: '贴纸', content: '保留格式', color: 'yellow', background: 'solid', position: { x: 0, y: 0 }, size: { width: 300, height: 240 } }] }
useGraphStore.getState().openDocument(stickyDoc)
function StickyHarness() {
  const node = useGraphStore((state) => state.currentDocument.nodes[0])
  return React.createElement(StickyContent, { node })
}
const stickyRoot = createRoot(document.getElementById('app'))
await act(async () => { stickyRoot.render(React.createElement(StickyHarness)); await new Promise(resolve => setTimeout(resolve, 30)) })
assert.deepEqual([...document.querySelectorAll('[role="toolbar"] button')].map(button => button.getAttribute('aria-label')), ['撤销', '重做', '粗体', '斜体', '无序列表', '任务列表'])
assert.equal(document.querySelector('[aria-label="便签颜色"]'), null, 'colors belong to the hover capsule, not the Sticky body')
const stickyEditor = document.querySelector('.cnote-rich-text').editor
await act(async () => { stickyEditor.commands.selectAll(); document.querySelector('button[aria-label="粗体"]').click() })
const savedSticky = JSON.parse(JSON.stringify(useGraphStore.getState().currentDocument))
assert.equal(savedSticky.nodes[0].content, '保留格式')
assert.equal(savedSticky.nodes[0].document.json.content[0].content[0].marks[0].type, 'bold')
await act(async () => { document.dispatchEvent(new window.Event('cnote:flush-node-editors')) })
await act(async () => useGraphStore.getState().undo())
assert.equal(document.querySelector('.cnote-rich-text strong'), null, 'graph undo restores the unformatted Sticky')
await act(async () => useGraphStore.getState().redo())
assert.equal(document.querySelector('.cnote-rich-text strong').textContent, '保留格式', 'graph redo restores formatting without changing plain text')
await act(async () => useGraphStore.getState().duplicateNode('sticky'))
const duplicated = useGraphStore.getState().currentDocument.nodes[1]
assert.deepEqual(duplicated.document, savedSticky.nodes[0].document)
assert.notEqual(duplicated.document, useGraphStore.getState().currentDocument.nodes[0].document)
assert.equal(duplicated.position.x - (stickyDoc.nodes[0].position.x + stickyDoc.nodes[0].size.width), 40)
await act(async () => useGraphStore.getState().updateNode(duplicated.id, { content: '独立副本', document: plainTextDocument('独立副本') }))
assert.equal(document.querySelector('.cnote-rich-text strong').textContent, '保留格式', 'editing the copy leaves original formatting intact')
await act(async () => useGraphStore.getState().undo())
assert.equal(useGraphStore.getState().currentDocument.nodes.length, 1)
await act(async () => useGraphStore.getState().redo())
assert.deepEqual(useGraphStore.getState().currentDocument.nodes[1].document, savedSticky.nodes[0].document)
await act(async () => stickyRoot.unmount())
useGraphStore.setState({ currentDocument: savedSticky })
const reopenedRoot = createRoot(document.getElementById('app'))
await act(async () => { reopenedRoot.render(React.createElement(StickyHarness)); await new Promise(resolve => setTimeout(resolve, 30)) })
assert.equal(document.querySelector('.cnote-rich-text strong').textContent, '保留格式')
const selectedText = document.querySelector('.cnote-rich-text strong').firstChild
const selectVisibleText = () => {
  const range = document.createRange()
  range.selectNodeContents(selectedText)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
}
selectVisibleText()
await act(async () => document.querySelector('button[aria-label="粗体"]').dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
assert.equal(window.getSelection().toString(), '保留格式', 'own formatting toolbar preserves selection')
for (const target of [document.body, document.body.appendChild(document.createElement('div'))]) {
  selectVisibleText()
  await act(async () => target.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
  assert.equal(window.getSelection().rangeCount, 0, 'outside pointer clears selection before canvas prevents default')
}
await act(async () => reopenedRoot.unmount())
dom.window.close()
console.log('rich text: JSON persistence, import, formatting, two-view sync, selection, undo/redo, Chinese text, URL safety: PASS')
