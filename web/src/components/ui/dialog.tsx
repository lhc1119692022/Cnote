import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

const activeDialogs: HTMLDivElement[] = []
const focusableSelector = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const pointerDownOnBackdrop = React.useRef(false)
  const changeRef = React.useRef(onOpenChange)
  changeRef.current = onOpenChange

  React.useLayoutEffect(() => {
    if (!open || !contentRef.current) return
    const content = contentRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    activeDialogs.push(content)
    const isTop = () => activeDialogs[activeDialogs.length - 1] === content
    const focusFirst = () => {
      const target = content.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea:not([disabled]), [contenteditable="true"]') || content.querySelector<HTMLElement>(focusableSelector) || content
      target.focus({ preventScroll: true })
    }
    const keepFocus = (event: FocusEvent) => {
      if (isTop() && !content.contains(event.target as Node)) focusFirst()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        changeRef.current?.(false)
      } else if (event.key === 'Tab') {
        const targets = Array.from(content.querySelectorAll<HTMLElement>(focusableSelector)).filter(target => target.getClientRects().length > 0 && target.tabIndex >= 0)
        const first = targets[0] || content
        const last = targets[targets.length - 1] || content
        if (event.shiftKey && (document.activeElement === first || document.activeElement === content)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === content)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    if (!content.contains(document.activeElement)) focusFirst()
    document.addEventListener('focusin', keepFocus)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      activeDialogs.splice(activeDialogs.indexOf(content), 1)
      document.removeEventListener('focusin', keepFocus)
      document.removeEventListener('keydown', onKeyDown, true)
      pointerDownOnBackdrop.current = false
      if (previous?.isConnected && (!activeDialogs.length || activeDialogs[activeDialogs.length - 1]?.contains(previous))) previous.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onPointerDownCapture={(event) => { pointerDownOnBackdrop.current = event.button === 0 && event.target === event.currentTarget }}
      onPointerCancel={() => { pointerDownOnBackdrop.current = false }}
      onClick={(event) => {
        if (pointerDownOnBackdrop.current && event.target === event.currentTarget) onOpenChange?.(false)
        pointerDownOnBackdrop.current = false
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="cnote-dialog-content relative z-50 pointer-events-auto min-w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto outline-none"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>, document.body,
  )
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function DialogHeader({ className, children, ...props }: DialogHeaderProps) {
  return (
    <div className={cn('mb-4', className)} {...props}>
      {children}
    </div>
  )
}

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode
}

export function DialogTitle({ className, children, ...props }: DialogTitleProps) {
  return (
    <h3
      className={cn('text-xl font-bold text-foreground mb-2', className)}
      {...props}
    >
      {children}
    </h3>
  )
}

interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode
}

export function DialogDescription({ className, children, ...props }: DialogDescriptionProps) {
  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </p>
  )
}
