export interface MenuBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function nodeMenuPlacement(
  anchor: MenuBounds,
  bounds: MenuBounds,
  size: { width: number; height: number },
  align: 'left' | 'right',
  gap = 8,
) {
  const width = Math.min(size.width, Math.max(0, bounds.right - bounds.left))
  const below = Math.max(0, bounds.bottom - Math.max(bounds.top, anchor.bottom + gap))
  const above = Math.max(0, Math.min(bounds.bottom, anchor.top - gap) - bounds.top)
  const placement = size.height > below && above > below ? 'top' : 'bottom'
  const maxHeight = placement === 'top' ? above : below
  const height = Math.min(size.height, maxHeight)
  const left = Math.max(bounds.left, Math.min(align === 'right' ? anchor.right - width : anchor.left, bounds.right - width))
  const top = Math.max(bounds.top, Math.min(placement === 'top' ? anchor.top - gap - height : anchor.bottom + gap, bounds.bottom - height))
  return { left, top, width, maxHeight, placement }
}

export function bindNodeMenus(
  root: HTMLElement,
  getLayout: () => { zoom: number; leftInset: number; rightInset: number },
) {
  let frame = 0
  const update = () => {
    frame = 0
    const menus = root.querySelectorAll<HTMLElement>('details[open] > [data-node-menu]')
    if (!menus.length) return
    const canvas = root.closest('[data-cnote-canvas]')
    if (!canvas) return
    const panel = root.closest('[data-extension-panel]')
    const rect = (panel || canvas).getBoundingClientRect()
    const layout = getLayout()
    const zoom = Math.max(0.1, Math.min(4, layout.zoom))
    const left = Math.max(0, rect.left) + layout.leftInset + 8
    const top = Math.max(0, rect.top) + 8
    const bounds = {
      left,
      top,
      right: Math.max(left, Math.min(window.innerWidth, rect.right) - layout.rightInset - 8),
      bottom: Math.max(top, Math.min(window.innerHeight, rect.bottom) - 8),
    }
    menus.forEach((menu) => {
      const details = menu.parentElement
      const summary = details?.querySelector('summary')
      if (!details || !summary) return
      const availableWidth = (bounds.right - bounds.left) / zoom
      menu.style.minWidth = `${Math.min(Number(menu.dataset.menuWidth), availableWidth)}px`
      menu.style.maxWidth = `${availableWidth}px`
      const anchor = summary.getBoundingClientRect()
      const origin = details.getBoundingClientRect()
      const border = menu.offsetHeight - menu.clientHeight
      const position = nodeMenuPlacement(anchor, bounds, {
        width: menu.getBoundingClientRect().width,
        height: Math.min(menu.scrollHeight + border, Number(menu.dataset.menuHeight)) * zoom,
      }, menu.dataset.nodeMenu === 'right' ? 'right' : 'left', 8 * zoom)
      menu.style.left = `${(position.left - origin.left) / zoom}px`
      menu.style.right = 'auto'
      menu.style.top = `${(position.top - origin.top) / zoom}px`
      menu.style.maxHeight = `${Math.min(Number(menu.dataset.menuHeight), position.maxHeight / zoom)}px`
      menu.dataset.placement = position.placement
    })
    frame = window.requestAnimationFrame(update)
  }
  const schedule = () => {
    if (!frame) update()
  }
  const dismiss = (event: Event) => {
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
    root.querySelectorAll('details[open] > [data-node-menu]').forEach((menu) => {
      const details = menu.parentElement
      if (details && (event.type === 'keydown' || !event.composedPath().includes(details))) {
        details.removeAttribute('open')
      }
    })
  }
  root.addEventListener('toggle', schedule, true)
  root.ownerDocument.addEventListener('pointerdown', dismiss, true)
  root.ownerDocument.addEventListener('keydown', dismiss)
  schedule()
  return () => {
    root.removeEventListener('toggle', schedule, true)
    root.ownerDocument.removeEventListener('pointerdown', dismiss, true)
    root.ownerDocument.removeEventListener('keydown', dismiss)
    window.cancelAnimationFrame(frame)
  }
}
