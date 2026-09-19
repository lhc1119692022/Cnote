import { useLayoutEffect, type RefObject } from 'react'

export function usePromptAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, variant: string | null) {
  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    const resize = () => {
      const scrollTop = textarea.scrollTop
      textarea.style.height = '0px'
      textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`
      textarea.scrollTop = scrollTop
    }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    let width = textarea.offsetWidth
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return
      width = textarea.offsetWidth
      resize()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [ref, value, variant])
}
