import { resolveRHInputs } from './inputs'
import type { ContentNodeSpec, GenerationRun, GenerationTask, RequestNodeSpec } from '@/domain'
import type { GenerationReference } from '@/types/flow'
import { useGraphStore } from '@/stores/graph-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { useGenerationStore } from '@/stores/use-generation-store'
import { AssetManager } from '@/runtime/asset-manager'
import { desktopFetch } from '@/lib/desktop-fetch'
import { flushRuntimePersistence } from '@/storage/runtime-persistence'
import { loadReferenceForInspection } from '@/lib/generation/media-inspection'
import { collectUpstreamNodes, collectUpstreamReferences, localReferencesFromAssetIds, mergeGenerationReferences, generationInputProvenanceIds } from '@/canvas/contents/request-generation'
import { CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { resourceIdForAsset } from '@/storage/asset-store'
import { safeGenerationError } from '@/lib/generation/safe-error'
import { assertWorkflowBindings, runningHubClient, type RHResult } from './client'
import { buildOverrides, type RHRunSnapshot } from './workflow'

const active = new Map<string, AbortController>()
const manager = new AssetManager()

export function runningHubReferences(node: RequestNodeSpec): GenerationReference[] {
  const document = useGraphStore.getState().currentDocument
  const runtime = useRuntimeStore.getState()
  if (!document) return []
  return mergeGenerationReferences(
    localReferencesFromAssetIds('video', node.rh?.referenceAssetIds.filter(id => Object.values(node.rh?.selections[node.rh?.workflowKey || '']?.bindings || {}).includes(id)), runtime.assets),
    collectUpstreamReferences('video', collectUpstreamNodes(node.id, document.nodes, document.edges), document.nodes, runtime.assets, runtime.runs),
    undefined,
  )
}

function currentRun(id: string): GenerationRun {
  const run = useRuntimeStore.getState().runs[id]
  if (!run) throw new Error('任务记录已移除')
  return run
}

async function update(id: string, status: GenerationRun['status'], patch: Partial<GenerationTask> = {}, snapshotPatch: Partial<RHRunSnapshot> = {}) {
  const run = currentRun(id)
  const task = run.tasks[0]
  useRuntimeStore.getState().putRun({ ...run, status, tasks: [{ ...task, ...patch, rhSnapshot: { ...task.rhSnapshot!, ...snapshotPatch } }] })
  await flushRuntimePersistence()
}

function mimeFor(result: RHResult, blob: Blob): string {
  if (blob.type && blob.type !== 'application/octet-stream') return blob.type
  const extensions: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', pdf: 'application/pdf' }
  return extensions[result.outputType.toLowerCase()] || 'application/octet-stream'
}

function materialize(run: GenerationRun): void {
  const task = run.tasks[0]
  const snapshot = task.rhSnapshot!
  const document = useGraphStore.getState().currentDocument
  if (!document || document.id !== snapshot.documentId) return
  const request = document.nodes.find(node => node.id === run.requestNodeId)
  if (!request || request.kind !== 'request' || request.latestRunId !== run.id) return
  const runtime = useRuntimeStore.getState()
  const additions: ContentNodeSpec[] = []
  for (const [index, assetId] of (task.resultAssetIds || []).entries()) {
    if (document.nodes.some(node => node.kind === 'content' && node.generatedBy?.runId === run.id && node.assetId === assetId)) continue
    const asset = runtime.assets[assetId]
    if (!asset) continue
    const type = asset.mimeType.startsWith('image/') ? 'image' : asset.mimeType.startsWith('video/') ? 'video' : asset.mimeType.startsWith('audio/') ? 'audio' : 'document'
    const fileName = `${snapshot.selection.workflow.name}-${index + 1}`
    const resource = { resourceId: resourceIdForAsset(assetId), mimeType: asset.mimeType, url: '', fileName }
    additions.push({
      id: crypto.randomUUID(), kind: 'content', label: fileName,
      position: { x: request.position.x + request.size.width + 88, y: request.position.y + index * (CONTENT_NODE_DEFAULT_SIZE.height + 24) },
      size: { ...CONTENT_NODE_DEFAULT_SIZE }, category: type, subtype: type === 'image' ? 'image' : type === 'video' ? 'local-video' : type === 'audio' ? 'podcast' : 'unknown',
      assetId, source: { kind: 'file', assetId, mimeType: asset.mimeType, fileName }, state: 'ready',
      ...(type === 'image' ? { payload: { kind: 'image' as const, resources: [{ resource, label: fileName }], activeResourceIndex: 0 } } : {}),
      ...(type === 'video' ? { payload: { kind: 'video' as const, provider: 'direct' as const, playback: 'video' as const, resources: [{ resource, label: fileName }], activeResourceIndex: 0 } } : {}),
      generatedBy: { requestNodeId: request.id, variant: 'workflow', runId: run.id, taskId: task.remoteTaskId, channelId: snapshot.channelId, providerId: 'runninghub', model: snapshot.selection.workflow.workflowId, inputReferenceIds: snapshot.inputReferenceIds, inputAssetIds: snapshot.inputAssetIds, createdAt: Date.now() },
    })
  }
  if (!additions.length) return
  useGraphStore.setState({ currentDocument: { ...document, updatedAt: Date.now(), nodes: [...document.nodes, ...additions], edges: [...document.edges, ...additions.map(node => ({ id: crypto.randomUUID(), source: request.id, target: node.id, sourceHandle: 'out', targetHandle: 'in' }))] } })
  useGraphStore.getState().commitHistory()
}

async function wait(signal: AbortSignal, milliseconds: number): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已停止查询', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function executeRunningHub(nodeId: string, resumeRunId?: string): Promise<void> {
  if (active.has(nodeId)) return
  const document = useGraphStore.getState().currentDocument
  const node = document?.nodes.find(item => item.id === nodeId)
  if (!document || !node || node.kind !== 'request' || node.variant !== 'workflow' || node.disabled) throw new Error('RH 节点不可运行')
  const existing = resumeRunId ? currentRun(resumeRunId) : undefined
  if (existing && (existing.requestNodeId !== nodeId || existing.tasks[0]?.rhSnapshot?.documentId !== document.id)) throw new Error('任务不属于当前节点')
  let selection = existing?.tasks[0]?.rhSnapshot?.selection || (node.rh?.workflowKey ? node.rh.selections[node.rh.workflowKey] : undefined)
  if (!selection) throw new Error('请选择工作流')
  const channelId = existing?.tasks[0]?.rhSnapshot?.channelId || node.rh?.channelId
  const channel = useGenerationStore.getState().channels.find(item => item.id === channelId)
  if (!channel || channel.protocol !== 'runninghub') throw new Error('请关联 RunningHub 渠道')
  const client = runningHubClient({ ...channel, baseURL: existing?.tasks[0]?.rhSnapshot?.baseURL || channel.baseURL }, useGenerationStore.getState().getAPIKey(channel.id) || '')
  if (existing && !existing.tasks[0].remoteTaskId) throw new Error('没有远端任务 ID，无法恢复；请先在 RunningHub 核实任务是否已创建，避免重复计费')
  if (existing && existing.tasks[0].rhSnapshot?.phase === 'completed') { materialize(existing); return }
  const references = runningHubReferences(node)
  if (!existing) {
    const inputs = resolveRHInputs(selection, references)
    if (inputs.extra.length) throw new Error('素材数量超过工作流输入数量，请断开多余连线')
    if (inputs.missing.length) throw new Error(`缺少素材：${inputs.missing.map(field => field.label).join('、')}`)
    selection = { ...selection, bindings: inputs.bindings }
  }
  const runId = existing?.id || crypto.randomUUID()
  const controller = new AbortController()
  const signal = controller.signal
  active.set(nodeId, controller)
  if (!existing) {
    const provenance = generationInputProvenanceIds(references)
    const snapshot: RHRunSnapshot = {
      documentId: document.id, channelId: channel.id, baseURL: channel.baseURL, selection: structuredClone(selection),
      inputReferenceIds: provenance.inputReferenceIds || [], inputAssetIds: provenance.inputAssetIds || [],
      submittedValues: [], phase: 'preparing', downloaded: {},
    }
    useRuntimeStore.getState().putRun({ id: runId, variant: 'workflow', requestNodeId: nodeId, status: 'validating', createdAt: Date.now(), tasks: [{ id: crypto.randomUUID(), variant: 'workflow', status: 'validating', channelId: channel.id, model: selection.workflow.workflowId, requestNodeId: nodeId, rhSnapshot: snapshot }] })
    useGraphStore.getState().updateNode(nodeId, { latestRunId: runId })
  }
  try {
    await flushRuntimePersistence()
    let taskId = existing?.tasks[0].remoteTaskId
    if (!taskId) {
      assertWorkflowBindings(selection.workflow, await client.read(selection.workflow.workflowId, signal))
      const mediaValues: Record<string, string> = {}
      for (const field of selection.workflow.fields.filter(item => item.enabled && ['image', 'video', 'audio'].includes(item.inputType))) {
        const referenceId = selection.bindings[field.key]
        const reference = references.find(item => item.id === referenceId)
        if (!reference) {
          if (referenceId || field.required) throw new Error(`“${field.label}”素材未绑定或已断开连接`)
          continue
        }
        if (reference.type !== field.inputType) throw new Error(`“${field.label}”需要${field.inputType}素材`)
        if (field.transport === 'url' && /^https?:\/\//i.test(reference.url || '')) mediaValues[field.key] = reference.url!
        else {
          const blob = await loadReferenceForInspection(reference, signal)
          const uploaded = await client.upload(blob, reference.label || `input.${reference.type}`, signal)
          const value = field.transport === 'url' ? uploaded.url : uploaded.fileName
          if (!value) throw new Error(`“${field.label}”上传后没有返回 URL`)
          mediaValues[field.key] = value
        }
      }
      const overrides = buildOverrides(selection, mediaValues, () => crypto.getRandomValues(new Uint32Array(1))[0])
      signal.throwIfAborted()
      await update(runId, 'queued', { status: 'queued', submittedAt: Date.now() }, { phase: 'submitting', submittedValues: overrides.map(item => ({ ...item, fieldValue: typeof item.fieldValue === 'string' && /^https?:\/\//i.test(item.fieldValue) ? '[素材 URL]' : item.fieldValue })) })
      taskId = await client.create(selection.workflow.workflowId, overrides, signal, channel.runningHubInstanceType)
      await update(runId, 'queued', { remoteTaskId: taskId }, { phase: 'submitted' })
    }
    const deadline = Date.now() + 60 * 60 * 1000
    while (Date.now() < deadline) {
      const remote = await client.query(taskId, signal)
      if (remote.status === 'FAILED' || remote.status === 'CANCELLED') {
        const status = remote.status === 'FAILED' ? 'failed' : 'cancelled'
        await update(runId, status, { status, error: remote.error, rawStatus: remote.status }, { phase: status })
        return
      }
      if (remote.status === 'SUCCESS') {
        await update(runId, 'running', { status: 'running', rawStatus: 'SUCCESS' }, { phase: 'downloading' })
        const outputs = selection.workflow.outputs.filter(item => item.enabled)
        const results = outputs.length ? (await client.outputsByNode(taskId, signal)).filter(item => outputs.some(output => output.nodeId === item.nodeId)) : remote.results
        if (!results.length) throw new Error('任务成功，但没有匹配的输出文件；请检查输出设置后继续获取结果')
        for (const [index, result] of results.entries()) {
          const key = `${result.nodeId || 'all'}:${index}`
          if (currentRun(runId).tasks[0].rhSnapshot!.downloaded[key]) continue
          const response = await desktopFetch(result.url, { signal })
          if (!response.ok) throw new Error(`结果下载失败（HTTP ${response.status}），可继续获取结果`)
          const downloaded = await response.blob()
          const asset = await manager.importAsset(new Blob([downloaded], { type: mimeFor(result, downloaded) }), `${selection.workflow.name}-${index + 1}.${result.outputType || 'bin'}`)
          const snapshot = currentRun(runId).tasks[0].rhSnapshot!
          const next = { ...snapshot.downloaded, [key]: asset.id }
          await update(runId, 'running', { resultAssetIds: Object.values(next) }, { downloaded: next })
        }
        await update(runId, 'completed', { status: 'completed', error: undefined, completedAt: Date.now() }, { phase: 'completed' })
        materialize(currentRun(runId))
        return
      }
      await update(runId, remote.status === 'QUEUED' ? 'queued' : 'running', { status: remote.status === 'QUEUED' ? 'queued' : 'running', error: undefined, rawStatus: remote.status })
      await wait(signal, 4000)
    }
    throw new Error('查询已超时；远端任务未确认，可继续查询，不要重复生成')
  } catch (cause) {
    const task = currentRun(runId).tasks[0]
    if (task.rhSnapshot?.phase !== 'cancelled') {
      const uncertain = Boolean(task.remoteTaskId || task.rhSnapshot?.phase === 'submitting')
      await update(runId, uncertain ? 'waiting-for-user' : 'failed', { status: 'failed', error: signal.aborted ? '已停止本地查询；远端任务状态未确认' : safeGenerationError(cause instanceof Error ? cause.message : cause) })
    }
  } finally { active.delete(nodeId) }
}

export async function cancelRunningHub(nodeId: string, runId: string): Promise<void> {
  const run = currentRun(runId)
  const task = run.tasks[0]
  const snapshot = task.rhSnapshot
  if (!snapshot || run.requestNodeId !== nodeId) throw new Error('没有可取消的 RH 任务')
  if (!task.remoteTaskId) {
    active.get(nodeId)?.abort()
    return
  }
  const channel = useGenerationStore.getState().channels.find(item => item.id === snapshot.channelId)
  if (!channel) throw new Error('原渠道已移除，无法确认取消；请到 RunningHub 查看任务')
  await runningHubClient({ ...channel, baseURL: snapshot.baseURL }, useGenerationStore.getState().getAPIKey(channel.id) || '').cancel(task.remoteTaskId)
  await update(runId, 'cancelled', { status: 'cancelled', error: undefined }, { phase: 'cancelled' })
  active.get(nodeId)?.abort()
}

export function pauseRunningHub(nodeId: string): void { active.get(nodeId)?.abort() }
export function isRunningHubActive(nodeId: string): boolean { return active.has(nodeId) }
