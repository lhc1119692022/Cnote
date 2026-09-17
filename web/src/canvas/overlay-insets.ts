/**
 * Overlay side panels sit on the canvas instead of shrinking the container.
 * Insets describe the remaining working rectangle used for fit, add-node
 * placement, and content virtualization.
 */

export const NODE_PANEL_INSET = 284
export const CANVAS_CONTROLS_OCCUPIED_WIDTH = 24 + 48
export const EXTENSION_PANEL_MIN_WIDTH = 280
export const EXTENSION_PANEL_MAX_WIDTH = 640
export const EXTENSION_PANEL_MARGIN = 16

export interface CanvasOverlayInsetState {
  showNodePanel: boolean
  showExtensionPanel: boolean
  extensionWidth: number
}

export interface CanvasOverlayInsets {
  left: number
  right: number
}

export function hasSafePanelToolbarSpacing(
  viewportWidth: number,
  insets: CanvasOverlayInsets,
  groups: { left: number; right: number; center?: number },
): boolean {
  const widths = [groups.left, Math.min(48, groups.center ?? 0), groups.right].filter((width) => width > 0)
  const required = widths.reduce((total, width) => total + width, 0) + Math.max(0, widths.length - 1) * 40
  return viewportWidth - insets.left - insets.right - 32 >= required
}

export function canvasOverlayInsets(state: CanvasOverlayInsetState): CanvasOverlayInsets {
  return {
    left: state.showNodePanel ? NODE_PANEL_INSET : 0,
    right: state.showExtensionPanel
      ? Math.max(EXTENSION_PANEL_MIN_WIDTH, state.extensionWidth) + EXTENSION_PANEL_MARGIN
      : 0,
  }
}
