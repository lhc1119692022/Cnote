import assert from 'node:assert/strict'
import { sourceLoader } from './helpers/load-source.mjs'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const load = sourceLoader()
const { collectUpstreamInputs, upstreamNodeInput } = load('lib/flow/upstream-inputs')
const { collectUpstreamNodes, collectUpstreamText, resolveRequestGenerationInputs } = load('canvas/contents/request-generation')
const { useRuntimeStore } = load('stores/runtime-store')
const base = { position: { x: 0, y: 0 }, size: { width: 200, height: 120 } }
const nodes = [
  { ...base, id: 'second', kind: 'sticky', label: 'Second', content: 'second text' },
  { ...base, id: 'first', kind: 'content', category: 'text', label: 'First', content: 'first text' },
  { ...base, id: 'disabled', kind: 'sticky', label: 'Disabled', content: 'do not send', disabled: true },
  { ...base, id: 'empty-ai', kind: 'ai', label: 'Must not be sent as body', activeSessionId: 'session-1' },
  { ...base, id: 'browser', kind: 'browser', label: 'Page', url: 'https://fixture.invalid', latestCaptureId: 'capture-1' },
  { ...base, id: 'image', kind: 'content', category: 'image', label: 'Image', source: { kind: 'file', assetId: 'asset-1', mimeType: 'image/png' } },
]
const edges = [
  { id: 'edge-1', source: 'first', target: 'target' },
  { id: 'edge-2', source: 'second', target: 'target' },
  { id: 'duplicate', source: 'first', target: 'target' },
  { id: 'disabled-edge', source: 'disabled', target: 'target' },
  { id: 'deleted-edge', source: 'deleted', target: 'target' },
  { id: 'ai-edge', source: 'empty-ai', target: 'target' },
  { id: 'browser-edge', source: 'browser', target: 'target' },
  { id: 'ancestor-edge', source: 'image', target: 'first' },
]
const inputs = collectUpstreamInputs('target', nodes, edges)
assert.deepEqual(inputs.map(entry => entry.nodeId), ['first', 'second', 'empty-ai', 'browser'])
assert.deepEqual(inputs[0].edgeIds, ['edge-1', 'duplicate'])
assert.equal(inputs[2].text, '')
assert.equal(inputs[2].availability, 'empty')
assert.equal(inputs[3].availability, 'url-only')
assert.equal(upstreamNodeInput(nodes[5]).resources[0].assetId, 'asset-1')
const runtime = { captures: { 'capture-1': { id: 'capture-1', text: 'captured body' } }, aiSessions: { 'session-1': { id: 'session-1', messages: [{ role: 'user', content: 'not output' }, { role: 'assistant', content: 'latest output' }] } } }
useRuntimeStore.setState(runtime)
const preview = collectUpstreamInputs('target', nodes, edges, runtime)
const generationNodes = collectUpstreamNodes('target', nodes, edges)
assert.deepEqual(generationNodes.map(node => node.id), preview.map(entry => entry.nodeId))
const expectedText = preview.map(entry => entry.text).filter(Boolean).join('\n\n')
assert.equal(collectUpstreamText(generationNodes), expectedText)
const submitted = resolveRequestGenerationInputs({ requestNodeId: 'target', variant: 'image', config: { prompt: 'instruction' }, nodes, edges, assets: {}, runs: {} })
assert.equal(submitted.prompt, `instruction\n\n${expectedText}`)
useRuntimeStore.setState({ aiSessions: { 'session-1': { ...runtime.aiSessions['session-1'], messages: [{ role: 'assistant', content: 'updated before send' }] } } })
assert.ok(collectUpstreamText(generationNodes).includes('updated before send'))
assert.ok(!collectUpstreamText(generationNodes).includes('Must not be sent as body'))
assert.equal(collectUpstreamInputs('target', nodes.filter(node => node.id !== 'first'), edges).some(entry => entry.nodeId === 'first'), false)
const dom = new JSDOM('<div id="app"></div>', { url: 'https://fixture.invalid' })
for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { UpstreamInputChips } = load('canvas/components/UpstreamInputChips')
const root = createRoot(document.getElementById('app'))
const renderInputs = entries => root.render(React.createElement(UpstreamInputChips, { inputs: entries, targetLabel: 'Generate' }))
await act(async () => renderInputs(inputs))
assert.equal(document.querySelectorAll('[aria-label="预览上游 First"]').length, 1)
assert.ok(document.body.textContent.includes('仅网址'))
assert.ok(document.body.textContent.includes('暂无输出'))
assert.equal(document.querySelector('[aria-label^="定位来源"]'), null)
assert.ok(document.querySelector('[aria-label="预览上游 First"]').title.includes('edge-1, duplicate'))
await act(async () => document.querySelector('[aria-label="预览上游 First"]').click())
assert.equal(document.querySelector('[role="region"]').textContent, 'first text')
await act(async () => renderInputs(collectUpstreamInputs('target', nodes.map(node => node.id === 'first' ? { ...node, content: 'new text before send' } : node), edges, runtime)))
assert.equal(document.querySelector('[role="region"]').textContent, 'new text before send')
await act(async () => renderInputs(collectUpstreamInputs('target', nodes.filter(node => node.id !== 'first'), edges, runtime)))
assert.equal(document.querySelector('[role="region"]'), null)
await act(async () => root.unmount())
dom.window.close()
console.log('upstream contract: ordering/filtering, preview/send snapshots, live text preview, empty/URL statuses and no source locator passed')
