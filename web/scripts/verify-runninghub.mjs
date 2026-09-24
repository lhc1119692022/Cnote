import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(relative, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  })
  return module.exports
}

const workflow = load('lib/runninghub/workflow.ts')
const clientModule = load('lib/runninghub/client.ts', {
  './workflow': workflow,
  './instance': load('lib/runninghub/instance.ts'),
  '@/lib/desktop-fetch': { desktopFetch: () => { throw new Error('Real network access is forbidden in this test') } },
  '@/lib/generation/safe-error': load('lib/generation/safe-error.ts'),
})
const inputs = load('lib/runninghub/inputs.ts')
const raw = {
  '4': { class_type: 'LoadImage', _meta: { title: '原图' }, inputs: { image: 'example.png' } },
  '27': { class_type: 'RH_TopazLabs_ImageUpscale', inputs: { scale: '4', face_enhancement: true, seed: 1234, image: ['4', 0], api_key: 'never-save', settings: { token: 'never-save' } } },
  '32': { class_type: 'SaveImage', inputs: { images: ['27', 0], filename_prefix: 'test' } },
  '99': { class_type: 'Image Comparer (rgthree)', inputs: { rgthree_comparer: { url: '/view?Rh-Comfy-Auth=secret' }, text: 'https://example.com/a?Rh-Comfy-Auth=secret' } },
}
assert.equal(workflow.parseWorkflowId('1904136902449209346'), '1904136902449209346')
assert.equal(workflow.parseWorkflowId('https://www.runninghub.cn/workflow/1904136902449209346'), '1904136902449209346')
assert.throws(() => workflow.parseWorkflowId('https://evil.test/workflow/123'))
assert.throws(() => workflow.analyzeWorkflow({ nodes: [] }))
assert.throws(() => workflow.analyzeWorkflow('{'))
const analyzed = workflow.analyzeWorkflow(raw)
assert.equal(analyzed.fields.find(field => field.key === '4:image').inputType, 'image')
assert.equal(analyzed.fields.find(field => field.key === '27:scale').value, '4')
assert.equal(analyzed.fields.find(field => field.key === '27:face_enhancement').value, true)
assert.ok(!analyzed.fields.some(field => field.key === '27:image'))
assert.ok(!JSON.stringify(analyzed).includes('never-save'))
assert.ok(!JSON.stringify(analyzed).includes('Rh-Comfy-Auth'))
assert.equal(analyzed.outputs[0].nodeId, '32')
const configured = { id: 'local', channelId: 'channel', workflowId: '123', name: 'Topaz', revision: 1, ...analyzed }
configured.fields.find(field => field.key === '27:scale').enabled = true
const selection = { workflow: configured, values: { '27:scale': '2' }, bindings: {} }
assert.throws(() => workflow.buildOverrides(selection, {}, () => 42), /选择素材/)
const overrides = workflow.buildOverrides(selection, { '4:image': 'uploads/image.png' }, () => 42)
assert.deepEqual(overrides.find(item => item.fieldName === 'scale'), { nodeId: '27', fieldName: 'scale', fieldValue: '2' })
assert.equal(overrides.find(item => item.fieldName === 'seed').fieldValue, 1234)
selection.seedModes = { '27:seed': 'random' }
assert.equal(workflow.buildOverrides(selection, { '4:image': 'file.png' }, () => 42).find(item => item.fieldName === 'seed').fieldValue, 42)
assert.throws(() => workflow.buildOverrides({ ...selection, values: { '27:scale': 2 } }, { '4:image': 'file.png' }, () => 42), /类型/)
const changed = structuredClone(raw)
delete changed['27'].inputs.scale
const reconciled = workflow.reconcileWorkflow(configured, changed)
assert.equal(reconciled.workflow.revision, 2)
assert.ok(reconciled.changes.some(message => message.includes('scale')))
assert.throws(() => clientModule.assertWorkflowBindings(configured, changed), /绑定失效/)
clientModule.assertWorkflowBindings(configured, raw)

const calls = []
const responses = [
  { code: 0, data: { prompt: JSON.stringify(raw) } },
  { code: 0, data: { fileName: 'uploads/a.png', download_url: 'https://example.com/a.png' } },
  { code: 0, data: { taskId: '1999999999999999999' } },
  { taskId: '1999999999999999999', status: 'RUNNING', results: null },
  { taskId: '1999999999999999999', status: 'SUCCESS', results: [{ url: 'https://example.com/out.png', outputType: 'png' }] },
  { code: 0, data: [{ fileUrl: 'https://example.com/out.png', fileType: 'png', nodeId: '32' }] },
  { code: 0, data: null },
]
const client = clientModule.runningHubClient({ baseURL: 'https://www.runninghub.cn', enabled: true }, 'test-key', async (url, options) => {
  calls.push({ url, options })
  return new Response(JSON.stringify(responses.shift()), { status: 200 })
})
assert.deepEqual(await client.read('123'), raw)
assert.equal((await client.upload(new Blob(['input']), 'a.png')).fileName, 'uploads/a.png')
const taskId = await client.create('123', overrides)
assert.equal(taskId, '1999999999999999999')
assert.equal((await client.query(taskId)).status, 'RUNNING')
assert.equal((await client.query(taskId)).results.length, 1)
assert.equal((await client.outputsByNode(taskId))[0].nodeId, '32')
await client.cancel(taskId)
assert.equal(calls.length, 7)
assert.equal(calls[1].url, 'https://www.runninghub.cn/openapi/v2/media/upload/binary')
assert.equal(calls[1].options.headers['Content-Type'], undefined)
assert.deepEqual(JSON.parse(calls[2].options.body).nodeInfoList, overrides)
assert.equal(JSON.parse(calls[2].options.body).instanceType, 'default')
assert.equal(calls[3].url, 'https://www.runninghub.cn/openapi/v2/query')
assert.throws(() => clientModule.runningHubClient({ baseURL: 'https://www.runninghub.cn', enabled: true }, ''), /API Key/)
let failedCalls = 0
const failing = clientModule.runningHubClient({ baseURL: 'https://www.runninghub.cn', enabled: true }, 'test-key', async () => {
  failedCalls++
  throw new Error('network test-key')
})
await assert.rejects(failing.create('123', []), error => !error.message.includes('test-key'))
assert.equal(failedCalls, 1)
const mismatch = clientModule.runningHubClient({ baseURL: 'https://www.runninghub.cn', enabled: true }, 'test-key', async () => new Response(JSON.stringify({ taskId: 'different', status: 'SUCCESS' })))
await assert.rejects(mismatch.query('requested'), /不匹配/)

for (const [tier, expected] of [['default', 'default'], ['plus', 'plus'], ['ultra', 'ultra'], ['1', 'default'], ['2', 'plus'], ['3', 'ultra']]) {
  let body
  const tierClient = clientModule.runningHubClient({ baseURL: 'https://www.runninghub.cn', enabled: true }, 'test-key', async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ code: 0, data: { taskId: '123' } })) })
  await tierClient.create('123', [], undefined, tier)
  assert.equal(body.instanceType, expected)
}
const mixed = { ...selection, workflow: { ...configured, fields: [
  { ...configured.fields[0], key: 'video', inputType: 'video' },
  { ...configured.fields[0], key: 'image', inputType: 'image' },
  { ...configured.fields[0], key: 'video2', inputType: 'video' },
] }, bindings: {} }
const refs = [{ id: 'v1', type: 'video' }, { id: 'i1', type: 'image' }, { id: 'v2', type: 'video' }]
assert.deepEqual(inputs.resolveRHInputs(mixed, refs).bindings, { video: 'v1', image: 'i1', video2: 'v2' })
assert.equal(inputs.resolveRHInputs(mixed, refs.slice(0, 2)).missing.length, 1)
assert.equal(inputs.resolveRHInputs(mixed, [...refs, { id: 'v3', type: 'video' }]).extra.length, 1)
assert.equal(inputs.workflowChanged(configured, structuredClone(configured)), false)
assert.equal(inputs.workflowChanged(configured, { ...configured, name: 'changed' }), true)
for (const file of process.argv.slice(2)) {
  const parsed = workflow.analyzeWorkflow(readFileSync(file, 'utf8'))
  assert.ok(parsed.fields.length > 0)
  assert.ok(parsed.outputs.length > 0)
  assert.ok(!JSON.stringify(parsed).includes('Rh-Comfy-Auth'))
  if (file.includes('画质修复')) {
    assert.ok(parsed.fields.some(field => field.key === '209:value'))
    assert.ok(!parsed.fields.some(field => field.key === '143:denoise'))
  }
  if (file.includes('DepthCrafter')) {
    const media = parsed.fields.filter(field => field.enabled && ['image', 'video', 'audio'].includes(field.inputType))
    assert.equal(media.length, 1)
    assert.equal(media[0].inputType, 'video')
    const sample = { workflow: { ...configured, ...parsed }, values: {}, bindings: {} }
    assert.equal(inputs.resolveRHInputs(sample, [{ id: 'v1', type: 'video' }]).missing.length, 0)
    assert.equal(inputs.resolveRHInputs(sample, [{ id: 'v1', type: 'video' }, { id: 'v2', type: 'video' }]).extra.length, 1)
  }
  if (file.includes('SeedVR2')) assert.equal(Object.keys(parsed.structure).length, 25)
  if (file.includes('Topaz')) assert.equal(typeof parsed.fields.find(field => field.key === '27:scale').value, 'string')
}
console.log('RunningHub workflow parser, typed overrides, revision reconciliation, and mocked API contracts passed. No remote calls.')
