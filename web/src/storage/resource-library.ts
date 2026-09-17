import storage, { ensureResourcePolicy } from '@/lib/localforage-storage'
import { loadDocument, saveDocument, deleteDocument, removeDocumentIndex } from './graph-store'
import { flushOpenGraphIfAny, cancelScheduledGraphPersist } from './graph-session'
import { hydrateRuntimeStore, flushRuntimePersistence } from './runtime-persistence'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useSourceStore } from '@/stores/use-source-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { getLocalResourceMeta, purgeLocalResource } from '@/lib/resource-storage'
import { RESOURCE_POLICY_KEY, currentResourcePolicy, identityAliases, resourceReferences, scrubResources, thumbnailKey } from './resource-policy'
import { GALLERY_PREFIX, indexGalleryDocument, mergeGalleryEntries, type GalleryDocumentIndex } from './gallery-index'

const ORPHANS_KEY = 'cnote:resource-orphans:v1'
const FAVORITES_KEY = 'cnote:gallery-favorites:v1'
const RETENTION = 7 * 24 * 60 * 60 * 1000
let operations: Promise<unknown> = Promise.resolve()
function exclusive<T>(run: () => Promise<T>) {
  const result = operations.then(run)
  operations = result.catch(() => undefined)
  return result
}
async function readJson<T>(key: string, fallback: T): Promise<T> {
  const value = await storage.getItem<unknown>(key)
  return value == null ? fallback : typeof value === 'string' ? JSON.parse(value) as T : value as T
}
async function writePolicy(value: ReturnType<typeof currentResourcePolicy>) {
  await storage.setItem(RESOURCE_POLICY_KEY, JSON.stringify(value))
}
function assertIdle() {
  if (Object.values(useRuntimeStore.getState().runs).some(run => !['completed', 'failed', 'cancelled'].includes(run.status))) throw new Error('请先完成或放弃待继续的生成任务，再清理资源。')
}
async function prepare() {
  await ensureResourcePolicy()
  await hydrateRuntimeStore()
  await Promise.all([useSourceStore.persist.rehydrate(), useTemplateStore.persist.rehydrate()])
  await flushOpenGraphIfAny()
  await flushRuntimePersistence()
}
async function documentIds() {
  const keys = await storage.keys()
  return keys.filter(key => key.startsWith('doc:flow:') && !currentResourcePolicy().deletedFlows.includes(key.slice(9))).map(key => key.slice(9))
}
export async function loadGallery() {
  await prepare()
  const ids = await documentIds()
  const indices: GalleryDocumentIndex[] = []
  for (const id of ids) {
    let index = await readJson<GalleryDocumentIndex | null>(GALLERY_PREFIX + id, null).catch(() => null)
    if (!index || index.version !== 1 || index.flowId !== id || !Array.isArray(index.entries) || await storage.getItem('gallery-dirty:' + id)) {
      const loaded = await loadDocument(id)
      if (!loaded.ok) throw new Error('无法读取画布 ' + id + '，请先恢复数据')
      index = indexGalleryDocument(loaded.doc)
      await storage.setItem(GALLERY_PREFIX + id, JSON.stringify(index))
      await storage.removeItem('gallery-dirty:' + id)
    }
    indices.push(index)
  }
  return mergeGalleryEntries(indices)
}
export async function galleryFavorites(): Promise<string[]> { return readJson(FAVORITES_KEY, []) }
export async function setGalleryFavorite(id: string, favorite: boolean) {
  return exclusive(async () => {
    const items = new Set(await galleryFavorites())
    if (favorite) items.add(id); else items.delete(id)
    await storage.setItem(FAVORITES_KEY, JSON.stringify([...items]))
  })
}
export async function resourceImpact(identity: string) {
  await prepare()
  const flows: { id: string; name: string; nodes: number }[] = []
  for (const id of await documentIds()) {
    const loaded = await loadDocument(id)
    if (!loaded.ok) throw new Error('画布无法读取，停止清理：' + id)
    const nodes = loaded.doc.nodes.filter(node => resourceReferences(node).has(identity)).length
    if (nodes) flows.push({ id, name: loaded.doc.name, nodes })
  }
  return { flows, sources: useSourceStore.getState().sources.filter(source => resourceReferences(source).has(identity)).length, templates: useTemplateStore.getState().templates.filter(template => resourceReferences(template).has(identity)).length }
}
async function sweepDeleted() {
  cancelScheduledGraphPersist()
  const graph = useGraphStore.getState()
  if (graph.currentDocument) {
    if (currentResourcePolicy().deletedFlows.includes(graph.currentDocument.id)) graph.closeDocument()
    else {
      const currentDocument = scrubResources(graph.currentDocument)
      const history = graph.history.map(snapshot => scrubResources(snapshot))
      useGraphStore.setState({ currentDocument, history, selection: graph.selection.filter(id => currentDocument.nodes.some(node => node.id === id)) })
    }
  }
  const runtime = useRuntimeStore.getState()
  const retired = new Set(currentResourcePolicy().pendingFlowNodes || [])
  const runs = Object.fromEntries(Object.entries(runtime.runs).filter(([, run]) => !run.requestNodeId || !retired.has(run.requestNodeId)))
  const aiSessions = Object.fromEntries(Object.entries(runtime.aiSessions).filter(([, session]) => !session.nodeId || !retired.has(session.nodeId)))
  useRuntimeStore.setState({ runs: scrubResources(runs), assets: scrubResources(runtime.assets), captures: scrubResources(runtime.captures), aiSessions: scrubResources(aiSessions) })
  useSourceStore.setState({ sources: scrubResources(useSourceStore.getState().sources) })
  useTemplateStore.setState({ templates: scrubResources(useTemplateStore.getState().templates) })
  for (const id of currentResourcePolicy().pendingFlows || []) {
    await deleteDocument(id)
    await removeDocumentIndex(id)
    await storage.removeItem(GALLERY_PREFIX + id)
    await storage.removeItem('gallery-dirty:' + id)
  }
  for (const id of await documentIds()) {
    const loaded = await loadDocument(id)
    if (!loaded.ok) throw new Error('无法读取画布，清理暂未完成：' + id)
    await saveDocument(scrubResources(loaded.doc))
  }
  const records = await storage.keys()
  for (const key of records.filter(key => /^(runtime:|cnote-sources|cnote-templates|flows)/.test(key))) {
    const value = await readJson<unknown>(key, null)
    await storage.setItem(key, JSON.stringify(scrubResources(value) ?? null))
  }
  await flushRuntimePersistence()
  for (const identity of currentResourcePolicy().pending) {
    if (identity.startsWith('sha256-')) {
      await purgeLocalResource(identity)
      await window.cnoteDesktop?.system.removeManagedResource(identity)
    }
    await storage.removeItem(await thumbnailKey(identity))
  }

  await writePolicy({ ...currentResourcePolicy(), pending: [], pendingFlows: [], pendingFlowNodes: [] })
  window.dispatchEvent(new Event('cnote-gallery-updated'))
}
export async function removeResourceFromFlow(flowId: string, identity: string) {
  return exclusive(async () => {
    await prepare()
    assertIdle()
    const loaded = await loadDocument(flowId)
    if (!loaded.ok) throw new Error('画布无法读取')
    const next = { ...scrubResources(loaded.doc, [identity]), updatedAt: Date.now() }
    await saveDocument(next)
    if (useGraphStore.getState().currentDocumentId === flowId) {
      useGraphStore.setState({ currentDocument: next, selection: [] })
      useGraphStore.getState().commitHistory()
    }
  })
}
export async function permanentlyDeleteResource(identity: string) {
  return exclusive(async () => {
    await prepare()
    assertIdle()
    const aliases = new Set(identityAliases(identity))
    for (const id of await documentIds()) {
      const loaded = await loadDocument(id)
      if (!loaded.ok) throw new Error('无法读取画布，未执行删除')
      for (const node of loaded.doc.nodes) if (node.kind === 'content' && node.payload && (node.payload.kind === 'image' || node.payload.kind === 'video')) {
        for (const item of node.payload.resources || []) if (item.resource.resourceId === identity && /^https?:/.test(item.resource.url)) aliases.add(item.resource.url)
      }
    }
    const previous = currentResourcePolicy()
    await writePolicy({ ...previous, deleted: [...new Set([...previous.deleted, ...aliases])], pending: [...new Set([...previous.pending, identity])] })
    await sweepDeleted()
  })
}
export async function deleteFlowWithResources(id: string) {
  return exclusive(async () => {
    await prepare()
    const loaded = await loadDocument(id)
    if (!loaded.ok) throw new Error('画布无法读取，未执行删除')
    const runtime = useRuntimeStore.getState()
    const nodeIds = new Set(loaded.doc.nodes.map(node => node.id))
    const runs = Object.values(runtime.runs).filter(run => run.requestNodeId && nodeIds.has(run.requestNodeId))
    if (runs.some(run => !['completed', 'failed', 'cancelled'].includes(run.status))) throw new Error('该画布有未结束的生成任务，请先完成或放弃任务')
    await writePolicy({ ...currentResourcePolicy(), deletedFlows: [...new Set([...currentResourcePolicy().deletedFlows, id])], pendingFlowNodes: [...new Set([...(currentResourcePolicy().pendingFlowNodes || []), ...nodeIds])], pendingFlows: [...new Set([...(currentResourcePolicy().pendingFlows || []), id])] })
    for (const run of runs) runtime.removeRun(run.id)
    for (const session of Object.values(runtime.aiSessions)) if (session.nodeId && nodeIds.has(session.nodeId)) runtime.removeAISession(session.id)
    const remainingCaptures = new Set<string>()
    for (const flowId of await documentIds()) {
      const other = await loadDocument(flowId)
      if (!other.ok) throw new Error('无法核对其他画布，清理暂缓')
      for (const node of other.doc.nodes) if (node.kind === 'content' && node.captureId) remainingCaptures.add(node.captureId)
    }
    for (const node of loaded.doc.nodes) if (node.kind === 'content' && node.captureId && !remainingCaptures.has(node.captureId)) runtime.removeCapture(node.captureId)
    await sweepDeleted()
    await collectUnusedResourcesInternal().catch(() => undefined)
  })
}
async function collectUnusedResourcesInternal() {
  if ((window.location.hash || window.location.pathname).includes('/flows/')) throw new Error('编辑画布期间不进行资源回收，请返回设置页面清理')
  await prepare()
  assertIdle()
  const before = { graph: useGraphStore.getState(), runtime: useRuntimeStore.getState(), sources: useSourceStore.getState().sources, templates: useTemplateStore.getState().templates, route: window.location.href }
  const assertUnchanged = () => {
    if (useGraphStore.getState() !== before.graph || useRuntimeStore.getState() !== before.runtime || useSourceStore.getState().sources !== before.sources || useTemplateStore.getState().templates !== before.templates || window.location.href !== before.route) throw new Error('使用状态发生变化，本轮回收暂缓')
  }
  const references = new Set<string>()
  for (const id of await documentIds()) {
    const loaded = await loadDocument(id)
    if (!loaded.ok) throw new Error('存在无法读取的画布，停止回收：' + id)
    resourceReferences(loaded.doc, references)
  }
  const records = await storage.keys()
  for (const key of records.filter(key => /^(doc:flow:|runtime:ai-session:|runtime:capture:|cnote-sources|cnote-templates|flows)/.test(key))) {
    if (key.startsWith('doc:flow:') && currentResourcePolicy().deletedFlows.includes(key.slice(9))) continue
    resourceReferences(await readJson(key, null), references)
  }
  const graph = useGraphStore.getState()
  resourceReferences(graph.currentDocument, references)
  resourceReferences(graph.history, references)
  resourceReferences(useSourceStore.getState().sources, references)
  resourceReferences(useTemplateStore.getState().templates, references)
  const runtime = useRuntimeStore.getState()
  resourceReferences(runtime.aiSessions, references)
  resourceReferences(runtime.captures, references)
  const known = await readJson<Record<string, number>>(ORPHANS_KEY, {})
  const next: Record<string, number> = {}
  let bytes = 0
  const eligible: string[] = []
  const now = Date.now()

  for (const key of records.filter(key => key.startsWith('resource-meta:'))) {
    const identity = key.slice('resource-meta:'.length)
    const meta = await getLocalResourceMeta(identity)
    if (!meta || references.has(identity)) continue
    const since = known[identity] || now
    next[identity] = since
    bytes += meta.size
    if (now - since < RETENTION || now - meta.createdAt < RETENTION) continue
    eligible.push(identity)
  }
  assertUnchanged()
  await storage.setItem(ORPHANS_KEY, JSON.stringify(next))
  if (eligible.length) {
    assertUnchanged()
    const previous = currentResourcePolicy()
    await writePolicy({ ...previous, deleted: [...new Set([...previous.deleted, ...eligible.flatMap(identityAliases)])], pending: [...new Set([...previous.pending, ...eligible])] })
    await sweepDeleted()
  }
  return { pending: Object.keys(next).length - eligible.length, bytes, removed: eligible.length, retentionDays: 7 }
}
export function collectUnusedResources() { return exclusive(collectUnusedResourcesInternal) }
export async function resumeResourceCleanup() {
  await ensureResourcePolicy()
  if (currentResourcePolicy().pending.length || currentResourcePolicy().pendingFlows?.length) await exclusive(async () => { await prepare(); assertIdle(); await sweepDeleted() })
}
