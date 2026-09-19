import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from '../../web/node_modules/typescript/lib/typescript.js'

const source = await readFile(new URL('../../web/src/storage/runtime-persistence.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('runtime-persistence.ts', source, ts.ScriptTarget.Latest, true)
const declaration = tree.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'serializeEntity')
assert.ok(declaration)
const compiled = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const serializeEntity = new Function(`${compiled}; return serializeEntity;`)()
const tests = []
for (let repeat = 0; repeat < 5; repeat++) for (const megabytes of [1, 8, 32]) for (const changes of ['none', 'one', 'all']) tests.push({ repeat, megabytes, changes })
let seed = 190926
for (let index = tests.length - 1; index > 0; index--) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const target = seed % (index + 1)
  ;[tests[index], tests[target]] = [tests[target], tests[index]]
}
const rows = []
for (const input of tests) {
  const text = 'Transcript 中文. '.repeat(180)
  const entityCount = Math.ceil(input.megabytes * 2 ** 20 / Buffer.byteLength(text))
  const original = Array.from({ length: entityCount }, (_, index) => ({ id: `session-${index}`, messages: [{ role: 'assistant', content: text }], updatedAt: 1 }))
  const oldStrings = new Map(original.map(entity => [entity.id, serializeEntity(entity)]))
  const oldReferences = new Map(original.map(entity => [entity.id, entity]))
  const changedCount = input.changes === 'all' ? entityCount : input.changes === 'one' ? 1 : 0
  const current = original.map((entity, index) => index < changedCount ? { ...entity, updatedAt: 2 } : entity)
  const expected = new Map(current.slice(0, changedCount).map(entity => [entity.id, serializeEntity(entity)]))
  const variants = input.repeat % 2 ? ['reference-cache', 'current-serialize-then-compare'] : ['current-serialize-then-compare', 'reference-cache']
  for (const variant of variants) {
    let serializations = 0
    const writes = new Map()
    const started = performance.now()
    for (const entity of current) {
      if (variant === 'reference-cache' && oldReferences.get(entity.id) === entity) continue
      serializations++
      const serialized = serializeEntity(entity)
      if (serialized !== oldStrings.get(entity.id)) writes.set(entity.id, serialized)
    }
    const elapsedMs = performance.now() - started
    assert.equal(writes.size, changedCount)
    for (const [id, serialized] of writes) assert.equal(serialized, expected.get(id))
    rows.push({ ...input, variant, entityCount, serializations, writes: writes.size, elapsedMs, correct: true })
  }
}
const output = { scope: 'Node CPU kernel only; production serializeEntity, immutable AI-session-shaped entities; no storage I/O and no renderer frame measurement', sourceSha256: createHash('sha256').update(source).digest('hex'), node: process.version, rows, limitations: ['Reference-cache invalidation across hydration/deletion and mutable external dependencies must be tested before production use', 'This prototype targets immutable AI sessions, not every runtime collection or full persistence logic'] }
await writeFile(new URL('./results/serialization.json', import.meta.url), JSON.stringify(output, null, 2))
const median = values => values.sort((left, right) => left - right)[Math.floor(values.length / 2)]
for (const megabytes of [1, 8, 32]) for (const changes of ['none', 'one', 'all']) {
  const subset = rows.filter(row => row.megabytes === megabytes && row.changes === changes)
  console.log(JSON.stringify({ megabytes, changes, currentMs: median(subset.filter(row => row.variant === 'current-serialize-then-compare').map(row => row.elapsedMs)), referenceMs: median(subset.filter(row => row.variant === 'reference-cache').map(row => row.elapsedMs)) }))
}
console.log(`Serialization: ${rows.length} cases passed with identical write intents`)
