/**
 * Storage key namespaces for flow documents and their list index.
 * Must not overlap resource-storage prefixes (`resource:` / `resource-meta:`).
 */

export const DOC_PREFIX = 'doc:flow:'
export const META_PREFIX = 'meta:flow:'

/** Homepage flow-id list; reserved so it cannot collide with a nanoid document id. */
export const FLOW_LIST_INDEX_KEY = `${META_PREFIX}__list__`

export function docKey(id: string): string {
  return `${DOC_PREFIX}${id}`
}

export function docMetaKey(id: string): string {
  return `${META_PREFIX}${id}`
}

export interface FlowListIndex {
  ids: string[]
}
