import { useState } from 'react'
import { LoaderCircle, Play, Sparkles, Square } from 'lucide-react'

interface GenerationActionButtonProps {
  running: boolean
  waiting: boolean
  elapsed: string
  disabled: boolean
  reason?: string
  onStart: () => void
  onCancel: () => void
  onResume: () => void
}

export function GenerationActionButton({ running, waiting, elapsed, disabled, reason, onStart, onCancel, onResume }: GenerationActionButtonProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const cancelling = running && (hovered || focused)
  const label = running ? '取消生成' : waiting ? '继续生成' : '开始生成'
  return (
    <button
      type="button"
      data-generation-action={running ? 'running' : waiting ? 'waiting' : 'idle'}
      className={[
        'flex h-8 shrink-0 items-center justify-center rounded-full text-xs transition-colors disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        running || waiting ? 'gap-1.5 px-3' : 'w-8',
        cancelling ? 'bg-destructive text-white' : 'bg-foreground text-background hover:opacity-90',
      ].join(' ')}
      disabled={disabled}
      aria-label={label}
      title={disabled && reason ? reason : label}
      onPointerDown={event => event.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={() => {
        if (running) onCancel()
        else if (waiting) onResume()
        else onStart()
      }}
    >
      {running ? (
        <span className="grid items-center">
          <span className={'col-start-1 row-start-1 flex items-center gap-1.5 ' + (cancelling ? 'invisible' : '')}>
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>生成中 <span className="tabular-nums">{elapsed}</span></span>
          </span>
          <span className={'col-start-1 row-start-1 flex items-center justify-center gap-1.5 ' + (cancelling ? '' : 'invisible')}>
            <Square className="h-3.5 w-3.5" aria-hidden />取消生成
          </span>
        </span>
      ) : waiting ? <><Play className="h-3.5 w-3.5" aria-hidden /><span>继续生成</span></> : <Sparkles className="h-4 w-4" aria-hidden />}
    </button>
  )
}
