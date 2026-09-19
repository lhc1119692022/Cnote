import React from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasViewport } from '../../src/canvas/components/CanvasViewport'
import { useGraphStore } from '../../src/stores/graph-store'
import { useUiStore } from '../../src/stores/ui-store'
import { useCutEdges } from '../../src/canvas/cut-edges'
import '../../src/index.css'

export async function setupCutUi() {
  useUiStore.setState({ showNodePanel: false, showExtensionPanel: false })
  useGraphStore.getState().openDocument({ id: 'cut-ui', name: 'cut-ui', createdAt: 0, updatedAt: 0, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
    { id: 'left', kind: 'content', category: 'image', subtype: 'image', source: null, label: '原图', position: { x: 100, y: 100 }, size: { width: 200, height: 150 } },
    { id: 'right', kind: 'content', category: 'image', subtype: 'image', source: null, label: '参考节点', position: { x: 700, y: 100 }, size: { width: 200, height: 150 } },
  ], edges: [{ id: 'cut-edge', source: 'left', target: 'right' }] })
  document.body.innerHTML = '<div id="cut-root" style="width:100vw;height:100vh"></div>'
  createRoot(document.getElementById('cut-root')!).render(<CanvasViewport>{(node) => <div className="h-full w-full rounded-xl border bg-card p-4">{node.label}</div>}</CanvasViewport>)
  await new Promise((resolve) => setTimeout(resolve, 250))
}

export function assertCutPreview() {
  if (useGraphStore.getState().currentDocument?.edges.length !== 1) throw new Error('Preview deleted edge too early')
  if (!useCutEdges.getState().ids.includes('cut-edge')) throw new Error('Crossed edge not marked')
  if (!document.querySelector('[data-cut-trail] polyline')) throw new Error('Red trail missing')
  if (!document.querySelector('path[stroke="#e11d48"][stroke-dasharray="8 6"]')) throw new Error('Crossed edge not red/dashed')
  if (!getComputedStyle(document.querySelector('.canvas-cutting')!).cursor.includes('data:image/svg')) throw new Error('Scissors cursor missing')
}

export function assertCutCommit() {
  if (useGraphStore.getState().currentDocument?.edges.length !== 0) throw new Error('Release did not cut')
  if (document.querySelector('[data-canvas-context-menu]')) throw new Error('Paste menu still exists')
  useGraphStore.getState().undo()
  if (useGraphStore.getState().currentDocument?.edges.length !== 1) throw new Error('Undo did not restore edge')
  useGraphStore.getState().redo()
  if (useGraphStore.getState().currentDocument?.edges.length !== 0) throw new Error('Redo did not cut edge')
  return { passed: true, preview: true, commit: true, undoRedo: true }
}
