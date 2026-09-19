import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from '../../web/node_modules/jszip/lib/index.js'

const output = path.resolve('experiments/canvas-comparison/ui-test-documents')
await fs.mkdir(output, { recursive: true })
for (const count of [20, 30, 100, 300]) {
  const columns = count <= 30 ? 5 : count === 100 ? 10 : 20
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `test-node-${index + 1}`, type: 'content',
    position: { x: (index % columns) * 480, y: Math.floor(index / columns) * 360 },
    style: { width: 420, height: 300 },
    data: { label: `验收-${index + 1}`, category: 'text', subtype: 'plain-text', content: `真实窗口验收节点 ${index + 1}\n中文 ABC 123\n只用于本地测试`, state: 'ready' },
  }))
  const edges = nodes.slice(1).map((node, index) => ({ id: `test-edge-${index + 1}`, source: nodes[index].id, target: node.id }))
  const flow = { id: `ui-test-${randomUUID()}`, name: `实机补测-${count}节点`, title: `实机补测-${count}节点`, nodes, edges, viewport: { x: 130, y: 150, zoom: count <= 30 ? 0.45 : count === 100 ? 0.23 : 0.12 }, createdAt: Date.now(), updatedAt: Date.now() }
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ format: 'cnote-flow-backup', version: 1, schemaVersion: 1, exportedAt: new Date().toISOString(), flow, resources: [] }))
  await fs.writeFile(path.join(output, `nodes-${count}.cnote.zip`), await zip.generateAsync({ type: 'nodebuffer' }))
  console.log(`${count} nodes: ${flow.id}`)
}
