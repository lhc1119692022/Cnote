/**
 * Versioned document envelope and forward-only migration chain.
 *
 * Bump `CURRENT_SCHEMA_VERSION` when `FlowDocument` shape changes, and
 * append a contiguous `Migration` to `MIGRATIONS`.
 */

import type { FlowDocument } from './graph'

export const CURRENT_SCHEMA_VERSION = 3

export interface CnoteDocument {
  schemaVersion: number
  kind: 'flow'
  payload: FlowDocument
  migratedFrom?: string[]
}

export interface Migration {
  from: number
  to: number
  up: (input: unknown) => unknown
}

/**
 * Forward-only migration chain.
 * Invariant: `MIGRATIONS[n].to === MIGRATIONS[n + 1].from`, and the last
 * `to` equals `CURRENT_SCHEMA_VERSION`.
 */
export const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, up: migrateV1ToV2 },
  { from: 2, to: 3, up: migrateV2ToV3 },
]

export function migrateDocument(input: unknown): CnoteDocument {
  if (input === null || typeof input !== 'object') {
    throw new Error('invalid document')
  }

  const document = input as Record<string, unknown>
  const schemaVersion = document.schemaVersion

  if (schemaVersion === undefined) {
    throw new Error('legacy document without schema envelope is not supported yet')
  }

  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    throw new Error('invalid document')
  }

  assertBasicEnvelope(document)

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    return normalizeDocumentName(input as CnoteDocument)
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('document schema version is ahead of runtime')
  }

  assertMigrationTable()

  let current: unknown = input
  let version = schemaVersion

  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = migrationFrom(version)
    if (migration.to <= migration.from) {
      throw new Error('migration did not advance version')
    }
    if (migration.to > CURRENT_SCHEMA_VERSION) {
      throw new Error('migration target version is ahead of runtime')
    }

    current = migration.up(current)
    if (!isCnoteDocumentShape(current)) {
      throw new Error('migration produced invalid document')
    }

    const nextVersion = current.schemaVersion
    if (typeof nextVersion !== 'number' || nextVersion !== migration.to || nextVersion <= version) {
      throw new Error('migration did not advance version')
    }

    current = withMigratedFrom(current, version)
    if (!isCnoteDocumentShape(current)) {
      throw new Error('migration produced invalid document')
    }
    version = current.schemaVersion
  }

  if (!isCnoteDocumentShape(current)) {
    throw new Error('migration produced invalid document')
  }
  return normalizeDocumentName(current)
}

function normalizeDocumentName(document: CnoteDocument): CnoteDocument {
  const payload = document.payload
  if (typeof payload.name === 'string' && payload.name.trim()) return document
  const title = (payload as unknown as Record<string, unknown>).title
  const name = typeof title === 'string' && title.trim() ? title : '未命名画布'
  return { ...document, payload: { ...payload, name } }
}

function migrateV2ToV3(input: unknown): unknown {
  const document = input as CnoteDocument
  return {
    ...document,
    schemaVersion: 3,
    payload: {
      ...document.payload,
      nodes: document.payload.nodes.map((node) => node.kind === 'request' ? {
        ...node,
        video: { ...node.video, autoAdaptImages: node.video?.autoAdaptImages ?? false },
      } : node),
    },
  }
}

function migrateV1ToV2(input: unknown): unknown {
  if (!isRecord(input)) {
    throw new Error('invalid document')
  }
  assertBasicEnvelope(input)

  const payload = input.payload
  if (!isRecord(payload)) {
    throw new Error('invalid document')
  }

  const nodes = payload.nodes
  if (!Array.isArray(nodes)) {
    return {
      ...input,
      schemaVersion: 2,
    }
  }

  let changed = false
  const nextNodes = nodes.map((node) => {
    const nextNode = normalizeRequestResultNodeIds(node)
    if (nextNode !== node) changed = true
    return nextNode
  })

  return {
    ...input,
    schemaVersion: 2,
    payload: changed ? { ...payload, nodes: nextNodes } : payload,
  }
}

function normalizeRequestResultNodeIds(node: unknown): unknown {
  if (!isRecord(node) || node.kind !== 'request' || !isRecord(node.resultNodeIds)) {
    return node
  }

  const resultNodeIds = node.resultNodeIds
  const nextResultNodeIds: Record<string, unknown> = { ...resultNodeIds }
  let changed = false

  for (const key of ['image', 'video'] as const) {
    if (!Object.prototype.hasOwnProperty.call(resultNodeIds, key)) continue
    const current = resultNodeIds[key]
    const normalized = normalizeResultNodeIdList(current)
    if (!sameResultNodeIdList(current, normalized)) {
      nextResultNodeIds[key] = normalized
      changed = true
    }
  }

  if (!changed) return node
  return {
    ...node,
    resultNodeIds: nextResultNodeIds,
  }
}

function normalizeResultNodeIdList(value: unknown): unknown {
  if (typeof value === 'string') {
    return value === '' ? [] : [value]
  }
  if (!Array.isArray(value)) return value

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function sameResultNodeIdList(current: unknown, normalized: unknown): boolean {
  if (current === normalized) return true
  if (!Array.isArray(current) || !Array.isArray(normalized)) return false
  if (current.length !== normalized.length) return false
  return current.every((item, index) => item === normalized[index])
}

function withMigratedFrom(document: CnoteDocument, fromVersion: number): CnoteDocument {
  const tag = `schema:${fromVersion}`
  const previous = Array.isArray(document.migratedFrom) ? document.migratedFrom : []
  const migratedFrom = appendUniqueStrings(previous, tag)
  const unchanged =
    Array.isArray(document.migratedFrom)
    && document.migratedFrom.length === migratedFrom.length
    && document.migratedFrom.every((item, index) => item === migratedFrom[index])
  if (unchanged) return document
  return {
    ...document,
    migratedFrom,
  }
}

function appendUniqueStrings(values: unknown[], tag: string): string[] {
  const result: string[] = []
  for (const value of values) {
    if (typeof value === 'string' && !result.includes(value)) {
      result.push(value)
    }
  }
  if (!result.includes(tag)) result.push(tag)
  return result
}

function migrationFrom(version: number): Migration {
  const matches = MIGRATIONS.filter((step) => step.from === version)
  if (matches.length === 0) {
    throw new Error(`missing migration from schema version ${version}`)
  }
  if (matches.length !== 1) {
    throw new Error('broken migration chain')
  }
  return matches[0]
}

function assertMigrationTable(): void {
  if (MIGRATIONS.length === 0) {
    throw new Error('missing migration from schema version 1')
  }

  for (let index = 0; index < MIGRATIONS.length; index += 1) {
    const step = MIGRATIONS[index]
    if (step.to <= step.from) {
      throw new Error('migration did not advance version')
    }
    if (index > 0 && MIGRATIONS[index - 1].to !== step.from) {
      throw new Error('broken migration chain')
    }
  }

  const last = MIGRATIONS[MIGRATIONS.length - 1]
  if (last.to !== CURRENT_SCHEMA_VERSION) {
    throw new Error('broken migration chain')
  }
}

function assertBasicEnvelope(document: Record<string, unknown>): void {
  if (document.kind !== 'flow' || !isRecord(document.payload)) {
    throw new Error('invalid document')
  }
}

function isCnoteDocumentShape(value: unknown): value is CnoteDocument {
  if (!isRecord(value)) return false
  return typeof value.schemaVersion === 'number' && value.kind === 'flow' && isRecord(value.payload)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
