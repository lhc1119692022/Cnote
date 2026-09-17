/**
 * Canvas chrome / panel UI state.
 * No document or runtime logic — just flags and panel inputs.
 */

import { create } from 'zustand'

export type UiPanelTab = 'nodes' | 'content'

export interface UiStoreState {
  showNodePanel: boolean
  showExtensionPanel: boolean
  extensionWidth: number
  showMinimap: boolean
  isViewportMoving: boolean
  panelTab: UiPanelTab
  panelFilter: string
  panelSearch: string
  selectionMode: boolean
  selectedPanelIds: string[]
  selectedEdgeId: string | null
  nodeChrome: Record<string, { settings?: boolean; systemPrompt?: boolean }>
}

export interface UiStoreActions {
  setShowNodePanel: (show: boolean) => void
  setShowExtensionPanel: (show: boolean) => void
  setExtensionWidth: (width: number) => void
  toggleMinimap: () => void
  setViewportMoving: (moving: boolean) => void
  setPanelTab: (tab: UiPanelTab) => void
  setPanelFilter: (filter: string) => void
  setPanelSearch: (search: string) => void
  setSelectionMode: (enabled: boolean) => void
  setSelectedPanelIds: (ids: string[]) => void
  setSelectedEdgeId: (id: string | null) => void
  setNodeChrome: (id: string, patch: { settings?: boolean; systemPrompt?: boolean }) => void
}

export type UiStore = UiStoreState & UiStoreActions

export const useUiStore = create<UiStore>((set) => ({
  showNodePanel: false,
  showExtensionPanel: false,
  extensionWidth: 370,
  showMinimap: true,
  isViewportMoving: false,
  panelTab: 'nodes',
  panelFilter: 'all',
  panelSearch: '',
  selectionMode: false,
  selectedEdgeId: null,
  nodeChrome: {},
  selectedPanelIds: [],

  setShowNodePanel: (show) => set({ showNodePanel: show }),
  setShowExtensionPanel: (show) => set({ showExtensionPanel: show }),
  setExtensionWidth: (width) => set({ extensionWidth: width }),
  toggleMinimap: () => set((state) => ({ showMinimap: !state.showMinimap })),
  setViewportMoving: (moving) => set({ isViewportMoving: moving }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  setPanelFilter: (filter) => set({ panelFilter: filter }),
  setPanelSearch: (search) => set({ panelSearch: search }),
  setSelectionMode: (enabled) => set({ selectionMode: enabled }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),
  setNodeChrome: (id, patch) => set((state) => ({
    nodeChrome: {
      ...state.nodeChrome,
      [id]: { ...state.nodeChrome[id], ...patch },
    },
  })),
  setSelectedPanelIds: (ids) => set({ selectedPanelIds: ids }),
}))
