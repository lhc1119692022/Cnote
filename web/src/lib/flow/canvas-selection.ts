export function installCanvasSelectionGuard(canvas: HTMLElement) {
  let selecting = false
  const clear = () => window.getSelection()?.removeAllRanges()
  const finish = () => {
    if (selecting) clear()
    selecting = false
    canvas.classList.remove('flow-node-selecting')
  }
  const start = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target || !canvas.contains(target) || !target.closest('.react-flow')) return
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey || event.shiftKey)) return
    selecting = true
    canvas.classList.add('flow-node-selecting')
    clear()
    if (event.type === 'mousedown') event.preventDefault()
  }
  const preventSelection = (event: Event) => {
    if (selecting) event.preventDefault()
  }
  document.addEventListener('pointerdown', start, true)
  document.addEventListener('mousedown', start, true)
  document.addEventListener('selectstart', preventSelection, true)
  document.addEventListener('pointerup', finish)
  document.addEventListener('pointercancel', finish)
  window.addEventListener('blur', finish)
  return () => {
    finish()
    document.removeEventListener('pointerdown', start, true)
    document.removeEventListener('mousedown', start, true)
    document.removeEventListener('selectstart', preventSelection, true)
    document.removeEventListener('pointerup', finish)
    document.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
  }
}
