import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function GenerationDurationInput({ value, min = 1, max = 60, allowed, onChange }: {
  value: number
  min?: number
  max?: number
  allowed?: number[]
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const options = [...new Set(allowed || [])].sort((a, b) => a - b)
  const lower = options[0] ?? min
  const upper = options[options.length - 1] ?? max
  const commit = () => {
    const parsed = Number(draft)
    let next = draft.trim() && Number.isFinite(parsed) ? Math.max(lower, Math.min(upper, Math.round(parsed))) : value
    if (options.length) next = options.reduce((best, option) => Math.abs(option - next) < Math.abs(best - next) ? option : best)
    setDraft(String(next))
    onChange(next)
  }
  const step = (direction: number) => {
    const next = options.length
      ? direction > 0 ? options.find(option => option > value) ?? upper : [...options].reverse().find(option => option < value) ?? lower
      : Math.max(lower, Math.min(upper, value + direction))
    setDraft(String(next))
    onChange(next)
  }
  return (
    <div className="flex h-7 w-16 items-center rounded-full border border-border bg-background/75 px-2 focus-within:ring-1 focus-within:ring-foreground/30" onPointerDown={event => event.stopPropagation()}>
      <input
        type="text" inputMode="numeric" role="spinbutton" aria-label="时长（秒）"
        aria-valuemin={lower} aria-valuemax={upper} aria-valuenow={value}
        value={draft} className="min-w-0 w-full bg-transparent text-center text-[10px] text-foreground outline-none"
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowUp' ? 1 : -1)
          } else if (event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation(); event.currentTarget.blur()
          }
        }}
      />
      <span className="flex flex-col">
        <button type="button" aria-label="增加时长" title="增加时长" disabled={value >= upper} className="text-muted-foreground hover:text-foreground disabled:opacity-30" onMouseDown={event => event.preventDefault()} onClick={() => step(1)}><ChevronUp className="h-3 w-3" /></button>
        <button type="button" aria-label="减少时长" title="减少时长" disabled={value <= lower} className="text-muted-foreground hover:text-foreground disabled:opacity-30" onMouseDown={event => event.preventDefault()} onClick={() => step(-1)}><ChevronDown className="h-3 w-3" /></button>
      </span>
    </div>
  )
}
