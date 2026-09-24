import type { RHSelection, RHWorkflow } from './workflow'

export function workflowChanged(a: RHWorkflow, b: RHWorkflow): boolean {
  const content = (w: RHWorkflow) => JSON.stringify([w.name, w.workflowId, w.fields, w.outputs, w.structure])
  return content(a) !== content(b)
}

export function resolveRHInputs(selection: RHSelection, references: Array<{ id: string; type: string }>) {
  const fields = selection.workflow.fields.filter(field => field.enabled && ['image', 'video', 'audio'].includes(field.inputType))
  const bindings: Record<string, string> = {}
  const used = new Set<string>()
  // Keep existing valid assignments first; then fill empty slots in workflow order.
  for (const field of fields) {
    const id = selection.bindings[field.key]
    if (references.some(ref => ref.id === id && ref.type === field.inputType) && !used.has(id)) { bindings[field.key] = id; used.add(id) }
  }
  for (const field of fields) {
    if (bindings[field.key]) continue
    const ref = references.find(item => item.type === field.inputType && !used.has(item.id))
    if (ref) { bindings[field.key] = ref.id; used.add(ref.id) }
  }
  return { bindings, missing: fields.filter(field => field.required && !bindings[field.key]), extra: references.filter(ref => !used.has(ref.id)) }
}
