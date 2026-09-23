import { useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { askConfirmation } from '@/lib/app-dialog'
import { useGenerationStore } from '@/stores/use-generation-store'
import { useRunningHubStore } from '@/stores/use-runninghub-store'
import { runningHubClient } from '@/lib/runninghub/client'
import { analyzeWorkflow, parseWorkflowId, reconcileWorkflow, validateFields, type RHField, type RHInputType, type RHWorkflow } from '@/lib/runninghub/workflow'
import { RHFieldInput, rhInputClass } from './RHFieldInput'

export function RunningHubWorkflowsDialog({ channelId, open, onOpenChange }: { channelId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Mount afresh on open so an unsaved draft never appears to have been saved.
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <WorkflowEditor channelId={channelId} />}</Dialog>
}

export function RunningHubWorkflowsPanel({ channelId }: { channelId: string }) {
  return <WorkflowEditor channelId={channelId} inline />
}

function WorkflowSurface({ inline, children }: { inline: boolean; children: ReactNode }) {
  return inline
    ? <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">{children}</div>
    : <DialogContent className="max-w-3xl">{children}</DialogContent>
}

function WorkflowEditor({ channelId, inline = false }: { channelId: string; inline?: boolean }) {
  const channel = useGenerationStore(state => state.channels.find(item => item.id === channelId))
  const workflows = useRunningHubStore(state => state.workflows)
  const [draft, setDraft] = useState<RHWorkflow | null>(null)
  const [link, setLink] = useState('')
  const [search, setSearch] = useState('')
  const [fieldSearch, setFieldSearch] = useState('')
  const [error, setError] = useState('')
  const [changes, setChanges] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const reading = useRef(false)
  const list = workflows.filter(item => item.channelId === channelId && `${item.name} ${item.workflowId}`.toLowerCase().includes(search.toLowerCase()))
  const client = () => {
    if (!channel) throw new Error('渠道已移除')
    return runningHubClient(channel, useGenerationStore.getState().getAPIKey(channelId) || '')
  }
  const applyRaw = (raw: unknown, id: string) => {
    if (draft && draft.workflowId === id) {
      const updated = reconcileWorkflow(draft, raw)
      setDraft(updated.workflow)
      setChanges(updated.changes.length ? updated.changes : ['字段结构未变化，已保留原有设置。'])
    } else {
      setDraft({ id: crypto.randomUUID(), channelId, workflowId: id, name: `工作流 ${id}`, revision: 1, ...analyzeWorkflow(raw) })
      setChanges([])
    }
    setFieldSearch('')
  }
  const read = async () => {
    if (reading.current) return
    reading.current = true
    setBusy(true); setError('')
    try {
      const id = parseWorkflowId(link)
      applyRaw(await client().read(id), id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败') }
    finally { reading.current = false; setBusy(false) }
  }
  const patchField = (key: string, patch: Partial<RHField>) => setDraft(current => current && ({ ...current, fields: current.fields.map(field => field.key === key ? { ...field, ...patch } : field) }))
  const move = (key: string, offset: number) => setDraft(current => {
    if (!current) return current
    const fields = [...current.fields]
    const from = fields.findIndex(field => field.key === key)
    const to = from + offset
    if (to < 0 || to >= fields.length) return current
    ;[fields[from], fields[to]] = [fields[to], fields[from]]
    return { ...current, fields }
  })
  const save = () => {
    if (!draft) return
    try {
      if (!channel) throw new Error('渠道已移除')
      if (!draft.name.trim()) throw new Error('请填写工作流名称')
      validateFields(draft.fields)
      const previous = workflows.find(item => item.id === draft.id)
      useRunningHubStore.getState().save({ ...draft, name: draft.name.trim(), revision: previous ? Math.max(previous.revision + 1, draft.revision) : 1 })
      setDraft(null); setChanges([]); setError(''); setLink('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
  }
  return <WorkflowSurface inline={inline}>
    {inline ? <div className="mb-3"><h3 className="text-[13px] font-semibold">工作流管理</h3><p className="mt-1 text-[11px] text-muted-foreground">验证成功后，可在这里导入多个工作流并在节点中切换。</p></div> : <DialogHeader><DialogTitle>{channel?.name || 'RunningHub'} · 工作流</DialogTitle></DialogHeader>}
    {error && <p role="alert" className="my-2 text-sm text-destructive">{error}</p>}
    <div className="flex gap-2 py-3">
      <input className={rhInputClass} aria-label="工作流链接或 ID" placeholder="工作流链接或 ID" value={link} disabled={busy || Boolean(draft)} onChange={event => setLink(event.target.value)} />
      <Button variant="secondary" size="icon" aria-label={draft ? '重新读取平台工作流' : '读取工作流'} title={draft ? '重新读取平台工作流' : '读取工作流'} disabled={busy || !channel} onClick={() => void read()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button>
      <Button variant="secondary" size="icon" aria-label="导入 API JSON" title="导入 API JSON" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /></Button>
      <input ref={fileRef} className="hidden" type="file" accept=".json,application/json" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (!file) return
        setError('')
        try {
          const id = parseWorkflowId(link)
          if (file.size > 10 * 1024 * 1024) throw new Error('工作流 JSON 不能超过 10 MB')
          applyRaw(await file.text(), id)
        } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败') }
      }} />
    </div>
    {!draft ? <>
      <input className={rhInputClass} aria-label="搜索工作流" placeholder="搜索工作流" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="mt-3 max-h-[55vh] overflow-y-auto">
        {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">{search ? '没有匹配的工作流' : '粘贴工作流链接或 ID 后读取'}</p>}
        {list.map(workflow => <div key={workflow.id} className="flex items-center gap-2 border-b border-border py-3">
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{workflow.name}</div><div className="text-xs text-muted-foreground">{workflow.workflowId} · v{workflow.revision}</div></div>
          <Button variant="ghost" size="icon-sm" title="编辑工作流" aria-label={`编辑 ${workflow.name}`} onClick={() => { setDraft(structuredClone(workflow)); setLink(workflow.workflowId); setError(''); setChanges([]) }}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="复制本地配置" aria-label={`复制 ${workflow.name}`} onClick={() => { setDraft({ ...structuredClone(workflow), id: crypto.randomUUID(), name: `${workflow.name} 副本`, revision: 1 }); setLink(workflow.workflowId); setError(''); setChanges([]) }}><Copy className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="移除本地工作流" aria-label={`移除 ${workflow.name}`} onClick={async () => { if (await askConfirmation(`移除“${workflow.name}”？画布中的已有配置仍会保留。`)) useRunningHubStore.getState().remove(workflow.id) }}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
      </div>
    </> : <>
      <label className="block text-xs text-muted-foreground">工作流名称<input className={`${rhInputClass} mt-1`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      {changes.length > 0 && <div role="status" className="my-2 max-h-24 overflow-y-auto text-xs text-muted-foreground">{changes.map((change, index) => <p key={index}>{change}</p>)}</div>}
      <input className={`${rhInputClass} mt-3`} aria-label="搜索输入和参数" placeholder="搜索节点或参数" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} />
      <div className="my-3 max-h-[45vh] overflow-y-auto pr-2">
        {draft.fields.filter(field => `${field.nodeTitle} ${field.nodeId} ${field.fieldName} ${field.label}`.toLowerCase().includes(fieldSearch.toLowerCase())).map(field => <div key={field.key} className="border-b border-border py-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" aria-label={`显示 ${field.nodeTitle} ${field.fieldName}`} checked={field.enabled} onChange={event => patchField(field.key, { enabled: event.target.checked })} />
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">{field.nodeTitle} · {field.nodeId} / {field.fieldName}</span>
            <button type="button" aria-label={`上移 ${field.label}`} title="上移" onClick={() => move(field.key, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={`下移 ${field.label}`} title="下移" onClick={() => move(field.key, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
          </div>
          {field.enabled && <div className="mt-2 space-y-2">
            <div className="flex gap-2"><input className={rhInputClass} aria-label={`显示名称 ${field.key}`} value={field.label} onChange={event => patchField(field.key, { label: event.target.value })} />
              <select className={rhInputClass} aria-label={`用途 ${field.label}`} value={field.inputType} onChange={event => patchField(field.key, { inputType: event.target.value as RHInputType })}>
                <option value="parameter">参数</option>{typeof field.value === 'string' && <><option value="text">文本输入</option><option value="image">图片输入</option><option value="video">视频输入</option><option value="audio">音频输入</option></>}
              </select>
            </div>
            {['image', 'video', 'audio'].includes(field.inputType) ? <div className="flex items-center gap-3 text-xs">
              <label><input type="checkbox" checked={field.required} onChange={event => patchField(field.key, { required: event.target.checked })} /> 必填</label>
              <select aria-label={`素材传递方式 ${field.label}`} className={rhInputClass} value={field.transport} onChange={event => patchField(field.key, { transport: event.target.value as 'upload' | 'url' })}><option value="upload">上传后传文件名</option><option value="url">传素材 URL</option></select>
            </div> : <><RHFieldInput field={field} value={field.value} onChange={value => patchField(field.key, { value })} />
              {typeof field.value === 'number' && <div className="flex gap-2">{(['min', 'max', 'step'] as const).map((key, index) => <input key={key} type="number" className={rhInputClass} placeholder={['最小值', '最大值', '步长'][index]} aria-label={`${field.label} ${key}`} value={field[key] ?? ''} onChange={event => patchField(field.key, { [key]: event.target.value === '' ? undefined : event.target.valueAsNumber })} />)}</div>}
              {typeof field.value !== 'boolean' && <label className="block text-xs text-muted-foreground">可选值（每行一个，留空为自由输入）<textarea className={rhInputClass} rows={2} value={field.options?.map(String).join('\n') || ''} onChange={event => patchField(field.key, { options: event.target.value ? event.target.value.split('\n').map(value => typeof field.value === 'number' ? Number(value) : value) : undefined })} /></label>}
            </>}
          </div>}
          {field.seedMode && <label className="mt-2 flex items-center gap-2 text-xs">种子<select aria-label={`种子策略 ${field.key}`} value={field.seedMode} onChange={event => patchField(field.key, { seedMode: event.target.value as 'fixed' | 'random' })}><option value="fixed">固定</option><option value="random">每次随机</option></select></label>}
        </div>)}
        <div className="py-3 text-xs"><p className="mb-2 font-medium">输出节点（不选则接收全部结果）</p>
          {draft.outputs.map(output => <label key={output.nodeId} className="mb-2 flex gap-2"><input type="checkbox" checked={output.enabled} onChange={event => setDraft({ ...draft, outputs: draft.outputs.map(item => item.nodeId === output.nodeId ? { ...item, enabled: event.target.checked } : item) })} />{output.label} · {output.nodeId}</label>)}
          <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, outputs: [...draft.outputs, ...Object.entries(draft.structure).filter(([id]) => !draft.outputs.some(item => item.nodeId === id)).map(([nodeId, node]) => ({ nodeId, label: node.classType, enabled: false }))] })}><Plus className="mr-1 h-3.5 w-3.5" />显示其他节点</Button>
        </div>
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => { setDraft(null); setChanges([]); setError(''); setLink('') }}>取消</Button><Button disabled={busy} onClick={save}>保存工作流</Button></div>
    </>}
  </WorkflowSurface>
}
