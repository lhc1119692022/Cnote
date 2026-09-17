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

/** Runtime entities are stored per id; the manifest only lists those ids. */
export const RUNTIME_MANIFEST_KEY = 'runtime:manifest'
export const RUNTIME_SESSION_PREFIX = 'runtime:session:'
export const RUNTIME_CAPTURE_PREFIX = 'runtime:capture:'
export const RUNTIME_ASSET_PREFIX = 'runtime:asset:'
export const RUNTIME_AI_SESSION_PREFIX = 'runtime:ai-session:'
export const RUNTIME_RUN_PREFIX = 'runtime:run:'

export function runtimeSessionKey(id: string): string {
  return `${RUNTIME_SESSION_PREFIX}${id}`
}

export function runtimeCaptureKey(id: string): string {
  return `${RUNTIME_CAPTURE_PREFIX}${id}`
}

export function runtimeAssetKey(id: string): string {
  return `${RUNTIME_ASSET_PREFIX}${id}`
}

export function runtimeAiSessionKey(id: string): string {
  return `${RUNTIME_AI_SESSION_PREFIX}${id}`
}

export function runtimeRunKey(id: string): string {
  return `${RUNTIME_RUN_PREFIX}${id}`
}

export interface RuntimeManifest {
  sessionIds: string[]
  captureIds: string[]
  assetIds: string[]
  aiSessionIds: string[]
  runIds: string[]
}
