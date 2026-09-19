import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from '../../web/node_modules/jszip/lib/index.js'

const paragraphs = Array.from({ length: 60 }, (_, index) => `验收段落 ${index + 1}：中文与 English 123，用于检查滚动与缩放。`).join('\n')
const image = await fs.readFile('experiments/canvas-comparison/results/final-product-preview.png')
const imageUrl = `data:image/png;base64,${image.toString('base64')}`
const entries = [
  ['表格验收', 'data', 'csv', { kind: 'data', sheets: [{ name: '测试表', columns: ['序号', '名称', '数值'], rows: Array.from({ length: 60 }, (_, index) => [index + 1, `测试行-${index + 1}`, index * 3]), totalRows: 60, truncated: false }] }],
  ['文档验收', 'document', 'markdown', { kind: 'document', plainText: paragraphs, headings: [{ level: 1, text: '本地合成文档' }] }],
  ['社媒验收', 'social', 'social-post', { kind: 'social', platform: 'generic', canonicalUrl: '', title: '本地合成社媒内容', bodyText: paragraphs.slice(0, 500), contentBlocks: [], author: { name: '测试作者' } }],
  ['图片验收', 'image', 'image', { kind: 'image', resources: [{ resource: { url: imageUrl } }] }],
]
const nodes = entries.map(([label, category, subtype, payload], index) => ({ id: `mixed-${index}`, type: 'content', position: { x: -1000 + (index % 2) * 650, y: -800 + Math.floor(index / 2) * 500 }, style: { width: 560, height: 420 }, data: { label, category, subtype, payload, state: 'ready' } }))
nodes.push({ id: 'far-node', type: 'content', position: { x: 10000, y: -10000 }, style: { width: 500, height: 350 }, data: { label: '远处节点', category: 'text', subtype: 'plain-text', content: '世界坐标 10000, -10000；导航与网点验收', state: 'ready' } })
const flow = { id: 'ui-mixed-20260919', name: '实机补测-混合内容与负坐标', title: '实机补测-混合内容与负坐标', nodes, edges: [], viewport: { x: 750, y: 650, zoom: 0.65 }, createdAt: Date.now(), updatedAt: Date.now() }
const zip = new JSZip()
zip.file('manifest.json', JSON.stringify({ format: 'cnote-flow-backup', version: 1, schemaVersion: 1, exportedAt: new Date().toISOString(), flow, resources: [] }))
const output = path.resolve('experiments/canvas-comparison/ui-test-documents/mixed-content.cnote.zip')
await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }))
console.log(output)
