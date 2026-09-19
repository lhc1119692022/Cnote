import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/canvas/use-prompt-autosize.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
let cleanup
let dependencies
let observer
let measurements = 0
let contentHeight = 320
const textarea = { style: {}, scrollTop: 75, offsetWidth: 440, get scrollHeight() {
  assert.equal(this.style.height, '0px', 'reset height before measuring shorter text')
  measurements++
  return contentHeight
} }
const module = { exports: {} }
vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
  ResizeObserver: class {
    constructor(callback) { this.callback = callback; observer = this }
    observe(target) { assert.equal(target, textarea) }
    disconnect() { this.disconnected = true }
  },
})((name) => {
  assert.equal(name, 'react')
  return { useLayoutEffect(effect, deps) { cleanup = effect(); dependencies = deps } }
}, module, module.exports)
const { usePromptAutosize } = module.exports
const ref = { current: textarea }
usePromptAutosize(ref, 'restored long prompt', 'video')
assert.equal(textarea.style.height, '320px')
assert.equal(textarea.scrollTop, 75)
assert.equal(dependencies[1], 'restored long prompt')
assert.equal(dependencies[2], 'video')
const previousMeasurements = measurements
observer.callback()
assert.equal(measurements, previousMeasurements, 'height-only resize must not cause an observer loop')
contentHeight = 580
textarea.offsetWidth = 220
observer.callback()
assert.equal(textarea.style.height, '580px', 'narrower nodes reflow text')
contentHeight = 160
textarea.offsetWidth = 880
observer.callback()
assert.equal(textarea.style.height, '160px', 'wider nodes reclaim unused prompt space')
const previousObserver = observer
cleanup()
assert(previousObserver.disconnected)
contentHeight = 28
usePromptAutosize(ref, '', 'image')
assert.equal(textarea.style.height, '48px', 'empty prompt keeps compact minimum height')
cleanup()
ref.current = null
usePromptAutosize(ref, '', null)
assert.equal(cleanup, undefined, 'request chooser does not have a textarea')
ref.current = textarea
contentHeight = 920
usePromptAutosize(ref, 'pasted long prompt', 'image')
assert.equal(textarea.style.height, '920px', 'image prompts use the same autosizing')
cleanup()

const request = readFileSync(new URL('../src/canvas/contents/RequestContent.tsx', import.meta.url), 'utf8')
assert.match(request, /usePromptAutosize\(promptRef, prompt, generationVariant\)/)
assert.match(request, /relative flex min-h-0 shrink flex-col p-2 pt-1/)
assert.match(request, /flex min-h-0 flex-auto flex-col gap-2/)
assert.match(request, /min-h-\[48px\] flex-auto resize-none overflow-y-auto overscroll-contain/)
assert.match(request, /flex shrink-0 items-end gap-2/)
assert.match(request, /min-h-\[56px\] flex-1 overflow-auto/)
console.log('Prompt autosize PASS: long/short/restored prompts, width reflow, stable scroll, observer cleanup and bounded flex layout contract. Geometry still requires browser verification.')
