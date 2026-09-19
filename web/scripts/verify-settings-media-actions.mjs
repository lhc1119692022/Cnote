import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/settings/APIKeysManager.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let action
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'clearMediaObjects') action = node.initializer.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(action)
const compiled = ts.transpileModule(`const run = ${action}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
async function scenario(options = {}) {
  const deleted = []
  let confirmations = 0
  let pages = 0
  let message = ''
  let objects = options.empty ? [] : [{ key: 'first' }]
  const context = vm.createContext({
    Map, Set, Error,
    mediaClearingRef: { current: false }, mediaScopeRef: { current: 0 }, mediaObjectsRequestRef: { current: 0 },
    mediaDeletingKey: null, mediaObjectsVisible: !options.hidden, mediaObjects: objects,
    mediaBaseURL: 'https://example.test', mediaAccessToken: 'test-only',
    setMediaClearing: () => {}, setMediaObjectsCursor: () => {},
    setMediaObjects: update => { objects = update(objects) }, setMediaMessage: value => { message = value },
    askConfirmation: async () => { confirmations++; return !options.cancel },
    mediaStorage: {
      listObjects: async ({ cursor }) => {
        pages++
        return cursor ? { objects: [{ key: 'second' }], cursor: options.repeat ? 'next' : undefined } : { objects: [{ key: 'first' }], cursor: 'next' }
      },
      deleteObject: async key => { if (options.fail && key === 'second') throw new Error('offline'); deleted.push(key) },
      refreshUsage: async () => {},
    },
  })
  await vm.runInContext(`${compiled}\nrun()`, context)
  assert.equal(context.mediaClearingRef.current, false)
  return { deleted, confirmations, pages, message, objects }
}
for (const options of [{ hidden: true }, { empty: true }]) {
  const result = await scenario(options)
  assert.equal(result.confirmations, 0)
  assert.equal(result.pages, 0)
}
const cancelled = await scenario({ cancel: true })
assert.equal(cancelled.confirmations, 1)
assert.equal(cancelled.pages, 0)
assert.deepEqual(cancelled.deleted, [])
const complete = await scenario()
assert.deepEqual(complete.deleted, ['first', 'second'])
assert.equal(complete.pages, 2)
const partial = await scenario({ fail: true })
assert.deepEqual(partial.deleted, ['first'])
assert.match(partial.message, /已清理 1.*offline/)
assert.deepEqual((await scenario({ repeat: true })).deleted, [])
assert.match(source, /disabled=\{!mediaObjectsVisible \|\| !mediaObjects.length \|\| mediaClearing/)
assert.match(source, /mediaObjectsVisible && mediaObjects.length > 0/)
console.log('Settings remote cleanup: visibility, empty state, confirmation, pagination, failure and repeated cursors passed.')

const generationSource = readFileSync(new URL('../src/components/settings/GenerationChannelsManager.tsx', import.meta.url), 'utf8')
const generationAst = ts.createSourceFile('generation.tsx', generationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let persist
let verifyUpload
function findPersist(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(generationAst) === 'persistChannel') persist = node.initializer.getText(generationAst)
  if (ts.isVariableDeclaration(node) && node.name.getText(generationAst) === 'handleTestMediaUpload') verifyUpload = node.initializer.getText(generationAst)
  ts.forEachChild(node, findPersist)
}
findPersist(generationAst)
assert.ok(persist)
assert.ok(verifyUpload)
const persistCode = ts.transpileModule(`const persist = ${persist}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const verifyCode = ts.transpileModule(`const verify = ${verifyUpload}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
async function saveScenario({ existing = false, fail = false, close = false, verify = false, uploadFail = false } = {}) {
  const events = []
  const channel = { id: 'channel', secretName: 'secret' }
  const context = vm.createContext({
    Map, Error,
    baseURL: 'https://provider.test/', channelName: 'Test', apiKey: 'new-key',
    editingChannelId: existing ? 'channel' : null,
    supportsImage: false, supportsVideo: true, mediaTransport: 'custom', requiresPublicHttps: false,
    presetId: 'test', protocol: 'video', channelPresets: [], modelIds: ['S-2.5'], modelCatalog: [],
    GENERATION_PROTOCOL_LABELS: { video: 'Video' },
    normalizeEndpoint: value => value.replace(/\/$/, ''), protocolSupportsImage: () => false, protocolSupportsVideo: () => true,
    showMessage: message => { throw new Error(`Unexpected modal: ${message}`) },
    addChannel: input => { assert.equal(input.apiKey, 'new-key'); events.push('add'); return channel },
    updateChannel: (id, input) => { assert.equal(id, 'channel'); assert.equal(input.apiKey, 'new-key'); events.push('update') },
    useGenerationStore: { getState: () => ({ getChannel: () => channel }) },
    setEditingChannelId: () => {},
    syncDesktopSecret: async () => { events.push('secret'); if (fail) throw new Error('locked') },
    setMediaTestState: value => events.push(value), setMediaTestMessage: () => {},
    setSavedAPIKey: () => events.push('saved'), resetChannelDialog: () => events.push('close'),
    transportStatus: { canTestUpload: true }, savingRef: { current: null }, mediaTestRunningRef: { current: false },
    testGenerationMediaUpload: async saved => {
      assert.equal(saved, channel)
      events.push('upload')
      if (uploadFail) throw new Error('upload failed')
      return {}
    },
  })
  if (verify) {
    await vm.runInContext(`${persistCode}\n${verifyCode}\nconst handleSaveChannel = close => persist(close); Promise.all([verify(), verify()])`, context)
    assert.equal(context.mediaTestRunningRef.current, false)
  } else {
    await vm.runInContext(`${persistCode}\npersist(${close})`, context)
  }
  return events
}
assert.deepEqual(await saveScenario(), ['add', 'secret', 'saved'])
assert.deepEqual(await saveScenario({ existing: true }), ['update', 'secret', 'saved'])
assert.deepEqual(await saveScenario({ close: true }), ['add', 'secret', 'saved', 'close'])
assert.deepEqual(await saveScenario({ fail: true }), ['add', 'secret', 'error'])
assert.deepEqual(await saveScenario({ verify: true }), ['add', 'secret', 'saved', 'testing', 'upload', 'success'])
assert.deepEqual(await saveScenario({ verify: true, existing: true }), ['update', 'secret', 'saved', 'testing', 'upload', 'success'])
assert.deepEqual(await saveScenario({ verify: true, fail: true }), ['add', 'secret', 'error'])
assert.deepEqual(await saveScenario({ verify: true, uploadFail: true }), ['add', 'secret', 'saved', 'testing', 'upload', 'error'])
assert.doesNotMatch(generationSource, /请先保存刚修改的密钥|请先在“本地存储”中配置自定义上传服务/)
assert.doesNotMatch(generationSource, /setTimeout|autoSave|等待自动保存/)
console.log('Generation upload verification: click-triggered save, secure save before upload, open dialog, duplicate clicks and failure passed.')
