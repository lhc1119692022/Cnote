import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/canvas/contents/BrowserContent.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('BrowserContent.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'attachWebview') callback = node.initializer.arguments[0].getText(tree)
  ts.forEachChild(node, visit)
}
visit(tree)
const handlers = new Map()
let state = {}
let error = ''
const listenersRef = { current: null }
const context = {
  listenersRef, webviewRef: { current: null }, sessionId: 'session', tabId: 'tab', initialSrcRef: { current: 'https://example.com' },
  DEFAULT_BROWSER_URL: 'https://example.com', WEBVIEW_PARTITION: 'test', browserViewId: () => 'browser',
  useRuntimeStore: { getState: () => ({ updateTab: (_session, _tab, patch) => { state = { ...state, ...patch } } }) },
  setWebviewReady() {}, setNativeError(value) { error = value }, syncNativeNav() {}, eventUrl: () => 'https://example.com', errorMessage: value => value,
}
const attach = vm.runInNewContext(ts.transpileModule('(' + callback + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
attach({ getAttribute: () => 'value', setAttribute() {}, style: {}, getTitle: () => 'Page', addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: name => handlers.delete(name) })
handlers.get('did-start-navigation')({ isMainFrame: true })
assert.equal(state.status, 'loading')
handlers.get('did-stop-loading')({})
assert.equal(state.status, 'ready')
for (const event of [{ isMainFrame: false }, { isMainFrame: true, isInPlace: true }]) {
  handlers.get('did-start-navigation')(event)
  assert.equal(state.status, 'ready', 'subframes and in-page navigation do not overlay existing page')
}
handlers.get('did-start-navigation')({ isMainFrame: true })
handlers.get('did-fail-load')({ isMainFrame: true, errorCode: -105, errorDescription: 'DNS failed' })
handlers.get('did-stop-loading')({})
assert.equal(state.status, 'error')
assert.equal(error, 'DNS failed')
handlers.get('did-start-navigation')({ isMainFrame: true })
handlers.get('did-fail-load')({ isMainFrame: true, errorCode: -3 })
handlers.get('did-stop-loading')({})
assert.equal(state.status, 'ready', 'aborted navigation does not leave loading stuck')
listenersRef.current()
assert.equal(handlers.size, 0)

const module = { exports: {} }
const headersSource = readFileSync(new URL('../../desktop/src/runtime/youtube-embed.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(headersSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: module.exports, URL })
const { youtubeEmbedHeaders } = module.exports
const request = { webContentsId: 5, resourceType: 'subFrame', url: 'https://www.youtube-nocookie.com/embed/abc', requestHeaders: {} }
assert.equal(youtubeEmbedHeaders(5, request).Referer, 'https://com.cnote.desktop/')
for (const patch of [{ webContentsId: 6 }, { resourceType: 'mainFrame' }, { url: 'https://example.com/embed/abc' }, { url: 'https://www.youtube.com/watch?v=abc' }]) assert.deepEqual(Object.keys(youtubeEmbedHeaders(5, { ...request, ...patch })), [])
assert.equal(youtubeEmbedHeaders(5, { ...request, requestHeaders: { Referer: 'https://existing.example/' } }).Referer, 'https://existing.example/')
assert.equal(youtubeEmbedHeaders(5, { ...request, requestHeaders: { referer: 'file:///private/path' } }).Referer, 'https://com.cnote.desktop/')
console.log('Browser navigation feedback and scoped YouTube embed identification: PASS (no native UI/network)')
