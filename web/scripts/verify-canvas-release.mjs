import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const webDirectory = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('../../experiments/canvas-comparison/results/', import.meta.url)
mkdirSync(output, { recursive: true })
const scripts = ['verify-frame-task', 'verify-canvas-optimization', 'verify-upstream-contract', 'verify-canvas-navigation', 'verify-canvas-user-flow', 'verify-ai-streaming', 'verify-ai-upstream-transport', 'verify-generation-inputs', 'verify-generation-selection', 'verify-prompt-mentions', 'verify-runtime-persistence', 'verify-document-autosave', 'verify-session-exit', 'verify-capture-materializer', 'verify-rich-text', 'verify-schema']
const result = { recordedAt: new Date().toISOString(), rows: [], sources: {} }
result.sources['pages/CanvasEditorPage.tsx'] = createHash('sha256').update(readFileSync(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url))).digest('hex')
for (const relative of ['canvas/components/CanvasProvider.tsx', 'canvas/components/CanvasViewport.tsx', 'canvas/components/UpstreamInputChips.tsx', 'canvas/contents/AIContent.tsx', 'canvas/contents/RequestContent.tsx', 'lib/frame-task.ts', 'lib/flow/upstream-inputs.ts', 'storage/runtime-persistence.ts', 'stores/canvas-viewport-store.ts', 'stores/graph-store.ts']) result.sources[relative] = createHash('sha256').update(readFileSync(new URL(`../src/${relative}`, import.meta.url))).digest('hex')
for (const script of scripts) {
  const started = Date.now()
  const execution = spawnSync(process.execPath, [`scripts/${script}.mjs`], { cwd: webDirectory, encoding: 'utf8', windowsHide: true, timeout: 90000 })
  process.stdout.write(execution.stdout || '')
  process.stderr.write(execution.stderr || '')
  result.rows.push({ script, exitCode: execution.status, milliseconds: Date.now() - started, stdout: execution.stdout, stderr: execution.stderr, error: execution.error?.message })
  if (execution.status !== 0) break
}
const filename = new URL(`release-checks-${Date.now()}.json`, output)
writeFileSync(filename, JSON.stringify(result, null, 2))
if (result.rows.length !== scripts.length || result.rows.some(row => row.exitCode !== 0)) process.exitCode = 1
console.log(`Canvas release checks: ${result.rows.filter(row => row.exitCode === 0).length}/${scripts.length}; ${filename.pathname}`)
