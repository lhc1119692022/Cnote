import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/settings/APIKeysManager.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('MEDIA_STORAGE_CHANGED_EVENT')) callback = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(callback)
const windowMock = new EventTarget()
const documentMock = new EventTarget()
documentMock.visibilityState = 'visible'
let now = 1000000
const tick = () => { now += 5 * 60 * 1000; windowMock.dispatchEvent(new Event('focus')) }
windowMock.setInterval = () => { assert.fail('storage must not poll on a fixed interval') }
let usageCalls = 0
let listCalls = 0
let objects = []
let errorMessage = ''
let fail = false
let hold
const storage = {
  refreshUsage: async () => { usageCalls++; if (fail) throw new Error('offline') },
  listObjects: async () => {
    listCalls++
    if (hold) await hold
    if (fail) throw new Error('offline')
    return { objects: [{ key: 'unique' }, { key: 'unique' }] }
  },
}
const context = vm.createContext({
  window: windowMock, document: documentMock, Promise, Map,
  Date: { now: () => now },
  activeTab: 'storage', mediaStorage: { baseURL: 'https://storage.test', enabled: true },
  useMediaStorageStore: { getState: () => storage },
  mediaObjectCountRef: { current: 50 }, mediaObjectsRequestRef: { current: 0 },
  setMediaObjects: value => { objects = value }, setMediaObjectsCursor: () => {},
  setMediaAutoError: value => { errorMessage = value },
  MEDIA_STORAGE_CHANGED_EVENT: 'changed',
})
const start = vm.runInContext(ts.transpile('(' + callback + ')', { target: ts.ScriptTarget.ES2022 }), context)
const flush = () => new Promise(resolve => setImmediate(resolve))
const stop = start()
await flush()
assert.equal(usageCalls, 1)
assert.equal(listCalls, 1)
assert.equal(objects.length, 1, 'duplicate object keys are not duplicated in the UI')
windowMock.dispatchEvent(new Event('focus'))
documentMock.dispatchEvent(new Event('visibilitychange'))
await flush()
assert.equal(usageCalls, 1, 'focus within five minutes does not refresh')
now += 5 * 60 * 1000 - 1
windowMock.dispatchEvent(new Event('focus'))
await flush()
assert.equal(usageCalls, 1, 'five minute threshold is respected')
now -= 5 * 60 * 1000 - 1
tick()
await flush()
assert.equal(usageCalls, 2)
documentMock.visibilityState = 'hidden'
tick()
windowMock.dispatchEvent(new Event('changed'))
await flush()
assert.equal(listCalls, 2, 'hidden pages do not poll')
documentMock.visibilityState = 'visible'
documentMock.dispatchEvent(new Event('visibilitychange'))
await flush()
assert.equal(usageCalls, 3)
windowMock.dispatchEvent(new Event('changed'))
await flush()
assert.equal(listCalls, 4)
assert.equal(usageCalls, 3, 'mutation notification refreshes objects without duplicating mutation usage refresh')
fail = true
tick()
await flush()
assert.match(errorMessage, /offline/)
const failedCalls = listCalls
windowMock.dispatchEvent(new Event('focus'))
await flush()
assert.equal(listCalls, failedCalls, 'failed focus refreshes are throttled too')
assert.equal(objects.length, 1, 'refresh errors keep the last successful list')
fail = false
tick()
await flush()
assert.equal(errorMessage, '')
let release
hold = new Promise(resolve => { release = resolve })
tick()
const previousObjects = objects
stop()
release()
await flush()
assert.equal(objects, previousObjects, 'in-flight results are ignored after leaving settings')
const previousCalls = listCalls
windowMock.dispatchEvent(new Event('focus'))
windowMock.dispatchEvent(new Event('changed'))
await flush()
assert.equal(listCalls, previousCalls)
assert.ok(!source.includes('}, [mediaStorage])'), 'background usage updates must not reset draft inputs')
console.log('storage auto-refresh lifecycle: PASS')
