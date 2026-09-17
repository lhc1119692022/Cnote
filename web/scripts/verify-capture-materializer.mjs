import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const modules = new Map()

function evaluate(source, requireModule = require) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, requireModule)
  return module.exports
}

function sourcePath(relativeOrAbsolute) {
  const base = resolve(sourceRoot, relativeOrAbsolute)
  if (existsSync(base) && /\.(ts|tsx)$/.test(base)) return base
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext
  }
  return base
}

function load(relativePath) {
  const path = sourcePath(relativePath)
  if (modules.has(path)) return modules.get(path)
  const result = evaluate(readFileSync(path, 'utf8'), (specifier) => {
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  modules.set(path, result)
  return result
}

const { useGraphStore } = load('stores/graph-store.ts')
const { materializeBrowserCapture } = load('runtime/capture-materializer.ts')
const { CONTENT_NODE_DEFAULT_SIZE } = load('lib/flow/node-dimensions.ts')

function browserDoc(overrides = {}) {
  return {
    id: 'flow-1',
    name: 't',
    title: 't',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'browser-1',
        kind: 'browser',
        position: { x: 100, y: 80 },
        size: { width: 920, height: 620 },
        label: '浏览器',
        url: 'https://example.com',
        ...overrides,
      },
    ],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function capture(partial = {}) {
  return {
    id: 'cap-1',
    sessionId: 'session-1',
    url: 'https://example.com/article',
    title: 'Example article',
    html: '<p>hello</p>',
    text: 'Hello body',
    fetchedAt: 20,
    ...partial,
  }
}

function open(doc = browserDoc()) {
  useGraphStore.getState().closeDocument()
  useGraphStore.getState().openDocument(doc)
}

function live() {
  const doc = useGraphStore.getState().currentDocument
  assert.ok(doc)
  return doc
}

function browserNode() {
  const node = live().nodes.find((item) => item.id === 'browser-1')
  assert.equal(node?.kind, 'browser')
  return node
}

function contentNodes() {
  return live().nodes.filter((node) => node.kind === 'content')
}

open()
const first = materializeBrowserCapture('browser-1', capture())
assert.equal(first.status, 'applied')
assert.equal(first.created, true)
assert.equal(useGraphStore.getState().historyIndex, 1)

const created = contentNodes()
assert.equal(created.length, 1)
assert.equal(created[0].id, first.contentNodeId)
assert.equal(created[0].category, 'text')
assert.equal(created[0].subtype, 'markdown')
assert.equal(created[0].captureId, 'cap-1')
assert.equal(created[0].content, 'Hello body')
assert.equal(created[0].label, 'Example article')
assert.equal(created[0].sourceId, undefined)
assert.deepEqual(created[0].source, { kind: 'url', url: 'https://example.com/article', provider: 'generic' })
assert.equal(created[0].position.x, 100 + 920 + 88)
assert.equal(created[0].position.y, 80)
assert.equal(created[0].size.width, CONTENT_NODE_DEFAULT_SIZE.width)
assert.equal(created[0].size.height, CONTENT_NODE_DEFAULT_SIZE.height)

const browser = browserNode()
assert.equal(browser.latestCaptureId, 'cap-1')
assert.equal(browser.linkedContentNodeId, created[0].id)
assert.equal(live().edges.length, 1)
assert.equal(live().edges[0].source, 'browser-1')
assert.equal(live().edges[0].target, created[0].id)

// Same capture again (StrictMode / retry): no extra node, edge, or history commit.
const replay = materializeBrowserCapture('browser-1', capture())
assert.equal(replay.status, 'applied')
assert.equal(replay.created, false)
assert.equal(replay.contentNodeId, created[0].id)
assert.equal(contentNodes().length, 1)
assert.equal(live().edges.length, 1)
assert.equal(useGraphStore.getState().historyIndex, 1)

// Later captures reuse linkedContentNodeId and still commit once.
const second = materializeBrowserCapture('browser-1', capture({
  id: 'cap-2',
  title: 'Updated',
  text: 'New body',
  url: 'https://example.com/updated',
}))
assert.equal(second.status, 'applied')
assert.equal(second.created, false)
assert.equal(second.contentNodeId, created[0].id)
assert.equal(contentNodes().length, 1)
assert.equal(contentNodes()[0].captureId, 'cap-2')
assert.equal(contentNodes()[0].content, 'New body')
assert.equal(contentNodes()[0].label, 'Updated')
assert.equal(browserNode().latestCaptureId, 'cap-2')
assert.equal(browserNode().linkedContentNodeId, created[0].id)
assert.equal(live().edges.length, 1)
assert.equal(useGraphStore.getState().historyIndex, 2)

// Title/url without body still materializes; completely empty payload does not create a shell node.
open()
const titled = materializeBrowserCapture('browser-1', capture({
  id: 'cap-title-only',
  text: '   ',
  html: '',
  title: 'Only title',
  url: 'https://example.com',
}))
assert.equal(titled.status, 'applied')
assert.equal(titled.created, true)
assert.equal(contentNodes()[0].content, '   ')
assert.equal(contentNodes()[0].label, 'Only title')
assert.equal(contentNodes()[0].captureId, 'cap-title-only')
assert.deepEqual(contentNodes()[0].source, { kind: 'url', url: 'https://example.com', provider: 'generic' })

open()
const empty = materializeBrowserCapture('browser-1', capture({
  id: 'cap-empty',
  text: '  ',
  title: '',
  url: '',
  html: '<html></html>',
}))
assert.equal(empty.status, 'applied')
assert.equal(empty.created, false)
assert.equal(empty.contentNodeId, undefined)
assert.equal(contentNodes().length, 0)
assert.equal(live().edges.length, 0)
assert.equal(browserNode().latestCaptureId, 'cap-empty')
assert.equal(browserNode().linkedContentNodeId, undefined)

// Uses live graph state, not a stale linkedContentNodeId that no longer exists.
open(browserDoc({ linkedContentNodeId: 'missing-node' }))
const recreated = materializeBrowserCapture('browser-1', capture({ id: 'cap-recreate' }))
assert.equal(recreated.created, true)
assert.equal(contentNodes().length, 1)
assert.equal(browserNode().linkedContentNodeId, recreated.contentNodeId)
assert.notEqual(recreated.contentNodeId, 'missing-node')

open()
const withMedia = materializeBrowserCapture('browser-1', capture({
  id: 'cap-media',
  media: [
    { kind: 'url', url: 'https://cdn.example.com/shot.jpg', mimeType: 'image/jpeg' },
    { kind: 'url', url: 'https://cdn.example.com/clip.mp4', mimeType: 'video/mp4' },
  ],
}))
assert.equal(withMedia.status, 'applied')
assert.equal(withMedia.created, true)
const mediaNodes = contentNodes().filter((node) => node.category === 'image' || node.category === 'video')
assert.equal(mediaNodes.length, 2)
assert.equal(mediaNodes.some((node) => node.category === 'image' && node.source?.kind === 'url' && node.source.url === 'https://cdn.example.com/shot.jpg'), true)
assert.equal(mediaNodes.some((node) => node.category === 'video' && node.source?.kind === 'url' && node.source.url === 'https://cdn.example.com/clip.mp4'), true)
assert.equal(live().edges.filter((edge) => edge.source === 'browser-1').length, 3)

console.log('verify-capture-materializer: ok')
