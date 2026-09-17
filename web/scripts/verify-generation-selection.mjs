import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const mocks = new Map()
const modules = new Map()

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://cnote.test' })
for (const key of ['window', 'document', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}

function evaluate(source, requireModule = require) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
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
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  modules.set(path, result)
  return result
}

mocks.set('@/lib/localforage-storage', {
  localForageStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
})
mocks.set('@/lib/secure-storage', { decryptAPIKey: (value) => value, encryptAPIKey: (value) => value })
mocks.set('@/lib/desktop-secrets', { deleteDesktopSecret: async () => {}, syncDesktopSecretInBackground: () => {} })

const { runGenerationBatch } = load('lib/generation/batch.ts')
const { generationChannelSupportsVariant } = load('stores/use-generation-store.ts')
const {
  generationRequestContextFromSnapshot,
  generationRunStatusFromTasks,
  generationTaskResumeBlockReason,
  isGenerationTaskResumable,
} = load('lib/generation/resume-context.ts')

function channel(extra) {
  return {
    id: extra.id,
    providerId: extra.providerId || 'custom',
    protocol: extra.protocol,
    name: extra.name || extra.id,
    baseURL: extra.baseURL || '',
    modelIds: extra.modelIds || [],
    enabled: extra.enabled !== false,
    supportsImage: extra.supportsImage,
    supportsVideo: extra.supportsVideo,
  }
}

const imageChannel = channel({ id: 'img', providerId: 'openai', protocol: 'openai-images', modelIds: ['gpt-image-2'], supportsImage: true, supportsVideo: false })
const videoChannel = channel({ id: 'vid', providerId: 'video', protocol: 'video-api', modelIds: ['seedance-2.5-pro'], supportsImage: false, supportsVideo: true })
const dualChannel = channel({ id: 'dual', providerId: 'custom', protocol: 'openai-images', modelIds: ['gpt-image-2'], supportsImage: true, supportsVideo: true })
const disabledImage = channel({ id: 'off', providerId: 'openai', protocol: 'openai-images', modelIds: ['gpt-image-2'], enabled: false, supportsImage: true, supportsVideo: false })
const inferredVideo = channel({ id: 'inferred-video', providerId: 'video', protocol: 'video-api', modelIds: ['seedance-2.5-pro'] })
const inferredImage = channel({ id: 'inferred-image', providerId: 'openai', protocol: 'openai-images', modelIds: ['gpt-image-2'] })

assert.equal(generationChannelSupportsVariant(imageChannel, 'image'), true)
assert.equal(generationChannelSupportsVariant(imageChannel, 'video'), false)
assert.equal(generationChannelSupportsVariant(videoChannel, 'image'), false)
assert.equal(generationChannelSupportsVariant(videoChannel, 'video'), true)
assert.equal(generationChannelSupportsVariant(dualChannel, 'image'), true)
assert.equal(generationChannelSupportsVariant(dualChannel, 'video'), true)
assert.equal(generationChannelSupportsVariant(inferredImage, 'image'), true)
assert.equal(generationChannelSupportsVariant(inferredImage, 'video'), false)
assert.equal(generationChannelSupportsVariant(inferredVideo, 'image'), false)
assert.equal(generationChannelSupportsVariant(inferredVideo, 'video'), true)

function channelsForVariant(channels, variant) {
  if (variant === 'body') return []
  return channels.filter((item) => item.enabled && generationChannelSupportsVariant(item, variant))
}

const catalog = [imageChannel, videoChannel, dualChannel, disabledImage, inferredImage, inferredVideo]
assert.deepEqual(channelsForVariant(catalog, 'image').map((item) => item.id), ['img', 'dual', 'inferred-image'])
assert.deepEqual(channelsForVariant(catalog, 'video').map((item) => item.id), ['vid', 'dual', 'inferred-video'])
assert.deepEqual(channelsForVariant(catalog, 'body'), [], 'body does not use generation channel capability filtering')

const requestText = readFileSync(new URL('../src/canvas/contents/RequestContent.tsx', import.meta.url), 'utf8')
const requestSource = ts.createSourceFile('RequestContent.tsx', requestText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function findBinding(name) {
  let found = false
  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) ||
      (ts.isFunctionDeclaration(node) && node.name?.text === name)
    ) found = true
    else ts.forEachChild(node, visit)
  }
  visit(requestSource)
  return found
}

function callArguments(name) {
  const calls = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls.push(node.arguments.map((argument) => argument.getText(requestSource)))
    }
    ts.forEachChild(node, visit)
  }
  visit(requestSource)
  return calls
}

assert.ok(findBinding('modelGroups'), 'RequestContent builds modelGroups')
assert.ok(findBinding('selectedGroup'), 'RequestContent resolves selectedGroup')
assert.ok(findBinding('chooseModel'), 'RequestContent exposes chooseModel')
assert.match(requestText, /type GenerationVariant = Exclude<RequestVariant, 'body'>/)

const supportCalls = callArguments('generationChannelSupportsVariant')
assert.ok(supportCalls.length >= 1, 'RequestContent calls generationChannelSupportsVariant')
assert.ok(supportCalls.every((args) => args[1] === 'generationVariant' || args[1] === 'variant'))
assert.ok(supportCalls.every((args) => !["'body'", '"body"'].includes(args[1])), 'body never queries generation channel support')

const batchCalls = callArguments('runGenerationBatch')
assert.equal(batchCalls.length, 2, 'RequestContent submits and resumes through runGenerationBatch')
assert.match(requestText, /requestedGenerationCount\(variant, runConfig\.outputCount\)/)
assert.ok(batchCalls.some((args) => args[0].includes('initialTasks')))

assert.ok(findBinding('resumeWaitingGeneration'), 'RequestContent can resume waiting-for-user polling')
assert.ok(findBinding('abandonWaitingGeneration'), 'RequestContent can abandon a waiting-for-user run')
assert.ok(findBinding('buildRequestSnapshot'), 'RequestContent snapshots the request before submit')
assert.match(requestText, /run\?\.status === 'waiting-for-user'/)
assert.match(requestText, /继续查询/)
assert.match(requestText, /放弃/)
assert.match(requestText, /已暂停/)
assert.match(requestText, /requestSnapshot,/)
assert.match(requestText, /generationRequestContextFromSnapshot/)
assert.match(requestText, /generationRunStatusFromTasks/)
assert.match(requestText, /isGenerationTaskResumable/)
assert.match(requestText, /domainTask\.id/)
assert.match(requestText, /parkGenerationRunForResume/)
assert.match(requestText, /findWaitingGenerationRun/)
assert.match(requestText, /elapsedOffset: 0/)
assert.equal([...requestText.matchAll(/\bputRun\(/g)].length, 2, 'submit creates a run; unmount parks the same run')
assert.equal([...requestText.matchAll(/\bnanoid\(\)/g)].length, 2, 'resume polling reuses the existing run and creates one id per child task')

const generationTaskCalls = callArguments('runGenerationTask')
assert.equal(generationTaskCalls.length, 2, 'RequestContent submits new tasks and resumes waiting tasks via runGenerationTask')
assert.ok(
  generationTaskCalls.some((args) => args[1]?.includes('taskId: remoteTaskId')),
  'waiting-for-user resume polls the existing remoteTaskId',
)
assert.ok(
  generationTaskCalls.some((args) => args[1] && !args[1].includes('taskId:')),
  'new submissions do not pass a remote taskId',
)
assert.ok(
  generationTaskCalls.some((args) => args[1]?.includes('onRemoteTaskId')),
  'new submissions persist remoteTaskId as soon as the provider returns it',
)

const snapshot = {
  variant: 'image',
  channelId: 'ch-1',
  providerId: 'openai',
  protocol: 'openai-images',
  adapterId: 'adapter-old',
  baseURL: 'https://old.example/v1',
  secretName: 'cnote:generation:ch-1',
  model: 'gpt-image-2',
  config: { prompt: 'a cat', references: [], adapterId: 'adapter-old' },
}
const editedChannel = {
  id: 'ch-1',
  providerId: 'google',
  protocol: 'google-images',
  name: 'edited',
  baseURL: 'https://new.example/v1',
  apiKey: 'sk-current',
  secretName: 'cnote:generation:ch-1',
  modelIds: ['gpt-image-2'],
  enabled: true,
  adapters: [{ id: 'adapter-new', protocol: 'google-images' }],
}
const resumeContext = generationRequestContextFromSnapshot(
  { ...snapshot, apiKey: 'sk-stolen' },
  { channel: editedChannel, model: { id: 'gpt-image-2', name: 'GPT Image 2', capabilities: [] } },
)
assert.equal(resumeContext.channel.baseURL, 'https://old.example/v1', 'resume routing uses the snapshot endpoint')
assert.equal(resumeContext.channel.protocol, 'openai-images')
assert.equal(resumeContext.channel.providerId, 'openai')
assert.equal(resumeContext.channel.adapters[0].id, 'adapter-old')
assert.equal(resumeContext.channel.adapters[0].protocol, 'openai-images')
assert.equal(resumeContext.channel.apiKey, 'sk-current', 'resume keeps the current secret, not a snapshot key')
assert.equal(Object.hasOwn(resumeContext.channel, 'apiKey') && resumeContext.channel.apiKey !== 'sk-stolen', true)
assert.equal(generationRunStatusFromTasks([{ status: 'completed' }, { status: 'running' }]), 'running')
assert.equal(generationRunStatusFromTasks([{ status: 'completed' }, { status: 'completed' }]), 'completed')
assert.equal(generationRunStatusFromTasks([{ status: 'completed' }, { status: 'failed' }]), 'failed')
assert.equal(isGenerationTaskResumable({ status: 'running', remoteTaskId: 'r1', requestSnapshot: snapshot }), true)
assert.equal(isGenerationTaskResumable({ status: 'running', requestSnapshot: snapshot }), false)
assert.equal(generationTaskResumeBlockReason({ status: 'running', requestSnapshot: snapshot }), '缺少远程任务，无法继续查询')
assert.equal(generationTaskResumeBlockReason({ status: 'running', remoteTaskId: 'r1' }), '缺少请求快照，无法继续查询')

const resolveCalls = callArguments('resolveRequestGenerationInputs')
assert.ok(resolveCalls.length >= 1, 'RequestContent uses resolveRequestGenerationInputs')
assert.ok(resolveCalls.every((args) => args[0].includes('requestNodeId') && args[0].includes('nodes') && args[0].includes('edges')))

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

{
  const { parkGenerationRunForResume, parkInflightGenerationRuns, isGenerationRunResumable, resolveRequestGenerationInputs } = load('canvas/contents/request-generation.ts')
  const { useRuntimeStore } = load('stores/runtime-store.ts')
  const parked = parkGenerationRunForResume({
    id: 'run-1',
    status: 'running',
    createdAt: 1,
    requestNodeId: 'req-1',
    tasks: [{
      id: 't1',
      status: 'running',
      remoteTaskId: 'remote-1',
      requestSnapshot: {
        variant: 'image',
        channelId: 'ch-1',
        providerId: 'openai',
        baseURL: 'https://api.example.com',
        model: 'gpt-image',
        inputVersion: 'v1',
        config: { prompt: 'x' },
      },
      recovery: {
        requestNodeId: 'req-1',
        variant: 'image',
        channelId: 'ch-1',
        model: 'gpt-image',
        inputVersion: 'v1',
        state: 'submitted',
        updatedAt: 1,
      },
    }],
  })
  assert.equal(parked.status, 'waiting-for-user')
  assert.equal(parked.tasks[0].recovery.state, 'waiting-for-user')
  assert.equal(isGenerationRunResumable(parked), true)
  assert.equal(parkGenerationRunForResume({ ...parked, status: 'completed' }).status, 'completed')

  const parkedWithoutRecovery = parkGenerationRunForResume({
    id: 'run-2',
    status: 'queued',
    createdAt: 1,
    requestNodeId: 'req-2',
    variant: 'image',
    tasks: [{
      id: 't2',
      status: 'queued',
      remoteTaskId: 'remote-2',
      requestNodeId: 'req-2',
      variant: 'image',
      channelId: 'ch-1',
      model: 'gpt-image',
      inputVersion: 'v1',
      requestSnapshot: {
        variant: 'image',
        channelId: 'ch-1',
        providerId: 'openai',
        baseURL: 'https://api.example.com',
        model: 'gpt-image',
        inputVersion: 'v1',
        config: { prompt: 'x' },
      },
    }],
  })
  assert.equal(parkedWithoutRecovery.status, 'waiting-for-user')
  assert.equal(parkedWithoutRecovery.tasks[0].status, 'queued')
  assert.equal(parkedWithoutRecovery.tasks[0].recovery?.state, 'waiting-for-user')
  assert.equal(isGenerationRunResumable(parkedWithoutRecovery), true)

  useRuntimeStore.setState({
    runs: {
      'run-live': { ...parkedWithoutRecovery, id: 'run-live', status: 'running' },
      'run-done': { id: 'run-done', status: 'completed', createdAt: 1, tasks: [] },
    },
  })
  const parkedIds = parkInflightGenerationRuns()
  assert.deepEqual(parkedIds, ['run-live'])
  assert.equal(useRuntimeStore.getState().runs['run-live']?.status, 'waiting-for-user')
  assert.equal(useRuntimeStore.getState().runs['run-done']?.status, 'completed')

  const captured = resolveRequestGenerationInputs({
    requestNodeId: 'req-1',
    variant: 'image',
    config: { prompt: 'draw this' },
    nodes: [
      { id: 'req-1', kind: 'request', position: { x: 0, y: 0 }, size: { width: 100, height: 80 }, label: '生成', variant: 'image' },
      {
        id: 'cap-img',
        kind: 'content',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 80 },
        label: '截图',
        category: 'image',
        source: { kind: 'url', url: 'https://cdn.example.com/shot.jpg', provider: 'generic' },
        captureId: 'cap-1',
      },
      {
        id: 'cap-text',
        kind: 'content',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 80 },
        label: '正文',
        category: 'text',
        content: 'Captured article',
        source: { kind: 'url', url: 'https://example.com/article', provider: 'generic' },
        captureId: 'cap-2',
      },
    ],
    edges: [
      { id: 'e1', source: 'cap-img', target: 'req-1' },
      { id: 'e2', source: 'cap-text', target: 'req-1' },
    ],
    assets: {},
    runs: {},
  })
  assert.ok(captured)
  assert.match(captured.prompt, /Captured article/)
  assert.equal(captured.references.some((reference) => reference.upstreamNodeId === 'cap-img' && reference.type === 'image'), true)
}

console.log('PASS: RequestContent generation entry points; image/video/body channel filtering; concurrent batch, ordering, partial failure, resume; waiting-for-user continue/abandon')
