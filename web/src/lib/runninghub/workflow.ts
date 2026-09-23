/** Portable configuration; excludes preview objects and credential fields from exports. */
export type RHValue = string | number | boolean
export type RHInputType = 'parameter' | 'image' | 'video' | 'audio' | 'text'
export interface RHField {
  key: string
  nodeId: string
  fieldName: string
  nodeTitle: string
  classType: string
  label: string
  value: RHValue
  enabled: boolean
  inputType: RHInputType
  transport: 'upload' | 'url'
  required: boolean
  seedMode?: 'fixed' | 'random'
  options?: RHValue[]
  min?: number
  max?: number
  step?: number
}
export interface RHOutput { nodeId: string; label: string; enabled: boolean }
export interface RHWorkflow {
  id: string
  channelId: string
  workflowId: string
  name: string
  revision: number
  fields: RHField[]
  outputs: RHOutput[]
  /** Graph shape only, used to detect stale bindings. No values or URLs. */
  structure: Record<string, { classType: string; inputs: Record<string, string> }>
}
export interface RHSelection {
  workflow: RHWorkflow
  values: Record<string, RHValue>
  bindings: Record<string, string>
  seedModes?: Record<string, 'fixed' | 'random'>
}
export interface RHNodeConfig {
  channelId?: string
  workflowKey?: string
  selections: Record<string, RHSelection>
  referenceAssetIds: string[]
}

export interface RHRunSnapshot {
  documentId: string
  channelId: string
  baseURL: string
  selection: RHSelection
  inputReferenceIds: string[]
  inputAssetIds: string[]
  submittedValues: Array<{ nodeId: string; fieldName: string; fieldValue: RHValue }>
  phase: 'preparing' | 'submitting' | 'submitted' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  downloaded: Record<string, string>
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseWorkflowId(input: string): string {
  const value = input.trim()
  if (/^\d+$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入 RunningHub 工作流链接或数字 ID') }
  if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)runninghub\.(cn|ai)$/.test(url.hostname)) throw new Error('请输入 RunningHub 平台工作流链接')
  const id = url.searchParams.get('workflowId') || url.pathname.match(/\/workflow\/(\d+)(?:\/|$)/)?.[1]
  if (!id || !/^\d+$/.test(id)) throw new Error('链接中没有工作流 ID，请复制工作流详情页链接')
  return id
}

function safeText(value: string): string {
  return value.replace(/https?:\/\/[^\s"<>]+/gi, url => /[?&](?:Rh-Comfy-Auth|Rh-Identify|token|signature|q-sign-)/i.test(url) ? '' : url)
    .replace(/(?:\/view\?)[^\s"<>]+/gi, '')
}

function suggestedInput(classType: string, fieldName: string): RHInputType {
  if (classType === 'LoadImage' && fieldName === 'image') return 'image'
  if (/^VHS_LoadVideo/.test(classType) && fieldName === 'video') return 'video'
  if (/LoadAudio/i.test(classType) && fieldName === 'audio') return 'audio'
  if (/LoadImageFromUrl/i.test(classType) && /^(image|url|image_url)$/.test(fieldName)) return 'image'
  return 'parameter'
}

export function analyzeWorkflow(raw: unknown): Pick<RHWorkflow, 'fields' | 'outputs' | 'structure'> {
  let parsed: unknown = raw
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { throw new Error('文件不是有效的 JSON') }
  }
  if (!record(parsed) || !Object.keys(parsed).length || Object.keys(parsed).length > 5000) throw new Error('请选择 ComfyUI API 格式工作流')
  const fields: RHField[] = []
  const outputs: RHOutput[] = []
  const structure: RHWorkflow['structure'] = Object.create(null)
  for (const [nodeId, node] of Object.entries(parsed)) {
    if (!/^\d+$/.test(nodeId) || !record(node) || typeof node.class_type !== 'string' || !record(node.inputs)) throw new Error('请选择“导出工作流 API”文件，不支持画布布局 JSON')
    const classType = node.class_type
    const title = record(node._meta) && typeof node._meta.title === 'string' ? safeText(node._meta.title) : classType
    const inputs: Record<string, string> = Object.create(null)
    for (const [fieldName, value] of Object.entries(node.inputs)) {
      const link = Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]) && Object.prototype.hasOwnProperty.call(parsed, value[0])
      inputs[fieldName] = link ? `link:${value[0]}:${value[1]}` : typeof value
      if (link || !['string', 'number', 'boolean'].includes(typeof value)) continue
      if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error(`节点 ${nodeId} 的 ${fieldName} 超出安全数值范围，请在平台调整后重新导出`)
      if (/(?:api.?key|token|password|secret|authorization|notes|rgthree_comparer)/i.test(fieldName)) continue
      const inputType = suggestedInput(classType, fieldName)
      const media = inputType !== 'parameter'
      fields.push({
        key: `${nodeId}:${fieldName}`, nodeId, fieldName, nodeTitle: title, classType,
        label: media ? title : fieldName, value: typeof value === 'string' ? safeText(value) : value as RHValue,
        enabled: media, inputType, required: media,
        transport: /FromUrl/i.test(classType) ? 'url' : 'upload',
        ...(/^(seed|noise_seed)$/.test(fieldName) ? { seedMode: 'fixed' as const } : {}),
      })
    }
    structure[nodeId] = { classType, inputs }
    if (/SaveImage|SaveAudio|VideoCombine|SaveVideo|SaveFile/.test(classType)) outputs.push({ nodeId, label: title, enabled: false })
  }
  return { fields, outputs, structure }
}

export function reconcileWorkflow(previous: RHWorkflow, raw: unknown): { workflow: RHWorkflow; changes: string[] } {
  const fresh = analyzeWorkflow(raw)
  const changes: string[] = []
  const fields = fresh.fields.map(field => {
    const old = previous.fields.find(item => item.key === field.key)
    if (!old) { changes.push(`新增：${field.nodeTitle} / ${field.fieldName}`); return field }
    if (old.classType !== field.classType || typeof old.value !== typeof field.value) {
      changes.push(`类型变化：${old.label}`)
      return { ...field, enabled: false }
    }
    return { ...field, ...old, nodeTitle: field.nodeTitle }
  })
  for (const old of previous.fields) if (!fresh.fields.some(field => field.key === old.key)) changes.push(`已移除：${old.label}`)
  const outputs = fresh.outputs.map(output => ({ ...output, enabled: previous.outputs.some(old => old.nodeId === output.nodeId && old.enabled) }))
  for (const old of previous.outputs) if (old.enabled && !outputs.some(output => output.nodeId === old.nodeId)) changes.push(`输出已移除：${old.label}`)
  return { workflow: { ...previous, ...fresh, fields, outputs, revision: previous.revision + 1 }, changes }
}

export function validateFields(fields: RHField[]): void {
  for (const field of fields.filter(item => item.enabled)) {
    if (!field.label.trim()) throw new Error('请填写已选参数的显示名称')
    if (field.inputType !== 'parameter' && typeof field.value !== 'string') throw new Error(`${field.label}：素材和文本输入只能绑定字符串字段`)
    validateFieldValue(field, field.value)
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) throw new Error(`${field.label}：最小值不能大于最大值`)
    if (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0)) throw new Error(`${field.label}：步长必须大于 0`)
  }
}

export function validateFieldValue(field: RHField, value: RHValue): void {
  if (typeof value !== typeof field.value) throw new Error(`${field.label}：参数类型不匹配`)
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error(`${field.label}：请输入有效数值`)
  if (typeof value === 'number' && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) throw new Error(`${field.label}：数值超出范围`)
  if (field.options?.length && !field.options.includes(value)) throw new Error(`${field.label}：请选择有效选项`)
}

export function buildOverrides(selection: RHSelection, mediaValues: Record<string, string>, randomSeed: () => number): Array<{ nodeId: string; fieldName: string; fieldValue: RHValue }> {
  validateFields(selection.workflow.fields)
  return selection.workflow.fields.filter(field => field.enabled || field.seedMode).flatMap(field => {
    const media = ['image', 'video', 'audio'].includes(field.inputType)
    let value = media ? mediaValues[field.key] : selection.values[field.key] ?? field.value
    if (media && !value) {
      if (field.required) throw new Error(`请为“${field.label}”选择素材`)
      return []
    }
    if (field.seedMode && (selection.seedModes?.[field.key] ?? field.seedMode) === 'random') value = typeof field.value === 'string' ? String(randomSeed()) : randomSeed()
    validateFieldValue(field, value)
    return [{ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value }]
  })
}

export function parseRHRunSnapshot(value: unknown): RHRunSnapshot | undefined {
  if (!record(value) || !record(value.selection) || !record(value.selection.workflow)) return undefined
  if (typeof value.documentId !== 'string' || typeof value.channelId !== 'string' || typeof value.baseURL !== 'string') return undefined
  if (!['preparing', 'submitting', 'submitted', 'downloading', 'completed', 'failed', 'cancelled'].includes(String(value.phase))) return undefined
  const workflow = value.selection.workflow
  if (typeof workflow.id !== 'string' || typeof workflow.workflowId !== 'string' || !/^\d+$/.test(workflow.workflowId) || typeof workflow.name !== 'string' || !Number.isInteger(workflow.revision)) return undefined
  if (!Array.isArray(workflow.fields) || !Array.isArray(workflow.outputs) || !record(workflow.structure)) return undefined
  for (const field of workflow.fields) {
    if (!record(field) || typeof field.key !== 'string' || typeof field.nodeId !== 'string' || typeof field.fieldName !== 'string' || typeof field.label !== 'string') return undefined
    if (!['string', 'number', 'boolean'].includes(typeof field.value) || !['parameter', 'image', 'video', 'audio', 'text'].includes(String(field.inputType))) return undefined
  }
  if (!record(value.selection.values) || !record(value.selection.bindings) || !record(value.downloaded) || !Array.isArray(value.submittedValues)) return undefined
  if (!Array.isArray(value.inputReferenceIds) || !value.inputReferenceIds.every(item => typeof item === 'string') || !Array.isArray(value.inputAssetIds) || !value.inputAssetIds.every(item => typeof item === 'string')) return undefined
  if (!Object.values(value.downloaded).every(item => typeof item === 'string')) return undefined
  try { validateFields(workflow.fields as unknown as RHField[]) } catch { return undefined }
  return structuredClone(value) as unknown as RHRunSnapshot
}
