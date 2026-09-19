import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results')
const files = await readdir(directory)
const select = prefix => files.filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort().at(-1)
const baselineFile = select('full-windowed-')
const engineFile = select('engine-windowed-')
assert.ok(baselineFile && engineFile, 'Run the corrected windowed full and engine experiments before consolidation')
const baselineText = await readFile(path.join(directory, baselineFile), 'utf8')
const engineText = await readFile(path.join(directory, engineFile), 'utf8')
const baseline = JSON.parse(baselineText)
const engine = JSON.parse(engineText)
const motionText = await readFile(path.join(directory, 'motion.json'), 'utf8')
const motion = JSON.parse(motionText)
assert.equal(baseline.rows.length, 670)
assert.equal(engine.rows.length, 150)
assert.deepEqual(baseline.environment.versions, engine.environment.versions)
assert.deepEqual(baseline.environment.viewport, engine.environment.viewport)
assert.deepEqual(baseline.environment.gpuFeatures, engine.environment.gpuFeatures)
assert.equal(baseline.gitHead, engine.gitHead)
assert.equal(baseline.smoke, false)
assert.equal(engine.smoke, false)
const source = (name, text, report, retainedGroups) => ({ name, sha256: createHash('sha256').update(text).digest('hex'), recordedAt: report.recordedAt, completedAt: report.completedAt, sourceHashes: report.sourceHashes, retainedGroups })
const result = {
  ...baseline,
  sourceHashes: engine.sourceHashes,
  completedAt: engine.completedAt,
  series: [source(baselineFile, baselineText, baseline, 'all except engine'), source(engineFile, engineText, engine, 'engine only; stable node data and edge identities')],
  selectionPolicy: 'Replace the entire engine family after correcting reference stability; no per-row or winner-based selection. Do not pool discarded measurements.',
  rows: [...baseline.rows.filter(row => row.group !== 'engine'), ...engine.rows],
  failures: [...baseline.failures.filter(item => item.input.group !== 'engine'), ...engine.failures],
  capabilities: engine.capabilities,
  transportChecks: engine.transportChecks,
  animation: motion.results,
  animationScope: motion.scope,
  animationAssumptions: motion.assumptions,
  motionResultSha256: createHash('sha256').update(motionText).digest('hex'),
}
await writeFile(path.join(directory, 'accepted.json'), JSON.stringify(result, null, 2))
console.log(`Accepted ${result.rows.length} rows from ${baselineFile} and ${engineFile}; original source records preserved`)
