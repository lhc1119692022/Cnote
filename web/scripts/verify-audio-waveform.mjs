import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { JSDOM } from 'jsdom'
import { sourceLoader } from './helpers/load-source.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://cnote.test' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let resize
globalThis.ResizeObserver = class {
  constructor(callback) { resize = callback }
  observe() {}
  disconnect() {}
}
let decodeCount = 0
let large = false
globalThis.AudioContext = class {
  state = 'running'
  async decodeAudioData() {
    decodeCount++
    const length = large ? 20_000_000 : 4096
    const samples = new Proxy({}, { get: (_target, position) => Number(position) < length / 2 ? 0.001 : 0.01 })
    return { length, numberOfChannels: 2, duration: large ? 400 : 3, getChannelData: () => samples }
  }
  async close() { this.state = 'closed' }
}
const ui = create((set) => ({ nodeChrome: {}, setNodeChrome: (id, value) => set({ nodeChrome: { [id]: value } }) }))
const load = sourceLoader({
  '@/lib/desktop-fetch': { desktopFetch: async (src) => {
    if (src === 'broken') throw new Error('读取失败')
    return { ok: true, blob: async () => new Blob(['audio']) }
  } },
  '@/stores/ui-store': { useUiStore: ui },
  '../audio-trim': { createAudioTrimCopy: async () => {}, trimAudioBlob: async () => new Blob() },
})
const { audioTrimDisplayNode, formatAudioTime, parseAudioTime } = load('canvas/audio-trim-layout.ts')
assert.equal(formatAudioTime(20.66), '00:20')
assert.equal(formatAudioTime(66), '01:06')
assert.equal(parseAudioTime('00:66'), null)
assert.equal(parseAudioTime('20.66'), null)
assert.equal(parseAudioTime('06:36'), 396)
const baseNode = { kind: 'content', category: 'audio', size: { width: 540, height: 220 } }
assert.equal(audioTrimDisplayNode(baseNode, true).size.height, 268)
assert.equal(baseNode.size.height, 220, 'temporary trim layout must not mutate persisted dimensions')
assert.equal(audioTrimDisplayNode(baseNode, false), baseNode)
const imageNode = { ...baseNode, category: 'image' }
assert.equal(audioTrimDisplayNode(imageNode, true), imageNode, 'other node layouts must not change')
const { extractAudioWaveform, audioWaveformBars } = load('canvas/audio-waveform.ts')
assert.deepEqual(audioWaveformBars([], 480), [])
assert.deepEqual(audioWaveformBars([0, 0], 480), [0, 0], 'silence stays silent')
assert.deepEqual(extractAudioWaveform({ length: 2, numberOfChannels: 1, getChannelData: () => [0.01, 0.02] }), [0.01, 0.02])
assert.deepEqual(audioWaveformBars([0.001, 0.01], 480), [0.1, 1], 'quiet recordings retain visible dynamics')
const { AudioPlayer } = load('canvas/contents/AudioPlayer.tsx')
const root = createRoot(document.getElementById('root'))
const render = async (src) => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(AudioPlayer, { src, nodeId: 'audio' }))))
await render('short')
const waveform = () => document.querySelector('svg[aria-label="音频波形"]')
assert.ok(waveform(), 'short audio has real waveform')
const heights = [...waveform().querySelectorAll('line')].map((line) => Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')))
assert.ok(Math.max(...heights) > Math.min(...heights) * 5, 'waveform bars do not all collapse to one height')
const beforeResize = decodeCount
await act(async () => resize([{ contentRect: { width: 760 } }]))
assert.equal(decodeCount, beforeResize, 'resizing never decodes again')
assert.equal(waveform().querySelectorAll('line').length, 152)
large = true
await render('long')
assert.ok(waveform(), 'audio above the trim memory limit still has a waveform')
await act(async () => ui.getState().setNodeChrome('audio', { audioTrim: true }))
assert.ok(waveform(), 'opening trim preserves waveform')
assert.ok(document.querySelector('[aria-label="截取时长"]').classList.contains('z-20'), 'duration must render above z-10 trim handles')
assert.ok(document.querySelector('[aria-label="截取时长"]').classList.contains('pointer-events-none'), 'duration must not block dragging')
assert.ok(document.querySelector('[aria-label="拖动截取起点"]').classList.contains('rounded-l-md'))
assert.ok(document.querySelector('[aria-label="拖动截取终点"]').classList.contains('rounded-r-md'))
assert.ok(!document.querySelector('[aria-label="拖动截取起点"]').classList.contains('rounded-md'))
assert.ok(!document.querySelector('[aria-label="拖动截取终点"]').classList.contains('rounded-md'))
assert.doesNotMatch(document.body.textContent, /超过本地截取内存上限/)
assert.equal(document.querySelector('button[title="生成 WAV 截取副本，保留原音频"]').disabled, false, 'long sources can be trimmed without retaining decoded PCM')
await act(async () => document.querySelector('input[aria-label="截取开始时间"]').dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
assert.equal(ui.getState().nodeChrome.audio.audioTrim, true, 'inside clicks keep trimming open')
await act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
assert.equal(ui.getState().nodeChrome.audio.audioTrim, false, 'outside clicks close trimming')
await act(async () => ui.getState().setNodeChrome('audio', { audioTrim: false }))
await render('broken')
assert.equal(waveform(), null, 'changing source clears stale waveform')
assert.match(document.body.textContent, /读取失败/, 'decode errors are visible outside trim mode')
assert.equal(document.querySelector('svg line'), null, 'failure is not disguised as a flat waveform')
await act(async () => root.unmount())
console.log('PASS: audio waveform dynamics, silence, resize, long audio, trim limits, source replacement and errors')
