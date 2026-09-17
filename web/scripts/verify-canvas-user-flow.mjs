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
const addedKinds = []
let providerCalls = 0
let finishResponse
let lastProviderRequest
const fakeAIState = { apiKeys: [{ id: 'qa-channel', name: 'Test only', providerId: 'custom', modelIds: ['qa-model'] }], getAPIKey: () => 'fixture-not-a-key', createClientForChannel: () => ({ complete: request => { lastProviderRequest = request; providerCalls++; return new Promise(resolve => { finishResponse = resolve }) } }) }
const mocks = {
  '@/stores/use-ai-store': { useAIStore: selector => selector(fakeAIState) },
  '@/lib/api': { getProvider: () => ({ protocol: 'chatCompletions' }), getAIModelCapabilities: () => ({ webSearch: 'supported', reasoningLevels: ['low', 'medium', 'high'] }), adaptReasoningLevel: (_, level) => level },
  '@/canvas/components/CanvasProvider': { useCanvas: () => ({ containerSize: { width: 1440, height: 900 }, hoveredNodeId: null, setHoveredNode() {}, resizing: null, draggingNodeIds: [], worldToScreen: point => point, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], selection: [] }) },
  '@/canvas/content-import-adapter': {},
  '@/lib/content-import': {},
  '@/runtime': { AssetManager: class {} },
  '@/storage/asset-store': { assetIdForResource: value => value, loadAssetUrl: async id => id === 'fixture-image' ? 'data:image/png;base64,aW1hZ2U=' : null },
  '@/stores/use-source-store': { useSourceStore: Object.assign(selector => selector({ sources: [] }), { getState: () => ({ sources: [] }) }) },
  '@/canvas/node-factory': { addNodeAtClient: kind => addedKinds.push(kind), addLibrarySource() {} },
  '@/canvas/clipboard-import': { importDroppedFile: async () => {} },
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

function load(relative) {
  const filename = fileURLToPath(new URL('../src/' + relative, import.meta.url))
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (mocks[name]) return mocks[name]
    if (name.endsWith('.css')) return {}
    if (name.startsWith('@/') || name.startsWith('.')) {
      const path = name.startsWith('@/') ? name.slice(2) : join(dirname(relative), name).replaceAll('\\', '/')
      if (mocks['@/' + path]) return mocks['@/' + path]
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
const { useGraphStore } = load('stores/graph-store.ts')
const { useUiStore } = load('stores/ui-store.ts')
const { useRuntimeStore } = load('stores/runtime-store.ts')
const { AIContent } = load('canvas/contents/AIContent.tsx')
const { ContentContent } = load('canvas/contents/ContentContent.tsx')
const { CanvasExtensionPanel } = load('canvas/components/CanvasExtensionPanel.tsx')
const { minimapVisibleWorld, minimapWorldBounds } = load('canvas/minimap.ts')
for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
  for (const insets of [{ left: 0, right: 0 }, { left: 292, right: 0 }, { left: 292, right: 402 }]) {
    const visible = minimapVisibleWorld({ x: 300, y: -210, zoom }, { width: 1440, height: 920 }, insets)
    const { bounds, scale } = minimapWorldBounds(null, visible, { width: 272, height: 172 })
    assert.ok(Math.abs((visible.x + visible.width / 2 - bounds.x) * scale - 136) < 1e-8)
    assert.ok(Math.abs((visible.y + visible.height / 2 - bounds.y) * scale - 86) < 1e-8)
    assert.ok(visible.width * scale < 272 && visible.height * scale < 172)
    const content = { x: -500, y: 200, width: 540, height: 430 }
    const occupied = minimapWorldBounds(content, visible, { width: 272, height: 172 })
    const panned = minimapWorldBounds(content, { ...visible, x: visible.x + 500 }, { width: 272, height: 172 })
    assert.deepEqual(occupied, panned, 'populated world bounds do not chase viewport panning')
  }
}
const ai = { id: 'qa-ai', kind: 'ai', label: 'AI', position: { x: 0, y: 0 }, size: { width: 460, height: 510 }, prompt: '', channelId: 'qa-channel', model: 'qa-model' }
const textNode = { id: 'qa-text', kind: 'content', category: 'text', label: 'Text', position: { x: 600, y: 0 }, size: { width: 540, height: 430 }, content: 'Original text', payload: { kind: 'text', value: 'Original text', format: 'markdown' } }
useGraphStore.getState().openDocument({ id: 'qa', name: 'QA', nodes: [ai, textNode], edges: [{ id: 'upstream', source: textNode.id, target: ai.id }], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
useUiStore.getState().setShowExtensionPanel(true)
useGraphStore.getState().setSelection([ai.id])
function Harness() {
  const nodes = useGraphStore(state => state.currentDocument.nodes)
  return React.createElement('div', { 'data-cnote-canvas': true },
    React.createElement('div', { 'data-ai-toolbar': ai.id }),
    React.createElement('div', { id: 'inline-ai' }, React.createElement(AIContent, { node: nodes.find(node => node.id === ai.id) })),
    React.createElement('div', { id: 'inline-text' }, React.createElement(ContentContent, { node: nodes.find(node => node.id === textNode.id) })),
    React.createElement(CanvasExtensionPanel),
  )
}
const rootView = createRoot(document.getElementById('app'))
await act(async () => rootView.render(React.createElement(Harness)))
const toolbar = document.querySelector('[data-ai-toolbar]')
assert.ok(toolbar.querySelector('[aria-label="会话管理"]'))
assert.ok(toolbar.querySelector('[aria-label="系统提示词"]'))
assert.ok(toolbar.querySelector('[aria-label="选择模型"]'))
assert.equal(document.querySelectorAll('select[aria-label="联网搜索"]').length, 0)
assert.equal(document.querySelectorAll('#inline-text [aria-label="文本格式"]').length, 0)
assert.ok(document.querySelector('#inline-ai [aria-label="上游变量"]').className.includes('right-[calc(100%+20px)]'))
assert.equal(document.querySelectorAll('[role="textbox"][aria-label="输入提示词"]').length, 2, 'details panel uses a real composer')
await act(async () => toolbar.querySelector('[aria-label="AI 设置"]').click())
assert.equal(document.querySelectorAll('select[aria-label="联网搜索"]').length, 2)
assert.equal(document.querySelectorAll('select[aria-label="推理级别"]').length, 2)
const inline = document.getElementById('inline-ai')
const composer = inline.querySelector('[aria-label="输入提示词"]')
const search = inline.querySelector('select[aria-label="联网搜索"]')
assert.ok(composer.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING)
assert.ok(search.closest('div').querySelector('.ml-auto [aria-label="选择模型"]'))
await act(async () => { composer.textContent = 'QA chat'; composer.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
assert.equal(document.querySelector('[data-extension-panel] [aria-label="输入提示词"]').textContent, 'QA chat')
await act(async () => document.querySelector('[data-extension-panel] [aria-label="发送消息"]').click())
assert.equal(providerCalls, 1)
assert.ok([...document.querySelectorAll('[aria-label="发送消息"]')].every(button => button.disabled), 'both views share sending state')
assert.ok(inline.textContent.includes('QA chat'))
await act(async () => { finishResponse('## Fixture reply\n\n**粗体内容**与普通文本。\n\n- 列表项\n\n\x60\x60\x60js\nconst answer = 42\n\x60\x60\x60\n\n| 名称 | 值 |\n| --- | --- |\n| 示例 | 42 |'); await new Promise(resolve => setTimeout(resolve, 0)) })
assert.ok(inline.textContent.includes('Fixture reply'))
for (const view of [inline, document.querySelector('[data-extension-panel]')]) {
  const reply = view.querySelector('[data-ai-message-role="assistant"]')
  assert.equal(reply.querySelector('h2').textContent, 'Fixture reply')
  assert.equal(reply.querySelector('strong').textContent, '粗体内容')
  assert.ok(reply.querySelector('ul li'))
  assert.ok(reply.querySelector('pre code').textContent.includes('const answer = 42'))
  assert.ok(reply.querySelector('table'))
  assert.equal(reply.querySelector('[contenteditable="true"]'), null)
  assert.equal(reply.querySelector('[role="toolbar"]'), null)
}
assert.ok(document.querySelector('[data-extension-panel]').textContent.includes('Fixture reply'))
const firstSession = useGraphStore.getState().currentDocument.nodes.find(node => node.id === ai.id).activeSessionId
await act(async () => [...toolbar.querySelectorAll('button')].find(button => button.textContent === '新建会话').click())
const secondSession = useGraphStore.getState().currentDocument.nodes.find(node => node.id === ai.id).activeSessionId
assert.notEqual(firstSession, secondSession)
assert.equal(useRuntimeStore.getState().aiSessions[firstSession].nodeId, ai.id)
assert.equal(useRuntimeStore.getState().aiSessions[secondSession].nodeId, ai.id)
assert.equal(useRuntimeStore.getState().aiSessions[firstSession].messages.length, 2)
await act(async () => [...toolbar.querySelectorAll('button[aria-pressed]')].find(button => button.textContent === 'QA chat').click())
assert.equal(useGraphStore.getState().currentDocument.nodes.find(node => node.id === ai.id).activeSessionId, firstSession)
assert.ok(document.querySelector('[data-extension-panel]').textContent.includes('Fixture reply'))
await act(async () => useUiStore.getState().setNodeChrome(textNode.id, { settings: true }))
assert.ok(document.querySelector('#inline-text [aria-label="文本格式"]').classList.contains('flex-wrap'))
await act(async () => useGraphStore.getState().setSelection([textNode.id]))
const textPanel = document.querySelector('[data-extension-panel]')
assert.ok(textPanel.querySelector('[aria-label="文本格式"]').classList.contains('flex-wrap'))
assert.equal(textPanel.querySelectorAll('h3').length, 0)
assert.ok(!textPanel.querySelector('.cnote-rich-text').closest('.rounded-xl'))
await act(async () => useUiStore.getState().setNodeChrome(textNode.id, { settings: false }))
assert.equal(document.querySelectorAll('#inline-text [aria-label="文本格式"]').length, 0)
assert.ok(document.querySelector('#inline-text').textContent.includes('Original text'))
const imageNode = { id: 'image-input', kind: 'content', category: 'image', label: 'Logo.png', position: { x: 0, y: 0 }, size: { width: 540, height: 430 }, source: { kind: 'file', assetId: 'fixture-image', mimeType: 'image/png' } }
await act(async () => {
  const current = useGraphStore.getState().currentDocument
  useGraphStore.setState({ currentDocument: { ...current, nodes: [...current.nodes, imageNode], edges: [...current.edges, { id: 'image-edge', source: imageNode.id, target: ai.id }] } })
})
for (const value of ['识别上游图片', '{{node:image-input}} 识别此图片']) {
  await act(async () => { composer.textContent = value; composer.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  await act(async () => inline.querySelector('[aria-label="发送消息"]').click())
  const sentContent = lastProviderRequest.messages.at(-1).content
  assert.ok(Array.isArray(sentContent), 'actual send handler emits multimodal content')
  assert.equal(sentContent.filter(part => part.type === 'image').length, 1)
  assert.equal(sentContent.find(part => part.type === 'image').source.data, 'aW1hZ2U=')
  await act(async () => { finishResponse('Image fixture reply'); await new Promise(resolve => setTimeout(resolve, 0)) })
}
await act(async () => rootView.unmount())
const { CanvasAddMenu } = load('canvas/components/CanvasAddMenu.tsx')
const { NodeHoverToolbar } = load('canvas/components/NodeHoverToolbar.tsx')
const { StickyContent } = load('canvas/contents/StickyContent.tsx')
const sticky = { id: 'color-note', kind: 'sticky', label: '贴纸', color: 'yellow', content: '', position: { x: 400, y: 300 }, size: { width: 300, height: 240 } }
useGraphStore.getState().openDocument({ id: 'note-flow', name: 'Note', nodes: [sticky], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
function NoteHarness() {
  const node = useGraphStore(state => state.currentDocument.nodes[0])
  return React.createElement('div', null, React.createElement(NodeHoverToolbar, { node, selected: true }), React.createElement('div', { id: 'note-body' }, React.createElement(StickyContent, { node })))
}
const extraRoot = createRoot(document.getElementById('app'))
await act(async () => extraRoot.render(React.createElement(NoteHarness)))
assert.equal(document.querySelector('#note-body [aria-label="便签颜色"]'), null)
assert.equal(document.querySelectorAll('[aria-label="便签颜色"] button').length, 5)
await act(async () => document.querySelector('[aria-label="切换为蓝色便签"]').click())
assert.equal(useGraphStore.getState().currentDocument.nodes[0].color, 'blue')
assert.equal(document.querySelector('[aria-label="切换为蓝色便签"]').getAttribute('aria-pressed'), 'true')
await act(async () => useGraphStore.getState().undo())
assert.equal(useGraphStore.getState().currentDocument.nodes[0].color, 'yellow')
await act(async () => useGraphStore.getState().redo())
assert.equal(useGraphStore.getState().currentDocument.nodes[0].color, 'blue')
await act(async () => useGraphStore.setState({ isLocked: true }))
assert.ok([...document.querySelectorAll('[aria-label="便签颜色"] button')].every(button => button.disabled))
await act(async () => useGraphStore.setState({ isLocked: false }))
await act(async () => extraRoot.render(React.createElement(CanvasAddMenu, { menu: { x: 10, y: 10, clientX: 10, clientY: 10 }, container: null, onClose() {} })))
const menu = document.querySelector('[data-canvas-add-menu]')
assert.deepEqual([...menu.children].filter(element => element.tagName !== 'INPUT').map(element => element.getAttribute('role') === 'separator' ? 'separator' : element.textContent.trim()), ['添加内容节点', '添加 AI 节点', '添加请求体', '添加浏览器节点', 'separator', '添加贴纸', '导入文件', 'separator', '内容资料库'])
await act(async () => { for (const button of [...menu.querySelectorAll('button[role="menuitem"]')].slice(0, 5)) button.click() })
assert.deepEqual(addedKinds, ['content', 'ai', 'request', 'browser', 'sticky'])
const { GenerationActionButton } = load('canvas/components/GenerationActionButton.tsx')
const actions = []
const buttonProps = { running: false, waiting: false, elapsed: '0:00', disabled: false, onStart: () => actions.push('start'), onCancel: () => actions.push('cancel'), onResume: () => actions.push('resume') }
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, buttonProps)))
let actionButton = document.querySelector('[data-generation-action]')
assert.equal(document.querySelectorAll('button').length, 1)
assert.equal(actionButton.textContent, '')
assert.equal(actionButton.getAttribute('aria-label'), '开始生成')
await act(async () => actionButton.click())
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, running: true, elapsed: '0:10' })))
actionButton = document.querySelector('[data-generation-action]')
assert.equal(document.querySelectorAll('button').length, 1)
assert.ok(actionButton.textContent.includes('生成中 0:10'))
assert.ok(!actionButton.classList.contains('bg-destructive'))
await act(async () => actionButton.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })))
assert.ok(actionButton.classList.contains('bg-destructive'))
assert.ok([...actionButton.querySelectorAll('span')].some(span => span.textContent === '取消生成' && !span.classList.contains('invisible')))
await act(async () => actionButton.click())
await act(async () => actionButton.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
assert.ok(!actionButton.classList.contains('bg-destructive'))
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, running: true, elapsed: '0:11' })))
assert.ok(actionButton.textContent.includes('生成中 0:11'))
await act(async () => { actionButton.focus() })
assert.ok(actionButton.classList.contains('bg-destructive'), 'keyboard focus exposes cancellation')
await act(async () => { actionButton.blur() })
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, waiting: true })))
assert.equal(actionButton.textContent, '继续生成')
assert.equal(actionButton.getAttribute('aria-label'), '继续生成')
await act(async () => actionButton.click())
assert.deepEqual(actions, ['start', 'cancel', 'resume'])
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, disabled: true })))
await act(async () => actionButton.click())
assert.equal(actions.length, 3)
await act(async () => extraRoot.unmount())
const requestText = readFileSync(new URL('../src/canvas/contents/RequestContent.tsx', import.meta.url), 'utf8')
const requestTree = ts.createSourceFile('RequestContent.tsx', requestText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let chooseSource
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(requestTree) === 'chooseVariant') chooseSource = node.initializer.arguments[0].getText(requestTree); ts.forEachChild(node, visit) }
visit(requestTree)
for (const variant of ['image', 'video']) {
  const node = { id: 'request', variant: 'body', label: '请求体', image: { prompt: 'image draft' }, video: { prompt: 'video draft' } }
  let commits = 0
  const choose = vm.runInNewContext(ts.transpileModule('(' + chooseSource + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { node, isRunning: false, patchRequest: (_, patch) => Object.assign(node, patch), useGraphStore: { getState: () => ({ commitHistory: () => { commits++ } }) } })
  choose(variant)
  assert.equal(node.variant, variant)
  assert.equal(node.label, variant === 'image' ? '图片生成' : '视频生成')
  choose(variant === 'image' ? 'video' : 'image')
  choose('body')
  assert.equal(node.variant, variant, 'chosen generators cannot become another variant')
  assert.equal(commits, 1)
  assert.equal(node.image.prompt, 'image draft')
  assert.equal(node.video.prompt, 'video draft')
}
assert.ok(!requestText.includes('aria-label="生成变体"'))
assert.ok(!requestText.includes('mb-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground'))
const providerText = readFileSync(new URL('../src/canvas/components/CanvasProvider.tsx', import.meta.url), 'utf8')
assert.ok(providerText.includes('onDoubleClick='))
assert.ok(providerText.includes('radial-gradient(circle,'))
assert.ok(providerText.includes("backgroundSize: '24px 24px'"))
assert.ok(providerText.includes("backgroundPosition: '0px 0px'"))
const providerTree = ts.createSourceFile('CanvasProvider.tsx', providerText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let doubleClickSource
function findDoubleClick(node) { if (ts.isJsxAttribute(node) && node.name.getText(providerTree) === 'onDoubleClick') doubleClickSource = node.initializer.expression.getText(providerTree); ts.forEachChild(node, findDoubleClick) }
findDoubleClick(providerTree)
let openedMenu = null
let blockedTarget = false
const handler = vm.runInNewContext(ts.transpileModule('(' + doubleClickSource + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { toInput: () => ({ world: { x: 0, y: 0 } }), hitTestNode: () => blockedTarget, setContextMenu: () => {}, setAddMenu: value => { openedMenu = value } })
const event = { button: 0, clientX: 230, clientY: 180, target: { closest: () => false }, currentTarget: { getBoundingClientRect: () => ({ left: 30, top: 40 }) }, preventDefault() {} }
handler(event)
assert.deepEqual(JSON.parse(JSON.stringify(openedMenu)), { x: 200, y: 140, clientX: 230, clientY: 180 })
for (const kind of ['node', 'chrome', 'button']) {
  openedMenu = null
  handler({ ...event, target: { closest: () => kind } })
  assert.equal(openedMenu, null)
}
blockedTarget = true
handler(event)
assert.equal(openedMenu, null)
let generationControlsUses = 0
function inspectRequest(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(requestTree) === 'generationControls') {
    generationControlsUses++
    const row = node.parent
    assert.ok(row.getText(requestTree).includes('<GenerationActionButton'))
    assert.ok(row.getText(requestTree).includes('onCancel={cancelGeneration}'))
    assert.ok(row.getText(requestTree).includes('onResume={() => void resumeWaitingGeneration()}'))
    assert.ok(row.parent.getText(requestTree).includes('<textarea'))
  }
  ts.forEachChild(node, inspectRequest)
}
inspectRequest(requestTree)
assert.equal(generationControlsUses, 1, 'parameters have only one home: the composer action row')
const panelSource = readFileSync(new URL('../src/canvas/components/CanvasNodePanel.tsx', import.meta.url), 'utf8')
assert.ok(panelSource.includes('bottom-4 left-4 top-4'))
assert.ok(!panelSource.includes('top-16'))
console.log('User flow repairs: empty minimap centering, AI two-view chat/settings/sessions, text collection, generator identity, upstream image sends, Sticky palette, menu grouping, fixed grid, Markdown replies, unified generation action: PASS (mock provider; no native UI or network)')
