import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export function useMediaResourceDrag(nodeId: string, select: (index: number) => void, dropOutside?: (index: number, point: { x: number; y: number }, target: Element | null) => void, resourceKeys?: string[]) {
  const pending = useRef<{ pointerId: number; index: number; key?: string; x: number; y: number; moved: boolean; target: HTMLElement } | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  const cancel = () => {
    const current = pending.current
    pending.current = null
    if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    setDragging(false)
  }
  useEffect(() => {
    const stop = () => {
      const current = pending.current
      if (!current) return
      suppressClick.current = current.moved
      pending.current = null
      if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
      setDragging(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stop() }
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', stop)
      const current = pending.current
      pending.current = null
      if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    }
  }, [])
  return {
    dragging,
    handlers(index: number) {
      return {
        onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
          event.stopPropagation()
          if (event.button !== 0 || pending.current) return
          suppressClick.current = false
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          pending.current = { pointerId: event.pointerId, index, key: resourceKeys?.[index], x: event.clientX, y: event.clientY, moved: false, target: event.currentTarget }
          event.currentTarget.setPointerCapture(event.pointerId)
        },
        onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
          const current = pending.current
          if (!current || current.pointerId !== event.pointerId) return
          event.stopPropagation()
          if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 6) {
            current.moved = true
            setDragging(true)
          }
        },
        onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
          const current = pending.current
          if (!current || current.pointerId !== event.pointerId) return
          event.stopPropagation()
          suppressClick.current = true
          const target = document.elementFromPoint(event.clientX, event.clientY)
          cancel()
          const index = current.key === undefined ? current.index : resourceKeys?.indexOf(current.key) ?? -1
          if (index < 0) return
          if (!current.moved || target?.closest('[data-media-preview]')?.getAttribute('data-media-preview') === nodeId) select(index)
          else dropOutside?.(index, { x: event.clientX, y: event.clientY }, target)
        },
        onPointerCancel() { suppressClick.current = true; cancel() },
        onLostPointerCapture() { if (pending.current) { suppressClick.current = true; cancel() } },
        onClick(event: { detail: number }) {
          if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return }
          suppressClick.current = false
          select(index)
        },
      }
    },
  }
}
