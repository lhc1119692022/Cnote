import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CanvasViewport } from '@/canvas/components/CanvasViewport'
import { useCanvas } from '@/canvas/components/CanvasProvider'
import { ContentContent } from '@/canvas/contents/ContentContent'
import { AIContent } from '@/canvas/contents/AIContent'
import { BrowserContent } from '@/canvas/contents/BrowserContent'
import { StickyContent } from '@/canvas/contents/StickyContent'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useUiStore } from '@/stores/ui-store'
import { createDisplayBuffer } from '@/lib/frame-task'
import { panBy, zoomAt } from '@/canvas'

const root = createRoot(document.getElementById('root'))
let canvas
let sequence = 0
function Probe() { canvas = useCanvas(); return null }
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const graph = () => useGraphStore.getState()
function renderNode(node) {
  const body = node.kind === 'ai' ? <AIContent node={node} />
    : node.kind === 'browser' ? <BrowserContent node={node} />
      : node.kind === 'content' ? <ContentContent node={node} /> : <StickyContent node={node} />
  return <>{node.id === 'node-0' && <Probe />}{body}</>
}
function makeNodes(count) {
  return Array.from({ length: count }, (_, index) => {
    const base = { id: `node-${index}`, label: `Fixture ${index}`, position: { x: index % 8 * 340, y: Math.floor(index / 8) * 260 }, size: { width: 320, height: 240 } }
    if (index === 0) return { ...base, kind: 'ai', activeSessionId: 'fixture-chat' }
    if (index % 30 === 29) return { ...base, kind: 'browser', url: `${location.origin}/guest`, sessionId: `browser-${index}`, activeTarget: `tab-${index}` }
    if (index % 3 === 1) return { ...base, kind: 'content', category: 'text', subtype: 'markdown', content: '# Local fixture\n\n' + 'A paragraph with **bold** and ordinary text. '.repeat(30), source: { kind: 'text', mimeType: 'text/markdown' } }
    if (index % 3 === 2) return { ...base, kind: 'content', category: 'data', payload: { kind: 'data', sheets: [{ name: 'Local table', columns: ['First', 'Second'], rows: Array.from({ length: 30 }, (_, row) => [row, `Value ${row}`]), totalRows: 30 }] }, source: null }
    return { ...base, kind: 'sticky', color: 'yellow', content: 'Offline note '.repeat(20) }
  })
}
const percentile = (values, portion) => [...values].sort((first, second) => first - second)[Math.min(values.length - 1, Math.floor(values.length * portion))] || 0

window.runProductCase = async ({ count, variant, action, frames = 30 }) => {
  const nodes = makeNodes(count)
  const sessions = Object.fromEntries(nodes.filter(node => node.kind === 'browser').map(node => [node.sessionId, { id: node.sessionId, partition: 'fixture', activeTabId: node.activeTarget, tabs: [{ id: node.activeTarget, url: node.url, title: 'Fixture', status: 'ready' }], createdAt: 1 }]))
  useRuntimeStore.setState({ sessions, captures: {}, assets: {}, runs: {}, aiSessions: { 'fixture-chat': { id: 'fixture-chat', nodeId: 'node-0', title: 'Local stream', messages: [], createdAt: 1, updatedAt: 1 } } })
  useUiStore.setState({ showNodePanel: false, showExtensionPanel: false, showMinimap: false })
  flushSync(() => {
    graph().openDocument({ id: `fixture-${++sequence}`, name: 'Isolated product test', nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id })), viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
    graph().setSelection(nodes.slice(0, 20).map(node => node.id))
    root.render(<CanvasViewport key={sequence}>{renderNode}</CanvasViewport>)
  })
  for (let warm = 0; warm < 8; warm++) await frame()
  let graphWrites = 0
  let sessionWrites = 0
  const unsubscribe = useGraphStore.subscribe((state, previous) => { if (state.currentDocument !== previous.currentDocument) graphWrites++ })
  const unsubscribeRuntime = useRuntimeStore.subscribe((state, previous) => { if (state.aiSessions !== previous.aiSessions) sessionWrites++ })
  const intervals = []
  const updateTimes = []
  const longTasks = []
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) })
  observer.observe({ type: 'longtask', buffered: false })
  let response = ''
  const emit = text => {
    response += text
    const session = useRuntimeStore.getState().aiSessions['fixture-chat']
    useRuntimeStore.getState().putAISession({ ...session, messages: [{ role: 'assistant', content: response, createdAt: 1 }], updatedAt: session.updatedAt + 1 })
  }
  const display = createDisplayBuffer(emit)
  const pointer = offset => ({ screen: { x: offset, y: offset / 2 }, world: { x: offset, y: offset / 2 }, button: 0, shiftKey: false, ctrlKey: false, metaKey: false })
  const dragging = action === 'drag' || action === 'mixed'
  if (dragging) canvas.pointerDown(pointer(0), 'node-0')
  const surface = document.querySelector('[data-cnote-canvas]')
  let previousTime = performance.now()
  for (let index = 0; index < frames; index++) {
    const started = performance.now()
    for (let eventIndex = 1; eventIndex <= 10; eventIndex++) {
      const offset = index * 10 + eventIndex
      if (dragging) {
        if (variant === 'optimized') canvas.pointerMove(pointer(offset))
        else if (variant !== 'frame-single' || eventIndex === 10) {
          const patches = nodes.slice(0, 20).map(node => [node.id, { position: { x: node.position.x + offset, y: node.position.y + offset / 2 } }])
          if (variant === 'batch-only') graph().updateNodes(new Map(patches))
          else for (const [id, patch] of patches) graph().updateNode(id, patch)
        }
      } else if (action === 'pan') {
        if (variant === 'optimized') {
          if (!index && eventIndex === 1) canvas.pointerDown({ ...pointer(0), button: 1 })
          canvas.pointerMove({ ...pointer(offset), button: 1 })
        } else graph().setViewport(panBy(graph().view, { x: 1, y: 0.5 }))
      } else if (action === 'zoom') {
        if (variant === 'optimized') surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 640, clientY: 400, bubbles: true, cancelable: true }))
        else graph().setViewport(zoomAt(graph().view, { x: 640, y: 400 }, 1.0018))
      }
      if (action === 'stream' || action === 'mixed') {
        if (variant === 'immediate') emit(' text')
        else display.append(' text')
      }
    }
    updateTimes.push(performance.now() - started)
    await frame()
    const time = performance.now()
    intervals.push(time - previousTime)
    previousTime = time
  }
  if (dragging) canvas.pointerUp(pointer(frames * 10))
  if (action === 'pan' && variant === 'optimized') canvas.pointerUp({ ...pointer(frames * 10), button: 1 })
  display.flush()
  await frame()
  unsubscribe()
  unsubscribeRuntime()
  observer.disconnect()
  if (dragging && nodes.slice(0, 20).some((node, index) => graph().currentDocument.nodes[index].position.x !== node.position.x + frames * 10)) throw new Error('Final position mismatch')
  if ((action === 'stream' || action === 'mixed') && response !== ' text'.repeat(frames * 10)) throw new Error('Stream lost data')
  return { count, variant, action, frameP95: percentile(intervals, .95), updateP95: percentile(updateTimes, .95), longTasks, graphWrites, sessionWrites, mounted: document.querySelectorAll('[data-content-node]').length, intervals, updateTimes }
}

window.addGuest = async index => {
  if (!document.querySelector('#guests')) {
    flushSync(() => root.render(null))
    const holder = document.createElement('div')
    holder.id = 'guests'
    document.body.append(holder)
  }
  const guest = document.createElement('webview')
  guest.setAttribute('partition', 'product-fixture')
  guest.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0'
  guest.src = `${location.origin}/guest?index=${index}`
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Guest readiness timeout')), 15000)
    guest.addEventListener('dom-ready', () => { clearTimeout(timer); resolve() }, { once: true })
    document.querySelector('#guests').append(guest)
  })
  await guest.executeJavaScript(`document.querySelector('input').value = 'state-${index}'`)
  guest.style.left = '-5000px'
  return guest.getWebContentsId()
}
window.verifyGuests = async () => {
  const guests = [...document.querySelectorAll('webview')]
  for (let index = 0; index < guests.length; index++) {
    guests[index].style.left = '0px'
    const value = await guests[index].executeJavaScript('document.querySelector("input").value')
    if (value !== `state-${index}`) throw new Error('Guest state lost after offscreen return')
    guests[index].style.left = '-5000px'
  }
  return guests.length
}
