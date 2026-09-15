/**
 * Versioned document envelope and migration table skeleton.
 *
 * Migration bodies are intentionally unimplemented in this phase.
 * Bump `CURRENT_SCHEMA_VERSION` when `FlowDocument` shape changes, and
 * append a contiguous `Migration` to `MIGRATIONS`.
 */

import type { FlowDocument } from './graph'

export const CURRENT_SCHEMA_VERSION = 1

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
export const MIGRATIONS: readonly Migration[] = []

export function migrateDocument(input: unknown): CnoteDocument {
  if (input === null || typeof input !== 'object') {
    throw new Error('invalid document')
  }

  const schemaVersion = (input as { schemaVersion?: unknown }).schemaVersion

  if (typeof schemaVersion === 'number' && schemaVersion === CURRENT_SCHEMA_VERSION) {
    return input as CnoteDocument
  }

  if (typeof schemaVersion === 'number' && schemaVersion < CURRENT_SCHEMA_VERSION) {
    let current: unknown = input
    for (const migration of MIGRATIONS) {
      if (migration.from >= schemaVersion) {
        current = migration.up(current)
      }
    }
    if (!isCnoteDocumentShape(current)) {
      throw new Error('migration produced invalid document')
    }
    return current
  }

  if (schemaVersion === undefined) {
    throw new Error('legacy document without schema envelope is not supported yet')
  }

  throw new Error('invalid document')
}

function isCnoteDocumentShape(value: unknown): value is CnoteDocument {
  if (value === null || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return typeof doc.schemaVersion === 'number' && doc.kind === 'flow' && doc.payload != null
}
