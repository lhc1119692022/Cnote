import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { sourceLoader } from './helpers/load-source.mjs'

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://cnote.test', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'localStorage', 'Element', 'HTMLElement', 'Node', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let nextFrame = 0
const frames = new Map()
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
globalThis.cancelAnimationFrame = handle => frames.delete(handle)
const nextTick = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())) }
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback([{ contentRect: { width: 1440, height: 900 } }]) } disconnect() {} }
const mocks = {
  '@/canvas/components/CanvasAddMenu': { CanvasAddMenu: () => null },
  '@/canvas/clipboard-import': { rememberClientPoint() {}, handleCanvasDrop() {}, readSystemClipboardAndImport() {} },
  '@/canvas/node-factory': { createAddableNode() {}, defaultSizeFor: () => ({ width: 200, height: 120 }) },
  '@/canvas/content-import-adapter': {},
  '@/lib/content-import': {},
  '@/lib/localforage-storage': { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
}
const load = sourceLoader(mocks)
const { useGraphStore } = load('stores/graph-store')
const { useCanvasViewportStore, currentCanvasViewport } = load('stores/canvas-viewport-store')
const { currentGraphSource, withCurrentViewport } = load('storage/graph-session')
const { CanvasProvider, useCanvas } = load('canvas/components/CanvasProvider')
const { canvasDotPattern } = load('canvas/background')
const { contentPresentationStyle, visibleWorldRect, collectContentMountPinIds } = load('canvas/components/content-visibility')
const { createEdgePathCache } = load('canvas/edge-path-cache')
const { interpolateViewport } = load('canvas/navigation-motion')
const makeNode = index => ({ id: `node-${index}`, kind: 'sticky', label: `Node ${index}`, content: '', color: 'yellow', position: { x: index * 250, y: 0 }, size: { width: 200, height: 120 } })
const documentFixture = count => ({ id: `flow-${count}`, name: 'Fixture', nodes: Array.from({ length: count }, (_, index) => makeNode(index)), edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
let canvas
function Probe() { canvas = useCanvas(); return null }
const root = createRoot(document.getElementById('app'))
await act(async () => { useGraphStore.getState().openDocument(documentFixture(30)); root.render(React.createElement(CanvasProvider, null, React.createElement(Probe))) })
const input = (screenX, screenY, extra = {}) => ({ screen: { x: screenX, y: screenY }, world: { x: screenX, y: screenY }, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...extra })
const graph = () => useGraphStore.getState()
let changes = 0
const unsubscribe = useGraphStore.subscribe((state, previous) => { if (state.currentDocument !== previous.currentDocument) changes++ })
for (const count of [30, 100, 300]) {
  await act(async () => { graph().openDocument(documentFixture(count)); graph().setSelection(Array.from({ length: 20 }, (_, index) => `node-${index}`)) })
  changes = 0
  await act(async () => {
    canvas.pointerDown(input(0, 0), 'node-0')
    for (let index = 1; index <= 100; index++) canvas.pointerMove(input(index, index / 2))
  })
  assert.equal(changes, 0)
  await act(async () => nextTick())
  assert.equal(changes, 1, '20 nodes committed atomically once per frame')
  assert.deepEqual(graph().currentDocument.nodes[19].position, { x: 19 * 250 + 100, y: 50 })
  await act(async () => canvas.pointerUp(input(120, 60)))
  assert.deepEqual(graph().currentDocument.nodes[0].position, { x: 120, y: 60 })
  assert.equal(graph().history.length, 2)
  await act(async () => graph().undo())
  assert.deepEqual(graph().currentDocument.nodes[0].position, { x: 0, y: 0 })
}
await act(async () => {
  canvas.pointerDown(input(0, 0), 'node-0')
  canvas.pointerMove(input(80, 40))
  nextTick()
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
  nextTick()
})
assert.deepEqual(graph().currentDocument.nodes[0].position, { x: 0, y: 0 })
await act(async () => {
  canvas.pointerDown(input(0, 0, { button: 1 }))
  for (let index = 1; index <= 100; index++) canvas.pointerMove(input(index, index, { button: 1 }))
  nextTick()
})
assert.deepEqual(useCanvasViewportStore.getState().view, { x: 100, y: 100, zoom: 1 })
assert.deepEqual(graph().view, { x: 0, y: 0, zoom: 1 }, 'transient viewport does not persist each frame')
await act(async () => canvas.pointerUp(input(110, 110, { button: 1 })))
assert.deepEqual(graph().view, { x: 110, y: 110, zoom: 1 })
await act(async () => {
  canvas.setViewport({ x: 0, y: 0, zoom: 1 })
  canvas.beginResize('node-0', { x: 0, y: 0 })
  canvas.updateResize({ x: 90, y: 90 })
  canvas.endResize()
})
assert.deepEqual(graph().currentDocument.nodes[0].size, { width: 290, height: 210 })
await act(async () => {
  canvas.pointerDown(input(0, 0), 'node-0')
  canvas.pointerMove(input(1000, 1000))
  graph().openDocument(documentFixture(50))
  nextTick()
})
assert.deepEqual(graph().currentDocument.nodes[0].position, { x: 0, y: 0 }, 'pending gesture cannot modify next document')
window.matchMedia = () => ({ matches: true })
await act(async () => canvas.navigateToViewport({ x: 3, y: 4, zoom: 2 }))
assert.deepEqual(graph().view, { x: 3, y: 4, zoom: 2 })
assert.equal(frames.size, 0)
window.matchMedia = () => ({ matches: false })
await act(async () => { canvas.navigateToViewport({ x: 1000, y: 1000, zoom: 1 }); nextTick() })
await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', code: 'KeyA' })))
const interruptedView = { ...useCanvasViewportStore.getState().view }
await act(async () => { for (let index = 0; index < 20; index++) nextTick() })
assert.deepEqual(useCanvasViewportStore.getState().view, interruptedView, 'manual input cancels navigation without a later snap')
assert.equal(frames.size, 0)
await act(async () => {
  canvas.setViewport({ x: 0, y: 0, zoom: 1 })
  const surface = document.querySelector('[data-cnote-canvas]')
  for (let index = 0; index < 100; index++) surface.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -1, clientX: 250, clientY: 200, bubbles: true, cancelable: true }))
  assert.equal(useCanvasViewportStore.getState().view.zoom, 1, 'render notifications wait for the display frame')
  const source = currentGraphSource()
  assert.ok(Math.abs(source.view.zoom - 1.0018 ** 100) < 1e-10, 'saving before the display frame reads the latest input')
  assert.equal(withCurrentViewport(source.doc, source.view).viewport.zoom, currentCanvasViewport().zoom)
  nextTick()
})
assert.ok(Math.abs(useCanvasViewportStore.getState().view.zoom - 1.0018 ** 100) < 1e-10, 'wheel increments accumulate before a single display frame')
await act(async () => {
  canvas.setViewport({ x: 0, y: 0, zoom: 1 })
  canvas.setViewport({ x: NaN, y: 0, zoom: 1 })
  canvas.navigateToViewport({ x: 0, y: 0, zoom: -1 })
})
assert.deepEqual(currentCanvasViewport(), { x: 0, y: 0, zoom: 1 })
assert.equal(frames.size, 0, 'invalid targets cannot create an animation or poison hit testing')
const scrollContent = document.createElement('div')
scrollContent.setAttribute('data-canvas-content', 'true')
document.querySelector('[data-cnote-canvas]').append(scrollContent)
await act(async () => {
  canvas.navigateToViewport({ x: 1000, y: 800, zoom: 2 })
  nextTick()
  scrollContent.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: 30, bubbles: true }))
})
assert.deepEqual(graph().view, currentCanvasViewport(), 'scrolling content interrupts and commits programmatic navigation')
assert.equal(frames.size, 0)
scrollContent.remove()
await act(async () => {
  document.querySelector('[data-cnote-canvas]').dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -30, bubbles: true, cancelable: true }))
  graph().openDocument(documentFixture(30))
  nextTick()
})
assert.deepEqual(currentGraphSource().view, { x: 0, y: 0, zoom: 1 }, 'pending viewport cannot leak to another document')
await act(async () => {
  canvas.setViewport({ x: 0, y: 0, zoom: 1 })
  canvas.pointerDown(input(0, 0), 'node-0')
  canvas.pointerMove(input(500, 500))
  window.dispatchEvent(new dom.window.Event('blur'))
  nextTick()
})
assert.deepEqual(graph().currentDocument.nodes[0].position, { x: 0, y: 0 })
window.matchMedia = () => ({ matches: true })
await act(async () => canvas.centerOnWorld({ x: 500, y: 500 }))
assert.notDeepEqual(graph().view, { x: 0, y: 0, zoom: 1 })
const pattern = canvasDotPattern({ x: -25, y: 49, zoom: 1 })
assert.equal(pattern.backgroundPosition, '23px 1px')
assert.equal(pattern.backgroundSize, '24px 24px')
assert.ok(Number.parseFloat(canvasDotPattern({ x: 1e9, y: -1e9, zoom: 0.01 }).backgroundSize) >= 12)
assert.equal(visibleWorldRect({ x: 0, y: 0, zoom: 2 }, { width: 800, height: 600 }).x, -120)
assert.equal(contentPresentationStyle({ ...makeNode(0), kind: 'content', category: 'image' }, { zoom: 2 }).transform, 'scale(2)')
assert.equal(contentPresentationStyle({ ...makeNode(0), kind: 'content', category: 'text' }, { zoom: 2 }).zoom, 2)
assert.equal(contentPresentationStyle({ ...makeNode(0), kind: 'browser' }, { zoom: 2 }).zoom, 1)
const browserNodes = Array.from({ length: 50 }, (_, index) => ({ ...makeNode(index), kind: 'browser', sessionId: `session-${index}` }))
const sessions = Object.fromEntries(browserNodes.map(node => [node.sessionId, { tabs: [{ id: 'tab' }], activeTabId: 'tab' }]))
assert.equal(collectContentMountPinIds(browserNodes, { sessions }).size, 50, 'active guest state is not silently reclaimed')
const cache = createEdgePathCache()
const nodes = [makeNode(0), makeNode(1), makeNode(2)]
const edges = [{ id: 'edge-1', source: 'node-0', target: 'node-1' }, { id: 'edge-2', source: 'node-1', target: 'node-2' }]
const before = cache(nodes, edges)
const after = cache([{ ...nodes[0], position: { x: 10, y: 0 } }, nodes[1], nodes[2]], edges)
assert.notEqual(before[0], after[0])
assert.equal(before[1], after[1])
assert.deepEqual(interpolateViewport({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 20, zoom: 2 }, 1), { x: 10, y: 20, zoom: 2 })
unsubscribe()
const { CanvasViewport } = load('canvas/components/CanvasViewport')
let bodyRenders = 0
function Body() { bodyRenders++; return React.createElement('span', null, 'body') }
const renderBody = () => React.createElement(Body)
await act(async () => {
  graph().openDocument(documentFixture(30))
  root.render(React.createElement(CanvasViewport, null, renderBody))
})
const renderCount = bodyRenders
await act(async () => { for (let index = 0; index < 5; index++) useCanvasViewportStore.getState().setView({ x: index, y: 0, zoom: 1 }) })
assert.equal(bodyRenders, renderCount, 'pan with stable visibility does not rerender static bodies')
await act(async () => root.unmount())
assert.equal(frames.size, 0)
dom.window.close()
console.log('canvas optimization: real provider 30/100/300-node gestures, viewport commit, history/cancel, resize, document switch, reduced motion, grid, pin, presentation and edge cache passed')
