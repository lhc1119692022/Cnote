import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { sourceLoader } from './helpers/load-source.mjs'

const load = sourceLoader()
const { placeNewestResult } = load('canvas/result-placement.ts')
const node = (id, y, owner = 'request') => ({ id, kind: 'content', position: { x: 628, y }, size: { width: 540, height: 430 }, generatedBy: { requestNodeId: owner } })
const original = [node('old', 0), node('older', 454), { ...node('unrelated', 908, 'other') }]
const result = placeNewestResult(original, 'request', { x: 628, y: 0 }, { width: 540, height: 430 }, 24)
assert.equal(result.position.y, 0)
assert.equal(result.nodes[0].position.y, 454)
assert.equal(result.nodes[1].position.y, 1362)
assert.equal(result.nodes[2].position.y, 908)
assert.equal(original[0].position.y, 0)
const dom = new JSDOM('<div id="root"><video></video><video></video><div><webview></webview></div></div>')
const { preserveMotionMedia } = load('canvas/motion-media.ts')
const root = dom.window.document.getElementById('root')
const [playing, paused] = root.querySelectorAll('video')
Object.defineProperty(playing, 'paused', { value: false })
let pauses = 0
let resumes = 0
playing.pause = () => pauses++
playing.play = async () => { resumes++ }
paused.play = () => { throw new Error('User-paused video must not resume') }
const guest = root.querySelector('webview')
guest.capturePage = () => { throw new Error('Browser capture must not be called during motion') }
const stop = preserveMotionMedia(root)
assert.equal(pauses, 1)
assert.ok(!guest.classList.contains('canvas-motion-captured'))
assert.ok(!root.querySelector('img'))
stop()
assert.equal(resumes, 1)
assert.ok(!root.querySelector('.canvas-motion-snapshot'))
const cancel = preserveMotionMedia(root)
cancel()
assert.ok(!guest.classList.contains('canvas-motion-captured'))
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const hidingRule = css.match(/([^{}]+)\{\s*visibility: hidden !important;\s*\}/g).find((rule) => rule.includes('canvas-viewport-moving'))
assert.ok(hidingRule.includes('webview') && hidingRule.includes('iframe'))
assert.ok(!hidingRule.includes(' video'))
assert.ok(!css.includes('canvas-motion-snapshot'))
dom.window.close()
console.log('Newest result placement, media frame preservation, browser capture removal and original browser hiding: PASS')
