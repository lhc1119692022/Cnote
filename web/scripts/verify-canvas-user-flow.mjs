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
let pushResponse
let lastProviderSignal
let finishResponse
let lastProviderRequest
const fakeAIState = { apiKeys: [{ id: 'qa-channel', name: 'Test only', providerId: 'custom', modelIds: ['qa-model'] }], getAPIKey: () => 'fixture-not-a-key', createClientForChannel: () => ({ async *completeStream(request, signal) {
  lastProviderRequest = request
  lastProviderSignal = signal
  providerCalls++
  const queued = []
  let done = false
  let wake = () => {}
  pushResponse = value => { queued.push(value); wake() }
  finishResponse = value => { queued.push(value); done = true; wake() }
  const stop = () => { done = true; wake() }
  signal.addEventListener('abort', stop, { once: true })
  try {
    while (!signal.aborted) {
      if (queued.length) yield queued.shift()
      else if (done) return
      else await new Promise(resolve => { wake = resolve })
    }
  } finally { signal.removeEventListener('abort', stop) }
} }) }
const canvasInteraction = { containerRef: { current: null }, screenToWorld: point => point, hitTestNode: () => null }
const mocks = {
  '@/stores/use-ai-store': { useAIStore: selector => selector(fakeAIState) },
  '@/lib/api': { getProvider: () => ({ protocol: 'chatCompletions' }), getAIModelCapabilities: () => ({ webSearch: 'supported', reasoningLevels: ['low', 'medium', 'high'] }), adaptReasoningLevel: (_, level) => level },
  '@/canvas/components/CanvasProvider': { useCanvas: () => ({ ...canvasInteraction, containerSize: { width: 1440, height: 900 }, hoveredNodeId: null, setHoveredNode() {}, resizing: null, draggingNodeIds: [], worldToScreen: point => point, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], selection: [] }) },
  '@/canvas/content-import-adapter': {},
  '@/lib/content-import': {},
  '@/runtime': { AssetManager: class {} },
  '@/storage/asset-store': { assetIdForResource: value => value, loadAssetUrl: async id => id === 'fixture-image' ? 'data:image/png;base64,aW1hZ2U=' : null },
  '@/stores/use-source-store': { useSourceStore: Object.assign(selector => selector({ sources: [] }), { getState: () => ({ sources: [] }) }) },
  '@/canvas/node-factory': { addNodeAtClient: kind => addedKinds.push(kind), addLibrarySource() {} },
  '@/canvas/clipboard-import': { importDroppedFile: async () => {} },
}
mocks['@/canvas/components/CanvasProvider'].useCanvasInteraction = mocks['@/canvas/components/CanvasProvider'].useCanvas
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
assert.equal(document.querySelectorAll('[aria-label="停止生成"]').length, 2, 'both views expose the same stop action')
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
await act(async () => useGraphStore.getState().setSelection([ai.id]))
await act(async () => { composer.textContent = 'Streaming cancellation'; composer.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
await act(async () => inline.querySelector('[aria-label="发送消息"]').click())
await act(async () => { pushResponse('## Partial'); await new Promise(resolve => setTimeout(resolve, 60)) })
for (const view of [inline, document.querySelector('[data-extension-panel]')]) {
  assert.ok([...view.querySelectorAll('h2')].some(heading => heading.textContent === 'Partial'), 'partial Markdown visible before stream finishes')
}
await act(async () => { pushResponse(' reply'); await new Promise(resolve => setTimeout(resolve, 0)) })
await act(async () => document.querySelector('[data-extension-panel] [aria-label="停止生成"]').click())
assert.equal(lastProviderSignal.aborted, true)
assert.equal(document.querySelectorAll('[aria-label="停止生成"]').length, 0)
assert.equal(document.querySelectorAll('[aria-label="发送消息"]').length, 2)
const cancelledSession = useRuntimeStore.getState().aiSessions[firstSession]
assert.equal(cancelledSession.messages.at(-1).content, '## Partial reply', 'stop preserves already displayed text')
await act(async () => { pushResponse(' MUST NOT APPEAR'); await new Promise(resolve => setTimeout(resolve, 0)) })
assert.equal(inline.textContent.includes('MUST NOT APPEAR'), false)
const retryUser = [...inline.querySelectorAll('[data-ai-message-role="user"]')].find(element => element.textContent.includes('Streaming cancellation'))
await act(async () => retryUser.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })))
await act(async () => inline.querySelector('[aria-label="重试最后一条用户消息"]').click())
await act(async () => { finishResponse('Retry after stop'); await new Promise(resolve => setTimeout(resolve, 0)) })
assert.equal(useRuntimeStore.getState().aiSessions[firstSession].messages.at(-1).content, 'Retry after stop')
assert.equal(useRuntimeStore.getState().aiSessions[firstSession].messages.filter(message => message.content === 'Streaming cancellation').length, 1)
await act(async () => { composer.textContent = 'Navigate away'; composer.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
await act(async () => inline.querySelector('[aria-label="发送消息"]').click())
await act(async () => rootView.unmount())
await act(async () => useGraphStore.getState().closeDocument())
assert.equal(lastProviderSignal.aborted, true, 'leaving the document stops its in-flight AI request')
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
await act(async () => {
  useGraphStore.getState().setSelection([sticky.id])
  useUiStore.getState().setShowExtensionPanel(true)
})
await act(async () => extraRoot.render(React.createElement(CanvasExtensionPanel)))
const stickyDetails = document.querySelector('[data-extension-panel]')
assert.ok(stickyDetails)
assert.equal(stickyDetails.querySelector('select'), null)
assert.equal(stickyDetails.querySelector('h3'), null)
assert.equal(stickyDetails.querySelectorAll('[role="toolbar"] button').length, 6)
assert.ok(!stickyDetails.querySelector('.cnote-rich-text').closest('.rounded-xl'), 'no nested rounded editor frame')
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
assert.ok(!actionButton.classList.contains('bg-destructive'), 'keyboard focus alone does not expose cancellation')
await act(async () => { actionButton.blur() })
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, waiting: true })))
assert.equal(actionButton.textContent, '继续生成')
assert.equal(actionButton.getAttribute('aria-label'), '继续生成')
await act(async () => actionButton.click())
assert.deepEqual(actions, ['start', 'cancel', 'resume'])
await act(async () => extraRoot.render(React.createElement(GenerationActionButton, { ...buttonProps, disabled: true })))
await act(async () => actionButton.click())
assert.equal(actions.length, 3)
const originalElementFromPoint = document.elementFromPoint
let hitTarget = null
document.elementFromPoint = () => hitTarget
const pointerCaptures = new WeakMap()
HTMLElement.prototype.setPointerCapture = function (id) { pointerCaptures.set(this, id) }
HTMLElement.prototype.hasPointerCapture = function (id) { return pointerCaptures.get(this) === id }
HTMLElement.prototype.releasePointerCapture = function () { pointerCaptures.delete(this) }
function pointer(target, type, options = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 30, ...options })
  Object.defineProperty(event, 'pointerId', { value: 7 })
  target.dispatchEvent(event)
}
for (const kind of ['image', 'video']) {
  const mediaNode = { id: 'media-pointer', kind: 'content', category: kind, label: 'Media', position: { x: 0, y: 0 }, size: { width: 540, height: 430 }, source: null, payload: { kind, activeResourceIndex: 0, resources: [{ label: 'First', resource: { url: 'https://fixture.invalid/first' } }, { label: 'Second', resource: { url: 'https://fixture.invalid/second' } }] } }
  await act(async () => useGraphStore.getState().openDocument({ id: 'pointer-flow', name: 'Pointer', nodes: [mediaNode], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 }))
  function MediaHarness() { const node = useGraphStore(state => state.currentDocument.nodes[0]); return React.createElement(ContentContent, { node }) }
  await act(async () => extraRoot.render(React.createElement(MediaHarness)))
  const buttons = document.querySelectorAll('.media-resource-capsule')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[1].draggable, false, 'pointer transfer does not compete with HTML drag-and-drop')
  canvasInteraction.containerRef.current = document.body
  document.body.getBoundingClientRect = () => ({ left: 10, top: 20, right: 1450, bottom: 920 })
  canvasInteraction.screenToWorld = point => ({ x: point.x / 2, y: point.y / 2 })
  hitTarget = document.body
  await act(async () => pointer(buttons[1], 'pointerdown'))
  await act(async () => pointer(buttons[1], 'pointermove', { clientX: 1010, clientY: 820 }))
  await act(async () => pointer(buttons[1], 'pointerup', { clientX: 1010, clientY: 820 }))
  const dragCopy = useGraphStore.getState().currentDocument.nodes[1]
  assert.equal(dragCopy.payload.resources[0].resource.url, 'https://fixture.invalid/second')
  assert.deepEqual(dragCopy.position, { x: 230, y: 185 }, 'copy uses canvas offset and zoom-correct world position')
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.resources.length, 2)
  await act(async () => useGraphStore.getState().undo())
  canvasInteraction.containerRef.current = null
  hitTarget = document.querySelector('[data-media-preview]')
  await act(async () => pointer(buttons[1], 'pointerdown'))
  await act(async () => pointer(buttons[1], 'pointermove', { clientX: 200, clientY: 120 }))
  await act(async () => pointer(buttons[1], 'pointerup', { clientX: 200, clientY: 120 }))
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 1)
  await act(async () => buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })))
  await act(async () => useGraphStore.getState().undo())
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 0, 'drag commits exactly one history entry')
  await act(async () => useGraphStore.getState().redo())
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 1)
  hitTarget = document.createElement('div')
  hitTarget.setAttribute('data-media-preview', 'another-node')
  await act(async () => { pointer(buttons[0], 'pointerdown'); pointer(buttons[0], 'pointermove', { clientX: 240 }); pointer(buttons[0], 'pointerup', { clientX: 240 }) })
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 1, 'dropping into another node is rejected')
  hitTarget = document.querySelector('[data-media-preview]')
  for (const cancellation of ['pointercancel', 'lostpointercapture', 'escape']) {
    await act(async () => { pointer(buttons[0], 'pointerdown'); pointer(buttons[0], 'pointermove', { clientX: 240 }) })
    await act(async () => {
      if (cancellation === 'escape') window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
      else pointer(buttons[0], cancellation)
      pointer(buttons[0], 'pointerup', { clientX: 240 })
    })
    assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 1, cancellation + ' leaves selection intact')
  }
  await act(async () => buttons[0].click())
  assert.equal(useGraphStore.getState().currentDocument.nodes[0].payload.activeResourceIndex, 0, 'keyboard activation still works after cancelled drag')
}
document.elementFromPoint = originalElementFromPoint
const { restoreHostFocus } = load('canvas/restore-host-focus.ts')
let hostFocusCalls = 0
window.cnoteDesktop = { window: { focus: async () => { hostFocusCalls++ } } }
const focusCanvas = document.createElement('div')
focusCanvas.tabIndex = -1
const guest = document.createElement('webview')
guest.tabIndex = 0
const textInput = document.createElement('input')
focusCanvas.append(guest, textInput)
document.body.append(focusCanvas)
guest.focus()
restoreHostFocus(focusCanvas, guest)
assert.equal(document.activeElement, guest, 'clicking guest leaves its keyboard shortcuts alone')
assert.equal(hostFocusCalls, 0)
restoreHostFocus(focusCanvas, focusCanvas)
assert.equal(document.activeElement, focusCanvas, 'blank canvas explicitly regains focus despite pointer preventDefault')
assert.equal(hostFocusCalls, 1)
guest.focus()
restoreHostFocus(focusCanvas, textInput)
textInput.focus()
assert.equal(document.activeElement, textInput, 'host input remains editable after focus handoff')
assert.equal(hostFocusCalls, 2)
restoreHostFocus(focusCanvas, textInput)
assert.equal(hostFocusCalls, 2, 'normal host editing does not trigger repeated IPC focus')
textInput.blur()
restoreHostFocus(focusCanvas, focusCanvas)
assert.equal(hostFocusCalls, 3, 'blank click restores native focus even when DOM focus no longer reports the guest')
focusCanvas.remove()
delete window.cnoteDesktop
const toolbarText = readFileSync(new URL('../src/canvas/components/CanvasToolbar.tsx', import.meta.url), 'utf8')
const toolbarTree = ts.createSourceFile('toolbar.tsx', toolbarText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let menuMarkup
let aiButtonMarkup
function findToolbarControls(syntax) {
  if (ts.isJsxElement(syntax)) {
    const attributes = syntax.openingElement.attributes.properties
    if (attributes.some(attribute => attribute.name?.getText(toolbarTree) === 'data-toolbar-add-menu')) menuMarkup = syntax.getText(toolbarTree)
    if (attributes.some(attribute => attribute.name?.getText(toolbarTree) === 'aria-label' && attribute.initializer?.text === '新增 AI 节点')) {
      aiButtonMarkup = syntax.getText(toolbarTree)
      let parent = syntax.parent
      while (parent) { if (ts.isJsxExpression(parent)) assert.ok(!parent.getText(toolbarTree).startsWith('{!compactCenter'), 'AI shortcut must not disappear in compact layouts'); parent = parent.parent }
    }
  }
  ts.forEachChild(syntax, findToolbarControls)
}
findToolbarControls(toolbarTree)
assert.ok(menuMarkup && aiButtonMarkup)
const toolbarAdds = []
const { NodeMenuIcon } = load('canvas/components/NodeMenuIcon.tsx')
const { Button } = load('components/ui/button.tsx')
const { Sparkles } = require('lucide-react')
function compiledToolbarFragment(markup, compactCenter = false) {
  const code = ts.transpileModule('function Fixture() { return (' + markup + ') }', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('exports', 'require', 'NodeMenuIcon', 'Button', 'Sparkles', 'addKind', 'compactCenter', code + '; return Fixture')({}, require, NodeMenuIcon, Button, Sparkles, kind => toolbarAdds.push(kind), compactCenter)
}
await act(async () => extraRoot.render(React.createElement(compiledToolbarFragment(menuMarkup))))
assert.deepEqual([...document.querySelectorAll('[data-toolbar-add-menu] button')].map(button => button.textContent.trim()), ['添加内容节点', '添加请求体', '添加浏览器节点'])
await act(async () => { for (const button of document.querySelectorAll('[data-toolbar-add-menu] button')) button.click() })
for (const compact of [false, true]) {
  await act(async () => extraRoot.render(React.createElement(compiledToolbarFragment(aiButtonMarkup, compact))))
  await act(async () => document.querySelector('[aria-label="新增 AI 节点"]').click())
}
assert.deepEqual(toolbarAdds, ['content', 'request', 'browser', 'ai', 'ai'])
const mainText = readFileSync(new URL('../../desktop/src/main.ts', import.meta.url), 'utf8')
const mainTree = ts.createSourceFile('main.ts', mainText, ts.ScriptTarget.Latest, true)
let focusHandler
function findFocusHandler(syntax) {
  if (ts.isCallExpression(syntax) && syntax.expression.getText(mainTree) === 'ipcMain.handle' && syntax.arguments[0]?.text === 'window:focus') focusHandler = syntax.arguments[1].getText(mainTree)
  ts.forEachChild(syntax, findFocusHandler)
}
findFocusHandler(mainTree)
assert.ok(focusHandler)
let nativeFocused = 0
const nativeFocus = new Function('mainWindow', 'return (' + focusHandler + ')')({ isDestroyed: () => false, webContents: { id: 1 } })
nativeFocus({ sender: { id: 2, focus: () => nativeFocused++ } })
assert.equal(nativeFocused, 0, 'guest cannot steal host focus via IPC')
nativeFocus({ sender: { id: 1, focus: () => nativeFocused++ } })
assert.equal(nativeFocused, 1)
const { create: createStore } = require('zustand')
const batchModel = { id: 'batch-model', name: 'Batch model', capabilities: ['text-to-image'], parameters: [] }
const batchChannel = { id: 'batch-channel', name: 'Batch', providerId: 'openai', protocol: 'openai-images', baseURL: 'https://fixture.invalid', enabled: true, modelIds: [batchModel.id] }
mocks['@/stores/use-generation-store'] = { useGenerationStore: createStore(() => ({ channels: [batchChannel], getModels: () => [batchModel] })), generationChannelSupportsVariant: () => true, generationChannelUsesModelInference: () => false }
mocks['@/storage/runtime-persistence'] = { flushRuntimePersistence: async () => {} }
const batchRequests = []
mocks['@/lib/generation/client'] = { runGenerationTask: (_context, options) => new Promise((resolve, reject) => {
  const index = batchRequests.length
  if (options.onRemoteTaskId) void options.onRemoteTaskId('remote-' + index)
  batchRequests.push({ complete() { const task = { status: 'completed', resultUrls: ['https://fixture.invalid/batch-' + index + '.png'], resultMimeTypes: ['image/png'] }; options.onTaskUpdate(task); resolve(task) }, fail() { const task = { status: 'failed', error: 'Fixture failure' }; options.onTaskUpdate(task); resolve(task) } })
  options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
}) }
const { RequestContent } = load('canvas/contents/RequestContent.tsx')
const batchRequestNode = { id: 'batch-request', kind: 'request', variant: 'image', label: '图片生成', position: { x: 0, y: 0 }, size: { width: 480, height: 420 }, image: { prompt: 'Fixture prompt', channelId: batchChannel.id, model: batchModel.id, outputCount: 3 }, video: {} }
await act(async () => useGraphStore.getState().openDocument({ id: 'batch-component-flow', name: 'Batch', nodes: [batchRequestNode], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 }))
function BatchHarness() {
  const nodes = useGraphStore(state => state.currentDocument.nodes)
  return React.createElement('div', null, ...nodes.map(node => node.kind === 'request' ? React.createElement(RequestContent, { key: node.id, node }) : React.createElement('div', { key: node.id, 'data-batch-view': node.id }, React.createElement(ContentContent, { node }))))
}
await act(async () => extraRoot.render(React.createElement(BatchHarness)))
await act(async () => document.querySelector('[aria-label="开始生成"]').click())
assert.equal(batchRequests.length, 3)
let batches = useGraphStore.getState().currentDocument.nodes.filter(node => node.kind === 'content')
assert.equal(batches.length, 1, 'one placeholder and connection before any output')
const firstBatchId = batches[0].id
assert.equal(useGraphStore.getState().currentDocument.edges.length, 1)
assert.equal(document.querySelectorAll('[data-batch-progress]').length, 1)
assert.ok(document.querySelector('[data-batch-progress]').textContent.includes('0 个结果 · 0/3 项完成 · 0:00'))
assert.ok(document.querySelector('[data-batch-progress]').classList.contains('justify-center'))
await act(async () => batchRequests[2].complete())
assert.ok(document.querySelector('[data-batch-view] img').src.endsWith('batch-2.png'))
assert.equal(document.querySelector('[aria-label="展开批次"]'), null, 'running batch cannot expand')
await act(async () => batchRequests[0].complete())
assert.equal(document.querySelectorAll('[data-batch-view] img').length, 1)
await act(async () => batchRequests[1].fail())
await act(async () => document.querySelector('[aria-label="展开批次"]').click())
assert.equal(document.querySelector('[aria-label="解绑批次"]').disabled, false)
assert.equal(document.querySelectorAll('[data-batch-cell]').length, 2)
assert.ok([...document.querySelectorAll('[data-batch-cell]')].every(cell => cell.textContent === ''), 'no image captions')
await act(async () => document.querySelector('[aria-label="收起批次"]').click())
assert.equal(document.querySelectorAll('[data-batch-view] img').length, 1)
assert.ok(document.querySelector('[data-batch-view] img').src.endsWith('batch-2.png'), 'earlier task completing later does not steal current preview')
await act(async () => document.querySelector('[aria-label="开始生成"]').click())
assert.equal(useGraphStore.getState().currentDocument.nodes.filter(node => node.kind === 'content').length, 2)
assert.equal(useGraphStore.getState().currentDocument.nodes.find(node => node.id === firstBatchId).payload.resources.length, 2)
await act(async () => batchRequests[3].complete())
await act(async () => document.querySelector('[aria-label="取消生成"]').click())
const newBatch = useGraphStore.getState().currentDocument.nodes.filter(node => node.kind === 'content').find(node => node.id !== firstBatchId)
assert.equal(newBatch.payload.resources.length, 1, 'cancel keeps completed outputs')
await act(async () => document.querySelector('[data-batch-view="' + firstBatchId + '"] [aria-label="展开批次"]').click())
await act(async () => document.querySelector('[data-batch-view="' + firstBatchId + '"] [aria-label="解绑批次"]').click())
assert.equal(useGraphStore.getState().currentDocument.nodes.some(node => node.id === firstBatchId), false)
await act(async () => useGraphStore.getState().undo())
assert.ok(document.querySelector('[data-batch-view="' + firstBatchId + '"] [aria-label="收起批次"]'))
await act(async () => document.querySelector('[aria-label="开始生成"]').click())
await act(async () => batchRequests[6].complete())
const resumeRunId = useGraphStore.getState().currentDocument.nodes.find(node => node.id === batchRequestNode.id).latestRunId
const resumeResultId = useRuntimeStore.getState().runs[resumeRunId].resultNodeId
await act(async () => extraRoot.render(null))
assert.equal(useRuntimeStore.getState().runs[resumeRunId].status, 'waiting-for-user')
const savedBatchDocument = JSON.parse(JSON.stringify(useGraphStore.getState().currentDocument))
await act(async () => useGraphStore.getState().openDocument(savedBatchDocument))
await act(async () => extraRoot.render(React.createElement(BatchHarness)))
await act(async () => document.querySelector('[aria-label="继续生成"]').click())
assert.equal(useRuntimeStore.getState().runs[resumeRunId].resultNodeId, resumeResultId)
await act(async () => batchRequests[9].complete())
await act(async () => batchRequests[10].complete())
const resumedBatch = useGraphStore.getState().currentDocument.nodes.find(node => node.id === resumeResultId)
assert.equal(resumedBatch.payload.resources.length, 3, 'resume appends remaining tasks without losing completed output')
assert.equal(useGraphStore.getState().currentDocument.nodes.filter(node => node.generationBatch?.runId === resumeRunId).length, 1)
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
const { canvasDotPattern } = load('canvas/background.ts')
assert.equal(canvasDotPattern({ x: 0, y: 0, zoom: 1 }).backgroundSize, '24px 24px')
assert.equal(canvasDotPattern({ x: 24, y: -24, zoom: 1 }).backgroundPosition, '0px 0px')
assert.ok(providerText.includes('<CanvasBackground />'))
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
