import type { RHField, RHValue } from '@/lib/runninghub/workflow'

export const rhInputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20'

export function RHFieldInput({ field, value, onChange, disabled = false }: { field: RHField; value: RHValue; onChange: (value: RHValue) => void; disabled?: boolean }) {
  if (field.options?.length) return <select className={rhInputClass} aria-label={field.label} disabled={disabled} value={field.options.findIndex(option => option === value)} onChange={event => onChange(field.options![Number(event.target.value)])}>
    {field.options.map((option, index) => <option key={index} value={index}>{String(option)}</option>)}
  </select>
  if (typeof field.value === 'boolean') return <input type="checkbox" aria-label={field.label} checked={Boolean(value)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  if (typeof field.value === 'number') return <input className={rhInputClass} aria-label={field.label} type="number" value={Number.isFinite(value) ? Number(value) : ''} min={field.min} max={field.max} step={field.step ?? 'any'} disabled={disabled} onChange={event => onChange(event.target.value === '' ? Number.NaN : event.target.valueAsNumber)} />
  return <textarea className={`${rhInputClass} resize-y`} aria-label={field.label} rows={String(value).includes('\n') || String(value).length > 100 ? 4 : 2} value={String(value)} disabled={disabled} onChange={event => onChange(event.target.value)} />
}
