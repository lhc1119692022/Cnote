import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export function RHMenuSelect({ label, value, options, disabled, onChange, width = 'w-36' }: {
  label: string; value: string; options: Array<{ value: string; label: string }>
  disabled?: boolean; onChange: (value: string) => void; width?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current!.getBoundingClientRect()
    const height = Math.min(options.length * 40 + 12, 280)
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 8) : rect.bottom + 8, width: Math.max(200, Math.min(rect.width, 320)) })
    menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"], button')?.focus()
  }, [open, options.length])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])
  return <>
    <button ref={trigger} type="button" title={label} aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !options.length} onClick={() => setOpen(!open)} className={`flex h-8 min-w-0 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 ${width}`}>
      <span className="min-w-0 flex-1 truncate text-left">{options.find(option => option.value === value)?.label || label}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
    </button>
    {open && createPortal(<div ref={menu} role="listbox" aria-label={label} style={{ position: 'fixed', ...position, zIndex: 10000 }} className="cnote-menu-surface max-h-[280px] overflow-auto" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }}>{options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} data-active={option.value === value} className="cnote-menu-item" onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}><span className="min-w-0 flex-1 truncate text-left">{option.label}</span>{option.value === value && <Check className="h-3.5 w-3.5 text-primary" />}</button>)}</div>, trigger.current?.closest('[role="dialog"]') || document.body)}
  </>
}
