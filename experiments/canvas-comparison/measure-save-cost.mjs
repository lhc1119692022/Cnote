import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { sourceLoader } from '../../web/scripts/helpers/load-source.mjs'

const records = new Map()
const load = sourceLoader({ '@/lib/localforage-storage': { __esModule: true, default: { getItem: async key => records.get(key), setItem: async (key, value) => { records.set(key, value) }, removeItem: async key => { records.delete(key) } } } })
const { saveDocument } = load('storage/graph-store')
const { useGraphStore } = load('stores/graph-store')
const rows = []
for (const count of [30, 100, 300]) {
  const document = { id: `cost-${count}`, name: 'Save cost fixture', viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1, nodes: Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, kind: 'content', category: 'text', label: 'Text', content: 'Body text '.repeat(4096), position: { x: index * 100, y: 0 }, size: { width: 320, height: 240 }, source: { kind: 'text', mimeType: 'text/plain' } })), edges: [] }
  useGraphStore.getState().openDocument(document)
  for (let repeat = -2; repeat < 5; repeat++) {
    let started = performance.now()
    await saveDocument(document)
    const saveMs = performance.now() - started
    const serialized = [...records.values()].find(value => typeof value === 'string' && value.includes(`"id":"cost-${count}"`))
    assert.deepEqual(JSON.parse(serialized).payload, document)
    started = performance.now()
    useGraphStore.getState().commitHistory()
    const historyMs = performance.now() - started
    const state = useGraphStore.getState()
    assert.deepEqual(state.history.at(-1), state.currentDocument)
    assert.notEqual(state.history.at(-1), state.currentDocument)
    assert.notEqual(state.history.at(-1).nodes[0], state.currentDocument.nodes[0])
    if (repeat >= 0) rows.push({ count, repeat, serializedBytes: Buffer.byteLength(serialized), saveMs, historyMs })
  }
  const preserved = useGraphStore.getState().history.at(-1).nodes[0].position.x
  useGraphStore.getState().updateNode('node-0', { position: { x: 9999, y: 0 } })
  assert.equal(useGraphStore.getState().history.at(-1).nodes[0].position.x, preserved)
}
const sources = {}
for (const relative of ['storage/graph-store.ts', 'stores/graph-store.ts']) sources[relative] = createHash('sha256').update(await readFile(new URL(`../../web/src/${relative}`, import.meta.url))).digest('hex')
const filename = new URL(`./results/save-cost-${Date.now()}.json`, import.meta.url)
await writeFile(filename, JSON.stringify({ scope: 'Production saveDocument queue/encoding with an in-memory storage sink, plus production commitHistory; not disk or IPC latency.', runtime: process.version, sources, rows }, null, 2))
console.log(`Save/history production-path measurement: ${rows.length} samples; correct envelopes and isolated snapshots; ${filename.pathname}`)
