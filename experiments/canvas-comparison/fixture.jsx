import React, { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ReactFlow, { Handle, Position } from 'reactflow'
import 'reactflow/dist/style.css'
import './fixture.css'
import { CanvasViewport } from '@/canvas/components/CanvasViewport'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { collectContentMountPinIds, shouldMountNodeContent, visibleWorldRect } from '@/canvas/components/content-visibility'
import processor from './processor.cjs'

const root = createRoot(document.getElementById('root'))
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0
const viewportContext = createContext({ x: 0, y: 0, zoom: 1 })
let controller
let counters = { renders: 0, mounts: 0, unmounts: 0 }
const worker = new Worker(URL.createObjectURL(new Blob([`const serializeEntities = ${processor.serializeEntities.toString()}; onmessage = ({data}) => { const start = performance.now(); postMessage({serialized:serializeEntities(data),computeMs:performance.now()-start}); };`], { type: 'text/javascript' })))
const ports = new Map()
window.addEventListener('message', event => { if (event.source === window && event.data?.type === 'bench:port') ports.set(event.data.id, event.ports[0]) })

function createNodes(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, kind: 'sticky', label: `Node ${index}`, content: 'Fixture', color: '#fff', position: { x: index % 10 * 280 + 30, y: Math.floor(index / 10) * 180 + 30 }, size: { width: 240, height: 140 } }))
}

const Body = memo(function Body({ node, heavy = true, token = 0 }) {
  counters.renders++
  useEffect(() => { counters.mounts++; return () => { counters.unmounts++ } }, [])
  return <div className="bench-body" data-body={node.id}>
    <strong>{node.label}</strong><input defaultValue={`draft-${node.id}`} aria-label={node.id} />
    {heavy ? <><div contentEditable suppressContentEditableWarning>Editable text 中文 alignment and selection</div>{Array.from({ length: 6 }, (_, index) => <p key={index}>A paragraph with <b>rich text</b>, a link and deterministic content. {index}</p>)}</> : <p>Short note</p>}
    <span>{token}</span>
  </div>
})

function edgePath(source, target) {
  const startX = source.position.x + 240
  const startY = source.position.y + 70
  const endX = target.position.x
  const endY = target.position.y + 70
  return `M${startX},${startY} C${startX + 40},${startY} ${endX - 40},${endY} ${endX},${endY}`
}

function Edges({ nodes }) {
  return <svg style={{ position: 'absolute', width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>{nodes.slice(1).map((node, index) => <path key={node.id} d={edgePath(nodes[index], node)} stroke="#999" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />)}</svg>
}

function CurrentNode({ node }) {
  const viewport = useContext(viewportContext)
  return <div className="bench-shell" style={{ left: viewport.x + node.position.x * viewport.zoom, top: viewport.y + node.position.y * viewport.zoom, width: 240 * viewport.zoom, height: 140 * viewport.zoom }}><div style={{ zoom: viewport.zoom }}><Body node={node} /></div></div>
}

function CurrentEdges({ nodes }) {
  const viewport = useContext(viewportContext)
  const transformed = nodes.map(node => ({ ...node, position: { x: node.position.x * viewport.zoom + viewport.x, y: node.position.y * viewport.zoom + viewport.y } }))
  return <svg style={{ position: 'absolute', width: '100%', height: '100%' }}>{transformed.slice(1).map((node, index) => {
    const source = transformed[index]
    const startX = source.position.x + 240 * viewport.zoom
    const startY = source.position.y + 70 * viewport.zoom
    const endX = node.position.x
    const endY = node.position.y + 70 * viewport.zoom
    return <path key={node.id} d={`M${startX},${startY} C${startX + 40 * viewport.zoom},${startY} ${endX - 40 * viewport.zoom},${endY} ${endX},${endY}`} stroke="#999" strokeWidth="1.5" fill="none" />
  })}</svg>
}

function CurrentModel({ initial }) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [nodes, setNodes] = useState(initial)
  useLayoutEffect(() => { controller = { viewport: setViewport, nodes: setNodes } }, [])
  return <div className="bench-scene"><viewportContext.Provider value={viewport}><CurrentEdges nodes={nodes} />{nodes.map(node => <CurrentNode key={node.id} node={node} />)}</viewportContext.Provider></div>
}

function SharedModel({ initial }) {
  const [nodes, setNodes] = useState(initial)
  useLayoutEffect(() => { controller = { viewport: viewport => { document.getElementById('shared-world').style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }, nodes: setNodes } }, [])
  return <div className="bench-scene"><div id="shared-world" className="bench-world"><Edges nodes={nodes} />{nodes.map(node => <div key={node.id} className="bench-shell" style={{ left: node.position.x, top: node.position.y }}><Body node={node} /></div>)}</div></div>
}

const FlowNode = memo(({ data }) => <><Handle type="target" position={Position.Left} /><Body node={data.node} /><Handle type="source" position={Position.Right} /></>)
const nodeTypes = { bench: FlowNode }
const FlowShell = memo(() => <><Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} /></>)
const liftedTypes = { bench: FlowShell }
function FlowModel({ initial, lifted = false }) {
  const [nodes, setNodes] = useState(initial)
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 })
  const flowCache = useRef(new Map())
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  function updateLifted(viewport) {
    viewportRef.current = viewport
    if (!lifted) return
    for (const node of nodesRef.current) {
      const shell = document.getElementById(`lifted-${node.id}`)
      if (!shell) continue
      shell.style.transform = `translate(${viewport.x + node.position.x * viewport.zoom}px,${viewport.y + node.position.y * viewport.zoom}px)`
      shell.style.width = `${240 * viewport.zoom}px`
      shell.style.height = `${140 * viewport.zoom}px`
      shell.firstElementChild.style.zoom = viewport.zoom
    }
  }
  useLayoutEffect(() => { updateLifted(viewportRef.current) }, [nodes])
  const flowNodes = useMemo(() => nodes.map(node => {
    const previous = flowCache.current.get(node.id)
    if (previous?.data.node === node) return previous
    const next = { id: node.id, type: 'bench', position: node.position, data: { node }, style: { width: 240, height: 140 } }
    flowCache.current.set(node.id, next)
    return next
  }), [nodes])
  const edges = useMemo(() => initial.slice(1).map((node, index) => ({ id: `edge-${index}`, source: initial[index].id, target: node.id })), [initial])
  return <div className="bench-scene"><ReactFlow nodes={flowNodes} edges={edges} nodeTypes={lifted ? liftedTypes : nodeTypes} onInit={instance => { controller = { viewport: viewport => { instance.setViewport(viewport); updateLifted(viewport) }, nodes: setNodes } }} onlyRenderVisibleElements={false} proOptions={{ hideAttribution: true }} />{lifted ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{nodes.map(node => <div id={`lifted-${node.id}`} key={node.id} className="bench-shell"><div><Body node={node} /></div></div>)}</div> : null}</div>
}

function ScaleModel({ nodes, variant }) {
  useLayoutEffect(() => {
    controller = { viewport: viewport => {
      for (const node of nodes) {
        const shell = document.getElementById(node.id)
        shell.style.transform = `translate(${viewport.x + node.position.x * viewport.zoom}px,${viewport.y + node.position.y * viewport.zoom}px)`
        shell.style.width = `${240 * viewport.zoom}px`
        shell.style.height = `${140 * viewport.zoom}px`
        if (variant === 'zoom') shell.firstElementChild.style.zoom = viewport.zoom
        else shell.firstElementChild.style.transform = `scale(${viewport.zoom})`
      }
    } }
  }, [])
  return <div className="bench-scene">{nodes.map(node => <div key={node.id} id={node.id} className="bench-shell"><div style={{ width: 240, height: 140, transformOrigin: '0 0' }}><Body node={node} /></div></div>)}</div>
}

function VirtualModel({ nodes, variant, heavy, steady }) {
  const [state, setState] = useState({ viewport: { x: 0, y: 0, zoom: 1 }, tick: 0 })
  useLayoutEffect(() => { controller = { viewport: (viewport, tick) => setState({ viewport, tick }) } }, [])
  const streaming = steady || state.tick % 20 < 10
  const pins = collectContentMountPinIds(nodes, { selection: [nodes[0].id], inflightAINodeIds: streaming ? [nodes[nodes.length - 1].id] : [] })
  const visible = visibleWorldRect(state.viewport, { width: 1440, height: 900 })
  const all = variant === 'all' || (variant === 'threshold24-global' && (nodes.length < 24 || streaming)) || (variant === 'adaptive-pin' && nodes.length * (heavy ? 6 : 1) < 64)
  return <div className="bench-scene">{nodes.map(node => <div key={node.id} className="bench-shell" style={{ left: node.position.x + state.viewport.x, top: node.position.y + state.viewport.y }}>{all || shouldMountNodeContent(node, visible, pins) ? <Body node={node} heavy={heavy} token={streaming && node.id === nodes[nodes.length - 1].id ? state.tick : 0} /> : null}</div>)}</div>
}

function MaterialModel({ nodes, variant }) {
  useLayoutEffect(() => { controller = { viewport: viewport => {
    document.getElementById('material-world').style.transform = `translate(${viewport.x}px,${viewport.y}px)`
    document.getElementById('dots').style.backgroundPosition = `${viewport.x}px ${viewport.y}px`
  } } }, [])
  return <div className="bench-scene" style={{ background: variant === 'gradient' || variant === 'combined' ? 'radial-gradient(circle at 50% -20%,#fff,transparent 60%),linear-gradient(#f8f8f7,#ededeb)' : '#f8f8f7' }}>
    <div id="dots" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle,#bbb 1px,transparent 1px)', backgroundSize: '24px 24px' }} />
    {variant === 'noise' || variant === 'combined' ? <div className="bench-noise" /> : null}
    <div id="material-world" className="bench-world">{nodes.map(node => <div key={node.id} className="bench-shell" style={{ left: node.position.x, top: node.position.y }}><Body node={node} /></div>)}</div>
  </div>
}

function mount(input) {
  const nodes = createNodes(input.count || 30)
  controller = null
  flushSync(() => root.render(null))
  const choice = input.group === 'scale' ? <ScaleModel nodes={nodes} variant={input.variant} />
    : input.group.startsWith('virtual') ? <VirtualModel nodes={nodes} variant={input.variant} heavy={input.heavy} steady={input.group === 'virtual-steady'} />
      : input.group === 'material' ? <MaterialModel nodes={nodes} variant={input.variant} />
        : input.variant === 'shared-transform' ? <SharedModel initial={nodes} />
          : input.variant === 'reactflow-11' || input.variant === 'reactflow-lifted' ? <FlowModel initial={nodes} lifted={input.variant === 'reactflow-lifted'} />
            : input.variant.startsWith('production-') ? <CanvasViewport>{node => <Body node={node} />}</CanvasViewport>
              : <CurrentModel initial={nodes} />
  if (input.variant.startsWith('production-')) {
    useUiStore.setState({ showNodePanel: false, showExtensionPanel: false })
    useGraphStore.getState().openDocument({ id: 'isolated-benchmark', name: 'Isolated benchmark', schemaVersion: 2, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id })), viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 })
    controller = { viewport: view => useGraphStore.getState().setViewport(view), nodes: next => {
      if (input.variant === 'production-current') next.slice(0, 20).forEach(node => useGraphStore.getState().updateNode(node.id, { position: node.position }))
      else {
        const changes = new Map(next.slice(0, 20).map(node => [node.id, node.position]))
        useGraphStore.setState(state => ({ currentDocument: { ...state.currentDocument, nodes: state.currentDocument.nodes.map(node => changes.has(node.id) ? { ...node, position: changes.get(node.id) } : node), updatedAt: Date.now() } }))
      }
    } }
  }
  flushSync(() => root.render(choice))
  return nodes
}

async function visual(input) {
  const nodes = mount(input)
  for (let index = 0; index < 8; index++) await nextFrame()
  if (!controller) throw new Error('Scene controller unavailable')
  counters = { renders: 0, mounts: 0, unmounts: 0 }
  const intervals = []
  const writes = []
  const longTasks = []
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
  observer.observe({ type: 'longtask' })
  const before = await window.benchHost.metrics()
  let graphWrites = 0
  let positionsCorrect = true
  const unsubscribe = useGraphStore.subscribe(() => { graphWrites++ })
  let previous = await nextFrame()
  for (let frame = 0; frame < input.frames; frame++) {
    const started = performance.now()
    const progress = frame / Math.max(1, input.frames - 1)
    const displacement = Math.sin(progress * Math.PI * 2)
    const viewport = { x: -800 * Math.sin(progress * Math.PI) ** 2, y: -180 * Math.sin(progress * Math.PI) ** 2, zoom: input.action === 'zoom' ? 0.65 + (displacement + 1) * 0.4 : 1 }
    flushSync(() => {
      if (input.action === 'drag') controller.nodes(nodes.map((node, index) => index < 20 ? { ...node, position: { x: node.position.x + displacement * 180, y: node.position.y + displacement * 90 } } : node))
      else controller.viewport(viewport, frame)
    })
    if (input.variant.startsWith('production-') && input.action === 'drag') {
      const current = useGraphStore.getState().currentDocument.nodes
      positionsCorrect &&= current.every((node, index) => Math.abs(node.position.x - (nodes[index].position.x + (index < 20 ? displacement * 180 : 0))) < .000001 && Math.abs(node.position.y - (nodes[index].position.y + (index < 20 ? displacement * 90 : 0))) < .000001)
    }
    writes.push(performance.now() - started)
    const timestamp = await nextFrame()
    intervals.push(timestamp - previous)
    previous = timestamp
  }
  await nextFrame()
  const after = await window.benchHost.metrics()
  unsubscribe()
  observer.disconnect()
  const delta = name => (after[name] || 0) - (before[name] || 0)
  const pinnedPresent = !input.group.startsWith('virtual') || Boolean(document.querySelector('[data-body="node-0"]'))
  return { frameMedianMs: percentile(intervals, .5), frameP95Ms: percentile(intervals, .95), framesOver25Ms: intervals.filter(value => value > 25).length, writeP95Ms: percentile(writes, .95), layoutMs: delta('LayoutDuration') * 1000, styleMs: delta('RecalcStyleDuration') * 1000, scriptMs: delta('ScriptDuration') * 1000, taskMs: delta('TaskDuration') * 1000, layouts: delta('LayoutCount'), paints: delta('paintCount'), heapMiB: after.JSHeapUsedSize / 2 ** 20, mounted: document.querySelectorAll('[data-body]').length, ...counters, longTasks, graphWrites, correct: pinnedPresent && positionsCorrect, intervals }
}

async function transport(input) {
  const started = performance.timeOrigin + performance.now()
  const metadata = await window.benchHost.prepare(input)
  const deltas = []
  const decoder = new TextDecoder()
  let pending = ''
  let received = 0
  let correct = true
  let firstMs
  const accept = bytes => {
    pending += decoder.decode(bytes, { stream: true })
    let split
    while ((split = pending.indexOf('\n')) >= 0) {
      const value = JSON.parse(pending.slice(0, split))
      pending = pending.slice(split + 1)
      const receivedAt = performance.timeOrigin + performance.now()
      firstMs ??= receivedAt - started
      deltas.push(receivedAt - value.sentAt)
      correct &&= value.sequence === received++ && value.text === '汉😀'.repeat(Math.ceil(input.bytes / 7))
    }
  }
  if (input.variant === 'ipc-pull') {
    let bytes
    while ((bytes = await window.benchHost.read(metadata.id)) !== null) accept(new Uint8Array(bytes))
  } else if (input.variant === 'http') {
    const response = await fetch(metadata.url, { headers: { 'X-Bench-Token': metadata.token } })
    if (!response.ok) throw new Error(`HTTP benchmark ${response.status}`)
    const reader = response.body.getReader()
    while (true) { const packet = await reader.read(); if (packet.done) break; accept(packet.value) }
  } else {
    while (!ports.has(metadata.id)) await wait(1)
    const port = ports.get(metadata.id)
    await new Promise(resolve => {
      port.onmessage = ({ data }) => { if (data.done) { port.close(); resolve(); return }; accept(new Uint8Array(data.bytes)); port.postMessage({ credit: 1 }) }
      port.start()
      port.postMessage({ credit: 4 })
    })
    ports.delete(metadata.id)
  }
  const elapsedMs = performance.timeOrigin + performance.now() - started
  const remaining = await window.benchHost.cancel(metadata.id)
  return { firstMs, elapsedMs, deliveryMedianMs: percentile(deltas, .5), deliveryP95Ms: percentile(deltas, .95), received, correct: correct && received === input.count && pending === '' && remaining.outstanding === 0 }
}

async function isolation(input) {
  const text = 'A persisted transcript 中文 with messages and metadata. '.repeat(45)
  const entityBytes = new TextEncoder().encode(text).length
  const count = Math.max(1, Math.ceil(input.megabytes * 2 ** 20 / entityBytes))
  const entities = Array.from({ length: count }, (_, index) => ({ id: `session-${index}`, nodeId: `node-${index}`, title: 'Fixture session', messages: [{ role: 'assistant', content: text, createdAt: 1 }], updatedAt: 1 }))
  const expected = processor.serializeEntities(entities)
  await nextFrame()
  let last = performance.now()
  let worstGapMs = 0
  const timer = setInterval(() => { const stamp = performance.now(); worstGapMs = Math.max(worstGapMs, stamp - last); last = stamp }, 2)
  const started = performance.now()
  let output
  if (input.variant === 'renderer') { const begin = performance.now(); output = { serialized: processor.serializeEntities(entities), computeMs: performance.now() - begin } }
  else if (input.variant === 'worker') output = await new Promise(resolve => { worker.onmessage = ({ data }) => resolve(data); worker.postMessage(entities) })
  else output = await window.benchHost.utility(entities)
  const elapsedMs = performance.now() - started
  await wait(15)
  clearInterval(timer)
  return { elapsedMs, computeMs: output.computeMs, worstGapMs, entityCount: count, correct: output.serialized.length === expected.length && output.serialized.every((value, index) => value === expected[index]) }
}

window.runCase = async input => {
  flushSync(() => root.render(null))
  if (input.group === 'transport') return transport(input)
  if (input.group === 'isolation') return isolation(input)
  return visual(input)
}
window.warmup = async () => {
  for (const variant of ['current-model', 'shared-transform', 'reactflow-11', 'reactflow-lifted', 'production-current']) await visual({ group: 'engine', variant, count: 30, action: 'zoom', frames: 5 })
  for (const variant of ['renderer', 'worker', 'utility']) await isolation({ variant, megabytes: .1 })
}

window.checkCapabilities = async () => {
  const editing = []
  for (const variant of ['zoom', 'transform']) {
    mount({ group: 'scale', variant, count: 1 })
    for (const zoom of [.25, .5, 1, 2]) {
      controller.viewport({ x: 50, y: 50, zoom })
      await nextFrame()
      const input = document.querySelector('[data-body] input')
      input.focus()
      input.value = 'Persisted selection 中文'
      input.setSelectionRange(2, 7)
      controller.viewport({ x: 70, y: 60, zoom })
      await nextFrame()
      const rect = input.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      editing.push({ variant, zoom, focused: document.activeElement === input, selectionPreserved: input.selectionStart === 2 && input.selectionEnd === 7, hitCorrect: hit === input, width: rect.width })
    }
  }
  flushSync(() => root.render(null))
  const guestRows = []
  for (const variant of ['lifted', 'transform', 'zoom']) {
    const frame = document.createElement('div')
    frame.style.cssText = 'position:absolute;left:20px;top:20px;width:300px;height:200px;transform-origin:0 0;'
    const guest = document.createElement('webview')
    guest.style.cssText = 'display:flex;width:300px;height:200px;'
    guest.setAttribute('partition', 'benchmark-ephemeral')
    guest.setAttribute('src', `${location.origin}/guest`)
    frame.appendChild(guest)
    document.body.appendChild(frame)
    try {
      await Promise.race([new Promise(resolve => guest.addEventListener('dom-ready', resolve, { once: true })), wait(5000).then(() => { throw new Error('Guest timeout') })])
      for (const zoom of [.25, .5, 1, 2]) {
        if (variant === 'transform') frame.style.transform = `scale(${zoom})`
        else if (variant === 'zoom') frame.style.zoom = zoom
        else { guest.style.width = `${300 * zoom}px`; guest.style.height = `${200 * zoom}px` }
        await wait(70)
        const rect = guest.getBoundingClientRect()
        const guestState = await guest.executeJavaScript('({clicks:window.clicks,width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,value:document.getElementById("input").value})')
        const contentScale = variant === 'lifted' ? 1 : zoom
        const point = { x: rect.x + Math.min(100, guestState.clientWidth - 5) * contentScale, y: rect.y + Math.min(45, guestState.clientHeight - 5) * contentScale }
        const hit = document.elementFromPoint(point.x, point.y)
        await window.benchHost.click(point)
        await wait(50)
        const clicks = await guest.executeJavaScript('window.clicks')
        guestRows.push({ variant, zoom, width: rect.width, height: rect.height, guestWidth: guestState.width, guestHeight: guestState.height, preserved: guestState.value === 'preserved', hostHitCorrect: hit === guest, nativeClick: clicks === guestState.clicks + 1 })
      }
    } catch (error) { guestRows.push({ variant, error: String(error) }) }
    frame.remove()
  }
  return { editing, guestRows, notCovered: ['IME composition', 'text sharpness preference', 'full production menu layering', 'React Flow lifted prototype with production browser and editor behavior', 'full undo/redo and persistent session restoration'] }
}

window.checkTransport = async () => {
  const checks = []
  const input = { rate: 200, bytes: 128, count: 50 }
  const ipc = await window.benchHost.prepare({ ...input, variant: 'ipc-pull' })
  await window.benchHost.read(ipc.id)
  await window.benchHost.cancel(ipc.id)
  checks.push({ variant: 'ipc-pull', cancelPassed: await window.benchHost.read(ipc.id) === null })
  const metadata = await window.benchHost.prepare({ ...input, variant: 'message-port' })
  while (!ports.has(metadata.id)) await wait(1)
  const port = ports.get(metadata.id)
  let received = 0
  port.onmessage = ({ data }) => { if (data.bytes) received++ }
  port.start()
  port.postMessage({ credit: 2 })
  await wait(100)
  const bounded = received === 2
  await window.benchHost.cancel(metadata.id)
  const before = received
  await wait(30)
  port.close()
  ports.delete(metadata.id)
  checks.push({ variant: 'message-port', boundedCreditsPassed: bounded, cancelPassed: received === before })
  const http = await window.benchHost.prepare({ ...input, variant: 'http' })
  const controller = new AbortController()
  const response = await fetch(http.url, { headers: { 'X-Bench-Token': http.token }, signal: controller.signal })
  const reader = response.body.getReader()
  await reader.read()
  controller.abort()
  let aborted = false
  try { await reader.read() } catch (error) { aborted = error.name === 'AbortError' }
  await wait(30)
  const remaining = await window.benchHost.cancel(http.id)
  checks.push({ variant: 'http', cancelPassed: aborted, outstanding: remaining.outstanding })
  return checks
}

window.compareAnimations = () => {
  const results = []
  for (const distance of [100, 2000]) {
    for (const changingTarget of [false, true]) {
      for (const variant of ['instant', 'ease220', 'spring-critical', 'spring-underdamped', 'two-stage']) {
        let position = 0
        let velocity = 0
        let target = distance
        let origin = 0
        let phaseStart = 0
        let maxPosition = 0
        let settledAt = null
        let targetChangeVelocityJump = 0
        let previousVelocity = 0
        const samples = []
        for (let frame = 0; frame < 180; frame++) {
          const time = frame / 120
          if (changingTarget && frame === 18) { origin = position; target = distance * .5; phaseStart = time }
          const previous = position
          if (variant === 'instant') position = target
          else if (variant === 'ease220' || (variant === 'two-stage' && time < .4)) {
            const fraction = Math.min(1, (time - phaseStart) / (variant === 'two-stage' ? .4 : .22))
            position = origin + (target - origin) * (1 - (1 - fraction) ** 3)
          } else {
            const stiffness = variant === 'two-stage' ? 400 : 250
            const damping = variant === 'spring-critical' ? 2 * Math.sqrt(stiffness) : 25
            if (variant === 'two-stage' && frame === 48) velocity = previousVelocity
            velocity += (stiffness * (target - position) - damping * velocity) / 120
            position += velocity / 120
          }
          const measuredVelocity = (position - previous) * 120
          if (changingTarget && frame === 18) targetChangeVelocityJump = Math.abs(measuredVelocity - previousVelocity)
          previousVelocity = measuredVelocity
          maxPosition = Math.max(maxPosition, position)
          samples.push({ time, error: Math.abs(position - target), speed: Math.abs(measuredVelocity) })
        }
        const lastTargetChange = changingTarget ? .15 : 0
        for (let index = 0; index < samples.length; index++) {
          if (samples[index].time >= lastTargetChange && samples.slice(index).every(sample => sample.error < 1 && sample.speed < 5)) { settledAt = (samples[index].time - lastTargetChange) * 1000; break }
        }
        results.push({ distance, changingTarget, variant, settledMs: settledAt, overshootPx: changingTarget ? null : Math.max(0, maxPosition - distance), targetChangeVelocityJump, scope: 'deterministic 120Hz scalar camera simulation, not human preference evidence' })
      }
    }
  }
  return results
}
