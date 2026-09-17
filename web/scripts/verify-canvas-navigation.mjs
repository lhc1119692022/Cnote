import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const viewportSource = readFileSync(new URL('../src/canvas/components/CanvasViewport.tsx', import.meta.url), 'utf8')
assert.ok(viewportSource.includes("zIndex: 'var(--canvas-content-order, 0)'"))
assert.ok(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').includes('[data-content-node]:has(details[open] > [data-node-menu]) {\n  --canvas-content-order: 2;'))
assert.match(viewportSource, /zIndex: groups \? 5 : 15/)
assert.match(viewportSource, /data-canvas-edge-layer="true" className="[^"]*z-10"/)
assert.match(viewportSource, /nodes\.filter\(\(node\) => \(node\.kind === 'group'\) === groups\)/)
assert.match(viewportSource, /<CanvasContentOverlay renderNode=\{renderNode\} groups \/>/)
assert.match(viewportSource, /<CanvasContentOverlay renderNode=\{renderNode\} \/>/)
{
  const source = ts.createSourceFile('CanvasViewport.tsx', viewportSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let shells = 0
  let contents = 0
  const attribute = (element, name) => element.attributes.properties.some((item) => ts.isJsxAttribute(item) && item.name.getText(source) === name)
  const stackAncestor = (element) => {
    for (let parent = element.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) && attribute(parent.openingElement, 'data-canvas-node-stack')) return parent
    }
    return null
  }
  let shellStack
  let contentStack
  const visit = (element) => {
    if (ts.isJsxSelfClosingElement(element) && element.tagName.getText(source) === 'NodeShell') {
      shells++
      shellStack = stackAncestor(element)
      assert.ok(shellStack, 'Shell must share its node stacking context with content')
      for (let parent = element.parent; parent && parent !== shellStack; parent = parent.parent) {
        assert.ok(!ts.isConditionalExpression(parent), 'Content virtualization must not unmount the shell')
      }
    }
    if (ts.isJsxOpeningElement(element) && attribute(element, 'data-content-node')) {
      contents++
      contentStack = stackAncestor(element)
      for (let parent = element.parent; parent && parent !== contentStack; parent = parent.parent) {
        assert.ok(!ts.isJsxElement(parent) || parent.openingElement.tagName.getText(source) !== 'WorldLayer', 'Heavy content must stay outside the scaled world layer')
      }
    }
    ts.forEachChild(element, visit)
  }
  visit(source)
  assert.equal(shells, 1)
  assert.equal(contents, 1)
  assert.equal(shellStack, contentStack)
}
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const cache = new Map()

function withExt(base) {
  if (existsSync(base) && ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(base))) return base
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext
  }
  return base
}

function loadFrom(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.startsWith('@/')) return loadFrom(withExt(join(srcRoot, name.slice(2))))
    if (name.startsWith('.')) return loadFrom(withExt(join(dirname(filename), name)))
    return require(name)
  }, module, module.exports)
  return module.exports
}

const { nodeStackOrder, nodeFrontOrder, hitTestStackedNode } = loadFrom(join(srcRoot, 'canvas/node-stacking.ts'))
{
  const first = { id: 'first', kind: 'sticky', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }
  const second = { ...first, id: 'second' }
  const group = { ...first, id: 'group', kind: 'group', z: 999 }
  const nodes = [first, second, group]
  const idle = { hoveredNodeId: null, focusedNodeId: null, draggingNodeIds: [] }
  const point = { x: 50, y: 50 }
  assert.equal(nodeFrontOrder(nodes), 1000)
  assert.equal(hitTestStackedNode(nodes, point, idle), second.id)
  assert.equal(hitTestStackedNode([group, second, first], point, idle), first.id)
  assert.equal(hitTestStackedNode(nodes, point, { ...idle, hoveredNodeId: first.id }), first.id)
  assert.equal(hitTestStackedNode(nodes, point, { ...idle, focusedNodeId: first.id }), first.id)
  assert.equal(hitTestStackedNode(nodes, point, { ...idle, focusedNodeId: first.id, hoveredNodeId: second.id }), second.id)
  assert.equal(hitTestStackedNode(nodes, point, { ...idle, hoveredNodeId: second.id, resizingNodeId: first.id }), first.id)
  assert.equal(hitTestStackedNode(nodes, point, { ...idle, hoveredNodeId: second.id, draggingNodeIds: [first.id] }), first.id)
  assert.equal(hitTestStackedNode([group], point, idle), group.id)
  assert.equal(hitTestStackedNode(nodes, { x: 101, y: 50 }, idle), undefined)
  assert.equal(hitTestStackedNode(nodes, { x: 100, y: 100 }, idle), second.id)
  assert.equal(hitTestStackedNode([first, { ...second, disabled: true }], point, idle), second.id)
  assert.equal(hitTestStackedNode([{ ...first, z: 5 }, second], point, idle), first.id)
  const transforms = loadFrom(join(srcRoot, 'canvas/viewport.ts'))
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    const viewport = { x: 396, y: 200, zoom }
    const center = transforms.worldToScreen({ x: 0, y: 50 }, viewport)
    const outsideHandle = transforms.screenToWorld({ x: center.x - 20 * zoom, y: center.y }, viewport)
    assert.equal(hitTestStackedNode(nodes, outsideHandle, idle), undefined)
    assert.equal(hitTestStackedNode(nodes, outsideHandle, idle, true), second.id)
  }
  assert.equal(hitTestStackedNode(nodes, { x: -32, y: 50 }, idle, true), second.id)
  assert.equal(hitTestStackedNode(nodes, { x: -33, y: 50 }, idle, true), undefined)
  assert.equal(hitTestStackedNode(nodes, { x: -30, y: 20 }, idle, true), undefined)
  assert.equal(hitTestStackedNode(nodes, { x: 120, y: 50 }, idle, true), undefined)
  assert.equal(hitTestStackedNode([first, { ...second, disabled: true }], { x: -20, y: 50 }, idle, true), second.id)
  assert.equal(hitTestStackedNode(nodes, { x: -20, y: 50 }, { ...idle, hoveredNodeId: first.id }, true), first.id)
  const provider = readFileSync(new URL('../src/canvas/components/CanvasProvider.tsx', import.meta.url), 'utf8')
  assert.match(provider, /const target = hitTestConnectionTarget\(world\)/)
  assert.match(provider, /endConnect\(hitTestConnectionTarget\(input.world\) \?\? null\)/)
  const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.ok(styles.includes("[data-node-id][data-node-connection-target] .node-connection-handle,"))
}
{
  const node = { id: 'editing', kind: 'sticky', z: -2 }
  const idle = { hoveredNodeId: null, focusedNodeId: null, draggingNodeIds: [] }
  assert.equal(nodeStackOrder(node, 10, idle), -2)
  const focused = { ...idle, focusedNodeId: node.id }
  assert.equal(nodeStackOrder(node, 10, focused), 10)
  const hovered = { ...focused, hoveredNodeId: 'other' }
  assert.equal(nodeStackOrder(node, 10, hovered), 10)
  assert.equal(nodeStackOrder({ ...node, id: 'other' }, 10, hovered), 11)
  const resizing = { ...hovered, resizingNodeId: node.id }
  assert.equal(nodeStackOrder(node, 10, resizing), 12)
  const dragging = { ...hovered, draggingNodeIds: [node.id, 'member'] }
  assert.equal(nodeStackOrder(node, 10, dragging), 12)
  assert.equal(nodeStackOrder({ ...node, id: 'member' }, 10, dragging), 12)
  assert.equal(nodeStackOrder({ ...node, kind: 'group' }, 10, dragging), -2)
  assert.equal(nodeStackOrder(node, 10, idle), -2)
}

const {
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  wheelDeltaToPixels,
  worldToScreen,
  screenToWorld,
  zoomAt,
  panBy,
  fitBounds,
  visibleScreenCenter,
  visibleScreenRect,
  nodeRect,
  unionRect,
  rectsIntersect,
  edgePathPoints,
  cubicBezierPoint,
  pointToEdgeDistance,
  CanvasInteraction,
} = loadFrom(withExt(join(srcRoot, 'canvas')))

const { createGroupFromNodes, ungroupNode, expandDragIds, movableDragIds, outlineGapOffset, NODE_OUTLINE_GAP } = loadFrom(withExt(join(srcRoot, 'canvas/grouping')))
{
  const nodes = [
    { id: 'group', kind: 'group' },
    { id: 'fixed', kind: 'sticky', pinned: true, parentGroupId: 'group' },
    { id: 'free', kind: 'sticky', pinned: false, parentGroupId: 'group' },
    { id: 'content', kind: 'content' },
  ]
  assert.deepEqual(movableDragIds(nodes, ['fixed']), [])
  assert.deepEqual(movableDragIds(nodes, ['fixed', 'free', 'content']), ['free', 'content'])
  assert.deepEqual(movableDragIds(nodes, ['group']), ['group', 'free'])
  assert.deepEqual(expandDragIds(nodes, ['group']), ['group', 'fixed', 'free'], 'copy expansion must retain pinned members')
  assert.deepEqual(movableDragIds(nodes.map((node) => ({ ...node, pinned: false })), ['fixed']), ['fixed'])
}
const { minimapColor } = loadFrom(withExt(join(srcRoot, 'canvas/minimap')))
{
  const text = readFileSync(join(srcRoot, 'canvas/contents/ContentContent.tsx'), 'utf8')
  const source = ts.createSourceFile('ContentContent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['youtubeId', 'VideoBody', 'sourceUrl', 'stopNodeGesture'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const api = vm.runInNewContext(ts.transpileModule(functions + '\n({youtubeId,VideoBody})', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, { React, URL, useResolvedMediaSrc: node => node.testResolved, MediaEmpty: () => React.createElement('p', null, 'loading'), ImportEmpty: () => React.createElement('p', null, 'import'), ExternalLink: () => null })
  const id = 'dQw4w9WgXcQ'
  for (const url of [`https://www.youtube.com/watch?v=${id}&t=3`, `https://youtu.be/${id}?si=test`, `https://youtube.com/shorts/${id}`, `https://m.youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://youtube.com/v/${id}`]) assert.equal(api.youtubeId(url), id)
  for (const url of [undefined, 'bad url', `https://notyoutube.com/watch?v=${id}`, `https://youtu.be.attacker.test/${id}`, `https://example.test/?v=${id}`, `ftp://youtube.com/watch?v=${id}`, 'https://youtube.com/shorts/', 'https://youtu.be/too-short']) assert.equal(api.youtubeId(url), null)
  const base = { id: 'playback', kind: 'content', category: 'video', label: 'Test audio', source: { kind: 'file', assetId: 'audio' }, payload: { kind: 'video', provider: 'local', playback: 'audio' }, testResolved: { src: 'blob:local-audio', loading: false } }
  const render = node => renderToStaticMarkup(React.createElement(api.VideoBody, { node }))
  const audio = render(base)
  assert.match(audio, /<audio /)
  assert.match(audio, /src="blob:local-audio"/)
  assert.match(audio, /controls=""/)
  assert.match(audio, /aria-label="Test audio"/)
  assert.doesNotMatch(audio, /<video |<iframe /)
  assert.match(render({ ...base, testResolved: { src: null, loading: true } }), /loading/)
  assert.match(render({ ...base, testResolved: { src: null, loading: false } }), /import/)
  const resource = { resource: { url: 'https://media.test/selected.mp4' } }
  const selected = render({ ...base, payload: { ...base.payload, provider: 'youtube', url: `https://youtube.com/shorts/${id}`, resources: [resource] }, testResolved: { src: resource.resource.url, loading: false } })
  assert.match(selected, /<video /)
  assert.doesNotMatch(selected, /<audio |<iframe /)
  const shorts = render({ ...base, source: { kind: 'url', url: `https://youtube.com/shorts/${id}` }, payload: { kind: 'video', provider: 'youtube', playback: 'embed' } })
  assert.match(shorts, /<iframe /)
  assert.ok(shorts.includes(`youtube-nocookie.com/embed/${id}`))
}
{
  const text = readFileSync(join(srcRoot, 'canvas/contents/ContentContent.tsx'), 'utf8')
  const source = ts.createSourceFile('ContentContent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const helper = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'openContentEditor')
  assert.ok(helper, 'Text and mindmap nodes must retain their direct editor entry')
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const { useUiStore } = loadFrom(withExt(join(srcRoot, 'stores/ui-store')))
  const openEditor = vm.runInNewContext(ts.transpileModule(helper.getText(source) + '\nopenContentEditor', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { useGraphStore, useUiStore })
  for (const category of ['text', 'mindmap']) {
    const node = { id: 'editor-target', kind: 'content', category, content: 'unchanged draft', position: { x: 10, y: 20 }, size: { width: 540, height: 430 } }
    useGraphStore.getState().openDocument({ id: 'editor-entry', title: 'test', nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
    useGraphStore.getState().setSelection(['other'])
    useUiStore.getState().setShowExtensionPanel(false)
    useUiStore.getState().setSelectedEdgeId('previous-edge')
    const document = useGraphStore.getState().currentDocument
    const historyIndex = useGraphStore.getState().historyIndex
    openEditor(node.id)
    assert.equal(useGraphStore.getState().selection.join(), node.id)
    assert.equal(useUiStore.getState().showExtensionPanel, true)
    assert.equal(useUiStore.getState().selectedEdgeId, null)
    assert.equal(useGraphStore.getState().currentDocument, document, 'Opening the editor must not rewrite content or persist UI state')
    assert.equal(useGraphStore.getState().historyIndex, historyIndex)
    useUiStore.getState().setShowExtensionPanel(false)
    openEditor('missing')
    assert.equal(useUiStore.getState().showExtensionPanel, false)
    useGraphStore.getState().updateNode(node.id, { category: 'image' })
    openEditor(node.id)
    assert.equal(useUiStore.getState().showExtensionPanel, false)
    useGraphStore.getState().closeDocument()
  }
  assert.match(text, /editorVisible = hoveredNodeId === node.id \|\| selection.includes\(node.id\)/)
  assert.match(text, /title="展开编辑器"/)
  assert.match(text, /aria-label="展开编辑器"/)
  assert.match(text, /onClick=\{\(\) => openContentEditor\(node.id\)\}/)
}
{
  const text = readFileSync(join(srcRoot, 'canvas/contents/ContentContent.tsx'), 'utf8')
  const source = ts.createSourceFile('ContentContent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['selectMediaResource', 'droppedMediaIndex'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const api = vm.runInNewContext(ts.transpileModule(functions + '\n({selectMediaResource,droppedMediaIndex})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { useGraphStore })
  const store = () => useGraphStore.getState()
  for (const kind of ['image', 'video']) {
    const node = { id: 'media-rail', kind: 'content', category: kind, position: { x: 10, y: 20 }, size: { width: 540, height: 430 }, payload: { kind, activeResourceIndex: 0, resources: [{ resource: { url: 'first' } }, { resource: { url: 'second' } }] } }
    store().openDocument({ id: 'rail', title: 'test', nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
    assert.equal(api.droppedMediaIndex(JSON.stringify({ nodeId: node.id, kind, index: 1 }), node), 1)
    for (const value of ['null', 'bad JSON', JSON.stringify({ nodeId: 'other', kind, index: 1 }), JSON.stringify({ nodeId: node.id, kind, index: 9 }), JSON.stringify({ nodeId: node.id, kind, index: -1 }), JSON.stringify({ nodeId: node.id, kind, index: 0.5 })]) assert.equal(api.droppedMediaIndex(value, node), null)
    api.selectMediaResource(node.id, 1)
    assert.equal(store().currentDocument.nodes[0].payload.activeResourceIndex, 1)
    assert.equal(store().historyIndex, 1)
    assert.deepEqual(store().currentDocument.nodes[0].position, node.position)
    api.selectMediaResource(node.id, 1)
    api.selectMediaResource(node.id, 9)
    assert.equal(store().historyIndex, 1)
    store().undo()
    assert.equal(store().currentDocument.nodes[0].payload.activeResourceIndex, 0)
    store().redo()
    assert.equal(store().currentDocument.nodes[0].payload.activeResourceIndex, 1)
    const persisted = JSON.parse(JSON.stringify(store().currentDocument))
    store().closeDocument()
    store().openDocument(persisted)
    assert.equal(store().currentDocument.nodes[0].payload.activeResourceIndex, 1)
    store().closeDocument()
  }
  assert.match(text, /media-resource-rail nodrag nowheel/)
  assert.match(text, /onWheel=\{stopNodeGesture\}/)
  assert.match(text, /aria-pressed=\{index === activeIndex\}/)
}
{
  const text = readFileSync(join(srcRoot, 'canvas/contents/ContentContent.tsx'), 'utf8')
  const source = ts.createSourceFile('ContentContent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['sourceUrl', 'sourceAssetId', 'mediaSourceFor'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const resolve = vm.runInNewContext(ts.transpileModule(functions + '\nmediaSourceFor', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { assetIdForResource: id => id.replace('sha256-', 'asset-') })
  const resources = [{ resource: { url: 'https://media.test/first', resourceId: 'sha256-first' } }, { resource: { url: 'https://media.test/second' } }]
  for (const kind of ['image', 'video']) {
    const node = { kind: 'content', category: kind, assetId: 'stale', source: { kind: 'url', url: 'https://page.test/original' }, preview: { thumbnailUrl: 'https://preview.test/stale' }, payload: { kind, resources, activeResourceIndex: 1 } }
    const before = JSON.stringify(node)
    assert.equal(resolve(node).remoteUrl, resources[1].resource.url)
    assert.equal(resolve(node).assetId, undefined)
    assert.equal(JSON.stringify(node), before)
    for (const index of [undefined, -1, NaN, 0.5]) {
      const result = resolve({ ...node, payload: { ...node.payload, activeResourceIndex: index } })
      assert.equal(result.assetId, 'asset-first')
      assert.equal(result.remoteUrl, resources[0].resource.url)
    }
    assert.equal(resolve({ ...node, payload: { ...node.payload, activeResourceIndex: 99 } }).remoteUrl, resources[1].resource.url)
    const split = resolve({ ...node, payload: { kind, resources: [resources[1]], activeResourceIndex: 0 } })
    assert.equal(split.remoteUrl, resources[1].resource.url)
    assert.equal(split.assetId, undefined)
    const unavailable = resolve({ ...node, payload: { kind, resources: [{ resource: { url: '' } }] } })
    assert.equal(unavailable.remoteUrl, null, 'missing item cannot display its unrelated original source or poster')
  }
  assert.equal(resolve({ source: { kind: 'file', assetId: 'existing' } }).assetId, 'existing')
  assert.equal(resolve({ source: { kind: 'url', url: 'https://page.test' }, payload: { kind: 'video', url: 'https://media.test/movie' } }).remoteUrl, 'https://media.test/movie')
  assert.ok(text.includes('const { assetId, remoteUrl } = mediaSourceFor(node)'))
  assert.ok(text.includes('resolved.key === sourceKey'), 'stale asynchronous display state is rejected when media identity changes')
}
{
  const text = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  const source = ts.createSourceFile('NodeHoverToolbar.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['canRestoreContent', 'restoredContentFields'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const api = vm.runInNewContext(ts.transpileModule(functions + '\n({canRestoreContent,restoredContentFields})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  for (const state of ['missing', 'error']) assert.equal(api.canRestoreContent({ kind: 'content', state, payload: { kind: 'image', resources: [] } }), true)
  assert.equal(api.canRestoreContent({ kind: 'content', state: 'ready', payload: { kind: 'text', value: 'ok' } }), false)
  assert.equal(api.canRestoreContent({ kind: 'sticky', state: 'missing' }), false)
  for (const [data, assetId, content] of [
    [{ source: { kind: 'file', resourceId: 'new-file' } }, 'new-file', undefined],
    [{ source: { kind: 'clipboard-image', resourceId: 'new-image' } }, 'new-image', undefined],
    [{ source: { kind: 'url', normalizedUrl: 'https://example.test' } }, undefined, undefined],
    [{ source: { kind: 'text', text: 'source body' } }, undefined, 'source body'],
    [{ source: { kind: 'text', text: 'old' }, payload: { kind: 'text', value: '' } }, undefined, ''],
    [{ source: { kind: 'file', resourceId: 'text-file' }, payload: { kind: 'text', value: 'parsed' } }, undefined, 'parsed'],
  ]) {
    const restored = { assetId: 'stale', content: 'stale', ...api.restoredContentFields(data) }
    assert.equal(restored.assetId, assetId)
    assert.equal(restored.content, content)
  }
  assert.ok(text.includes('const showRestore = canRestoreContent(node)'))
  assert.ok(text.includes('...restoredContentFields(sourceData)'))
  assert.ok(text.includes("fileName: file.name }, node.category, { preserveOnFailure: true })"))
}
{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const store = () => useGraphStore.getState()
  for (const kind of ['image', 'video']) {
    const resources = [1, 2, 3].map(index => ({ label: `Media ${index}`, resource: { url: `https://example.test/${index}`, resourceId: `sha256-${index}` } }))
    const node = { id: 'split', kind: 'content', category: kind, label: 'Media', position: { x: 100, y: 80 }, size: { width: 540, height: 430 }, parentGroupId: 'group', favorite: true, sourceId: 'library', source: { kind: 'url', url: 'https://example.test/origin' }, payload: { kind, resources, activeResourceIndex: 2 }, generatedBy: { requestNodeId: 'request', variant: kind } }
    const edge = { id: 'edge', source: node.id, target: 'target' }
    const doc = { id: 'split-test', title: 'test', nodes: [node, { ...node, id: 'target', payload: undefined }], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 }
    store().openDocument(doc)
    useGraphStore.setState({ isLocked: false })
    assert.equal(store().splitMediaNode(node.id), true)
    assert.equal(store().historyIndex, 1, 'all split outputs and source update form one history step')
    const split = structuredClone(store().currentDocument)
    assert.equal(split.nodes.length, 4)
    assert.equal(split.nodes[0].payload.resources.length, 1)
    assert.deepEqual(split.edges, [edge])
    for (const [index, copy] of split.nodes.slice(2).entries()) {
      assert.equal(copy.payload.resources[0].resource.resourceId, `sha256-${index + 2}`)
      assert.equal(copy.payload.activeResourceIndex, 0)
      assert.equal(copy.position.x - (node.position.x + node.size.width), 40)
      assert.equal(copy.parentGroupId, undefined, 'new independent outputs do not inherit stale group membership')
      assert.equal(copy.sourceId, undefined)
      assert.equal(copy.favorite, false)
      assert.deepEqual(copy.generatedBy, { ...node.generatedBy, detached: true })
    }
    assert.equal(node.payload.resources.length, 3, 'input document remains immutable')
    store().undo()
    assert.deepEqual(store().currentDocument.nodes, doc.nodes)
    assert.deepEqual(store().currentDocument.edges, doc.edges)
    store().redo()
    assert.deepEqual(store().currentDocument.nodes, split.nodes)
    assert.equal(store().splitMediaNode(node.id), false, 'single media does not create history')
    assert.equal(store().historyIndex, 1)
    store().undo()
    store().toggleLock()
    assert.equal(store().splitMediaNode(node.id), false)
    assert.equal(store().historyIndex, 0)
    store().toggleLock()
    assert.equal(store().splitMediaNode('missing'), false)
    store().closeDocument()
  }
  assert.match(readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8'), /getState\(\)\.splitMediaNode\(node.id\)/)
}
{
  const text = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  const source = ts.createSourceFile('NodeHoverToolbar.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['canDownloadContentMedia', 'downloadContentMedia'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const compiled = ts.transpileModule(functions + '\n({canDownloadContentMedia,downloadContentMedia})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let saved
  const api = vm.runInNewContext(compiled, {
    Blob,
    safeFileName: value => value.replace(/[<>:"/\\|?*]/g, '_'),
    saveBlobToFile: async (blob, fileName, options) => { saved = { blob, fileName, options } },
    contentAssetId: () => { throw Error('text export must not read the original asset') },
  })
  assert.match(text, /node.category === 'text' \? '下载内容' : '下载媒体'/)
  for (const sample of [
    { payload: { kind: 'text', format: 'plain', value: '中文\nSecond line' }, expected: '中文\nSecond line', extension: 'txt' },
    { payload: { kind: 'text', format: 'markdown', value: '# Title\n**Body**' }, expected: '# Title\n**Body**', extension: 'md' },
    { payload: { kind: 'text', format: 'plain', value: 'stale payload' }, content: 'edited body', expected: 'edited body', extension: 'txt' },
    { payload: { kind: 'text', format: 'plain', value: 'stale payload' }, content: '', expected: '', extension: 'txt' },
    { content: '  preserve whitespace\n', expected: '  preserve whitespace\n', extension: 'md' },
  ]) {
    const node = { kind: 'content', category: 'text', label: 'QA:文本', ...sample }
    const original = JSON.stringify(node)
    assert.equal(api.canDownloadContentMedia(node), true)
    await api.downloadContentMedia(node)
    assert.equal(await saved.blob.text(), sample.expected)
    assert.equal(saved.blob.type, sample.extension === 'txt' ? 'text/plain' : 'text/markdown')
    assert.equal(saved.fileName, `QA_文本.${sample.extension}`)
    assert.equal(saved.options.extension, `.${sample.extension}`)
    assert.equal(JSON.stringify(node), original, 'export must not mutate the graph or parsed payload')
  }
  assert.equal(api.canDownloadContentMedia({ kind: 'sticky', content: 'not a Content node' }), false)
}
{
  const toolbar = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  const toolbarSource = ts.createSourceFile('NodeHoverToolbar.tsx', toolbar, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['mediaItems', 'contentAssetId', 'contentRemoteUrl', 'contentMimeType', 'isMediaContent', 'canDownloadContentMedia', 'mediaFileName', 'fileExtension', 'downloadContentMedia'])
  const functions = toolbarSource.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(toolbarSource)).join('\n')
  const compiled = ts.transpileModule(functions + '\n({canDownloadContentMedia,downloadContentMedia})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const requests = []
  const assets = []
  const saves = []
  let responseOk = true
  let cancelled = false
  const api = vm.runInNewContext(compiled, {
    Blob,
    ...loadFrom(join(srcRoot, 'lib/file-save.ts')),
    assetIdForResource: id => id.replace('sha256-', 'asset-'),
    loadAssetUrl: async id => { assets.push(id); return id === 'asset-missing' ? null : 'blob:local-media' },
    desktopFetch: async url => { requests.push(url); return { ok: responseOk, blob: async () => new Blob(['media bytes'], { type: 'image/png' }) } },
    saveBlobToFile: async (blob, fileName, options) => { if (cancelled) throw new DOMException('cancelled', 'AbortError'); saves.push({ blob, fileName, options }) },
  })
  const origin = { kind: 'content', category: 'image', label: 'Image', assetId: 'asset-original', source: { kind: 'url', url: 'https://example.test/article' } }
  for (const resourceId of [undefined, 'sha256-current', 'sha256-missing']) {
    const node = { ...origin, payload: { kind: 'image', resources: [{ resource: { url: 'https://example.test/image.png', resourceId } }] } }
    requests.length = 0
    assets.length = 0
    const before = JSON.stringify(node)
    assert.equal(api.canDownloadContentMedia(node), true)
    await api.downloadContentMedia(node)
    assert.equal(requests[0], resourceId === 'sha256-current' ? 'blob:local-media' : 'https://example.test/image.png')
    assert.ok(!assets.includes('asset-original'), 'split/parsed media must not download the original source asset')
    assert.equal(saves.at(-1).fileName, 'Image.png', 'response MIME supplies missing extension')
    assert.equal(await saves.at(-1).blob.text(), 'media bytes')
    assert.equal(JSON.stringify(node), before)
  }
  const local = { kind: 'content', category: 'image', source: { kind: 'file', assetId: 'asset-local', fileName: 'original.png', mimeType: 'image/png' } }
  await api.downloadContentMedia(local)
  assert.equal(saves.at(-1).fileName, 'original.png')
  const named = { ...origin, payload: { kind: 'image', resources: [{ resource: { url: 'https://example.test/image.png', fileName: 'actual.png' } }] } }
  await api.downloadContentMedia(named)
  assert.equal(saves.at(-1).fileName, 'actual.png')
  const count = saves.length
  responseOk = false
  await assert.rejects(api.downloadContentMedia(named), /media-unavailable/)
  assert.equal(saves.length, count, 'HTTP failure must not save response bytes')
  responseOk = true
  cancelled = true
  await assert.rejects(api.downloadContentMedia(named), { name: 'AbortError' })
  assert.equal(saves.length, count)
}
{
  const text = readFileSync(join(srcRoot, 'canvas/components/CanvasMinimap.tsx'), 'utf8')
  const source = ts.createSourceFile('CanvasMinimap.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let locator
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'locateFromEvent') locator = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(locator, 'exercise the production minimap pointer locator')
  for (const border of [0, 1, 2]) {
    for (const scale of [0.025, 0.1, 0.1075]) {
      const safeBounds = { x: -1200, y: -800 }
      let located
      const locate = vm.runInNewContext(ts.transpileModule('(' + locator + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
        scale, safeBounds, MAP_PAD: 4, MAP_WIDTH: 280, MAP_HEIGHT: 180,
        clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
        centerOnWorld: (point) => { located = point },
      })
      const currentTarget = {
        clientLeft: border, clientTop: border,
        getBoundingClientRect: () => ({ left: 1138.5, top: 758.25 }),
      }
      for (const local of [{ x: 4, y: 4 }, { x: 140, y: 90 }, { x: 274, y: 174 }]) {
        locate({ currentTarget, clientX: 1138.5 + border + local.x, clientY: 758.25 + border + local.y })
        assert.ok(Math.abs(located.x - (safeBounds.x + (local.x - 4) / scale)) < 1e-8, 'minimap click must invert the rendered padding-box x coordinate, excluding its border')
        assert.ok(Math.abs(located.y - (safeBounds.y + (local.y - 4) / scale)) < 1e-8, 'minimap click must invert the rendered padding-box y coordinate, excluding its border')
      }
    }
  }
}
const { canvasOverlayInsets, NODE_PANEL_INSET, hasSafePanelToolbarSpacing } = loadFrom(withExt(join(srcRoot, 'canvas/overlay-insets')))
assert.equal(hasSafePanelToolbarSpacing(1442, { left: 284, right: 386 }, { left: 360, right: 250 }), true)
assert.equal(hasSafePanelToolbarSpacing(1000, { left: 284, right: 386 }, { left: 360, right: 250 }), false)
assert.equal(hasSafePanelToolbarSpacing(1000, { left: 0, right: 386 }, { left: 88, right: 250 }), true)
assert.equal(hasSafePanelToolbarSpacing(402, { left: 0, right: 0 }, { left: 80, right: 250 }), true)
assert.equal(hasSafePanelToolbarSpacing(401, { left: 0, right: 0 }, { left: 80, right: 250 }), false)
assert.equal(hasSafePanelToolbarSpacing(1442, { left: 284, right: 386 }, { left: 360, center: 128, right: 250 }), true)
assert.equal(hasSafePanelToolbarSpacing(1440, { left: 284, right: 386 }, { left: 360, center: 128, right: 250 }), true)
assert.equal(hasSafePanelToolbarSpacing(1439, { left: 284, right: 386 }, { left: 360, center: 128, right: 250 }), false)

const EPS = 1e-9

const { nodeToolbarPlacement, nodeToolbarHorizontalPlacement, selectionToolbarTop } = loadFrom(withExt(join(srcRoot, 'canvas/toolbar-placement')))
for (const viewportHeight of [360, 600, 900]) {
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    for (const worldTop of [-2000, 0, 300, 2000]) {
      const selectionTop = worldTop * zoom
      const groupTop = selectionToolbarTop(selectionTop, viewportHeight)
      assert.ok(groupTop >= 72)
      assert.ok(groupTop + 40 <= viewportHeight - 8)
      for (const offset of [0, 100, 400]) {
        const layout = nodeToolbarPlacement(selectionTop + offset, selectionTop + offset + 240 * zoom, 48, viewportHeight, groupTop + 48)
        const top = layout.placement === 'top' ? layout.anchor - 48 : layout.anchor
        assert.ok(top >= groupTop + 48, 'member toolbar never overlaps multi-selection actions')
        assert.ok(top + 48 <= viewportHeight - 8, 'member toolbar remains inside the viewport')
      }
    }
  }
}
assert.deepEqual(nodeToolbarHorizontalPlacement(-68, 556, 300, 1442, { left: 0, right: 0 }), { left: 94, maxWidth: 1354 })
assert.equal(nodeToolbarHorizontalPlacement(-500, -100, 300, 1442, { left: 0, right: 0 }).left, 80)
assert.equal(nodeToolbarHorizontalPlacement(1400, 1800, 300, 1442, { left: 0, right: 0 }).left, 1134)
for (const insets of [{ left: 0, right: 0 }, { left: 284, right: 0 }, { left: 0, right: 416 }, { left: 284, right: 416 }]) {
  for (const zoom of [0.25, 0.5, 1, 1.5, 2.5, 4]) {
    const width = 300 * zoom
    const layout = nodeToolbarHorizontalPlacement(-200, 500, width, 1200, insets)
    assert.ok(layout.left >= insets.left + 80)
    assert.ok(layout.left + Math.min(width, layout.maxWidth) <= 1200 - insets.right - 8)
  }
}
assert.deepEqual(nodeToolbarPlacement(89, 850, 72, 920), { placement: 'bottom', anchor: 840 })
assert.deepEqual(nodeToolbarPlacement(200, 600, 48, 920), { placement: 'top', anchor: 200 })
assert.deepEqual(nodeToolbarPlacement(-200, 1500, 120, 920), { placement: 'bottom', anchor: 792 })
for (const zoom of [0.25, 0.5, 1, 1.5, 2.5, 4]) {
  const height = 48 * zoom
  const result = nodeToolbarPlacement(89, 850, height, 920)
  const top = result.placement === 'top' ? result.anchor - height : result.anchor
  assert.ok(top >= 72)
  assert.ok(top + height <= 912)
}

function almostEqual(actual, expected, label, eps = EPS) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`,
  )
}

function almostPoint(actual, expected, label, eps = EPS) {
  almostEqual(actual.x, expected.x, `${label}.x`, eps)
  almostEqual(actual.y, expected.y, `${label}.y`, eps)
}

function pointer(screen, viewport, extra = {}) {
  return {
    screen,
    world: screenToWorld(screen, viewport),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 1. worldToScreen / screenToWorld inverses
// ---------------------------------------------------------------------------
{
  const viewport = { x: 40, y: -20, zoom: 1.5 }
  const world = { x: 100, y: 200 }
  const screen = worldToScreen(world, viewport)
  almostPoint(screen, { x: 100 * 1.5 + 40, y: 200 * 1.5 - 20 }, 'worldToScreen')
  almostPoint(screenToWorld(screen, viewport), world, 'screenToWorld(worldToScreen)')

  const screenPt = { x: 10, y: 30 }
  almostPoint(worldToScreen(screenToWorld(screenPt, viewport), viewport), screenPt, 'worldToScreen(screenToWorld)')

  const zeroZoomWorld = screenToWorld({ x: 50, y: 80 }, { x: 10, y: 20, zoom: 0 })
  almostPoint(zeroZoomWorld, { x: (50 - 10) / MIN_ZOOM, y: (80 - 20) / MIN_ZOOM }, 'screenToWorld zoom=0')
}

// ---------------------------------------------------------------------------
// 2. zoomAt keeps the world point under the anchor; clampZoom / fitBounds safety
// ---------------------------------------------------------------------------
{
  const viewport = { x: 10, y: 20, zoom: 1 }
  const anchor = { x: 200, y: 150 }
  const worldAtAnchor = screenToWorld(anchor, viewport)
  const zoomed = zoomAt(viewport, anchor, 2)
  assert.equal(zoomed.zoom, 2)
  almostPoint(screenToWorld(anchor, zoomed), worldAtAnchor, 'zoomAt in')

  const zoomedOut = zoomAt(zoomed, anchor, 0.25)
  almostPoint(screenToWorld(anchor, zoomedOut), worldAtAnchor, 'zoomAt out')

  const clampedHigh = zoomAt({ x: 0, y: 0, zoom: 3 }, { x: 10, y: 10 }, 10)
  assert.equal(clampedHigh.zoom, MAX_ZOOM)
  almostPoint(
    screenToWorld({ x: 10, y: 10 }, clampedHigh),
    screenToWorld({ x: 10, y: 10 }, { x: 0, y: 0, zoom: 3 }),
    'zoomAt clamp high',
  )

  const clampedLow = zoomAt({ x: 5, y: 5, zoom: 0.2 }, { x: 40, y: 40 }, 0.01)
  assert.equal(clampedLow.zoom, MIN_ZOOM)
  almostPoint(
    screenToWorld({ x: 40, y: 40 }, clampedLow),
    screenToWorld({ x: 40, y: 40 }, { x: 5, y: 5, zoom: 0.2 }),
    'zoomAt clamp low',
  )

  assert.equal(clampZoom(1), 1)
  assert.equal(clampZoom(0), MIN_ZOOM)
  assert.equal(clampZoom(-4), MIN_ZOOM)
assert.equal(clampZoom(100), MAX_ZOOM)

// Wheel input remains continuous and normalizes line/page deltas.
assert.equal(wheelDeltaToPixels(12, 0, 800), 12)
assert.equal(wheelDeltaToPixels(2, 1, 800), 32)
assert.equal(wheelDeltaToPixels(1, 2, 600), 600)
assert.equal(wheelDeltaToPixels(Number.NaN, 0, 800), 0)
  assert.equal(clampZoom(Number.NaN), 1)
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), 1)
  assert.equal(clampZoom(Number.NEGATIVE_INFINITY), 1)

  const fitted = fitBounds({ x: 0, y: 0, width: 200, height: 100 }, { width: 400, height: 400 })
  assert.equal(fitted.zoom, 2)
  almostEqual(fitted.x, 0, 'fitBounds.x')
  almostEqual(fitted.y, 100, 'fitBounds.y')

  assert.equal(fitBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 }).zoom, MIN_ZOOM)
  assert.equal(fitBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: -10, height: 50 }).zoom, MIN_ZOOM)
  assert.equal(fitBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 50, height: 50 }, 40).zoom, MIN_ZOOM)
  assert.equal(fitBounds({ x: 10, y: 20, width: 0, height: 0 }, { width: 800, height: 600 }).zoom, 1)
  assert.equal(fitBounds({ x: 0, y: 0, width: 0, height: 50 }, { width: 200, height: 100 }).zoom, 2)
  assert.equal(fitBounds({ x: 0, y: 0, width: 50, height: 0 }, { width: 200, height: 100 }).zoom, 4)
  assert.equal(fitBounds({ x: 0, y: 0, width: 1, height: 1 }, { width: 10_000, height: 10_000 }).zoom, MAX_ZOOM)

  const insetFitted = fitBounds({ x: 0, y: 0, width: 200, height: 100 }, { width: 684, height: 400 }, { left: 284, right: 0 })
  assert.equal(insetFitted.zoom, 2)
  almostEqual(insetFitted.x, 284, 'fitBounds inset.x')
  almostEqual(insetFitted.y, 100, 'fitBounds inset.y')

  const closed = canvasOverlayInsets({ showNodePanel: false, showExtensionPanel: false, extensionWidth: 320 })
  const opened = canvasOverlayInsets({ showNodePanel: true, showExtensionPanel: false, extensionWidth: 320 })
  assert.deepEqual(closed, { left: 0, right: 0 })
  assert.deepEqual(opened, { left: NODE_PANEL_INSET, right: 0 })
  const size = { width: 1000, height: 800 }
  assert.deepEqual(visibleScreenRect(size, closed), { x: 0, y: 0, width: 1000, height: 800 })
  assert.deepEqual(visibleScreenRect(size, opened), { x: NODE_PANEL_INSET, y: 0, width: 1000 - NODE_PANEL_INSET, height: 800 })
  const previousCenter = visibleScreenCenter(size, closed)
  const nextCenter = visibleScreenCenter(size, opened)
  almostEqual(previousCenter.x, 500, 'closed canvas center x')
  almostEqual(nextCenter.x, NODE_PANEL_INSET + (1000 - NODE_PANEL_INSET) / 2, 'open panel center x')
  almostEqual(nextCenter.x - previousCenter.x, NODE_PANEL_INSET / 2, 'panel open pans by half inset')
}

// ---------------------------------------------------------------------------
{
  const text = readFileSync(join(srcRoot, 'canvas/components/CanvasControls.tsx'), 'utf8')
  const source = ts.createSourceFile('CanvasControls.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fitAction
  const findFit = element => {
    if (ts.isVariableDeclaration(element) && element.name.getText(source) === 'handleFit') fitAction = element.initializer.getText(source)
    ts.forEachChild(element, findFit)
  }
  findFit(source)
  assert.ok(fitAction)
  const compiled = ts.transpileModule(`(${fitAction})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const { CANVAS_CONTROLS_OCCUPIED_WIDTH, canvasOverlayInsets } = loadFrom(withExt(join(srcRoot, 'canvas/overlay-insets')))
  for (const width of [1024, 1440, 2048]) {
    for (const showNodePanel of [false, true]) {
      for (const showExtensionPanel of [false, true]) {
        const overlayInsets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth: 368 })
        const nodes = [stickyNode('left', -200, 100, 540, 430), stickyNode('right', 231, 12, 540, 430)]
        let fitted
        const run = vm.runInNewContext(compiled, { nodes, containerSize: { width, height: 920 }, overlayInsets, CANVAS_CONTROLS_OCCUPIED_WIDTH, fitBounds, unionRect, nodeRect, setViewport: value => { fitted = value } })
        run()
        for (const node of nodes) {
          const origin = worldToScreen(node.position, fitted)
          assert.ok(origin.x >= overlayInsets.left + CANVAS_CONTROLS_OCCUPIED_WIDTH + 40 - 0.001, 'fitted node clears the control strip plus breathing room')
          assert.ok(origin.x + node.size.width * fitted.zoom <= width - overlayInsets.right - 40 + 0.001, 'fit still respects the opposite panel')
        }
      }
    }
  }
}

// 3. panBy, nodeRect / unionRect / rectsIntersect
// ---------------------------------------------------------------------------
{
  const panned = panBy({ x: 5, y: 7, zoom: 1.2 }, { x: 3, y: -2 })
  assert.deepEqual(panned, { x: 8, y: 5, zoom: 1.2 })

  const node = nodeRect({ position: { x: 10, y: 20 }, size: { width: 100, height: 50 } })
  assert.deepEqual(node, { x: 10, y: 20, width: 100, height: 50 })

  const a = { x: 0, y: 0, width: 10, height: 10 }
  const b = { x: 5, y: 5, width: 10, height: 10 }
  assert.equal(rectsIntersect(a, b), true)
  assert.equal(rectsIntersect(a, { x: 10, y: 0, width: 4, height: 4 }), true)
  assert.equal(rectsIntersect(a, { x: 20, y: 20, width: 1, height: 1 }), false)
  assert.deepEqual(unionRect(a, b), { x: 0, y: 0, width: 15, height: 15 })
}

// ---------------------------------------------------------------------------
// 4. edgePathPoints / cubicBezierPoint / pointToEdgeDistance
// ---------------------------------------------------------------------------
{
  const pts = edgePathPoints(
    { x: 0, y: 0, width: 100, height: 40 },
    { x: 300, y: 80, width: 100, height: 40 },
  )
  assert.deepEqual(pts.source, { x: 100, y: 20 })
  assert.deepEqual(pts.target, { x: 300, y: 100 })
  assert.deepEqual(pts.controlA, { x: 200, y: 20 })
  assert.deepEqual(pts.controlB, { x: 200, y: 100 })

  const start = cubicBezierPoint(pts.source, pts.controlA, pts.controlB, pts.target, 0)
  const end = cubicBezierPoint(pts.source, pts.controlA, pts.controlB, pts.target, 1)
  const mid = cubicBezierPoint(pts.source, pts.controlA, pts.controlB, pts.target, 0.5)
  almostPoint(start, pts.source, 'bezier t=0')
  almostPoint(end, pts.target, 'bezier t=1')
  almostEqual(mid.x, 200, 'bezier t=0.5 x')
  almostEqual(mid.y, 60, 'bezier t=0.5 y')

  assert.ok(pointToEdgeDistance(start, pts) < 1e-6, 'distance at source')
  assert.ok(pointToEdgeDistance(mid, pts) < 1e-6, 'distance at midpoint')
  assert.ok(pointToEdgeDistance({ x: 10_000, y: 10_000 }, pts) > 100, 'distance far from edge')

  const close = edgePathPoints(
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 20, y: 0, width: 10, height: 10 },
  )
  assert.equal(close.controlA.x, 10 + 40)
  assert.equal(close.controlB.x, 20 - 40)
}

// ---------------------------------------------------------------------------
// 5. CanvasInteraction: node-drag cumulative delta, empty marquee, connect
// ---------------------------------------------------------------------------
{
  const dragEvents = []
  const dragViewport = { x: 0, y: 0, zoom: 2 }
  const dragging = new CanvasInteraction(() => dragViewport, (event) => dragEvents.push(event))

  dragging.pointerDown(pointer({ x: 100, y: 80 }, dragViewport), 'n1')
  assert.equal(dragging.getMode(), 'dragging-nodes')
  assert.equal(dragEvents[0]?.type, 'node-drag-start')
  assert.equal(dragEvents[0]?.nodeId, 'n1')

  dragging.pointerMove(pointer({ x: 140, y: 100 }, dragViewport))
  const move1 = dragEvents.at(-1)
  assert.equal(move1.type, 'node-drag-move')
  almostPoint(move1.deltaWorld, { x: 20, y: 10 }, 'node-drag first delta')

  dragging.pointerMove(pointer({ x: 180, y: 120 }, dragViewport))
  const move2 = dragEvents.at(-1)
  assert.equal(move2.type, 'node-drag-move')
  almostPoint(move2.deltaWorld, { x: 40, y: 20 }, 'node-drag cumulative delta')

  dragging.pointerUp(pointer({ x: 180, y: 120 }, dragViewport))
  const dragEnd = dragEvents.at(-1)
  assert.equal(dragEnd.type, 'node-drag-end')
  almostPoint(dragEnd.deltaWorld, { x: 40, y: 20 }, 'node-drag end cumulative delta')
  assert.equal(dragging.getMode(), 'idle')
}

{
  const marqueeEvents = []
  const marqueeViewport = { x: 10, y: 20, zoom: 1 }
  const marquee = new CanvasInteraction(() => marqueeViewport, (event) => marqueeEvents.push(event))

  marquee.pointerDown(pointer({ x: 30, y: 40 }, marqueeViewport))
  assert.equal(marquee.getMode(), 'marquee')
  assert.equal(marqueeEvents[0]?.type, 'marquee-start')
  almostPoint(marqueeEvents[0].start, { x: 20, y: 20 }, 'marquee start')

  marquee.pointerMove(pointer({ x: 80, y: 90 }, marqueeViewport))
  const marqueeMove = marqueeEvents.at(-1)
  assert.equal(marqueeMove.type, 'marquee-move')
  almostPoint(marqueeMove.start, { x: 20, y: 20 }, 'marquee move start')
  almostPoint(marqueeMove.current, { x: 70, y: 70 }, 'marquee move current')

  marquee.pointerUp(pointer({ x: 80, y: 90 }, marqueeViewport))
  const marqueeEnd = marqueeEvents.at(-1)
  assert.equal(marqueeEnd.type, 'marquee-end')
  almostPoint(marqueeEnd.current, { x: 70, y: 70 }, 'marquee end')
  assert.equal(marquee.getMode(), 'idle')
}

{
  const connectEvents = []
  const connectViewport = { x: 0, y: 0, zoom: 1 }
  const connecting = new CanvasInteraction(() => connectViewport, (event) => connectEvents.push(event))

  connecting.beginConnect('src')
  assert.equal(connecting.getMode(), 'connecting')
  assert.equal(connectEvents[0]?.type, 'connect-start')
  assert.equal(connectEvents[0]?.sourceId, 'src')

  connecting.pointerMove(pointer({ x: 50, y: 50 }, connectViewport))
  assert.equal(connectEvents.length, 1, 'pointerMove is ignored while connecting')

  connecting.updateConnect({ x: 12, y: 34 })
  const connectMove = connectEvents.at(-1)
  assert.equal(connectMove.type, 'connect-move')
  almostPoint(connectMove.current, { x: 12, y: 34 }, 'connect move')

  connecting.endConnect('tgt')
  const connectEnd = connectEvents.at(-1)
  assert.equal(connectEnd.type, 'connect-end')
  assert.equal(connectEnd.sourceId, 'src')
  assert.equal(connectEnd.targetId, 'tgt')
  almostPoint(connectEnd.current, { x: 12, y: 34 }, 'connect end current')
  assert.equal(connecting.getMode(), 'idle')
}

const {
  CONTENT_OVERSCAN_WORLD_PX,
  visibleWorldRect,
  shouldMountNodeContent,
  collectContentMountPinIds,
  contentLayerStyle,
  isActiveGenerationRunStatus,
  isUsableContainerSize,
  isUsableViewport,
} = loadFrom(withExt(join(srcRoot, 'canvas/components/content-visibility')))

function stickyNode(id, x, y, width = 100, height = 80, extra = {}) {
  return {
    id,
    kind: 'sticky',
    position: { x, y },
    size: { width, height },
    label: id,
    content: '',
    color: 'yellow',
    background: 'solid',
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 6. Content-layer visible-world virtualization
// ---------------------------------------------------------------------------
{
  assert.equal(CONTENT_OVERSCAN_WORLD_PX >= 200 && CONTENT_OVERSCAN_WORLD_PX <= 300, true)
  assert.equal(isUsableContainerSize({ width: 800, height: 600 }), true)
  assert.equal(isUsableContainerSize({ width: 0, height: 600 }), false)
  assert.equal(isUsableContainerSize({ width: -10, height: 10 }), false)
  assert.equal(isUsableContainerSize({ width: Number.NaN, height: 10 }), false)
  assert.equal(isUsableViewport({ x: 0, y: 0, zoom: 1 }), true)
  assert.equal(isUsableViewport({ x: 0, y: 0, zoom: 0 }), false)
  assert.equal(isUsableViewport({ x: 0, y: 0, zoom: -1 }), false)
  assert.equal(isUsableViewport({ x: Number.NaN, y: 0, zoom: 1 }), false)

  assert.equal(visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }), null)
  assert.equal(visibleWorldRect({ x: 0, y: 0, zoom: Number.NaN }, { width: 800, height: 600 }), null)
  assert.equal(visibleWorldRect({ x: 0, y: 0, zoom: -2 }, { width: 800, height: 600 }), null)
  assert.equal(visibleWorldRect({ x: Number.POSITIVE_INFINITY, y: 0, zoom: 1 }, { width: 800, height: 600 }), null)

  const overscan = CONTENT_OVERSCAN_WORLD_PX
  const world1 = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 })
  almostEqual(world1.x, -overscan, 'visibleWorld zoom1 x')
  almostEqual(world1.y, -overscan, 'visibleWorld zoom1 y')
  almostEqual(world1.width, 800 + overscan * 2, 'visibleWorld zoom1 w')
  almostEqual(world1.height, 600 + overscan * 2, 'visibleWorld zoom1 h')

  const world2 = visibleWorldRect({ x: 100, y: 50, zoom: 2 }, { width: 400, height: 300 })
  almostEqual(world2.x, (0 - 100) / 2 - overscan, 'visibleWorld zoom2 x')
  almostEqual(world2.y, (0 - 50) / 2 - overscan, 'visibleWorld zoom2 y')
  almostEqual(world2.width, 400 / 2 + overscan * 2, 'visibleWorld zoom2 w')
  almostEqual(world2.height, 300 / 2 + overscan * 2, 'visibleWorld zoom2 h')

  const visible = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { width: 400, height: 300 }, 240)
  const inside = stickyNode('in', 10, 10)
  const overscanHit = stickyNode('band', 500, 10)
  const outside = stickyNode('out', 2000, 2000)
  assert.equal(shouldMountNodeContent(inside, visible), true)
  assert.equal(shouldMountNodeContent(overscanHit, visible), true)
  assert.equal(shouldMountNodeContent(outside, visible), false)
  assert.equal(shouldMountNodeContent(outside, null), true, 'unmeasured container mounts all')
  assert.equal(shouldMountNodeContent(outside, visible, new Set(['out'])), true)

  for (const status of ['created', 'validating', 'queued', 'running', 'waiting-for-user']) {
    assert.equal(isActiveGenerationRunStatus(status), true, status)
  }
  for (const status of ['completed', 'failed', 'cancelled', 'idle', '']) {
    assert.equal(isActiveGenerationRunStatus(status), false, status)
  }

  const requestActive = {
    id: 'req-active',
    kind: 'request',
    position: { x: 9000, y: 9000 },
    size: { width: 120, height: 80 },
    label: 'req',
    variant: 'image',
    image: { prompt: '' },
    video: { prompt: '' },
    latestRunId: 'run-live',
  }
  const requestCompleted = {
    ...requestActive,
    id: 'req-done',
    latestRunId: 'run-done',
  }
  const requestByPointer = {
    ...requestActive,
    id: 'req-pointer',
    latestRunId: undefined,
  }
  const browserLive = {
    id: 'br-live',
    kind: 'browser',
    position: { x: 9000, y: 9000 },
    size: { width: 160, height: 120 },
    label: 'br',
    url: 'https://example.com',
    sessionId: 'sess-live',
  }
  const browserEmpty = { ...browserLive, id: 'br-empty', sessionId: 'sess-empty' }
  const browserMissing = { ...browserLive, id: 'br-miss', sessionId: 'sess-missing' }

  const pinNodes = [outside, requestActive, requestCompleted, requestByPointer, browserLive, browserEmpty, browserMissing]
  const pins = collectContentMountPinIds(pinNodes, {
    selection: ['out'],
    resizingNodeId: 'resize-1',
    connectingSourceId: 'connect-1',
    runs: {
      'run-live': { id: 'run-live', status: 'running', requestNodeId: 'req-active' },
      'run-done': { id: 'run-done', status: 'completed', requestNodeId: 'req-done' },
      'run-orphan': { id: 'run-orphan', status: 'queued', requestNodeId: 'req-pointer' },
    },
    sessions: {
      'sess-live': { tabs: [{ id: 't1', url: 'https://example.com', status: 'ready' }], activeTabId: 't1' },
      'sess-empty': { tabs: [], activeTabId: null },
    },
  })
  assert.equal(pins.has('out'), true)
  assert.equal(pins.has('resize-1'), true)
  assert.equal(pins.has('connect-1'), true)
  const aiPins = collectContentMountPinIds([{ id: 'ai-1', kind: 'ai', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, label: 'ai' }], {
    inflightAINodeIds: ['ai-1'],
  })
  assert.equal(aiPins.has('ai-1'), true)
  assert.equal(pins.has('req-active'), true)
  assert.equal(pins.has('req-pointer'), true)
  assert.equal(pins.has('req-done'), false)
  assert.equal(pins.has('br-live'), true)
  assert.equal(pins.has('br-empty'), false)
  assert.equal(pins.has('br-miss'), false)
  assert.equal(shouldMountNodeContent(requestActive, visible, pins), true)
  assert.equal(shouldMountNodeContent(requestCompleted, visible, pins), false)
  assert.equal(shouldMountNodeContent(browserLive, visible, pins), true)
  assert.equal(shouldMountNodeContent(browserEmpty, visible, pins), false)

  const box = contentLayerStyle(stickyNode('n', 40, 60, 120, 80, { z: 7 }), { x: 10, y: 20, zoom: 2 })
  assert.equal(box.transform, 'translate(90px, 140px)')
  assert.equal(box.transform.includes('scale('), false)
  assert.equal(box.transformOrigin, '0 0')
  assert.equal(box.width, 240)
  assert.equal(box.height, 160)
  assert.equal(box.zIndex, 7)

  const safe = contentLayerStyle(stickyNode('n', 10, 20, 50, 40), { x: Number.NaN, y: Number.NaN, zoom: -3 })
  assert.equal(Number.isFinite(safe.width) && safe.width > 0, true)
  assert.equal(Number.isFinite(safe.height) && safe.height > 0, true)
  assert.match(safe.transform, /^translate\(-?\d+(\.\d+)?px, -?\d+(\.\d+)?px\)$/)
  assert.equal(safe.transform.includes('scale('), false)
}

{
  const a = { id: 'a', kind: 'sticky', position: { x: 100, y: 80 }, size: { width: 200, height: 120 }, label: 'A' }
  const b = { id: 'b', kind: 'sticky', position: { x: 360, y: 140 }, size: { width: 180, height: 100 }, label: 'B' }
  const outsider = { id: 'c', kind: 'ai', position: { x: 900, y: 40 }, size: { width: 200, height: 200 }, label: 'C' }
  const grouped = createGroupFromNodes([a, b, outsider], ['a', 'b'])
  assert.ok(grouped, 'two members should create a group')
  const group = grouped.nodes.find((node) => node.id === grouped.groupId)
  const memberA = grouped.nodes.find((node) => node.id === 'a')
  const memberB = grouped.nodes.find((node) => node.id === 'b')
  assert.equal(group?.kind, 'group')
  assert.equal(group?.memberCount, 2)
  assert.equal(memberA?.parentGroupId, grouped.groupId)
  assert.equal(memberB?.parentGroupId, grouped.groupId)
  assert.deepEqual(memberA?.position, a.position)
  assert.deepEqual(memberB?.position, b.position)
  assert.ok(group.position.x <= a.position.x)
  assert.ok(group.position.y <= a.position.y)
  assert.ok(group.position.x + group.size.width >= b.position.x + b.size.width)
  assert.ok(group.position.y + group.size.height >= b.position.y + b.size.height)
  const dragIds = expandDragIds(grouped.nodes, [grouped.groupId])
  assert.equal(dragIds.includes('a'), true)
  assert.equal(dragIds.includes('b'), true)
  const restored = ungroupNode(grouped.nodes, grouped.groupId)
  assert.equal(restored.some((node) => node.kind === 'group'), false)
  assert.equal(restored.find((node) => node.id === 'a')?.parentGroupId, undefined)
  assert.equal(createGroupFromNodes([a, outsider], ['a']), null)

  const singleOffset = outlineGapOffset([a])
  assert.deepEqual(singleOffset, { x: a.size.width + NODE_OUTLINE_GAP, y: 0 })
  const multiOffset = outlineGapOffset([a, b])
  assert.deepEqual(multiOffset, { x: (b.position.x + b.size.width - a.position.x) + NODE_OUTLINE_GAP, y: 0 })
  const copyA = { x: a.position.x + multiOffset.x, y: a.position.y + multiOffset.y }
  assert.equal(copyA.x - (b.position.x + b.size.width), NODE_OUTLINE_GAP)

  assert.match(minimapColor('ai', false, false), /8b5cf6/)
  assert.equal(minimapColor('sticky', false, true), 'var(--primary)')
  assert.match(minimapColor('unknown', true, false), /muted-foreground/)
}

{
  const viewport = { x: 10, y: 20, zoom: 2 }
  const world = screenToWorld({ x: 100, y: 200 }, viewport)
  almostPoint({ x: world.x - 270, y: world.y - 215 }, { x: -225, y: -125 }, 'clipboard world position')
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const source = stickyNode('source', 0, 0, 200, 120)
  const target = stickyNode('target', 240, 0, 200, 120)
  const store = () => useGraphStore.getState()
  store().openDocument({ id: 'connection-test', name: 'test', title: 'test', nodes: [source], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  store().addConnectedNode('missing', target)
  assert.equal(store().currentDocument.nodes.length, 1)
  store().toggleLock()
  store().addConnectedNode('source', target)
  assert.equal(store().currentDocument.nodes.length, 1)
  store().toggleLock()
  store().addConnectedNode('source', { ...target, disabled: true })
  assert.equal(store().currentDocument.nodes.length, 1)
  store().addConnectedNode('source', target)
  assert.equal(store().currentDocument.nodes.length, 2)
  assert.equal(store().currentDocument.edges.length, 1)
  assert.deepEqual(store().selection, ['target'])
  assert.equal(store().historyIndex, 1, 'create and connect are a single undo step')
  store().addConnectedNode('source', target)
  store().addEdge('source', 'source')
  store().addEdge('missing', 'target')
  store().addEdge('source', 'target')
  assert.equal(store().currentDocument.edges.length, 1)
  assert.equal(store().historyIndex, 1)
  store().undo()
  assert.equal(store().currentDocument.nodes.length, 1)
  assert.equal(store().currentDocument.edges.length, 0)
  store().redo()
  assert.equal(store().currentDocument.nodes.length, 2)
  assert.equal(store().currentDocument.edges.length, 1)
  store().deleteEdge(store().currentDocument.edges[0].id)
  store().undo()
  assert.equal(store().currentDocument.edges.length, 1)
  store().closeDocument()
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const store = () => useGraphStore.getState()
  const node = stickyNode('resize-navigation', 0, 0, 200, 120)
  store().openDocument({ id: 'resize-navigation', title: 'test', nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  store().setViewport({ x: -175, y: 234, zoom: 0.60556 })
  store().updateNode(node.id, { size: { width: 300, height: 180 } })
  store().commitHistory()
  for (const view of [{ x: -175, y: 234, zoom: 0.60556 }, { x: 600, y: -800, zoom: 0.25 }, { x: -2400, y: 720, zoom: 2.5 }]) {
    store().setViewport(view)
    store().undo()
    assert.deepEqual(store().currentDocument.nodes[0].size, { width: 200, height: 120 })
    assert.deepEqual(store().view, view, 'undoing a resize must not undo minimap navigation or canvas zoom')
    store().redo()
    assert.deepEqual(store().currentDocument.nodes[0].size, { width: 300, height: 180 })
    assert.deepEqual(store().view, view, 'redoing a resize preserves the current view')
  }
  assert.deepEqual(store().history[0].viewport, { x: 0, y: 0, zoom: 1 }, 'view preservation does not mutate history snapshots')
  store().closeDocument()
}

{
  const toolbarSource = ts.createSourceFile(
    'CanvasToolbar.tsx',
    readFileSync(join(srcRoot, 'canvas/components/CanvasToolbar.tsx'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  const requiredActions = new Set(['保存', '保存为模板', '导出', '导入', '添加节点'])
  const inspect = (syntax) => {
    if (ts.isJsxElement(syntax)) {
      const attributes = syntax.openingElement.attributes.properties
      const label = attributes.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(toolbarSource) === 'aria-label')
      if (label?.initializer && ts.isStringLiteral(label.initializer) && requiredActions.has(label.initializer.text)) {
        assert.ok(attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(toolbarSource) === 'title'))
        assert.ok(attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(toolbarSource) === 'onClick'))
        for (let ancestor = syntax.parent; ancestor; ancestor = ancestor.parent) {
          if (!ts.isJsxExpression(ancestor) || !ancestor.expression) continue
          const expression = ancestor.expression
          const condition = ts.isBinaryExpression(expression) ? expression.left
            : ts.isConditionalExpression(expression) ? expression.condition : null
          assert.ok(!condition?.getText(toolbarSource).includes('compactActions'), `${label.initializer.text} must remain mounted in compact mode`)
          assert.ok(!condition?.getText(toolbarSource).includes('compactCenter'), `${label.initializer.text} must remain mounted when the center compacts`)
        }
        requiredActions.delete(label.initializer.text)
      }
    }
    ts.forEachChild(syntax, inspect)
  }
  inspect(toolbarSource)
  assert.equal(requiredActions.size, 0, 'toolbar actions and add-node entry must have labeled buttons')
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const store = () => useGraphStore.getState()
  const group = { id: 'group', kind: 'group', label: 'Group', position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, memberCount: 2 }
  const members = [stickyNode('member1', 30, 30, 80, 60, { parentGroupId: group.id }), stickyNode('member2', 200, 30, 80, 60, { parentGroupId: group.id })]
  const outside = stickyNode('outside', 600, 100, 100, 80)
  const edge = { id: 'edge', source: 'outside', target: 'member1' }
  store().openDocument({ id: 'drop-test', name: 'test', title: 'test', nodes: [group, ...members, outside], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  store().updateNode(outside.id, { position: { x: 320, y: 180 } })
  store().finishNodeDrag([outside.id])
  const joined = store().currentDocument.nodes.find((node) => node.id === outside.id)
  assert.equal(joined.parentGroupId, group.id)
  assert.deepEqual(joined.position, { x: 320, y: 180 }, 'joining preserves absolute world coordinates')
  assert.equal(store().currentDocument.nodes.find((node) => node.id === group.id).memberCount, 3)
  assert.deepEqual(store().currentDocument.edges, [edge])
  assert.equal(store().historyIndex, 1, 'movement and membership are one undo step')
  store().undo()
  assert.deepEqual(store().currentDocument.nodes.find((node) => node.id === outside.id).position, outside.position)
  assert.equal(store().currentDocument.nodes.find((node) => node.id === outside.id).parentGroupId, undefined)
  store().redo()
  assert.equal(store().currentDocument.nodes.find((node) => node.id === outside.id).parentGroupId, group.id)
  store().updateNode(outside.id, { position: { x: 700, y: 180 } })
  store().finishNodeDrag([outside.id])
  assert.equal(store().currentDocument.nodes.find((node) => node.id === outside.id).parentGroupId, undefined)
  assert.deepEqual(store().currentDocument.edges, [edge])
  store().undo()
  assert.equal(store().currentDocument.nodes.find((node) => node.id === outside.id).parentGroupId, group.id)
  store().closeDocument()
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const { movableDragIds } = loadFrom(withExt(join(srcRoot, 'canvas/grouping')))
  const source = ts.createSourceFile('provider.tsx', readFileSync(join(srcRoot, 'canvas/components/CanvasProvider.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  const findHandler = (syntax) => {
    if (ts.isBinaryExpression(syntax) && syntax.left.getText(source) === 'emitRef.current') handler = syntax.right.getText(source)
    ts.forEachChild(syntax, findHandler)
  }
  findHandler(source)
  assert.ok(handler)
  const store = () => useGraphStore.getState()
  const originalNodes = [stickyNode('first', 0, 0, 100, 80), stickyNode('second', 160, 0, 100, 80)]
  const originalEdge = { id: 'original-edge', source: 'first', target: 'second' }
  store().openDocument({ id: 'alt-drag', name: 'test', title: 'test', nodes: originalNodes, edges: [originalEdge], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  store().setSelection(['first', 'second'])
  const duplicateDragRef = { current: { selection: [...store().selection], copies: [] } }
  const dragOriginRef = { current: new Map() }
  const emitRef = { current: null }
  const nodesRef = { current: originalNodes }
  const noop = () => {}
  const compiled = ts.transpileModule('const handler = ' + handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  emitRef.current = new Function('useGraphStore', 'useUiStore', 'duplicateDragRef', 'dragOriginRef', 'nodesRef', 'movableDragIds', 'setDraggingNodeIds', 'setMarquee', 'viewportRef', 'emitRef', compiled + '; return handler')(useGraphStore, { getState: () => ({ setViewportMoving: noop, setSelectedEdgeId: noop }) }, duplicateDragRef, dragOriginRef, nodesRef, movableDragIds, noop, noop, { current: { zoom: 1 } }, emitRef)
  const emit = (type, x = 0, y = 0) => emitRef.current({ type, nodeId: 'first', deltaWorld: { x, y } })
  emit('node-drag-start')
  emit('node-drag-end', 1)
  assert.equal(store().currentDocument.nodes.length, 2, 'Alt-click must not create a copy')
  duplicateDragRef.current = { selection: ['first', 'second'], copies: [] }
  emit('node-drag-start')
  emit('node-drag-move', 70, 40)
  const copies = [...duplicateDragRef.current.copies]
  assert.equal(copies.length, 2)
  assert.deepEqual(store().currentDocument.nodes.slice(0, 2), originalNodes, 'Alt-drag preserves originals')
  assert.deepEqual(store().currentDocument.nodes[2].position, { x: 70, y: 40 })
  assert.equal(store().currentDocument.edges.length, 2)
  assert.equal(store().currentDocument.edges[1].source, copies[0])
  assert.equal(store().currentDocument.edges[1].target, copies[1])
  assert.equal(store().historyIndex, 0, 'moving copies does not commit early')
  emit('gesture-cancel')
  assert.deepEqual(store().currentDocument.nodes, originalNodes)
  assert.deepEqual(store().currentDocument.edges, [originalEdge])
  assert.deepEqual(store().selection, ['first', 'second'])
  duplicateDragRef.current = { selection: ['first', 'second'], copies: [] }
  emit('node-drag-start')
  emit('node-drag-move', 60, 30)
  emit('node-drag-end', 90, 50)
  assert.equal(store().historyIndex, 1, 'copy and movement commit together')
  assert.deepEqual(store().currentDocument.nodes[2].position, { x: 90, y: 50 })
  store().undo()
  assert.deepEqual(store().currentDocument.nodes, originalNodes)
  store().redo()
  assert.equal(store().currentDocument.nodes.length, 4)
  assert.equal(store().currentDocument.edges.length, 2)
  store().closeDocument()
}

{
  const source = ts.createSourceFile('provider.tsx', readFileSync(join(srcRoot, 'canvas/components/CanvasProvider.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let capture
  const findCapture = (syntax) => {
    if (ts.isVariableDeclaration(syntax) && syntax.name.getText(source) === 'onPointerDownCapture') capture = syntax.initializer.getText(source)
    ts.forEachChild(syntax, findCapture)
  }
  findCapture(source)
  assert.ok(capture)
  const compiled = ts.transpileModule('const handler = ' + capture, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const scenario of [
    { button: 1, space: false, chrome: false, mode: 'idle', resize: false, expected: true },
    { button: 0, space: true, chrome: false, mode: 'idle', resize: false, expected: true },
    { button: 0, space: false, chrome: false, mode: 'idle', resize: false, expected: false },
    { button: 1, space: false, chrome: true, mode: 'idle', resize: false, expected: false },
    { button: 0, space: true, chrome: true, mode: 'idle', resize: false, expected: false },
    { button: 1, space: false, chrome: false, mode: 'connecting', resize: false, expected: false },
    { button: 1, space: false, chrome: false, mode: 'idle', resize: true, expected: false },
    { button: 2, space: true, chrome: false, mode: 'idle', resize: false, expected: false },
  ]) {
    const calls = []
    const panClickRef = { current: false }
    const handler = new Function('restoreHostFocus', 'panClickRef', 'spacePressed', 'interaction', 'resizeRef', 'pointerDown', 'getPointerInput', compiled + '; return handler')(() => {}, panClickRef, scenario.space, { getMode: () => scenario.mode }, { current: scenario.resize }, () => calls.push('pan'), () => ({}))
    handler({ button: scenario.button, pointerId: 7, target: { closest: () => scenario.chrome }, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'), currentTarget: { setPointerCapture: (id) => { assert.equal(id, 7); calls.push('capture') } } })
    assert.deepEqual(calls, scenario.expected ? ['prevent', 'stop', 'capture', 'pan'] : [], JSON.stringify(scenario))
    assert.equal(panClickRef.current, scenario.expected)
  }
  assert.match(source.text, /onPointerDownCapture={onPointerDownCapture}/)
  assert.match(source.text, /onClickCapture=/)
  assert.match(source.text, /onAuxClickCapture=/)
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const source = ts.createSourceFile('provider.tsx', readFileSync(join(srcRoot, 'canvas/components/CanvasProvider.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let finish
  const findFinish = (syntax) => {
    if (ts.isVariableDeclaration(syntax) && syntax.name.getText(source) === 'finishResize') finish = syntax.initializer.arguments[0].getText(source)
    ts.forEachChild(syntax, findFinish)
  }
  findFinish(source)
  assert.ok(finish)
  const compiled = ts.transpileModule('const handler = ' + finish, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const store = () => useGraphStore.getState()
  for (const scenario of [
    { commit: false, locked: false, changed: true, expectedCommit: false },
    { commit: true, locked: true, changed: true, expectedCommit: false },
    { commit: true, locked: false, changed: false, expectedCommit: false },
    { commit: true, locked: false, changed: true, expectedCommit: true },
  ]) {
    const node = stickyNode('resize', 50, 60, 200, 160)
    store().openDocument({ id: 'resize-test', name: 'test', title: 'test', nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
    useGraphStore.setState({ isLocked: scenario.locked })
    if (scenario.changed) store().updateNode(node.id, { size: { width: 320, height: 240 } })
    const resizeRef = { current: { nodeId: node.id, origin: { ...node.size } } }
    let resizing = true
    let moving = true
    const handler = new Function('useGraphStore', 'useUiStore', 'resizeRef', 'setResizing', compiled + '; return handler')(useGraphStore, { getState: () => ({ setViewportMoving: (value) => { moving = value } }) }, resizeRef, (value) => { resizing = value })
    handler(scenario.commit)
    assert.equal(resizeRef.current, null)
    assert.equal(resizing, null)
    assert.equal(moving, false)
    assert.deepEqual(store().currentDocument.nodes[0].size, scenario.expectedCommit ? { width: 320, height: 240 } : node.size)
    assert.equal(store().historyIndex, scenario.expectedCommit ? 1 : 0)
    if (scenario.expectedCommit) {
      assert.equal(store().currentDocument.nodes[0].manualSize, true)
      store().undo()
      assert.deepEqual(store().currentDocument.nodes[0].size, node.size)
      store().redo()
      assert.deepEqual(store().currentDocument.nodes[0].size, { width: 320, height: 240 })
    }
    store().closeDocument()
  }
  useGraphStore.setState({ isLocked: false })
  assert.ok(source.text.includes("window.addEventListener('blur', cancelGesture)"))
  assert.ok(source.text.includes('if (event.buttons !== 0) return'))
}

{
  const { minimapVisibleWorld } = loadFrom(withExt(join(srcRoot, 'canvas/minimap')))
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    const viewport = { x: -120, y: 90, zoom }
    const size = { width: 1440, height: 900 }
    for (const insets of [{ left: 0, right: 0 }, { left: 284, right: 0 }, { left: 0, right: 336 }, { left: 284, right: 336 }]) {
      const rect = minimapVisibleWorld(viewport, size, insets)
      assert.equal(rect.width, (1440 - insets.left - insets.right) / zoom)
      assert.equal(rect.x, (insets.left + 120) / zoom)
      assert.equal(rect.y, -90 / zoom)
      assert.equal(rect.height, 900 / zoom)
      assert.ok(Math.abs((rect.x + rect.width / 2) * zoom + viewport.x - (insets.left + (size.width - insets.left - insets.right) / 2)) < 0.00001, 'minimap frame uses the same visible center as navigation')
    }
  }
  assert.equal(minimapVisibleWorld({ x: 0, y: 0, zoom: 1 }, { width: 400, height: 200 }, { left: 284, right: 336 }).width, 0)
}

{
  const { nodeToolbarScaleStyle } = loadFrom(withExt(join(srcRoot, 'canvas/toolbar-placement')))
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    for (const placement of ['top', 'bottom']) {
      const style = nodeToolbarScaleStyle(zoom, placement)
      assert.equal(style.transformOrigin, '0 0')
      assert.equal(style.transition, 'opacity 140ms ease', 'inverse zoom must update immediately, not interpolate behind the world layer')
      assert.equal(style.transform, `scale(${1 / zoom}) translateY(${placement === 'top' ? '-100%' : '0'})`)
      assert.ok(Math.abs(32 * (1 / zoom) * zoom - 32) < 0.00001, 'toolbar buttons retain 32px screen hit targets')
    }
  }
  const toolbar = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  assert.ok(toolbar.includes('...nodeToolbarScaleStyle(viewport.zoom, toolbarPlacement)'))
  assert.ok(toolbar.includes('setToolbarWidth(element.offsetWidth)'))
  assert.ok(toolbar.includes('setToolbarHeight(element.offsetHeight)'))
  assert.ok(toolbar.includes('maxWidth: toolbarHorizontal.maxWidth,'))
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const { arrangeDocumentNodes } = loadFrom(withExt(join(srcRoot, 'canvas/node-factory')))
  const store = () => useGraphStore.getState()
  const group = { id: 'arrange-group', kind: 'group', label: 'group', position: { x: 900, y: 700 }, size: { width: 400, height: 300 }, memberCount: 1 }
  const member = stickyNode('arrange-member', 940, 750, 100, 80, { parentGroupId: group.id })
  const pinned = stickyNode('arrange-pin', 1500, 1100, 100, 80, { pinned: true })
  const edge = { id: 'arrange-edge', source: member.id, target: pinned.id }
  store().openDocument({ id: 'arrange-test', name: 'test', title: 'test', nodes: [group, member, pinned], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  useGraphStore.setState({ isLocked: true })
  arrangeDocumentNodes()
  assert.deepEqual(store().currentDocument.nodes, [group, member, pinned])
  assert.equal(store().historyIndex, 0)
  useGraphStore.setState({ isLocked: false })
  arrangeDocumentNodes()
  const arranged = store().currentDocument.nodes
  assert.deepEqual(arranged[0].position, { x: 80, y: 80 })
  assert.deepEqual(arranged[1].position, { x: 120, y: 130 })
  assert.equal(arranged[1].parentGroupId, group.id)
  assert.deepEqual(arranged[2].position, pinned.position)
  assert.deepEqual(store().currentDocument.edges, [edge])
  assert.equal(store().historyIndex, 1)
  store().undo()
  assert.deepEqual(store().currentDocument.nodes, [group, member, pinned])
  store().redo()
  assert.deepEqual(store().currentDocument.nodes, arranged)
  store().closeDocument()
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const store = () => useGraphStore.getState()
  const members = [stickyNode('lock-first', 20, 20, 100, 80, { parentGroupId: 'lock-group' }), stickyNode('lock-second', 160, 20, 100, 80, { parentGroupId: 'lock-group' })]
  const group = { id: 'lock-group', kind: 'group', label: 'group', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, memberCount: 2 }
  const edge = { id: 'lock-edge', source: members[0].id, target: members[1].id }
  store().openDocument({ id: 'lock-test', name: 'test', title: 'test', nodes: [group, ...members], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  useGraphStore.setState({ isLocked: true })
  const original = store().currentDocument
  const operations = [
    () => store().deleteNode(members[0].id),
    () => store().duplicateNode(members[0].id),
    () => store().deleteEdge(edge.id),
    () => store().ungroup(group.id),
    () => { store().setSelection([group.id]); store().ungroupSelected() },
    () => { store().setSelection(members.map((node) => node.id)); store().groupSelected() },
    () => store().deleteSelected(),
    () => store().duplicateSelected(),
    () => store().pasteNodes(members, { x: 40, y: 40 }),
  ]
  for (const operation of operations) {
    operation()
    assert.equal(store().currentDocument, original, 'locked structural operations must not replace or mutate the graph')
    assert.equal(store().historyIndex, 0)
  }
  useGraphStore.setState({ isLocked: false })
  store().deleteEdge(edge.id)
  assert.equal(store().currentDocument.edges.length, 0)
  store().undo()
  assert.deepEqual(store().currentDocument.edges, [edge])
  store().redo()
  assert.equal(store().currentDocument.edges.length, 0)
  store().closeDocument()
}

{
  const { useGraphStore } = loadFrom(withExt(join(srcRoot, 'stores/graph-store')))
  const { expandDragIds, outlineGapOffset } = loadFrom(withExt(join(srcRoot, 'canvas/grouping')))
  const source = ts.createSourceFile('clipboard.ts', readFileSync(join(srcRoot, 'canvas/clipboard-import.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const functions = source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && ['copySelectedNodes', 'pasteCopiedNodes'].includes(statement.name?.text))
  const code = ts.transpileModule('let nodeClipboard = []; let edgeClipboard = []; let pasteGeneration = 0; ' + functions.map((statement) => statement.getText(source).replace(/^export /, '')).join('; '), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const clipboard = new Function('useGraphStore', 'expandDragIds', 'outlineGapOffset', code + '; return { copySelectedNodes, pasteCopiedNodes }')(useGraphStore, expandDragIds, outlineGapOffset)
  const store = () => useGraphStore.getState()
  const group = { id: 'copy-group', kind: 'group', label: 'group', position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, memberCount: 2 }
  const members = [stickyNode('copy-first', 40, 50, 100, 80, { parentGroupId: group.id }), stickyNode('copy-second', 220, 50, 100, 80, { parentGroupId: group.id })]
  const external = stickyNode('copy-external', 700, 50, 100, 80)
  const edges = [{ id: 'internal', source: members[0].id, target: members[1].id, sourceHandle: 'output', targetHandle: 'input' }, { id: 'external', source: members[0].id, target: external.id }]
  store().openDocument({ id: 'copy-test', name: 'test', title: 'test', nodes: [group, ...members, external], edges, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 })
  store().setSelection([group.id])
  assert.equal(clipboard.copySelectedNodes(), true)
  useGraphStore.setState({ isLocked: true })
  assert.equal(clipboard.pasteCopiedNodes(), false)
  useGraphStore.setState({ isLocked: false })
  assert.equal(clipboard.pasteCopiedNodes(), true)
  const pasted = store().currentDocument.nodes.slice(4)
  assert.equal(pasted.length, 3, 'copying a group includes members')
  assert.deepEqual(pasted[0].position, { x: 440, y: 0 }, 'locked attempt does not consume the first 40px-gap placement')
  assert.equal(pasted[1].parentGroupId, pasted[0].id)
  assert.equal(pasted[2].parentGroupId, pasted[0].id)
  assert.equal(store().currentDocument.edges.length, 3, 'only internal edges are copied')
  const copiedEdge = store().currentDocument.edges[2]
  assert.equal(copiedEdge.source, pasted[1].id)
  assert.equal(copiedEdge.target, pasted[2].id)
  assert.equal(copiedEdge.sourceHandle, 'output')
  assert.equal(copiedEdge.targetHandle, 'input')
  assert.notEqual(copiedEdge.id, edges[0].id)
  assert.equal(store().historyIndex, 1)
  store().undo()
  assert.equal(store().currentDocument.nodes.length, 4)
  assert.deepEqual(store().currentDocument.edges, edges)
  store().redo()
  assert.equal(store().currentDocument.edges.length, 3)
  store().closeDocument()
}

{
  const source = ts.createSourceFile('clipboard.ts', readFileSync(join(srcRoot, 'canvas/clipboard-import.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const names = ['handleCanvasCopy', 'handleCanvasPaste']
  const bodies = source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)).map((statement) => statement.getText(source).replace(/^export /, '')).join('; ')
  const compiled = ts.transpileModule("const NODE_CLIPBOARD_TYPE = 'application/x-cnote-nodes'; let nodeClipboardToken = ''; const nodeClipboard = [{label:'Copied node'}]; " + bodies, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let pastes = 0
  let imports = 0
  let locked = false
  let editable = false
  const api = new Function('isEditableTarget', 'copySelectedNodes', 'pasteCopiedNodes', 'useGraphStore', 'lastPointerClient', 'classifyContentUrl', 'importClipboardInputIntoSelectedNode', 'importClipboardInputAt', compiled + '; return {handleCanvasCopy, handleCanvasPaste}')(
    () => editable, () => true, () => { pastes++; return true }, { getState: () => ({ isLocked: locked }) }, () => ({ x: 0, y: 0 }), () => null, async () => false, async () => { imports++ },
  )
  const data = new Map([['text/plain', 'previous system text']])
  let prevented = false
  const event = { target: null, clipboardData: { items: [], setData: (type, value) => data.set(type, value), getData: (type) => data.get(type) ?? '' }, preventDefault: () => { prevented = true } }
  assert.equal(api.handleCanvasCopy(event), true)
  assert.equal(prevented, true)
  assert.equal(data.get('text/plain'), 'Copied node')
  assert.ok(data.get('application/x-cnote-nodes'))
  assert.equal(await api.handleCanvasPaste(event), true)
  assert.equal(pastes, 1)
  assert.equal(imports, 0, 'node clipboard must win over its plain-text representation')
  data.delete('application/x-cnote-nodes')
  data.set('text/plain', 'fresh external text')
  await api.handleCanvasPaste(event)
  assert.equal(imports, 1, 'new external copy is not shadowed by cached nodes')
  assert.equal(pastes, 1)
  locked = true
  assert.equal(await api.handleCanvasPaste(event), false)
  assert.equal(imports, 1)
  editable = true
  assert.equal(api.handleCanvasCopy(event), false)
  assert.equal(await api.handleCanvasPaste(event), false)
}

{
  const { contentPresentationStyle, contentLayerStyle } = loadFrom(withExt(join(srcRoot, 'canvas/components/content-visibility')))
  for (const kind of ['sticky', 'ai', 'request', 'content', 'group']) {
    for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
      const node = { ...stickyNode('presentation', 120, 80, 400, 300), kind }
      const viewport = { x: 25, y: -30, zoom }
      const presentation = contentPresentationStyle(node, viewport)
      const outer = contentLayerStyle(node, viewport)
      assert.equal(presentation.width, 400, 'content retains its world layout width')
      assert.equal(presentation.height, 300)
      assert.equal(presentation.width * presentation.zoom, outer.width)
      assert.equal(presentation.height * presentation.zoom, outer.height)
      assert.equal(presentation.transform, undefined, 'content must not reenter a scale transform')
    }
  }
  assert.deepEqual(contentPresentationStyle({ kind: 'browser', size: { width: 800, height: 600 } }, { x: 0, y: 0, zoom: 0.25 }), { width: '100%', height: '100%', zoom: 1, '--canvas-node-radius': '6px' })
  assert.ok(viewportSource.includes('style={contentPresentationStyle(node, viewport)}'))
}

{
  const { browserChromeStyle } = loadFrom(withExt(join(srcRoot, 'canvas/browser-presentation')))
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    const style = browserChromeStyle(zoom)
    assert.equal(style.zoom, zoom)
    assert.equal(style.transform, undefined)
    assert.ok(600 * zoom - 48 * style.zoom > 0, 'address bar leaves a proportional guest viewport')
  }
  assert.equal(browserChromeStyle(NaN).zoom, 1)
  assert.equal(browserChromeStyle(0).zoom, 0.1)
  assert.equal(browserChromeStyle(10).zoom, 4)
  const browserSource = readFileSync(join(srcRoot, 'canvas/contents/BrowserContent.tsx'), 'utf8')
  const source = ts.createSourceFile('BrowserContent.tsx', browserSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let scaledForms = 0
  let guestViews = 0
  const visit = (element) => {
    if (ts.isJsxOpeningElement(element) && element.tagName.getText(source) === 'form') {
      assert.ok(element.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'style' && attribute.initializer?.getText(source) === '{browserChromeStyle(canvasZoom)}'))
      scaledForms++
    }
    if (ts.isJsxSelfClosingElement(element) && element.tagName.getText(source) === 'webview') {
      guestViews++
      for (let parent = element.parent; parent; parent = parent.parent) {
        if (ts.isJsxElement(parent)) {
          assert.notEqual(parent.openingElement.tagName.getText(source), 'form', 'native guest cannot inherit chrome layout zoom')
        }
      }
    }
    ts.forEachChild(element, visit)
  }
  visit(source)
  assert.equal(scaledForms, 1)
  assert.equal(guestViews, 1)
}

{
  const browserSource = readFileSync(join(srcRoot, 'canvas/contents/BrowserContent.tsx'), 'utf8')
  const source = ts.createSourceFile('BrowserContent.tsx', browserSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  let normalizer
  const visit = element => {
    if (ts.isFunctionDeclaration(element) && element.name?.text === 'normalizeUrl') normalizer = element.getText(source)
    if (ts.isVariableDeclaration(element) && element.initializer) {
      declarations.set(element.name.getText(source), element.initializer.getText(source))
    }
    ts.forEachChild(element, visit)
  }
  visit(source)
  assert.ok(normalizer)
  for (const name of ['liveUrl', 'initialSrcRef', '[frameSrc, setFrameSrc]']) assert.ok(declarations.has(name))
  const code = ts.transpileModule(`${normalizer}
    function initialize(node, tab) {
      const DEFAULT_BROWSER_URL = "https://www.google.com/";
      const useRef = value => ({current:value});
      const useState = factory => factory();
      const liveUrl = ${declarations.get('liveUrl')};
      return { native: (${declarations.get('initialSrcRef')}).current, iframe: ${declarations.get('[frameSrc, setFrameSrc]')} };
    }`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const initialize = vm.runInNewContext(`${code}; initialize`)
  for (const [node, tab, expected] of [
    [{url:'https://old.example/'}, {url:'https://saved.example/article'}, 'https://saved.example/article'],
    [{}, {url:'http://127.0.0.1:11337/next'}, 'http://127.0.0.1:11337/next'],
    [{url:'https://initial.example/'}, undefined, 'https://initial.example/'],
    [{}, undefined, 'https://www.google.com/'],
    [{}, {url:'about:blank'}, 'about:blank'],
  ]) {
    const mounted = initialize(node, tab)
    assert.equal(mounted.native, expected, 'native remount resumes saved runtime URL')
    assert.equal(mounted.iframe, expected, 'fallback remount resumes saved runtime URL')
  }
}

{
  const browserSource = readFileSync(join(srcRoot, 'canvas/contents/BrowserContent.tsx'), 'utf8')
  const source = ts.createSourceFile('BrowserContent.tsx', browserSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  const visit = element => {
    if (ts.isVariableDeclaration(element) && element.initializer) declarations.set(element.name.getText(source), element.initializer.getText(source))
    ts.forEachChild(element, visit)
  }
  visit(source)
  const code = ts.transpileModule(`
    let nativeError = "";
    let tab = {status:"loading"};
    let navigationFailed = false;
    let address = "https://main.example/";
    const setAddress = value => address = value;
    const eventUrl = event => event.url;
    const setWebviewReady = () => {};
    const syncNativeNav = () => {};
    const webview = {getTitle:()=>"Page"};
    const sessionId = "session";
    const tabId = "tab";
    const setNativeError = value => nativeError = value;
    const runtime = () => ({updateTab: (_session, _tab, patch) => Object.assign(tab, patch)});
    const onFailLoad = ${declarations.get('onFailLoad')};
    const onStartLoading = ${declarations.get('onStartLoading')};
    const onDomReady = ${declarations.get('onDomReady')};
    const onNavigate = ${declarations.get('onNavigate')};
    function loading(isDesktop, webviewMounted, webviewReady) { return ${declarations.get('loading')}; }
    ({onFailLoad,onStartLoading,onDomReady,onNavigate,loading,state:()=>({error:nativeError,status:tab.status,address,url:tab.url})});
  `, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const { browserErrorMessage } = loadFrom(join(srcRoot, 'canvas/browser-error.ts'))
  const api = vm.runInNewContext(code, { errorMessage: browserErrorMessage })
  assert.equal(api.loading(true, false, false), true)
  api.onFailLoad({errorCode:-3, isMainFrame:true})
  assert.equal(api.state().status, 'loading')
  api.onFailLoad({errorCode:-105, isMainFrame:false, errorDescription:'Subframe failed'})
  assert.equal(api.state().error, '')
  api.onFailLoad({errorCode:-105, isMainFrame:true, errorDescription:'Name resolution failed'})
  assert.equal(api.state().status, 'error')
  assert.equal(api.loading(true, true, false), false, 'first-load failure must stop the spinner')
  assert.equal(api.loading(true, true, true), false)
  api.onDomReady()
  assert.equal(api.state().status, 'error', 'Chromium error document readiness must not hide navigation failure')
  const failed = api.state();
  api.onNavigate({isMainFrame:false, url:'https://child.example/#anchor'});
  assert.equal(api.state().address, failed.address, 'subframe hash navigation must not replace the address bar');
  assert.equal(api.state().error, failed.error, 'subframe navigation must not clear a main-frame failure');
  assert.equal(api.state().status, 'error');
  api.onStartLoading({isMainFrame:true, isInPlace:false})
  assert.equal(api.state().error, '', 'retry clears obsolete navigation error')
  assert.equal(api.state().status, 'loading')
  assert.equal(api.loading(true, true, true), true)
  api.onDomReady()
  assert.equal(api.state().status, 'ready')
  assert.equal(api.loading(true, true, true), false)
  api.onNavigate({isMainFrame:true, url:'https://main.example/#anchor'});
  assert.equal(api.state().url, 'https://main.example/#anchor');
  api.onNavigate({url:'https://main.example/next'});
  assert.equal(api.state().address, 'https://main.example/next', 'did-navigate has no isMainFrame field');
  api.onNavigate({isMainFrame:false, url:'https://child.example/#next'});
  assert.equal(api.state().url, 'https://main.example/next', 'persisted tab URL remains the top-level page');
}

{
  const { nodeMenuPlacement, bindNodeMenus } = loadFrom(join(srcRoot, 'canvas/node-menu-placement.ts'))
  const bounds = { left: 292, top: 8, right: 900, bottom: 692 }
  for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2.5, 4]) {
    for (const left of [-300, 300, 850, 1500]) {
      for (const top of [-500, 10, 350, 660, 1200]) {
        for (const align of ['left', 'right']) {
          const menu = nodeMenuPlacement({ left, top, right: left + 150 * zoom, bottom: top + 32 * zoom }, bounds, { width: 280 * zoom, height: 440 * zoom }, align, 8 * zoom)
          assert.ok(menu.left >= bounds.left && menu.left + menu.width <= bounds.right)
          assert.ok(menu.top >= bounds.top && menu.top + Math.min(440 * zoom, menu.maxHeight) <= bounds.bottom)
        }
      }
    }
  }
  assert.equal(nodeMenuPlacement({ left: 400, right: 500, top: 640, bottom: 672 }, bounds, { width: 280, height: 440 }, 'right').placement, 'top')
  assert.equal(nodeMenuPlacement({ left: 400, right: 500, top: 20, bottom: 52 }, bounds, { width: 280, height: 440 }, 'left').placement, 'bottom')
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div data-cnote-canvas><div id="root"><details><summary>Parameters</summary><div data-node-menu="right" data-menu-width="280" data-menu-height="440"></div></details></div></div>')
  const previousWindow = globalThis.window
  globalThis.window = dom.window
  const frames = new Map()
  let nextFrame = 0
  dom.window.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame }
  dom.window.cancelAnimationFrame = (id) => frames.delete(id)
  const root = dom.window.document.getElementById('root')
  const details = root.querySelector('details')
  const summary = root.querySelector('summary')
  const menu = root.querySelector('[data-node-menu]')
  let anchor = { left: 800, right: 900, top: 650, bottom: 666 }
  let zoom = 0.5
  root.parentElement.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 700 })
  details.getBoundingClientRect = summary.getBoundingClientRect = () => anchor
  menu.getBoundingClientRect = () => ({ width: 280 * zoom })
  Object.defineProperties(menu, { scrollHeight: { get: () => 600 }, offsetHeight: { get: () => 442 }, clientHeight: { get: () => 440 } })
  let cleanup
  try {
    cleanup = bindNodeMenus(root, () => ({ zoom, leftInset: 284, rightInset: 116 }))
    assert.equal(frames.size, 0, 'closed menus do not schedule measurement')
    details.open = true
    menu.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }))
    assert.equal(details.open, true, 'menu interaction must preserve the open menu')
    root.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }))
    assert.equal(details.open, false, 'outside pointer closes the menu')
    details.open = true
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }))
    assert.equal(details.open, true, 'navigation keys do not dismiss the menu')
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
    assert.equal(details.open, false, 'Escape dismisses the menu')
    details.open = true
    details.dispatchEvent(new dom.window.Event('toggle'))
    assert.equal(menu.dataset.placement, 'top')
    assert.equal(menu.style.top, '-448px', 'screen coordinates convert back to layout pixels at 50%')
    assert.equal(frames.size, 1)
    anchor = { left: 100, right: 200, top: 20, bottom: 52 }
    zoom = 1
    const [frameId, callback] = frames.entries().next().value
    frames.delete(frameId)
    callback()
    assert.equal(menu.dataset.placement, 'bottom')
    assert.equal(menu.style.left, '192px', 'open menu follows canvas motion and avoids left panel')
    details.open = false
    const [closedId, closedCallback] = frames.entries().next().value
    frames.delete(closedId)
    closedCallback()
    assert.equal(frames.size, 0)
    details.open = true
    details.dispatchEvent(new dom.window.Event('toggle'))
    cleanup()
    assert.equal(frames.size, 0, 'unmount cancels pending measurement')
  } finally {
    cleanup?.()
    dom.window.close()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

{
  const groupContent = readFileSync(new URL('../src/canvas/contents/GroupContent.tsx', import.meta.url), 'utf8')
  const groupShell = readFileSync(new URL('../src/canvas/components/NodeShell.tsx', import.meta.url), 'utf8')
  assert.ok(!groupContent.includes('ungroup('), 'group actions belong to the shell only')
  const toolbar = readFileSync(new URL('../src/canvas/components/NodeHoverToolbar.tsx', import.meta.url), 'utf8')
  assert.ok(!groupShell.includes('ungroup('), 'shell delegates group actions to the shared toolbar')
  assert.ok(groupShell.includes('<NodeHoverToolbar node={node} selected={selected} />'))
  assert.equal(toolbar.split('label="解绑"').length - 1, 1, 'one group unbind control')
  assert.ok(toolbar.includes('<ToolbarButton label="解绑" disabled={isLocked}'), 'group unbind honors locking and shared 32px targets')
  assert.ok(!toolbar.includes("if (node.kind === 'group') return null"), 'group uses measured placement and inverse zoom')
  assert.ok(groupContent.includes('beginNodeDrag(event, node.id)'), 'group background remains draggable')
}

{
  const { browserErrorMessage } = loadFrom(join(srcRoot, 'canvas/browser-error.ts'))
  const raw = "Error invoking remote method GUEST_VIEW_MANAGER_CALL: Error: ERR_CONNECTION_REFUSED (-102) loading http://127.0.0.1/private"
  const expected = '无法连接到网站，请检查地址或稍后刷新（ERR_CONNECTION_REFUSED）'
  assert.equal(browserErrorMessage(new Error(raw), '导航失败'), expected)
  assert.equal(browserErrorMessage('ERR_CONNECTION_REFUSED', '导航失败'), expected, 'event and rejected navigation show the same error')
  assert.equal(browserErrorMessage('ERR_CERT_AUTHORITY_INVALID', '无法安全加载网页'), '无法安全加载网页（ERR_CERT_AUTHORITY_INVALID）')
  assert.equal(browserErrorMessage(null, '加载失败'), '加载失败')
  assert.equal(browserErrorMessage('Error invoking remote method capture', '捕获失败'), '捕获失败')
  assert.equal(browserErrorMessage('没有可提取的正文', '捕获失败'), '没有可提取的正文')
}

{
  const text = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  const source = ts.createSourceFile('NodeHoverToolbar.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let feedbackAction
  const findFeedback = element => {
    if (ts.isVariableDeclaration(element) && element.name.getText(source) === 'showFeedback') feedbackAction = element.initializer.getText(source)
    ts.forEachChild(element, findFeedback)
  }
  findFeedback(source)
  assert.ok(feedbackAction)
  const timers = []
  const cleared = []
  let displayedFeedback
  const feedbackTimer = { current: 9 }
  const showFeedback = vm.runInNewContext(ts.transpileModule(`(${feedbackAction})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    FEEDBACK_MS: 1800, feedbackTimer,
    setFeedback: value => { displayedFeedback = value },
    window: {
      clearTimeout: handle => cleared.push(handle),
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    },
  })
  showFeedback('已重新识别内容')
  assert.equal(displayedFeedback.tone, 'info')
  assert.equal(timers[0].delay, 1800)
  showFeedback('重新识别失败，已保留原内容', 'error')
  assert.equal(displayedFeedback.tone, 'error')
  assert.equal(displayedFeedback.message, '重新识别失败，已保留原内容')
  assert.equal(timers[1].delay, 6000)
  assert.deepEqual(cleared, [9, 1])
  timers[1].callback()
  assert.equal(displayedFeedback, null)
  assert.ok(text.includes('title={feedback.message}'), 'truncated feedback exposes its full message')
  assert.ok(text.includes("feedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'"))
  const names = new Set(['textFromNode', 'canCopyContentText', 'contentImportInput'])
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)).map(statement => statement.getText(source)).join('\n')
  const compiled = ts.transpileModule(functions + '\n({textFromNode,canCopyContentText,contentImportInput})', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const { contentNodeText } = loadFrom(join(srcRoot, 'domain/content-text.ts'))
  const api = vm.runInNewContext(compiled, { contentNodeText })
  for (const [category, payload, expected] of [
    ['text', {kind:'text',value:'Parsed text',format:'plain'}, 'Parsed text'],
    ['document', {kind:'document',plainText:'Document body'}, 'Document body'],
    ['social', {kind:'social',bodyText:'Post body'}, 'Post body'],
    ['video', {kind:'video',transcript:'Transcript'}, 'Transcript'],
  ]) {
    const node = {kind:'content',category,payload};
    assert.equal(api.canCopyContentText(node), true, 'parsed textual content exposes copy');
    assert.equal(api.textFromNode(node), expected);
  }
  const parsed = {kind:'content',category:'text',source:{kind:'text',mimeType:'text/plain'},payload:{kind:'text',value:'Recovered body',format:'plain'}};
  assert.equal(api.contentImportInput(parsed)?.text, 'Recovered body', 'reparse can read payload-only text');
  assert.equal(api.canCopyContentText({kind:'content',category:'image',payload:{kind:'image',resources:[]}}), false);
  assert.equal(api.textFromNode({...parsed,content:'Edited body'}), 'Edited body', 'explicit edited content has priority');
  const copyStart = text.indexOf('  const copyContentText = async');
  const copyEnd = text.indexOf('  const downloadMedia', copyStart);
  assert.ok(text.slice(copyStart,copyEnd).includes('textFromNode(node)'), 'copy action uses the same text resolver as capability detection');
  let copyAction;
  const findCopy = element => {
    if (ts.isVariableDeclaration(element) && element.name.getText(source) === 'copyContentText') copyAction = element.initializer.getText(source);
    ts.forEachChild(element, findCopy);
  };
  findCopy(source);
  const actionCode = ts.transpileModule(functions + `
    let busy = false;
    let copied;
    let feedback;
    const setBusy = value => busy = value;
    const showFeedback = value => feedback = value;
    const copyText = async value => { copied = value; };
    const run = ${copyAction};
    ({run,state:()=>({busy,copied,feedback})});
  `, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const action = vm.runInNewContext(actionCode, {node:parsed,contentNodeText});
  await action.run();
  assert.equal(action.state().copied, 'Recovered body', 'actual copy callback forwards payload text to clipboard');
  assert.equal(action.state().busy, false);
  assert.equal(action.state().feedback, undefined);
  const emptyAction = vm.runInNewContext(actionCode, {node:{...parsed,payload:{kind:'text',value:'   '}},contentNodeText});
  await emptyAction.run();
  assert.equal(emptyAction.state().copied, undefined);
  assert.equal(emptyAction.state().feedback, '没有可复制的文本');
}

{
  const text = readFileSync(join(srcRoot, 'canvas/content-import-adapter.ts'), 'utf8')
  const source = ts.createSourceFile('adapter.ts', text, ts.ScriptTarget.Latest, true)
  const importer = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'importContentIntoNode')
  assert.ok(importer)
  const compiled = ts.transpileModule(importer.getText(source).replace(/^export /, '') + '\nimportContentIntoNode', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const applied = []
  const retained = []
  let parsed = { source: { kind: 'url' }, payload: { kind: 'document', plainText: '' }, partial: true, warnings: [{ code: 'SERVICE_NOT_CONFIGURED', message: 'Missing parser' }] }
  const run = vm.runInNewContext(compiled, {
    detectAndParseContent: async () => parsed,
    applyParsedContent: (...args) => applied.push(args),
    retainLocalResource: async (assetId) => retained.push(assetId),
  })
  const input = { kind: 'text', text: 'https://example.com' }
  await assert.rejects(run('existing', input, undefined, { preserveOnFailure: true }), /Missing parser/)
  assert.equal(applied.length, 0, 'failed reparse must not replace existing content, category, title or history')
  assert.equal(retained.length, 0)
  await run('new', input)
  assert.equal(applied.length, 1, 'initial import still allows a retryable link preview')
  for (const warnings of [undefined, [{ code: 'PREVIEW_ONLY', message: 'Preview' }], [{ code: 'REMOTE_PARSE_PARTIAL', message: 'Metadata incomplete' }]]) {
    parsed = { source: { kind: 'url' }, payload: { kind: 'document', plainText: 'Fresh body' }, partial: Boolean(warnings), warnings }
    assert.equal(await run('existing', input, undefined, { preserveOnFailure: true }), parsed)
    assert.equal(applied.at(-1)[1], parsed)
  }
  const toolbar = readFileSync(join(srcRoot, 'canvas/components/NodeHoverToolbar.tsx'), 'utf8')
  const reparse = toolbar.slice(toolbar.indexOf('  const reparseContent = async'), toolbar.indexOf('  const restoreMissingResource'))
  assert.equal((reparse.match(/preserveOnFailure: true/g) || []).length, 2, 'URL/text and file reparses both preserve old content on parse failure')
  assert.ok(reparse.includes('parsed.partial'))
  const reparseSource = ts.createSourceFile('reparse.ts', reparse, ts.ScriptTarget.Latest, true)
  const callback = reparseSource.statements[0].declarationList.declarations[0].initializer.getText(reparseSource)
  for (const kind of ['url', 'file', 'clipboard-image']) {
    const calls = []
    const feedback = []
    const input = kind === 'url' ? { kind: 'text', text: 'https://example.com' } : null
    const blob = { fixture: true }
    const run = vm.runInNewContext(ts.transpileModule('(' + callback + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      busy: false,
      node: { id: 'existing', kind: 'content', category: 'document', source: { kind, assetId: 'asset', fileName: 'sample.txt' } },
      contentImportInput: () => input,
      setBusy: () => {},
      loadAssetUrl: async () => 'blob:fixture',
      fetch: async () => ({ ok: true, blob: async () => blob }),
      importContentIntoNode: async (...args) => { calls.push(args); return { partial: false } },
      showFeedback: (message) => feedback.push(message),
    })
    await run()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][2], 'document', 'reparse retains the explicitly selected category like the baseline')
    assert.equal(calls[0][3].preserveOnFailure, true)
    if (kind !== 'url') {
      assert.equal(calls[0][1].clipboardImage, kind === 'clipboard-image')
      assert.equal(calls[0][1].file, blob)
    }
    assert.equal(feedback[0], '已重新识别内容')
  }
}

{
  const { contentNodeText } = loadFrom(join(srcRoot, 'domain/content-text.ts'))
  const text = readFileSync(join(srcRoot, 'canvas/content-import-adapter.ts'), 'utf8')
  const source = ts.createSourceFile('adapter.ts', text, ts.ScriptTarget.Latest, true)
  const names = new Set(['categoryLabel', 'applyParsedSource', 'applyParsedContent', 'chooseContentCategory'])
  const functions = source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text))
    .map((statement) => statement.getText(source).replace(/^export /, '')).join('\n')
  let stored = { id: 'content', kind: 'content', label: 'Old title', content: 'Old body', assetId: 'old-asset', sourceId: 'favorite', captureId: 'capture', parentGroupId: 'group', position: { x: 40, y: 80 }, size: { width: 540, height: 430 } }
  let history = 0
  const assets = []
  const api = vm.runInNewContext(ts.transpileModule(functions + '\n({applyParsedContent,chooseContentCategory})', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    contentCategoryVisuals: { text: { label: 'Text' } },
    useGraphStore: { getState: () => ({
      currentDocument: { nodes: [stored] },
      updateNode: (id, patch) => { assert.equal(id, stored.id); stored = { ...stored, ...patch } },
      commitHistory: () => history++,
    }) },
    useRuntimeStore: { getState: () => ({ upsertAsset: (asset) => assets.push(asset) }) },
  })
  api.applyParsedContent('content', {
    category: 'document', subtype: 'web-page', source: { kind: 'url', normalizedUrl: 'https://example.com', provider: 'generic' },
    payload: { kind: 'document', plainText: 'Fresh parsed body' }, preview: { title: 'Fresh title' },
  })
  assert.equal(contentNodeText(stored), 'Fresh parsed body', 'successful reparse must not expose old edited text')
  assert.equal(stored.content, undefined)
  assert.equal(stored.assetId, undefined, 'remote import must not resolve an unrelated previous file')
  assert.equal(stored.captureId, 'capture')
  assert.equal(stored.sourceId, 'favorite')
  assert.equal(stored.parentGroupId, 'group')
  assert.deepEqual(stored.position, { x: 40, y: 80 })
  api.applyParsedContent('content', {
    category: 'document', subtype: 'plain-text', source: { kind: 'file', resourceId: 'new-asset', checksum: 'sha256-new', mimeType: 'text/plain', size: 10, fileName: 'new.txt' },
    payload: { kind: 'document', plainText: 'File body' }, preview: {},
  })
  assert.equal(stored.assetId, 'new-asset')
  assert.equal(contentNodeText(stored), 'File body')
  assert.equal(assets.length, 1)
  api.applyParsedContent('content', {
    category: 'text', subtype: 'plain-text', source: { kind: 'text', text: 'Typed body', mimeType: 'text/plain' },
    payload: { kind: 'text', value: 'Typed body', format: 'plain' }, preview: {},
  })
  assert.equal(stored.assetId, undefined, 'text replacement releases the node reference to its previous file')
  assert.equal(contentNodeText(stored), 'Typed body')
  api.chooseContentCategory('content', 'text')
  assert.equal(stored.content, undefined)
  assert.equal(stored.payload, undefined)
  assert.equal(stored.source, null)
  assert.equal(stored.state, 'empty')
  assert.equal(history, 4, 'each completed replacement is one undoable operation')

  for (const [path, name, empty] of [
    ['canvas/contents/AIContent.tsx', 'textFromUpstreamNode', 'Fallback label'],
    ['canvas/contents/request-generation.ts', 'textFromNode', ''],
  ]) {
    const code = readFileSync(join(srcRoot, path), 'utf8')
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    const reader = vm.runInNewContext(ts.transpileModule(declaration.getText(source) + '\n' + name, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, { contentNodeText })
    for (const [payload, expected] of [
      [{ kind: 'text', value: 'Parsed text' }, 'Parsed text'],
      [{ kind: 'document', plainText: 'Document body' }, 'Document body'],
      [{ kind: 'social', bodyText: 'Social body' }, 'Social body'],
      [{ kind: 'video', transcript: 'Transcript' }, 'Transcript'],
    ]) {
      assert.equal(reader({ kind: 'content', label: 'Fallback label', payload }), expected, path + ' reads actual payload text')
      assert.equal(reader({ kind: 'content', label: 'Fallback label', payload, content: 'Edited text' }), 'Edited text')
    }
    assert.equal(reader({ kind: 'content', label: 'Fallback label', payload: { kind: 'image', resources: [] } }), empty)
  }
}

console.log('canvas navigation: PASS')
