import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(directory, 'results/latest.json')
const report = JSON.parse(await readFile(source, 'utf8'))
const median = values => {
  const ordered = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  if (!ordered.length) return null
  return ordered.length % 2 ? ordered[Math.floor(ordered.length / 2)] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2
}
const fields = ['frameMedianMs', 'frameP95Ms', 'framesOver25Ms', 'writeP95Ms', 'layoutMs', 'styleMs', 'scriptMs', 'taskMs', 'layouts', 'paints', 'mounted', 'renders', 'mounts', 'unmounts', 'graphWrites', 'firstMs', 'elapsedMs', 'deliveryMedianMs', 'deliveryP95Ms', 'computeMs', 'worstGapMs']
const groups = new Map()
for (const row of report.rows) {
  const conditions = Object.fromEntries(['group', 'variant', 'count', 'action', 'heavy', 'rate', 'bytes', 'megabytes'].filter(field => row[field] !== undefined).map(field => [field, row[field]]))
  const key = JSON.stringify(conditions)
  if (!groups.has(key)) groups.set(key, { conditions, rows: [] })
  groups.get(key).rows.push(row)
}
const summary = [...groups.values()].map(({ conditions, rows }) => ({ ...conditions, repetitions: rows.length, correct: rows.every(row => row.correct), median: Object.fromEntries(fields.filter(field => rows.some(row => Number.isFinite(row[field]))).map(field => [field, median(rows.map(row => row[field]))])), ranges: Object.fromEntries(fields.filter(field => rows.some(row => Number.isFinite(row[field]))).map(field => [field, { min: Math.min(...rows.map(row => row[field]).filter(Number.isFinite)), max: Math.max(...rows.map(row => row[field]).filter(Number.isFinite)) }])) }))
summary.sort((left, right) => JSON.stringify([left.group, left.count, left.action, left.heavy, left.rate, left.bytes, left.megabytes, left.variant]).localeCompare(JSON.stringify([right.group, right.count, right.action, right.heavy, right.rate, right.bytes, right.megabytes, right.variant])))
const result = { source: path.basename(source), recordedAt: report.recordedAt, completedAt: report.completedAt, rows: report.rows.length, failures: report.failures, environment: report.environment, summary, capabilities: report.capabilities, transportChecks: report.transportChecks, animation: report.animation, httpUnauthorizedStatus: report.httpUnauthorizedStatus, httpWrongOriginStatus: report.httpWrongOriginStatus, outstandingJobs: report.outstandingJobs }
await writeFile(path.join(directory, 'results/summary.json'), JSON.stringify(result, null, 2))
const sections = ['# Automated comparison — numerical summary', '', `Source: ${path.basename(source)}`, `Rows: ${report.rows.length}; case failures: ${report.failures.length}`, `Renderer: ${report.environment.renderer}`, `GPU compositing: ${report.environment.gpuFeatures.gpu_compositing}`, '', 'Numbers are medians across repetitions. They are not pooled-frame percentiles. Full ranges and raw frames are in the JSON files.', 'Production-current is a separate product reference, not feature-equivalent to the small engine prototypes.', 'Software compositing results do not establish hardware-GPU performance. Native input checks are reported separately.', '']
for (const group of ['engine', 'scale', 'virtual', 'virtual-steady', 'material', 'transport', 'isolation', 'production-update']) {
  sections.push(`## ${group}`, '')
  const columns = group === 'transport' ? ['firstMs', 'elapsedMs', 'deliveryP95Ms'] : group === 'isolation' ? ['elapsedMs', 'computeMs', 'worstGapMs'] : ['frameP95Ms', 'writeP95Ms', 'layoutMs', 'styleMs', 'taskMs', 'mounts', 'mounted']
  sections.push(`| Variant and conditions | n | ${columns.join(' | ')} |`, `| --- | --- | ${columns.map(() => '---').join(' | ')} |`)
  for (const item of summary.filter(item => item.group === group)) {
    const conditions = ['count', 'action', 'heavy', 'rate', 'bytes', 'megabytes'].filter(field => item[field] !== undefined).map(field => `${field}=${item[field]}`).join(', ')
    sections.push(`| ${item.variant}; ${conditions} | ${item.repetitions} | ${columns.map(field => item.median[field] == null ? '-' : item.median[field].toFixed(3)).join(' | ')} |`)
  }
  sections.push('')
}
await writeFile(path.join(directory, 'results/summary.md'), sections.join('\n'))
console.log(`Summarized ${report.rows.length} rows into ${summary.length} conditions from ${source}`)
