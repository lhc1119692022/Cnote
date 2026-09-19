import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const mocks = new Map()
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
    if (mocks.has(specifier)) return mocks.get(specifier)
    if (specifier.startsWith('@/')) return load(specifier.slice(2))
    if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
    return require(specifier)
  })
  modules.set(path, result)
  return result
}

const storage = new Map()
const calls = []
let failKey = ''
let failOnce = false
let manifestGate = Promise.resolve()

const localForageStorage = {
  async getItem(name) {
    calls.push(`get:${name}`)
    if (name === 'runtime:manifest') await manifestGate
    return storage.has(name) ? storage.get(name) : null
  },
  async setItem(name, value) {
    calls.push(`set:${name}`)
    if (failKey && name === failKey) {
      if (failOnce) {
        failOnce = false
        throw new Error('forced persist failure')
      }
    }
    if (typeof value !== 'string') throw new Error(`runtime value must be a string: ${name}`)
    storage.set(name, value)
  },
  async removeItem(name) {
    calls.push(`remove:${name}`)
    storage.delete(name)
  },
}

mocks.set('@/lib/localforage-storage', { localForageStorage, default: localForageStorage })

const {
  RUNTIME_MANIFEST_KEY,
  runtimeAiSessionKey,
  runtimeAssetKey,
  runtimeCaptureKey,
  runtimeRunKey,
  runtimeSessionKey,
} = load('storage/keys.ts')
const { useRuntimeStore } = load('stores/runtime-store.ts')
const {
  hydrateRuntimeStore,
  flushRuntimePersistence,
  startRuntimePersistence,
  flushRuntimePersistenceForTests,
  resetRuntimePersistenceForTests,
} = load('storage/runtime-persistence.ts')

function resetStore() {
  useRuntimeStore.setState({
    sessions: {},
    captures: {},
    assets: {},
    aiSessions: {},
    runs: {},
  })
}

async function resetAll() {
  await resetRuntimePersistenceForTests()
  resetStore()
  storage.clear()
  calls.length = 0
  failKey = ''
  failOnce = false
  manifestGate = Promise.resolve()
}

function parse(key) {
  const raw = storage.get(key)
  assert.equal(typeof raw, 'string', `${key} should be a JSON string`)
  return JSON.parse(raw)
}

function sessionFixture(id, extra = {}) {
  return {
    id,
    partition: 'persist:cnote-browser',
    activeTabId: null,
    tabs: [],
    createdAt: 1,
    ...extra,
  }
}

function captureFixture(id, extra = {}) {
  return {
    id,
    sessionId: 'session-1',
    url: 'https://example.com/page',
    title: 'Example',
    html: '<html><body>captured-html</body></html>',
    text: 'captured-text',
    fetchedAt: 10,
    ...extra,
  }
}

await resetAll()

// Per-entity keys; capture html/text are not merged into a store-wide JSON.
startRuntimePersistence()
await flushRuntimePersistenceForTests()
calls.length = 0
const session = useRuntimeStore.getState().createSession()
const capture = captureFixture('cap-1', { sessionId: session.id, html: 'HUGE-HTML-PAYLOAD', text: 'BODY-TEXT' })
useRuntimeStore.getState().putCapture(capture)
useRuntimeStore.getState().upsertAsset({ id: 'asset-1', hash: 'abc', mimeType: 'text/plain', size: 4 })
useRuntimeStore.getState().putAISession({
  id: 'ai-1',
  nodeId: 'qa-ai-node',
  title: 'chat',
  messages: [{ role: 'user', content: 'hi' }],
  createdAt: 1,
  updatedAt: 2,
})
useRuntimeStore.getState().putRun({
  id: 'run-1',
  resultNodeId: 'batch-result-1',
  status: 'created',
  tasks: [],
  createdAt: 3,
})
await flushRuntimePersistenceForTests()

const manifest = parse(RUNTIME_MANIFEST_KEY)
assert.deepEqual(manifest.sessionIds, [session.id])
assert.deepEqual(manifest.captureIds, ['cap-1'])
assert.deepEqual(manifest.assetIds, ['asset-1'])
assert.deepEqual(manifest.aiSessionIds, ['ai-1'])
assert.deepEqual(manifest.runIds, ['run-1'])
assert.equal(JSON.stringify(manifest).includes('HUGE-HTML-PAYLOAD'), false)
assert.equal(JSON.stringify(manifest).includes('BODY-TEXT'), false)

const storedCapture = parse(runtimeCaptureKey('cap-1'))
assert.equal(storedCapture.html, 'HUGE-HTML-PAYLOAD')
assert.equal(storedCapture.text, 'BODY-TEXT')
assert.equal(storedCapture.id, 'cap-1')

assert.equal(storage.has(runtimeSessionKey(session.id)), true)
assert.equal(storage.has(runtimeAssetKey('asset-1')), true)
assert.equal(storage.has(runtimeAiSessionKey('ai-1')), true)
assert.equal(parse(runtimeAiSessionKey('ai-1')).nodeId, 'qa-ai-node')
assert.equal(storage.has(runtimeRunKey('run-1')), true)
assert.equal(parse(runtimeRunKey('run-1')).resultNodeId, 'batch-result-1')

for (const [key, value] of storage.entries()) {
  if (key === runtimeCaptureKey('cap-1')) continue
  assert.equal(String(value).includes('HUGE-HTML-PAYLOAD'), false, `${key} must not contain capture html`)
}

const persistCalls = calls.filter((item) => item.startsWith('set:'))
const manifestIndex = persistCalls.findIndex((item) => item === `set:${RUNTIME_MANIFEST_KEY}`)
assert.ok(manifestIndex > 0, 'manifest is written after at least one entity')
const entitySetsBeforeManifest = persistCalls.slice(0, manifestIndex).filter((item) => item.startsWith('set:runtime:'))
assert.ok(entitySetsBeforeManifest.length >= 1, 'entities write before manifest')

// Functions / UI blobs are not persisted.
useRuntimeStore.getState().putCapture({
  ...capture,
  html: capture.html,
})
await flushRuntimePersistenceForTests()
assert.equal(typeof parse(runtimeCaptureKey('cap-1')).id, 'string')

// Delete then persist removes the entity key and drops it from the manifest.
useRuntimeStore.getState().removeCapture('cap-1')
await flushRuntimePersistenceForTests()
assert.equal(storage.has(runtimeCaptureKey('cap-1')), false)
assert.deepEqual(parse(RUNTIME_MANIFEST_KEY).captureIds, [])

// Single write failure does not block other entities; later persist retries.
await resetAll()
useRuntimeStore.setState({
  sessions: {
    ok: sessionFixture('ok'),
    bad: sessionFixture('bad'),
  },
})
failKey = runtimeSessionKey('bad')
failOnce = true
const warn = console.warn
console.warn = () => {}
startRuntimePersistence()
await flushRuntimePersistenceForTests()
console.warn = warn
assert.equal(storage.has(runtimeSessionKey('ok')), true)
assert.equal(storage.has(runtimeSessionKey('bad')), false)
assert.deepEqual(parse(RUNTIME_MANIFEST_KEY).sessionIds, ['ok'])

useRuntimeStore.getState().setSessionActiveTab('ok', 'missing')
useRuntimeStore.getState().addTab('ok', 'https://ok.example')
await flushRuntimePersistenceForTests()
assert.equal(storage.has(runtimeSessionKey('bad')), true)
assert.deepEqual(parse(RUNTIME_MANIFEST_KEY).sessionIds.sort(), ['bad', 'ok'])

// Strict pre-submit flush reports storage failures to the caller.
await resetAll()
useRuntimeStore.getState().putRun({
  id: 'run-strict-failure',
  status: 'validating',
  tasks: [],
  createdAt: 4,
})
failKey = runtimeRunKey('run-strict-failure')
failOnce = true
let strictFailed = false
const strictWarn = console.warn
console.warn = () => {}
try {
  await flushRuntimePersistence()
} catch {
  strictFailed = true
} finally {
  console.warn = strictWarn
}
assert.equal(strictFailed, true)
assert.equal(storage.has(runtimeRunKey('run-strict-failure')), false)

// Hydrate validates JSON / entity id, skips missing or corrupt records.
await resetAll()
storage.set(RUNTIME_MANIFEST_KEY, JSON.stringify({
  sessionIds: ['live', 'missing', 'corrupt', 'mismatch'],
  captureIds: ['cap-live', 'cap-bad-json'],
  assetIds: [],
  aiSessionIds: ['owned-chat'],
  runIds: [],
}))
storage.set(runtimeSessionKey('live'), JSON.stringify(sessionFixture('live')))
storage.set(runtimeSessionKey('corrupt'), '{not-json')
storage.set(runtimeSessionKey('mismatch'), JSON.stringify(sessionFixture('other')))
storage.set(runtimeCaptureKey('cap-live'), JSON.stringify(captureFixture('cap-live')))
storage.set(runtimeCaptureKey('cap-bad-json'), '{broken')
storage.set(runtimeAiSessionKey('owned-chat'), JSON.stringify({ id: 'owned-chat', nodeId: 'qa-ai-node', title: 'renamed chat', messages: [], createdAt: 1, updatedAt: 2 }))
await hydrateRuntimeStore()
const hydrated = useRuntimeStore.getState()
assert.equal(hydrated.aiSessions['owned-chat'].nodeId, 'qa-ai-node')
assert.equal(hydrated.aiSessions['owned-chat'].title, 'renamed chat')
assert.equal(Boolean(hydrated.sessions.live), true)
assert.equal(hydrated.sessions.missing, undefined)
assert.equal(hydrated.sessions.corrupt, undefined)
assert.equal(hydrated.sessions.mismatch, undefined)
assert.equal(Boolean(hydrated.captures['cap-live']), true)
assert.equal(hydrated.captures['cap-bad-json'], undefined)

// Repeated hydrate is a single in-flight load.
const readsBefore = calls.filter((item) => item === `get:${RUNTIME_MANIFEST_KEY}`).length
await Promise.all([hydrateRuntimeStore(), hydrateRuntimeStore()])
const readsAfter = calls.filter((item) => item === `get:${RUNTIME_MANIFEST_KEY}`).length
assert.equal(readsAfter, readsBefore)

// In-memory entities win over disk during hydrate; missing disk records are filled in.
await resetAll()
let releaseManifest
manifestGate = new Promise((resolveGate) => {
  releaseManifest = resolveGate
})
storage.set(RUNTIME_MANIFEST_KEY, JSON.stringify({
  sessionIds: ['disk'],
  captureIds: [],
  assetIds: [],
  aiSessionIds: [],
  runIds: [],
}))
storage.set(runtimeSessionKey('disk'), JSON.stringify(sessionFixture('disk', { partition: 'persist:disk' })))
useRuntimeStore.setState({
  sessions: { memory: sessionFixture('memory', { partition: 'persist:memory' }) },
})
const hydrating = hydrateRuntimeStore()
useRuntimeStore.setState({
  sessions: {
    ...useRuntimeStore.getState().sessions,
    disk: sessionFixture('disk', { partition: 'persist:memory-wins' }),
  },
})
releaseManifest()
await hydrating
assert.equal(useRuntimeStore.getState().sessions.memory.partition, 'persist:memory')
assert.equal(useRuntimeStore.getState().sessions.disk.partition, 'persist:memory-wins')

function snapshotFixture(extra = {}) {
  return {
    variant: 'image',
    inputVersion: 'input-v1',
    channelId: 'ch-1',
    providerId: 'openai',
    baseURL: 'https://api.example',
    model: 'gpt-image-2',
    secretName: 'channel-secret',
    config: {
      prompt: 'a cat',
      references: [],
    },
    ...extra,
  }
}

function runFixture(id, status, extra = {}) {
  const taskStatus = status === 'completed' || status === 'failed' || status === 'cancelled'
    ? status
    : status === 'validating' || status === 'queued' ? status : 'running'
  return {
    id,
    status,
    createdAt: 42,
    requestNodeId: 'request-1',
    variant: 'image',
    tasks: [{
      id: `${id}-task`,
      status: taskStatus,
      channelId: 'ch-1',
      model: 'gpt-image-2',
      requestNodeId: 'request-1',
      variant: 'image',
      inputVersion: 'input-v1',
      remoteTaskId: `remote-${id}`,
      requestSnapshot: snapshotFixture(),
      rawStatus: 'failed',
      requestDiagnostics: { fields: ['model', 'duration', 'image_urls'], durationField: 'duration', duration: 5, resolution: '720p', aspectRatio: '9:16', references: [{ type: 'image', transport: 'inline', data: 'must-not-persist' }], apiKey: 'must-not-persist', prompt: 'must-not-persist' },
      failureDetails: { code: 'generation_failed', type: 'upstream', requestId: 'trace-fixture', apiKey: 'must-not-persist', rawResponse: { secret: 'must-not-persist' } },
      recovery: {
        requestNodeId: 'request-1',
        variant: 'image',
        channelId: 'ch-1',
        model: 'gpt-image-2',
        inputVersion: 'input-v1',
        state: 'submitted',
        updatedAt: 42,
      },
    }],
    ...extra,
  }
}

// Interrupted in-flight runs become waiting-for-user; recovery context is kept.
await resetAll()
const leakySnapshot = snapshotFixture({
  apiKey: 'sk-secret',
  rawResponse: { id: 'raw' },
  config: { prompt: 'a cat', references: [], apiKey: 'sk-nested' },
})
const leakyRun = runFixture('run-running', 'running')
leakyRun.tasks[0].requestSnapshot = leakySnapshot
const mixedRun = runFixture('run-mixed', 'running')
mixedRun.tasks.push({ id: 'corrupt-task' })
storage.set(RUNTIME_MANIFEST_KEY, JSON.stringify({
  sessionIds: [],
  captureIds: [],
  assetIds: [],
  aiSessionIds: [],
  runIds: ['run-running', 'run-queued', 'run-validating', 'run-done', 'run-mixed', 'run-bad', 'run-mismatch'],
}))
storage.set(runtimeRunKey('run-running'), JSON.stringify(leakyRun))
storage.set(runtimeRunKey('run-queued'), JSON.stringify(runFixture('run-queued', 'queued')))
storage.set(runtimeRunKey('run-validating'), JSON.stringify(runFixture('run-validating', 'validating')))
storage.set(runtimeRunKey('run-done'), JSON.stringify(runFixture('run-done', 'completed')))
storage.set(runtimeRunKey('run-mixed'), JSON.stringify(mixedRun))
storage.set(runtimeRunKey('run-bad'), '{not-json')
storage.set(runtimeRunKey('run-mismatch'), JSON.stringify(runFixture('other', 'running')))
await hydrateRuntimeStore()
const recovered = useRuntimeStore.getState().runs
assert.equal(recovered['run-running']?.status, 'waiting-for-user')
assert.equal(recovered['run-queued']?.status, 'waiting-for-user')
assert.equal(recovered['run-validating']?.status, 'waiting-for-user')
assert.equal(recovered['run-done']?.status, 'completed')
assert.equal(recovered['run-mixed']?.status, 'waiting-for-user')
assert.equal(recovered['run-bad'], undefined)
assert.equal(recovered['run-mismatch'], undefined)
const recoveredTask = recovered['run-running'].tasks[0]
assert.equal(recovered['run-running'].requestNodeId, 'request-1')
assert.equal(recovered['run-running'].variant, 'image')
assert.equal(recoveredTask.remoteTaskId, 'remote-run-running')
assert.equal(recoveredTask.rawStatus, 'failed')
assert.deepEqual(recoveredTask.requestDiagnostics, { fields: ['model', 'duration', 'image_urls'], durationField: 'duration', duration: 5, resolution: '720p', aspectRatio: '9:16', references: [{ type: 'image', transport: 'inline' }] })
assert.deepEqual(recoveredTask.failureDetails, { code: 'generation_failed', type: 'upstream', requestId: 'trace-fixture' })
assert.equal(recoveredTask.status, 'running')
assert.equal(recoveredTask.channelId, 'ch-1')
assert.equal(recoveredTask.model, 'gpt-image-2')
assert.equal(recoveredTask.requestNodeId, 'request-1')
assert.equal(recoveredTask.variant, 'image')
assert.equal(recoveredTask.inputVersion, 'input-v1')
assert.equal(recoveredTask.requestSnapshot.channelId, 'ch-1')
assert.equal(recoveredTask.requestSnapshot.model, 'gpt-image-2')
assert.equal(recoveredTask.requestSnapshot.inputVersion, 'input-v1')
assert.equal(recoveredTask.requestSnapshot.secretName, 'channel-secret')
assert.equal(recoveredTask.requestSnapshot.config.prompt, 'a cat')
assert.equal(recoveredTask.recovery.requestNodeId, 'request-1')
assert.equal(recoveredTask.recovery.variant, 'image')
assert.equal(recoveredTask.recovery.channelId, 'ch-1')
assert.equal(recoveredTask.recovery.model, 'gpt-image-2')
assert.equal(recoveredTask.recovery.inputVersion, 'input-v1')
assert.equal(recoveredTask.recovery.state, 'waiting-for-user')
assert.equal(recoveredTask.recovery.reason, '应用重启后等待恢复确认')
assert.equal(typeof recoveredTask.recovery.updatedAt, 'number')
assert.equal(recoveredTask.requestSnapshot.apiKey, undefined)
assert.equal(recoveredTask.requestSnapshot.rawResponse, undefined)
assert.equal(recoveredTask.requestSnapshot.config.apiKey, undefined)
assert.equal(recovered['run-mixed'].tasks.length, 1)
assert.equal(recovered['run-mixed'].tasks[0].id, 'run-mixed-task')
assert.equal(recovered['run-mixed'].tasks[0].remoteTaskId, 'remote-run-mixed')

// Hydrate alone does not rewrite disk; persistence start writes waiting-for-user.
assert.equal(parse(runtimeRunKey('run-running')).status, 'running')
assert.equal(parse(runtimeRunKey('run-queued')).status, 'queued')
startRuntimePersistence()
await flushRuntimePersistenceForTests()
assert.equal(parse(runtimeRunKey('run-running')).status, 'waiting-for-user')
assert.equal(parse(runtimeRunKey('run-queued')).status, 'waiting-for-user')
assert.equal(parse(runtimeRunKey('run-validating')).status, 'waiting-for-user')
assert.equal(parse(runtimeRunKey('run-done')).status, 'completed')
assert.equal(parse(runtimeRunKey('run-running')).tasks[0].remoteTaskId, 'remote-run-running')
assert.equal(parse(runtimeRunKey('run-running')).tasks[0].rawStatus, 'failed')
assert.deepEqual(parse(runtimeRunKey('run-running')).tasks[0].requestDiagnostics, recoveredTask.requestDiagnostics)
assert.deepEqual(parse(runtimeRunKey('run-running')).tasks[0].failureDetails, { code: 'generation_failed', type: 'upstream', requestId: 'trace-fixture' })
assert.equal(parse(runtimeRunKey('run-running')).tasks[0].requestSnapshot.apiKey, undefined)

await resetAll()
const batchSnapshot = snapshotFixture({
  baseURL: 'https://snapshot.example',
  protocol: 'openai-images',
  adapterId: 'adapter-old',
})
storage.set(RUNTIME_MANIFEST_KEY, JSON.stringify({
  sessionIds: [],
  captureIds: [],
  assetIds: [],
  aiSessionIds: [],
  runIds: ['run-batch'],
}))
storage.set(runtimeRunKey('run-batch'), JSON.stringify({
  id: 'run-batch',
  status: 'running',
  createdAt: 7,
  requestNodeId: 'request-1',
  variant: 'image',
  tasks: [
    {
      id: 'child-0',
      status: 'running',
      channelId: 'ch-1',
      model: 'gpt-image-2',
      remoteTaskId: 'remote-0',
      requestSnapshot: batchSnapshot,
    },
    {
      id: 'child-1',
      status: 'queued',
      channelId: 'ch-1',
      model: 'gpt-image-2',
      remoteTaskId: 'remote-1',
      requestSnapshot: batchSnapshot,
    },
  ],
}))
startRuntimePersistence()
await flushRuntimePersistenceForTests()
const persistedBatch = parse(runtimeRunKey('run-batch'))
assert.equal(persistedBatch.status, 'waiting-for-user')
assert.deepEqual(persistedBatch.tasks.map((task) => task.id), ['child-0', 'child-1'])
assert.deepEqual(persistedBatch.tasks.map((task) => task.remoteTaskId), ['remote-0', 'remote-1'])
assert.equal(persistedBatch.tasks[0].requestSnapshot.baseURL, 'https://snapshot.example')
assert.equal(persistedBatch.tasks[1].requestSnapshot.baseURL, 'https://snapshot.example')
assert.equal(persistedBatch.tasks[0].requestSnapshot.protocol, 'openai-images')
assert.equal(persistedBatch.tasks[0].requestSnapshot.apiKey, undefined)
useRuntimeStore.getState().updateTask('run-batch', 'child-0', { status: 'completed' })
useRuntimeStore.getState().updateTask('run-batch', 'child-1', { progress: 40 })
await flushRuntimePersistenceForTests()
const updatedBatch = parse(runtimeRunKey('run-batch'))
assert.equal(updatedBatch.status, 'waiting-for-user')
assert.equal(updatedBatch.tasks[0].status, 'completed')
assert.equal(updatedBatch.tasks[0].remoteTaskId, 'remote-0')
assert.equal(updatedBatch.tasks[1].status, 'queued')
assert.equal(updatedBatch.tasks[1].remoteTaskId, 'remote-1')
assert.equal(updatedBatch.tasks[1].progress, 40)

// Snapshot is persisted before a remote id exists; secrets never reach disk.
await resetAll()
startRuntimePersistence()
await flushRuntimePersistenceForTests()
const leakyLive = snapshotFixture({
  apiKey: 'sk-live',
  rawResponse: { id: 'raw' },
  protocol: 'openai-images',
  adapterId: 'adapter-1',
  config: { prompt: 'a cat', references: [], apiKey: 'sk-nested' },
})
useRuntimeStore.getState().putRun({
  id: 'run-submit',
  status: 'validating',
  createdAt: 9,
  requestNodeId: 'request-1',
  variant: 'image',
  tasks: [{
    id: 'task-submit',
    status: 'validating',
    channelId: 'ch-1',
    model: 'gpt-image-2',
    submittedAt: 9,
    requestNodeId: 'request-1',
    variant: 'image',
    inputVersion: 'input-v1',
    requestSnapshot: leakyLive,
    recovery: {
      requestNodeId: 'request-1',
      variant: 'image',
      channelId: 'ch-1',
      model: 'gpt-image-2',
      inputVersion: 'input-v1',
      state: 'pending',
      updatedAt: 9,
    },
  }],
})
await flushRuntimePersistenceForTests()
const submitted = parse(runtimeRunKey('run-submit'))
assert.equal(submitted.status, 'validating')
assert.equal(submitted.requestNodeId, 'request-1')
assert.equal(submitted.variant, 'image')
assert.equal(submitted.tasks[0].channelId, 'ch-1')
assert.equal(submitted.tasks[0].model, 'gpt-image-2')
assert.equal(submitted.tasks[0].inputVersion, 'input-v1')
assert.equal(submitted.tasks[0].recovery.state, 'pending')
assert.equal(submitted.tasks[0].remoteTaskId, undefined)
assert.equal(submitted.tasks[0].requestSnapshot.baseURL, 'https://api.example')
assert.equal(submitted.tasks[0].requestSnapshot.inputVersion, 'input-v1')
assert.equal(submitted.tasks[0].requestSnapshot.protocol, 'openai-images')
assert.equal(submitted.tasks[0].requestSnapshot.adapterId, 'adapter-1')
assert.equal(submitted.tasks[0].requestSnapshot.config.prompt, 'a cat')
assert.equal(submitted.tasks[0].requestSnapshot.apiKey, undefined)
assert.equal(submitted.tasks[0].requestSnapshot.rawResponse, undefined)
assert.equal(submitted.tasks[0].requestSnapshot.config.apiKey, undefined)

useRuntimeStore.getState().updateTask('run-submit', 'task-submit', {
  remoteTaskId: 'remote-live',
  progress: undefined,
  error: undefined,
})
await flushRuntimePersistenceForTests()
const afterRemote = parse(runtimeRunKey('run-submit'))
assert.equal(afterRemote.status, 'validating')
assert.equal(afterRemote.requestNodeId, 'request-1')
assert.equal(afterRemote.variant, 'image')
assert.equal(afterRemote.tasks[0].status, 'validating')
assert.equal(afterRemote.tasks[0].remoteTaskId, 'remote-live')
assert.equal(afterRemote.tasks[0].channelId, 'ch-1')
assert.equal(afterRemote.tasks[0].model, 'gpt-image-2')
assert.equal(afterRemote.tasks[0].requestSnapshot.config.prompt, 'a cat')
assert.equal(afterRemote.tasks[0].requestSnapshot.apiKey, undefined)
assert.equal(afterRemote.tasks[0].progress, undefined)

// Delayed hydrate still keeps interrupted recovery fields instead of persisting empty memory.
await resetAll()
let releaseKeep
manifestGate = new Promise((resolveGate) => {
  releaseKeep = resolveGate
})
storage.set(RUNTIME_MANIFEST_KEY, JSON.stringify({
  sessionIds: [],
  captureIds: [],
  assetIds: [],
  aiSessionIds: [],
  runIds: ['run-keep'],
}))
storage.set(runtimeRunKey('run-keep'), JSON.stringify(runFixture('run-keep', 'running')))
useRuntimeStore.setState({ runs: {} })
const keeping = startRuntimePersistence()
releaseKeep()
await keeping
await flushRuntimePersistenceForTests()
assert.equal(useRuntimeStore.getState().runs['run-keep']?.status, 'waiting-for-user')
assert.equal(parse(runtimeRunKey('run-keep')).status, 'waiting-for-user')
assert.equal(parse(runtimeRunKey('run-keep')).requestNodeId, 'request-1')
assert.equal(parse(runtimeRunKey('run-keep')).variant, 'image')
assert.equal(parse(runtimeRunKey('run-keep')).tasks[0].channelId, 'ch-1')
assert.equal(parse(runtimeRunKey('run-keep')).tasks[0].model, 'gpt-image-2')
assert.equal(parse(runtimeRunKey('run-keep')).tasks[0].remoteTaskId, 'remote-run-keep')
assert.equal(parse(runtimeRunKey('run-keep')).tasks[0].requestSnapshot.config.prompt, 'a cat')

await resetAll()
await startRuntimePersistence()
const originalStringify = JSON.stringify
let encodedSessions = 0
JSON.stringify = function (value, ...args) {
  if (value?.id === 'cached-ai') encodedSessions++
  return originalStringify(value, ...args)
}
try {
  const initial = { id: 'cached-ai', nodeId: 'ai-node', title: 'cached', messages: [{ role: 'assistant', content: 'first', createdAt: 1 }], createdAt: 1, updatedAt: 1 }
  useRuntimeStore.getState().putAISession(initial)
  await flushRuntimePersistenceForTests()
  const firstEncodes = encodedSessions
  for (let index = 0; index < 5; index++) {
    useRuntimeStore.getState().createSession(`unrelated-${index}`)
    await flushRuntimePersistenceForTests()
  }
  assert.equal(encodedSessions, firstEncodes, 'unchanged AI sessions are not encoded during unrelated writes')
  const next = { ...initial, title: 'next', updatedAt: 2 }
  failKey = runtimeAiSessionKey(initial.id)
  failOnce = true
  useRuntimeStore.getState().putAISession(next)
  await flushRuntimePersistenceForTests()
  await flushRuntimePersistence()
  assert.equal(parse(failKey).title, 'next', 'failed write is retried without marking its reference saved')
  useRuntimeStore.getState().removeAISession(initial.id)
  await flushRuntimePersistenceForTests()
  assert.equal(storage.has(failKey), false)
  useRuntimeStore.getState().putAISession(next)
  await flushRuntimePersistenceForTests()
  assert.equal(parse(failKey).title, 'next', 'same reference can be persisted after deletion')
  const setItem = localForageStorage.setItem
  let releaseWrite
  let enteredWrite
  const entered = new Promise(resolveEntered => { enteredWrite = resolveEntered })
  const gate = new Promise(resolveGate => { releaseWrite = resolveGate })
  localForageStorage.setItem = async (key, value) => {
    if (key === failKey) { enteredWrite(); await gate }
    return setItem(key, value)
  }
  try {
    useRuntimeStore.getState().putAISession({ ...next, title: 'in-flight', updatedAt: 3 })
    await entered
    useRuntimeStore.getState().putAISession({ ...next, title: 'latest', updatedAt: 4 })
    releaseWrite()
    await flushRuntimePersistenceForTests()
    assert.equal(parse(failKey).title, 'latest', 'updates arriving during a save are not lost')
  } finally {
    releaseWrite?.()
    localForageStorage.setItem = setItem
  }
} finally {
  JSON.stringify = originalStringify
  await resetRuntimePersistenceForTests()
}

console.log('verify-runtime-persistence: ok (including reference cache, retry, delete/recreate and concurrent update)')
