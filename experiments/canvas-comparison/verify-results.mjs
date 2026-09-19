import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const result = JSON.parse(await readFile(path.join(directory, 'results/accepted.json'), 'utf8'))
assert.equal(result.smoke, false)
assert.ok(result.completedAt)
assert.equal(result.rows.length, 670)
assert.deepEqual(result.failures, [])
const groups = new Map()
for (const row of result.rows) {
  assert.equal(row.correct, true)
  const key = JSON.stringify(Object.fromEntries(['group', 'variant', 'count', 'action', 'heavy', 'rate', 'bytes', 'megabytes'].filter(field => row[field] !== undefined).map(field => [field, row[field]])))
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row.repeat)
  for (const [field, value] of Object.entries(row)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} ${field} must be finite`)
  if (row.group === 'production-update') assert.equal(row.graphWrites, row.frames * (row.variant === 'production-current' ? 20 : 1))
  if (row.group === 'engine' && row.action === 'drag' && row.variant !== 'production-current') assert.equal(row.renders, row.frames * 20, 'Unchanged body components must not rerender during multi-node drag')
}
assert.equal(groups.size, 134)
for (const repeats of groups.values()) assert.deepEqual(repeats.sort(), [0, 1, 2, 3, 4])
for (const [filename, expected] of Object.entries(result.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(path.join(directory, filename))).digest('hex'), expected, `Source changed since the measured run: ${filename}`)
for (const series of result.series) assert.equal(createHash('sha256').update(await readFile(path.join(directory, 'results', series.name))).digest('hex'), series.sha256, 'Original raw results must remain unchanged')
assert.equal(result.httpUnauthorizedStatus, 403)
assert.equal(result.httpWrongOriginStatus, 403)
assert.equal(result.outstandingJobs, 0)
assert.ok(result.transportChecks.every(check => check.cancelPassed))
assert.equal(result.transportChecks.find(check => check.variant === 'message-port').boundedCreditsPassed, true)
const editing = result.capabilities[0].editing
assert.equal(editing.length, 8)
assert.ok(editing.every(check => check.focused && check.selectionPreserved && check.hitCorrect))
const guestRows = result.capabilities[0].guestRows
const guestFailures = guestRows.filter(check => !check.nativeClick || !check.hostHitCorrect || !check.preserved)
const motion = JSON.parse(await readFile(path.join(directory, 'results/motion.json'), 'utf8'))
assert.equal(createHash('sha256').update(await readFile(path.join(directory, 'results/motion.json'))).digest('hex'), result.motionResultSha256)
assert.equal(motion.results.length, 40)
assert.equal(motion.correct, true)
assert.ok(motion.results.every(check => check.cancelPassed))
const output = { measuredCases: result.rows.length, conditions: groups.size, repetitionsPerCondition: 5, sourceHashesMatch: true, positionsAndGraphWriteCounts: true, editingPassed: editing.length, guestPassed: guestRows.length - guestFailures.length, guestFailures, motionPassed: motion.results.length, cancellationAndCreditChecks: true, httpAuthChecks: true, remainingJobs: 0, timestamp: new Date().toISOString() }
await writeFile(path.join(directory, 'results/verification.json'), JSON.stringify(output, null, 2))
console.log(JSON.stringify(output, null, 2))
if (guestFailures.length) process.exitCode = 1
