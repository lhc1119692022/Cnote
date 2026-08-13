import { create } from 'zustand'

type ContentEditorMode = 'inline' | 'panel' | null

interface ContentEditorState {
  nodeId: string | null
  mode: ContentEditorMode
  preview: (nodeId: string) => void
  open: (nodeId: string) => void
  openInline: (nodeId: string) => void
  close: () => void
}

export const useContentEditorStore = create<ContentEditorState>((set) => ({
  nodeId: null,
  mode: null,
  preview: (nodeId) => set({ nodeId, mode: null }),
  open: (nodeId) => set({ nodeId, mode: 'panel' }),
  openInline: (nodeId) => set({ nodeId, mode: 'inline' }),
  close: () => set({ nodeId: null, mode: null }),
}))
