import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const cache = new Map()

function withExt(base) {
  if (existsSync(base) && ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(base))) return base
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext
  }
  return base
}

function loadFrom(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename })((name) => {
    if (name.startsWith('@/')) return loadFrom(withExt(join(srcRoot, name.slice(2))))
    if (name.startsWith('.')) return loadFrom(withExt(join(dirname(filename), name)))
    return require(name)
  }, module, module.exports)
  return module.exports
}

const { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateDocument } = loadFrom(withExt(join(srcRoot, 'domain/schema.ts')))

assert.equal(CURRENT_SCHEMA_VERSION, 3)
assert.equal(MIGRATIONS.length, 2)
assert.equal(MIGRATIONS[0].from, 1)
assert.equal(MIGRATIONS[0].to, 2)

const legacyProvenance = Object.freeze({
  requestNodeId: 'req-1',
  variant: 'image',
})

const fullProvenance = Object.freeze({
  requestNodeId: 'req-1',
  variant: 'video',
  runId: 'run-1',
  taskId: 'task-1',
  channelId: 'ch-1',
  providerId: 'provider-1',
  model: 'demo-model',
  inputReferenceIds: ['ref-1'],
  inputAssetIds: ['asset-1'],
  inputNodeIds: ['node-1'],
  createdAt: 1710000000000,
})

function flowPayload(overrides = {}) {
  return {
    id: 'flow-1',
    name: 'demo',
    title: 'demo',
    extraPayload: true,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'req-1',
        kind: 'request',
        extraNode: 1,
        resultNodeIds: { image: 'img-1', video: 'vid-1' },
      },
      {
        id: 'content-1',
        kind: 'content',
        generatedBy: legacyProvenance,
      },
      {
        id: 'content-2',
        kind: 'content',
        generatedBy: fullProvenance,
      },
    ],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function envelope(schemaVersion, overrides = {}) {
  const { payload, ...rest } = overrides
  return {
    schemaVersion,
    kind: 'flow',
    leftover: 'keep',
    payload: payload ?? flowPayload(),
    ...rest,
  }
}

const current = envelope(3, {
  payload: {
    id: 'partial',
    name: 'Partial flow',
    unknown: true,
    nodes: [{ id: 'req-1', kind: 'request', resultNodeIds: { image: 'still-a-string' } }],
  },
})
const currentResult = migrateDocument(current)
assert.equal(currentResult, current)
assert.equal(currentResult.payload.nodes[0].resultNodeIds.image, 'still-a-string')
assert.equal(currentResult.migratedFrom, undefined)

for (const version of [1, 2, 3]) {
  for (const name of [undefined, null, 42, {}, '', '   ']) {
    for (const title of ['Recovered title', undefined, null, 42, '', '   ']) {
      const source = envelope(version, { payload: flowPayload({ name, title }) })
      const normalized = migrateDocument(source)
      assert.equal(normalized.payload.name, title === 'Recovered title' ? title : '未命名画布')
      assert.equal(source.payload.name, name)
      assert.equal(normalized.payload.title, title)
      assert.equal(normalized.payload.id, source.payload.id)
      assert.equal(normalized.payload.edges, source.payload.edges)
      assert.equal(normalized.payload.viewport, source.payload.viewport)
      assert.equal(normalized.payload.nodes[1], source.payload.nodes[1])
      assert.equal(migrateDocument(normalized), normalized)
      assert.doesNotThrow(() => normalized.payload.name.toLowerCase())
    }
  }
  const named = migrateDocument(envelope(version, { payload: flowPayload({ name: '  Keep my name  ', title: 'Other title' }) }))
  assert.equal(named.payload.name, '  Keep my name  ')
}

const v1 = envelope(1)
const requestNode = v1.payload.nodes[0]
const contentNode = v1.payload.nodes[1]
const generatedContent = v1.payload.nodes[2]
const migrated = migrateDocument(v1)

assert.notEqual(migrated, v1)
assert.equal(migrated.schemaVersion, 3)
assert.equal(migrated.kind, 'flow')
assert.equal(migrated.leftover, 'keep')
assert.equal(migrated.payload.extraPayload, true)
assert.deepEqual(migrated.migratedFrom, ['schema:1', 'schema:2'])
assert.equal(migrated.payload.nodes[0].video.autoAdaptImages, false)
assert.deepEqual(migrated.payload.nodes[0].resultNodeIds, { image: ['img-1'], video: ['vid-1'] })
assert.equal(migrated.payload.nodes[0].extraNode, 1)
assert.equal(migrated.payload.nodes[0].id, requestNode.id)
assert.equal(migrated.payload.nodes[1], contentNode)
assert.equal(migrated.payload.nodes[1].generatedBy, legacyProvenance)
assert.deepEqual(migrated.payload.nodes[1].generatedBy, { requestNodeId: 'req-1', variant: 'image' })
assert.equal(migrated.payload.nodes[2], generatedContent)
assert.equal(migrated.payload.nodes[2].generatedBy, fullProvenance)
assert.deepEqual(migrated.payload.nodes[2].generatedBy, fullProvenance)
assert.equal('sessions' in migrated.payload, false)
assert.equal('runs' in migrated.payload, false)
assert.equal('assets' in migrated.payload, false)
assert.equal('captures' in migrated.payload, false)

const arraySource = envelope(1, {
  migratedFrom: ['legacy:zip', 'schema:1', 'legacy:zip', 12],
  payload: flowPayload({
    nodes: [
      {
        id: 'req-2',
        kind: 'request',
        resultNodeIds: {
          image: ['img-1', '', 'img-1', 'img-2'],
          video: ['', 'vid-1', 'vid-1'],
          other: 'leave',
        },
      },
      {
        id: 'sticky-1',
        kind: 'sticky',
        content: 'note',
      },
    ],
  }),
})
const sticky = arraySource.payload.nodes[1]
const arrayMigrated = migrateDocument(arraySource)
assert.deepEqual(arrayMigrated.payload.nodes[0].resultNodeIds, {
  image: ['img-1', 'img-2'],
  video: ['vid-1'],
  other: 'leave',
})
assert.equal(arrayMigrated.payload.nodes[1], sticky)
assert.deepEqual(arrayMigrated.migratedFrom, ['legacy:zip', 'schema:1', 'schema:2'])

assert.throws(
  () => migrateDocument({ schemaVersion: 0, kind: 'flow', payload: {} }),
  /missing migration|broken migration chain/,
)
assert.throws(
  () => migrateDocument({ schemaVersion: 4, kind: 'flow', payload: {} }),
  /ahead/,
)
assert.throws(
  () => migrateDocument({ schemaVersion: 2, kind: 'note', payload: {} }),
  /invalid document/,
)
assert.throws(
  () => migrateDocument({ schemaVersion: 1, kind: 'flow', payload: null }),
  /invalid document/,
)
assert.throws(
  () => migrateDocument({ kind: 'flow', payload: {} }),
  /legacy document without schema envelope is not supported yet/,
)
assert.throws(() => migrateDocument(null), /invalid document/)
assert.throws(() => migrateDocument('flow'), /invalid document/)

console.log('schema migration chain: PASS')
