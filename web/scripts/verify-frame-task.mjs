import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/frame-task.ts', import.meta.url), 'utf8')
const module = { exports: {} }
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(module, module.exports)
const { createFrameTask, createDisplayBuffer } = module.exports
let nextId = 0
const callbacks = new Map()
const clock = {
  request(callback) { const id = ++nextId; callbacks.set(id, callback); return id },
  cancel(handle) { callbacks.delete(handle) },
}
const step = () => { for (const callback of [...callbacks.values()]) callback() }
let total = 0
const task = createFrameTask(clock)
for (let index = 1; index <= 100; index++) task.schedule(() => { total = index })
assert.equal(callbacks.size, 1)
step()
assert.equal(total, 100)
assert.equal(callbacks.size, 0)
task.schedule(() => { total = 101 })
task.flush()
assert.equal(total, 101)
step()
assert.equal(total, 101)
task.schedule(() => { total = -1 })
task.cancel()
step()
assert.equal(total, 101)

globalThis.requestAnimationFrame = clock.request
globalThis.cancelAnimationFrame = clock.cancel
const emitted = []
const display = createDisplayBuffer(text => emitted.push(text), 10)
for (const text of ['你', '好', '🌍']) display.append(text)
assert.equal(emitted.length, 0)
step()
assert.deepEqual(emitted, ['你好🌍'])
display.append('后台')
await new Promise(resolve => setTimeout(resolve, 25))
assert.deepEqual(emitted, ['你好🌍', '后台'])
display.append('末尾')
display.flush()
display.flush()
assert.deepEqual(emitted, ['你好🌍', '后台', '末尾'])
display.append('取消丢弃')
display.cancel()
step()
await new Promise(resolve => setTimeout(resolve, 25))
assert.equal(emitted.length, 3)
const other = []
const concurrent = createDisplayBuffer(text => other.push(text))
display.append('A')
concurrent.append('B')
concurrent.flush()
display.flush()
assert.equal(emitted.at(-1), 'A')
assert.deepEqual(other, ['B'])
assert.equal(callbacks.size, 0)
console.log('verify-frame-task: coalescing, final flush, cancel, hidden fallback, Unicode and concurrent buffers passed')
