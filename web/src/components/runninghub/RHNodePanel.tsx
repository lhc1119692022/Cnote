import { useEffect, useMemo, useState, useRef } from 'react'
import { LoaderCircle, Play, Square } from 'lucide-react'
import type { RequestNodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useGenerationStore } from '@/stores/use-generation-store'
import { useRunningHubStore } from '@/stores/use-runninghub-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { RHFieldInput } from './RHFieldInput'
import { cancelRunningHub, executeRunningHub, isRunningHubActive, runningHubReferences } from '@/lib/runninghub/execution'
import { AssetManager } from '@/runtime/asset-manager'
import { RHMenuSelect } from './RHMenuSelect'
import { RHMediaSlot } from './RHMediaSlot'
import { resolveRHInputs, workflowChanged } from '@/lib/runninghub/inputs'
import type { RHSelection } from '@/lib/runninghub/workflow'


export function RHNodePanel({ node }: { node: RequestNodeSpec }) {
  const allChannels = useGenerationStore(state => state.channels)
  const channels = allChannels.filter(channel => channel.enabled && channel.protocol === 'runninghub')
  const workflows = useRunningHubStore(state => state.workflows)
  useGraphStore(state => state.currentDocument)
  useRuntimeStore(state => state.assets)
  const rh = node.rh || { selections: {}, referenceAssetIds: [] }
  const channel = channels.find(item => item.id === rh.channelId)
  const available = workflows.filter(item => item.channelId === channel?.id)
  const selected = rh.workflowKey ? rh.selections[rh.workflowKey]?.workflow : undefined
  const visibleFields = useMemo(() => selected?.fields.filter(field => field.enabled) || [], [selected])
  const update = (patch: Partial<NonNullable<RequestNodeSpec['rh']>>) => {
    useGraphStore.getState().updateNode(node.id, { rh: { ...rh, ...patch } })
    useGraphStore.getState().commitHistory()
  }
  const selectChannel = (channelId: string) => update({ channelId, workflowKey: undefined })
  const selectWorkflow = (workflowId: string) => {
    const workflow = available.find(item => item.id === workflowId)
    if (!workflow) return
    const existing = rh.selections[workflow.id]
    const nextSelection = existing || { workflow: structuredClone(workflow), values: Object.fromEntries(workflow.fields.map(field => [field.key, field.value])), bindings: {} }
    update({ workflowKey: workflow.id, selections: { ...rh.selections, [workflow.id]: nextSelection } })
  }
  const selection = selected ? rh.selections[selected.id] : undefined
  const latestRun = useRuntimeStore(state => node.latestRunId ? state.runs[node.latestRunId] : undefined)
  const task = latestRun?.tasks[0]
  const running = isRunningHubActive(node.id) || latestRun?.status === 'queued' || latestRun?.status === 'running' || latestRun?.status === 'validating'
  const waiting = latestRun?.status === 'waiting-for-user'
  const locked = running || waiting || Boolean(node.disabled)
  const references = runningHubReferences(node)
  const patchSelection = (patch: Partial<RHSelection>) => {
    if (selected && selection) update({ selections: { ...rh.selections, [selected.id]: { ...selection, ...patch } } })
  }
  const [error, setError] = useState('')
  const run = async () => { setError(''); try { await executeRunningHub(node.id) } catch (cause) { setError(cause instanceof Error ? cause.message : '运行失败') } }
  const cancel = async () => { setError(''); try { if (node.latestRunId) await cancelRunningHub(node.id, node.latestRunId) } catch (cause) { setError(cause instanceof Error ? cause.message : '取消失败') } }
  const resume = async () => { setError(''); try { if (latestRun) await executeRunningHub(node.id, latestRun.id) } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败') } }
  const latestDefinition = available.find(item => item.id === selected?.id)
  useEffect(() => {
    const onToolbarAction = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; action?: string }>).detail
      if (detail?.nodeId !== node.id || detail.action !== 'update' || !selected || !latestDefinition || !workflowChanged(latestDefinition, selected) || locked) return
      const next = structuredClone(latestDefinition)
      patchSelection({ workflow: next, values: Object.fromEntries(next.fields.map(field => { const previous = selected.fields.find(old => old.key === field.key && old.classType === field.classType && typeof old.value === typeof field.value); return [field.key, previous ? selection?.values[field.key] ?? field.value : field.value] })), bindings: Object.fromEntries(next.fields.filter(field => selected.fields.some(old => old.key === field.key && old.classType === field.classType && old.inputType === field.inputType)).map(field => [field.key, selection?.bindings[field.key] || ''])) })
    }
    window.addEventListener('cnote:runninghub-action', onToolbarAction)
    return () => window.removeEventListener('cnote:runninghub-action', onToolbarAction)
  // The handler intentionally captures the current node selection for this event subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDefinition, locked, node.id, selected, selection])
  const mediaFields = visibleFields.filter(field => ['image', 'video', 'audio'].includes(field.inputType))
  const inputs = selection ? resolveRHInputs(selection, references) : { bindings: {}, missing: [], extra: [] }
  const missingMediaFields = inputs.missing
  const uploading = useRef(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const upload = async (field: typeof mediaFields[number], file: File) => {
    if (uploading.current || locked || inputs.bindings[field.key] || !selected) return
    uploading.current = true; setUploadBusy(true); setError('')
    const manager = new AssetManager()
    try {
      if (!file.type.startsWith(`${field.inputType}/`)) throw new Error('素材类型不匹配')
      const asset = await manager.importAsset(file, file.name)
      const current = useGraphStore.getState().currentDocument?.nodes.find(item => item.id === node.id)
      const config = current?.kind === 'request' ? current.rh : undefined
      const live = config?.selections[selected.id]
      if (!current || current.kind !== 'request' || !config || !live || config.workflowKey !== selected.id || resolveRHInputs(live, runningHubReferences(current)).bindings[field.key]) { await manager.releaseAsset(asset.id); return }
      useGraphStore.getState().updateNode(node.id, { rh: { ...config, referenceAssetIds: [...new Set([...config.referenceAssetIds, asset.id])], selections: { ...config.selections, [selected.id]: { ...live, bindings: { ...live.bindings, [field.key]: asset.id } } } } })
      useGraphStore.getState().commitHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '素材导入失败') }
    finally { uploading.current = false; setUploadBusy(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-visible p-3" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-0.5">
    {!channels.length && <p className="text-xs text-muted-foreground">请先在生成渠道中添加 RunningHub 渠道。</p>}
    {channel && !available.length && <p className="text-xs text-muted-foreground">当前渠道还没有工作流，请到渠道设置中添加。</p>}
    {selected && <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {mediaFields.map(field => {
          const reference = references.find(item => item.id === inputs.bindings[field.key])
          return <RHMediaSlot key={field.key} field={field} reference={reference} disabled={locked || uploadBusy} onUpload={file => void upload(field, file)} onRemove={reference && !reference.upstreamNodeId ? () => {
            const bindings = { ...selection?.bindings }; delete bindings[field.key]
            update({ referenceAssetIds: rh.referenceAssetIds.filter(id => id !== reference.id), selections: { ...rh.selections, [selected.id]: { ...selection!, bindings } } })
          } : undefined} />
        })}
      </div>
      {visibleFields.filter(field => field.inputType === 'parameter' || field.inputType === 'text').map(field => <label key={field.key} className="block text-xs text-muted-foreground"><span className="mb-1 block">{field.label}</span><RHFieldInput disabled={locked} field={field} value={selection?.values[field.key] ?? field.value} onChange={value => patchSelection({ values: { ...selection?.values, [field.key]: value } })} /></label>)}
      {!visibleFields.length && <p className="text-xs text-muted-foreground">这个工作流暂未配置可调整的参数。</p>}
      {missingMediaFields.length > 0 && <p role="status" className="text-[11px] text-amber-700">还缺少：{missingMediaFields.map(field => field.label).join('、')}</p>}
      {inputs.extra.length > 0 && <p role="alert" className="text-xs text-destructive">多出 {inputs.extra.length} 个素材，请断开多余连线；本工作流最多接收 {mediaFields.length} 个素材。</p>}
    </div>}
    </div>
    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border pt-3">
      <div className="mr-auto flex min-w-0 items-center gap-1">
        <RHMenuSelect label="RunningHub 渠道" value={rh.channelId || ''} width="max-w-[132px]" disabled={locked} options={channels.map(item => ({ value: item.id, label: item.name }))} onChange={selectChannel} />
        <RHMenuSelect label="选择工作流" value={rh.workflowKey || ''} width="max-w-[150px]" disabled={!channel || locked} options={available.map(item => ({ value: item.id, label: item.name }))} onChange={selectWorkflow} />
      </div>
      {waiting ? <button type="button" className="h-9 shrink-0 rounded-lg border border-border px-2.5 text-xs" disabled={!task?.remoteTaskId} onClick={() => void resume()}>继续</button> : <button type="button" className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background shadow-sm hover:bg-foreground/85 disabled:opacity-50" disabled={!selected || locked || missingMediaFields.length > 0 || inputs.extra.length > 0 || uploadBusy} onClick={() => void run()}>{running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{running ? '运行中' : '运行工作流'}</button>}
    </div>
    {(error || task?.error) && <p role="alert" className="shrink-0 text-xs text-destructive">{error || task?.error}</p>}
    {latestRun?.status === 'completed' && <p role="status" className="shrink-0 text-xs text-muted-foreground">已完成 · {task?.resultAssetIds?.length || 0} 个结果</p>}
    {running && <button type="button" className="self-end text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void cancel()}><Square className="mr-1 inline h-3 w-3" />取消任务</button>}
  </div>
}
