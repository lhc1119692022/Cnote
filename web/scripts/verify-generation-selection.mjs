import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
function evaluate(source, bindings) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  const execute = new Function('module', 'exports', 'require', ...Object.keys(bindings), code)
  execute(module, module.exports, require, ...Object.values(bindings))
  return module.exports
}
function findNode(source, predicate) {
  let result
  function visit(node) {
    if (predicate(node)) result = node
    else ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, 'expected production function or JSX is present')
  return result
}

function load(path) {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInThisContext('(function(exports, module) {' + code + '\n})')(module.exports, module)
  return module.exports
}
const { runGenerationBatch } = load('lib/generation/batch.ts')
const requestSource = ts.createSourceFile('RequestNode.tsx', readFileSync(new URL('../src/components/flow/nodes/RequestNode.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const clientSource = ts.createSourceFile('client.ts', readFileSync(new URL('../src/lib/generation/client.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const runSource = findNode(requestSource, (node) => ts.isVariableDeclaration(node) && node.name.getText(requestSource) === 'runTask').initializer.arguments[0].getText(requestSource)
const clientRunSource = findNode(clientSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'runGenerationTask').getText(clientSource)
const formatSource = findNode(requestSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'formatElapsed').getText(requestSource)
const statusSource = findNode(requestSource, (node) => ts.isJsxExpression(node) && node.expression?.getText(requestSource).startsWith("task.status === 'completed' &&")).expression.getText(requestSource)

async function verifyGenerateButton(polled) {
  const submitted = []
  const releases = []
  const resultNodes = []
  const statusUpdates = []
  const node = { id: 'request', data: {} }
  const channel = { id: 'channel', providerId: 'openai', baseURL: 'https://mock.test' }
  const model = { id: 'mock-image', capabilities: [] }
  const runGenerationTask = evaluate(clientRunSource, {
    submitGenerationTask: async (context) => {
      const index = submitted.length
      submitted.push(context)
      await new Promise((resolve) => { releases[index] = resolve })
      return polled ? { taskId: `remote-${index}` } : { resultUrls: [`image-${index}`], resultFileNames: [`${index}.png`] }
    },
    pollGenerationTask: async (_, taskId) => ({ task: { status: 'completed', resultUrls: [`image-${taskId.slice(-1)}`] } }),
    pollIntervalForModel: () => 0,
    waitForPoll: async () => {},
  }).runGenerationTask
  const bindings = {
    variant: 'image', id: node.id,
    config: { channelId: channel.id, model: model.id, outputCount: 3, prompt: 'mock', references: [] },
    timeoutMs: 60000,
    pollingRef: { current: false }, abortRef: { current: null }, unmountingRef: { current: false },
    useGenerationStore: { getState: () => ({ getChannel: () => channel, getModels: () => [model] }) },
    useFlowStore: { getState: () => ({ nodes: [node] }) },
    withUpstreamInputs: (_, __, config) => config,
    window: { setTimeout, clearTimeout },
    runGenerationTask, runGenerationBatch,
    updateTask: (update) => { node.data.task = { ...node.data.task, ...update }; statusUpdates.push(node.data.task) },
    updateNode: () => {},
    createResultNodes: (...args) => resultNodes.push(args),
  }
  const runTask = evaluate('module.exports = ' + runSource, bindings)
  const pending = runTask()
  assert.equal(submitted.length, 3, 'actual Generate button submits all three before first completion')
  assert.ok(submitted.every((context) => context.config.outputCount === 1))
  releases[2]()
  await new Promise(setImmediate)
  assert.equal(node.data.task.status, 'in_progress')
  releases[0]()
  releases[1]()
  await pending
  assert.equal(node.data.task.status, 'completed')
  assert.deepEqual(node.data.task.resultUrls, ['image-0', 'image-1', 'image-2'])
  assert.equal(resultNodes.length, 1, 'results are materialized as one ordered batch')
  assert.deepEqual(resultNodes[0][0], node.data.task.resultUrls)
  assert.ok(statusUpdates.filter((state) => state.status === 'completed').every((state) => state.resultUrls.length === 3))
  const status = evaluate(formatSource + '\nmodule.exports = (' + statusSource + ')', {
    task: { ...node.data.task, elapsedMs: 7000 }, resultCount: 3, variant: 'image', elapsed: 999999,
  })
  const rendered = renderToStaticMarkup(status)
  assert.match(rendered, /已生成 3 张图片/)
  assert.match(rendered, /耗时 0:07/)
  assert.doesNotMatch(rendered, /\$/)
}
await verifyGenerateButton(false)
await verifyGenerateButton(true)
const states = []
const started = []
const releases = []
let clock = 1000
const originalNow = Date.now
Date.now = () => clock
try {
  const pending = runGenerationBatch({
    count: 3,
    submittedAt: clock,
    onTaskUpdate: (state) => states.push(state),
    run: async (index, update) => {
      started.push(index)
      update({ status: 'queued', taskId: `task-${index}` })
      await new Promise((resolve) => { releases[index] = resolve })
      const result = { status: 'completed', resultUrls: [`image-${index}`], resultResourceIds: [`resource-${index}`], resultMimeTypes: ['image/png'], resultFileNames: [`${index}.png`] }
      update(result)
      return result
    },
  })
  assert.deepEqual(started, [0, 1, 2], 'all requests start before ANY result is released')
  clock = 3000
  releases[2]()
  await new Promise(setImmediate)
  assert.equal(states.at(-1).status, 'in_progress')
  assert.deepEqual(states.at(-1).resultUrls, ['image-2'])
  clock = 5000
  releases[0]()
  await new Promise(setImmediate)
  assert.equal(states.at(-1).status, 'in_progress')
  clock = 8000
  releases[1]()
  const completed = await pending
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.resultUrls, ['image-0', 'image-1', 'image-2'])
  assert.deepEqual(completed.resultFileNames, ['0.png', '1.png', '2.png'])
  assert.equal(completed.resultResourceIds.length, 3)
  assert.equal(completed.elapsedMs, 7000, 'elapsed time is wall-clock duration, not sum of children')
  assert.equal(completed.taskId, undefined, 'batch does not impersonate one remote task')
  assert.deepEqual(completed.children.map((task) => task.taskId), ['task-0', 'task-1', 'task-2'])
  const failed = await runGenerationBatch({ count: 3, submittedAt: clock, onTaskUpdate: () => {}, run: async (index) => {
    if (index === 1) throw new Error('provider failed')
    return { status: 'completed', resultUrls: [`image-${index}`] }
  } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'provider failed')
  assert.deepEqual(failed.resultUrls, ['image-0', 'image-2'])
  const resumed = []
  const resumeResult = await runGenerationBatch({ count: 3, submittedAt: clock, initialTasks: failed.children, onTaskUpdate: () => {}, run: async (index) => {
    resumed.push(index)
    return { status: 'completed', resultUrls: [`image-${index}`] }
  } })
  assert.deepEqual(resumed, [1], 'completed children are never submitted again on resume')
  assert.equal(resumeResult.resultUrls.length, 3)
  const empty = await runGenerationBatch({ count: 1, submittedAt: clock, onTaskUpdate: () => {}, run: async () => ({ status: 'completed' }) })
  assert.equal(empty.status, 'failed')
  const timeout = await runGenerationBatch({ count: 1, submittedAt: clock, onTaskUpdate: () => {}, run: async () => ({ status: 'timeout', taskId: 'keep-me' }) })
  assert.equal(timeout.status, 'timeout')
  assert.equal(timeout.taskId, 'keep-me')
} finally {
  Date.now = originalNow
}

const dom = new JSDOM('<div id="canvas"><div class="react-flow"><div id="pane"></div><div id="node">unselected text</div><textarea id="editor"></textarea><div contenteditable="true" id="rich">editable</div></div></div><div id="outside">outside</div>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
const { installCanvasSelectionGuard } = load('lib/flow/canvas-selection.ts')
const canvas = document.getElementById('canvas')
const dispose = installCanvasSelectionGuard(canvas)
const mouse = (target, type, keys = {}) => {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...keys })
  target.dispatchEvent(event)
  return event
}
for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey']) {
  const selection = window.getSelection()
  selection.selectAllChildren(document.getElementById('node'))
  assert.equal(mouse(document.getElementById('pane'), 'mousedown', { [modifier]: true }).defaultPrevented, true)
  assert.equal(selection.isCollapsed, true)
  assert.equal(canvas.classList.contains('flow-node-selecting'), true)
  assert.equal(mouse(document.getElementById('node'), 'selectstart').defaultPrevented, true)
  mouse(document.body, 'pointerup')
  assert.equal(canvas.classList.contains('flow-node-selecting'), false)
}
for (const target of ['editor', 'rich', 'outside']) {
  assert.equal(mouse(document.getElementById(target), 'mousedown', { ctrlKey: true }).defaultPrevented, false)
  assert.equal(canvas.classList.contains('flow-node-selecting'), false)
}
assert.equal(mouse(document.getElementById('node'), 'mousedown').defaultPrevented, false)
mouse(document.getElementById('node'), 'pointerdown', { ctrlKey: true })
window.dispatchEvent(new window.Event('blur'))
assert.equal(canvas.classList.contains('flow-node-selecting'), false)
mouse(document.getElementById('pane'), 'pointerdown', { shiftKey: true })
mouse(document.body, 'pointercancel')
assert.equal(canvas.classList.contains('flow-node-selecting'), false)
dispose()
assert.equal(mouse(document.getElementById('pane'), 'mousedown', { ctrlKey: true }).defaultPrevented, false)
for (const path of ['components/flow/nodes/RequestNode.tsx', 'lib/flow/executor.ts']) {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  assert.match(source, /await runGenerationBatch\(/, `${path} uses the tested batch runner`)
  assert.doesNotMatch(source, /for \(let generationIndex/, 'no serial generation loop remains')
}
console.log('PASS: actual Generate button with direct and polled mock responses; rendered count/time; concurrent batch, ordering, partial failure, resume; Ctrl/Shift/Meta selection, editing and cleanup')
