/**
 * Per-document persistence for FlowDocument envelopes.
 * Writes go through a serial queue so the list index cannot tear.
 */

import {
  CURRENT_SCHEMA_VERSION,
  migrateDocument,
  type CnoteDocument,
  type FlowDocument,
} from '@/domain'
import localforage from '@/lib/localforage-storage'
import {
  FLOW_LIST_INDEX_KEY,
  docKey,
  type FlowListIndex,
} from './keys'

/** Serializes save/delete/append/remove so index + document writes cannot interleave. */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation)
  writeQueue = next.catch(() => undefined)
  return next
}

function parseFlowListIndex(raw: unknown): FlowListIndex {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return { ids: [] }
    }
  }
  if (value === null || typeof value !== 'object' || !('ids' in value)) {
    return { ids: [] }
  }
  const ids = (value as { ids: unknown }).ids
  if (!Array.isArray(ids)) return { ids: [] }
  return { ids: ids.filter((id): id is string => typeof id === 'string') }
}

async function readListIndex(): Promise<FlowListIndex> {
  const raw = await localforage.getItem<unknown>(FLOW_LIST_INDEX_KEY)
  if (raw == null) return { ids: [] }
  return parseFlowListIndex(raw)
}

async function writeListIndex(index: FlowListIndex): Promise<void> {
  await localforage.setItem(FLOW_LIST_INDEX_KEY, JSON.stringify(index))
}

export async function saveDocument(doc: FlowDocument): Promise<void> {
  return enqueueWrite(async () => {
    const envelope: CnoteDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'flow',
      payload: doc,
    }
    await localforage.setItem(docKey(doc.id), JSON.stringify(envelope))
  })
}

/**
 * Atomically persist a new document envelope and append its id to the list
 * index. Index write failure rolls back the envelope so the two cannot diverge.
 */
export async function createDocument(doc: FlowDocument): Promise<void> {
  return enqueueWrite(async () => {
    const envelope: CnoteDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'flow',
      payload: doc,
    }
    const key = docKey(doc.id)
    await localforage.setItem(key, JSON.stringify(envelope))
    try {
      const index = await readListIndex()
      if (!index.ids.includes(doc.id)) {
        await writeListIndex({ ids: [...index.ids, doc.id] })
      }
    } catch (error) {
      await localforage.removeItem(key)
      throw error
    }
  })
}

export type LoadDocumentResult =
  | { ok: true; doc: FlowDocument }
  | { ok: false; reason: 'missing' | 'corrupt' | 'migration-failed' }

export async function loadDocument(id: string): Promise<LoadDocumentResult> {
  const raw = await localforage.getItem<unknown>(docKey(id))
  if (raw == null) return { ok: false, reason: 'missing' }
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
  try {
    return { ok: true, doc: migrateDocument(parsed).payload }
  } catch {
    return { ok: false, reason: 'migration-failed' }
  }
}

export async function deleteDocument(id: string): Promise<void> {
  return enqueueWrite(async () => {
    await localforage.removeItem(docKey(id))
  })
}

export async function listDocuments(): Promise<FlowDocument[]> {
  const index = await readListIndex()
  if (index.ids.length === 0) return []
  const results = await Promise.all(index.ids.map((id) => loadDocument(id)))
  return results.flatMap((result) => (result.ok ? [result.doc] : []))
}

export async function appendDocumentIndex(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const index = await readListIndex()
    if (index.ids.includes(id)) return
    await writeListIndex({ ids: [...index.ids, id] })
  })
}

export async function removeDocumentIndex(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const index = await readListIndex()
    const ids = index.ids.filter((existing) => existing !== id)
    if (ids.length === index.ids.length) return
    await writeListIndex({ ids })
  })
}
