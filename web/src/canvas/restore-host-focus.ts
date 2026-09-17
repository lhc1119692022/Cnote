export function restoreHostFocus(canvas: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element) || target.closest('webview, iframe')) return
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const region = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('[data-content-node], [data-node-id], [data-extension-panel]')
  if (region && !region.contains(target)) selection?.removeAllRanges()
  const active = document.activeElement
  const guestFocused = active instanceof HTMLElement && active.matches('webview, iframe')
  const blank = !target.closest('[data-content-node], [data-node-id], [data-canvas-chrome], input, textarea, button, select, [contenteditable="true"]')
  if (guestFocused) active.blur()
  if (guestFocused || blank) void window.cnoteDesktop?.window.focus?.().catch(() => undefined)
  if (blank) {
    canvas.focus({ preventScroll: true })
  }
}
