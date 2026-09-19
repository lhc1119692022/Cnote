import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const results = new URL('./results/', import.meta.url)
const filenames = await readdir(results)
const latest = pattern => filenames.filter(filename => pattern.test(filename)).sort().at(-1)
const files = [30, 100, 300].map(count => latest(new RegExp(`^final-product-${count}-[0-9]+\\.json$`)))
assert.ok(files.every(Boolean), 'Every node-count shard must exist')
const reports = await Promise.all(files.map(async filename => JSON.parse(await readFile(new URL(filename, results), 'utf8'))))
const median = values => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)]
const stats = values => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) })
const hash = value => createHash('sha256').update(value).digest('hex')
const comparisons = []
const viewport = reports[0].rows[0]?.viewport
assert.ok(viewport && viewport.width > 0 && viewport.height > 0 && viewport.dpr > 0)
assert.equal(viewport.visibility, 'visible')
for (const report of reports) {
  assert.deepEqual(report.failures, [])
  assert.equal(report.smoke, false)
  assert.equal(report.rows.length, 100)
  assert.deepEqual(report.manifest, reports[0].manifest, 'All shards use identical source and fixture versions')
  assert.deepEqual(report.environment, reports[0].environment, 'All shards use the same recorded environment')
  const keys = new Set(report.rows.map(row => `${row.mode}/${row.action}/${row.version}/${row.repeat}`))
  assert.equal(keys.size, 100)
  for (const mode of ['web', 'desktop']) for (const action of ['drag', 'pan', 'zoom', 'stream', 'mixed']) {
    const select = version => report.rows.filter(row => row.mode === mode && row.action === action && row.version === version)
    const before = select('before')
    const after = select('after')
    for (const rows of [before, after]) {
      assert.deepEqual(rows.map(row => row.repeat).sort(), [0, 1, 2, 3, 4])
      for (const row of rows) {
        assert.equal(row.count, report.count)
        assert.deepEqual(row.viewport, viewport, 'Every row uses the same visible viewport and DPR')
        assert.ok(row.reactCommits > 0)
        assert.ok(row.frameP95 > 0 && Number.isFinite(row.frameP95))
        assert.equal(row.intervals.length, 20)
        if (action === 'stream' || action === 'mixed') {
          assert.equal(row.finalReplyLength, 1000)
          assert.equal(row.transport.chunks, 200)
          if (mode === 'desktop') assert.ok(row.transport.readCalls >= 200)
          else assert.equal(row.transport.readCalls, 0)
        }
      }
    }
    const beforeFrames = stats(before.map(row => row.frameP95))
    const afterFrames = stats(after.map(row => row.frameP95))
    comparisons.push({ count: report.count, mode, action, before: beforeFrames, after: afterFrames, changePercent: (afterFrames.median / beforeFrames.median - 1) * 100, rangesOverlap: beforeFrames.min <= afterFrames.max && afterFrames.min <= beforeFrames.max, beforeLongTasks: stats(before.map(row => row.longTasks.length)), afterLongTasks: stats(after.map(row => row.longTasks.length)), beforeCommits: median(before.map(row => row.reactCommits)), afterCommits: median(after.map(row => row.reactCommits)), beforeGraphWrites: median(before.map(row => row.graphWrites)), afterGraphWrites: median(after.map(row => row.graphWrites)), beforeSessionWrites: median(before.map(row => row.sessionWrites)), afterSessionWrites: median(after.map(row => row.sessionWrites)) })
  }
}
for (const [relative, record] of Object.entries(reports[0].manifest.sources.after)) assert.equal(hash(await readFile(new URL(`../../web/src/${relative}`, import.meta.url))), record.sha256, `Current source matches measurements: ${relative}`)
for (const [relative, checksum] of Object.entries(reports[0].manifest.harness)) assert.equal(hash(await readFile(new URL(relative, import.meta.url))), checksum, `Current fixture matches measurements: ${relative}`)
for (const relative of ['canvas/components/CanvasProvider.tsx', 'canvas/components/CanvasViewport.tsx', 'canvas/contents/AIContent.tsx', 'stores/graph-store.ts']) assert.equal(reports[0].manifest.sources.before[relative].provenance, 'frozen-source-map')
const guestFile = latest(/^final-product-guests-[0-9]+\.json$/)
assert.ok(guestFile)
const guests = JSON.parse(await readFile(new URL(guestFile, results), 'utf8'))
assert.deepEqual(guests.failures, [])
for (const entry of guests.guests) assert.equal(entry.restored, entry.guestCount)
assert.ok(guests.guests.some(entry => entry.target === 50 || entry.stopped))
const summary = { recordedAt: new Date().toISOString(), files, guestFile, sampleCount: reports.reduce((total, report) => total + report.rows.length, 0), manifest: reports[0].manifest, environment: { ...reports[0].environment, viewport }, comparisons, guests: guests.guests, guestEnvironment: guests.environment, guestManifest: guests.manifest }
await writeFile(new URL('final-product-summary.json', results), JSON.stringify(summary, null, 2))
for (const entry of comparisons) console.log(`${entry.count} ${entry.mode} ${entry.action}: ${entry.before.median.toFixed(1)} -> ${entry.after.median.toFixed(1)} ms; ${entry.changePercent.toFixed(1)}%; overlap=${entry.rangesOverlap}`)
console.log(`Verified ${summary.sampleCount} product samples (${summary.sampleCount / 2} pairs) and native guest restoration; source hashes match.`)
