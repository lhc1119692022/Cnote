import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { create } from 'zustand'
import { sourceLoader } from './helpers/load-source.mjs'

const dom = new JSDOM('<div id="canvas"><input /><div id="surface"></div></div>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'Element', 'HTMLElement']) globalThis[key] = dom.window[key]
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
const root = document.getElementById('canvas')
root.getBoundingClientRect = () => ({ left: 20, top: 30, width: 1000, height: 800 })
let captured = false
root.setPointerCapture = () => { captured = true }
root.hasPointerCapture = () => captured
root.releasePointerCapture = () => { captured = false }
let commits = 0
const graph = create(() => ({ currentDocument: null, isLocked: false, commitHistory: () => commits++ }))
const view = create(() => ({ view: { x: 0, y: 0, zoom: 1 } }))
const load = sourceLoader({ '@/stores/graph-store': { useGraphStore: graph }, '@/stores/canvas-viewport-store': { useCanvasViewportStore: view } })
const { installEdgeCutting, useCutEdges, segmentsCross } = load('canvas/cut-edges.ts')
const fixture = { id: 'document', nodes: [
  { id: 'left', kind: 'content', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
  { id: 'right', kind: 'content', position: { x: 400, y: 0 }, size: { width: 100, height: 100 } },
], edges: [{ id: 'edge-one', source: 'left', target: 'right' }, { id: 'edge-two', source: 'left', target: 'right' }] }
const reset = () => { graph.setState({ currentDocument: structuredClone(fixture), isLocked: false }); commits = 0 }
const dispatch = (type, x, y, options = {}) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  const { target = root, ...properties } = options
  Object.assign(event, { pointerId: 1, button: type === 'pointermove' ? -1 : 2, buttons: type === 'pointerup' ? 0 : 2, clientX: x + 20, clientY: y + 30, ...properties })
  target.dispatchEvent(event)
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
reset()
const uninstall = installEdgeCutting(root)
dispatch('pointerdown', 250, 0)
assert.ok(root.classList.contains('canvas-cutting'))
dispatch('pointermove', 250, 100)
await tick()
assert.deepEqual(useCutEdges.getState().ids, ['edge-one', 'edge-two'])
assert.equal(graph.getState().currentDocument.edges.length, 2, 'preview must not delete')
dispatch('pointerup', 250, 100)
assert.equal(graph.getState().currentDocument.edges.length, 0)
assert.equal(commits, 1, 'multi-edge cut must be one undo transaction')
assert.equal(captured, false)
assert.equal(useCutEdges.getState().points.length, 0)
for (const cancellation of ['escape', 'blur', 'pointercancel', 'document', 'lock', 'viewport']) {
  reset(); dispatch('pointerdown', 250, 0); dispatch('pointermove', 250, 100)
  if (cancellation === 'escape') window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  if (cancellation === 'blur') window.dispatchEvent(new window.Event('blur'))
  if (cancellation === 'pointercancel') dispatch('pointercancel', 250, 100)
  if (cancellation === 'document') graph.setState({ currentDocument: { ...fixture, id: 'another' } })
  if (cancellation === 'lock') graph.setState({ isLocked: true })
  if (cancellation === 'viewport') view.setState({ view: { x: 100, y: 100, zoom: 2 } })
  dispatch('pointerup', 250, 100)
  assert.equal(graph.getState().currentDocument.edges.length, 2, cancellation)
  assert.equal(commits, 0, cancellation)
}
reset()
dispatch('pointerdown', 600, 100)
dispatch('pointerup', 600, 100)
assert.equal(commits, 0, 'right click without crossing must not mutate graph')
dispatch('pointerdown', 600, 100, { target: root.querySelector('input') })
assert.ok(!root.classList.contains('canvas-cutting'), 'text inputs retain editing behavior')
dispatch('pointerdown', 600, 100, { button: 0, buttons: 1 })
assert.ok(!root.classList.contains('canvas-cutting'), 'left button unchanged')
dispatch('pointerdown', 600, 100)
dispatch('pointermove', 600, 300)
await tick()
assert.equal(useCutEdges.getState().ids.length, 2, 'zoom/pan coordinates must match displayed curve')
dispatch('pointerup', 600, 300)
assert.equal(commits, 1)
assert.ok(!segmentsCross({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }))
uninstall(); dom.window.close()
console.log('Right-button cutting: preview, multiple edges, single commit, offsets/zoom, click-only, cancel, lock and input isolation PASS')
