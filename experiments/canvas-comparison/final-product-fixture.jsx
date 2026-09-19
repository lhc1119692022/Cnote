import React, { Profiler } from 'react'
import { createRoot } from 'react-dom/profiling'
import { flushSync } from 'react-dom'
import { CanvasViewport } from '@/canvas/components/CanvasViewport'
import { useCanvas } from '@/canvas/components/CanvasProvider'
import { ContentContent } from '@/canvas/contents/ContentContent'
import { AIContent } from '@/canvas/contents/AIContent'
import { StickyContent } from '@/canvas/contents/StickyContent'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useUiStore } from '@/stores/ui-store'
import { useAIStore } from '@/stores/use-ai-store'
import { AIClient } from '@/lib/api/client'

const root = createRoot(document.getElementById('root'))
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const graph = () => useGraphStore.getState()
let canvas
let commits = 0
function Probe() { canvas = useCanvas(); return null }
const imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d4e4dc"/><circle cx="160" cy="90" r="50" fill="#678778"/></svg>')
function makeNodes(count) {
  return Array.from({ length: count }, (_, index) => {
    const base = { id: `node-${index}`, label: `Fixture ${index}`, position: { x: index % 8 * 340, y: Math.floor(index / 8) * 260 }, size: { width: 320, height: 240 } }
    if (index === 0) return { ...base, kind: 'ai', activeSessionId: 'fixture-chat', channelId: 'fixture-channel', model: 'fixture-model', prompt: 'Local instruction' }
    if (index % 30 === 29) return { ...base, kind: 'browser', url: `${location.origin}/guest`, sessionId: `browser-${index}`, activeTarget: `tab-${index}` }
    if (index % 5 === 1) return { ...base, kind: 'content', category: 'text', subtype: 'markdown', content: '# Local fixture\n\n' + 'A paragraph with **bold** and ordinary text. '.repeat(20), source: { kind: 'text', mimeType: 'text/markdown' } }
    if (index % 5 === 2) return { ...base, kind: 'content', category: 'data', payload: { kind: 'data', sheets: [{ name: 'Local table', columns: ['First', 'Second'], rows: Array.from({ length: 20 }, (_, row) => [row, `Value ${row}`]), totalRows: 20 }] }, source: null }
    if (index % 5 === 3) return { ...base, kind: 'content', category: 'image', source: { kind: 'url', url: imageUrl } }
    return { ...base, kind: 'sticky', color: 'yellow', content: 'Offline note '.repeat(12) }
  })
}
function renderNode(node) {
  const body = node.kind === 'ai' ? <AIContent node={node} />
    : node.kind === 'browser' ? <iframe title={node.label} src={node.url} style={{ width: '100%', height: '100%', border: 0 }} />
      : node.kind === 'content' ? <ContentContent node={node} /> : <StickyContent node={node} />
  return <>{node.id === 'node-0' && <Probe />}{body}</>
}
const percentile = (values, fraction) => [...values].sort((first, second) => first - second)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 300; attempt++) { if (await check()) return; await delay(10) }
  throw new Error(`Timed out: ${label}`)
}

window.runFinalProductCase = async ({ count, action, frames = 20 }) => {
  await useAIStore.persist.rehydrate()
  const nodes = makeNodes(count)
  const provider = { id: 'custom', name: 'Offline fixture', protocol: 'chatCompletions', baseURL: location.origin, models: [{ id: 'fixture-model', name: 'Fixture', maxTokens: 4096, supportsStreaming: true }] }
  useAIStore.setState({ getAPIKey: () => 'fixture-not-a-real-key' })
  useAIStore.setState({ apiKeys: [{ id: 'fixture-channel', name: 'Offline fixture', providerId: 'custom', protocol: 'chatCompletions', baseURL: location.origin, modelIds: ['fixture-model'], encryptedKey: '', secretName: 'fixture-not-a-real-secret' }], currentAPIKeyId: 'fixture-channel', currentModel: 'fixture-model', defaultsInitialized: true, createClientForChannel: () => new AIClient(provider, '', window.cnoteDesktop ? 'fixture-not-a-real-secret' : undefined) })
  const sessions = Object.fromEntries(nodes.filter(node => node.kind === 'browser').map(node => [node.sessionId, { id: node.sessionId, partition: 'fixture', activeTabId: node.activeTarget, tabs: [{ id: node.activeTarget, url: node.url, title: 'Fixture', status: 'ready' }], createdAt: 1 }]))
  useRuntimeStore.setState({ sessions, captures: {}, assets: {}, runs: {}, aiSessions: { 'fixture-chat': { id: 'fixture-chat', nodeId: 'node-0', title: 'Local stream', messages: [], createdAt: 1, updatedAt: 1 } } })
  useUiStore.setState({ showNodePanel: false, showExtensionPanel: false, showMinimap: false })
  flushSync(() => {
    graph().openDocument({ id: 'fixture-document', name: 'Product acceptance', nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id })), viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
    graph().setSelection(nodes.slice(0, 20).map(node => node.id))
    root.render(<Profiler id="canvas" onRender={() => { commits++ }}><CanvasViewport>{renderNode}</CanvasViewport></Profiler>)
  })
  for (let warm = 0; warm < 8; warm++) await frame()
  if (!canvas || !commits) throw new Error('Canvas or profiling instrumentation is unavailable')
  await window.benchmarkBridge.prepare()
  let graphWrites = 0
  let viewportWrites = 0
  let sessionWrites = 0
  const unsubscribe = useGraphStore.subscribe((state, previous) => { if (state.currentDocument !== previous.currentDocument) graphWrites++; if (state.view !== previous.view) viewportWrites++ })
  const unsubscribeRuntime = useRuntimeStore.subscribe((state, previous) => { if (state.aiSessions !== previous.aiSessions) sessionWrites++ })
  const intervals = []
  const updateTimes = []
  const longTasks = []
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration) })
  observer.observe({ type: 'longtask', buffered: false })
  commits = 0
  const streaming = action === 'stream' || action === 'mixed'
  if (streaming) {
    const send = document.querySelector('[data-content-node="node-0"] [aria-label="发送消息"]')
    if (!send || send.disabled) throw new Error('Real AI send button is unavailable')
    send.click()
    await waitFor(async () => (await window.benchmarkBridge.stats()).ready, 'production AI stream open')
  }
  const pointer = (offset, button = 0) => ({ screen: { x: offset, y: offset / 2 }, world: { x: offset, y: offset / 2 }, button, shiftKey: false, ctrlKey: false, metaKey: false })
  const dragFrames = action === 'drag' ? frames : action === 'mixed' ? Math.floor(frames / 2) : 0
  if (dragFrames) canvas.pointerDown(pointer(0), 'node-0')
  if (action === 'pan') canvas.pointerDown(pointer(0, 1))
  let previousTime = performance.now()
  for (let index = 0; index < frames; index++) {
    if (action === 'mixed' && index === dragFrames) { canvas.pointerUp(pointer(dragFrames * 10)); canvas.pointerDown(pointer(0, 1)) }
    const started = performance.now()
    for (let eventIndex = 1; eventIndex <= 10; eventIndex++) {
      const offset = index * 10 + eventIndex
      if (index < dragFrames) canvas.pointerMove(pointer(offset))
      else if (action === 'pan' || action === 'mixed') canvas.pointerMove(pointer((index - dragFrames) * 10 + eventIndex, 1))
      else if (action === 'zoom') document.querySelector('[data-cnote-canvas]').dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 640, clientY: 400, bubbles: true, cancelable: true }))
    }
    if (streaming) await window.benchmarkBridge.push(10, false)
    updateTimes.push(performance.now() - started)
    await frame()
    const time = performance.now()
    intervals.push(time - previousTime)
    previousTime = time
  }
  if (action === 'drag') canvas.pointerUp(pointer(frames * 10))
  if (action === 'pan' || action === 'mixed') canvas.pointerUp(pointer((frames - dragFrames) * 10, 1))
  if (streaming) {
    await window.benchmarkBridge.push(0, true)
    await waitFor(() => Boolean(document.querySelector('[data-content-node="node-0"] [aria-label="发送消息"]')), 'production AI finish')
  }
  await frame()
  unsubscribe(); unsubscribeRuntime(); observer.disconnect()
  const reply = useRuntimeStore.getState().aiSessions['fixture-chat'].messages.filter(message => message.role === 'assistant').at(-1)?.content || ''
  if (dragFrames && nodes.slice(0, 20).some((node, index) => graph().currentDocument.nodes[index].position.x !== node.position.x + dragFrames * 10)) throw new Error('Final drag position mismatch')
  if (streaming && reply !== ' text'.repeat(frames * 10)) throw new Error(`Stream mismatch: ${reply.length}`)
  const transport = await window.benchmarkBridge.stats()
  if (streaming && window.cnoteDesktop && !transport.readCalls) throw new Error('Desktop stream did not use the production read path')
  return { count, action, frameP95: percentile(intervals, .95), updateP95: percentile(updateTimes, .95), intervals, updateTimes, longTasks, graphWrites, viewportWrites, sessionWrites, reactCommits: commits, mounted: document.querySelectorAll('[data-content-node]').length, transport, finalReplyLength: reply.length }
}

window.addGuest = async index => {
  const guest = document.createElement('webview')
  guest.setAttribute('partition', 'final-fixture')
  guest.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0'
  guest.src = `${location.origin}/guest?index=${index}`
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Guest readiness timeout')), 15000)
    guest.addEventListener('dom-ready', () => { clearTimeout(timer); resolve() }, { once: true })
    document.body.append(guest)
  })
  await guest.executeJavaScript(`document.querySelector('input').value = 'state-${index}'`)
  guest.style.left = '-5000px'
}
window.verifyGuests = async () => {
  const guests = [...document.querySelectorAll('webview')]
  for (let index = 0; index < guests.length; index++) {
    guests[index].style.left = '0px'
    if (await guests[index].executeJavaScript('document.querySelector("input").value') !== `state-${index}`) throw new Error('Guest state lost after offscreen return')
    guests[index].style.left = '-5000px'
  }
  return guests.length
}
