/**
 * 正式新画布编辑器：加载/保存/撤销与节点增删走 graph-store + storage。
 * 不接入旧 reactflow / use-flow-store。路由替换由后续阶段完成。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { nanoid } from 'nanoid'
import { CanvasToolbar, type SaveStatus } from '@/canvas/components/CanvasToolbar'
import { CanvasViewport } from '@/canvas/components'
import { handleCanvasCopy, handleCanvasPaste, isEditableTarget } from '@/canvas/clipboard-import'
import { AIContent, BrowserContent, ContentContent, GroupContent, RequestContent, StickyContent } from '@/canvas/contents'
import type { FlowDocument, NodeSpec, Size } from '@/domain'
import { showMessage } from '@/lib/app-dialog'
import { migrateLegacyFlows } from '@/runtime/legacy-loader'
import {
  GRAPH_AUTOSAVE_DELAY_MS,
  cancelScheduledGraphPersist,
  createDocument,
  deleteDocument,
  flushGraphPersist,
  hydrateRuntimeStore,
  isGraphDirty,
  listDocuments,
  loadDocument,
  rememberOpenedGraph,
  removeDocumentIndex,
  scheduleGraphPersist,
} from '@/storage'
import { canvasOverlayInsets } from '@/canvas/overlay-insets'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'

function currentGraphSource() {
  const { currentDocument, view } = useGraphStore.getState()
  return { doc: currentDocument, view }
}

/** 量画布容器，给屏幕中心 → 世界坐标换算用。 */
function useContainerSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const readSize = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
    }

    readSize()
    const observer = new ResizeObserver(readSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return size
}

function createEmptyDocument(): FlowDocument {
  const now = Date.now()
  return {
    id: nanoid(),
    name: '未命名画布',
    title: '未命名画布',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: nanoid(),
        kind: 'sticky',
        position: { x: 200, y: 200 },
        size: { width: 320, height: 240 },
        label: '贴纸',
        content: '欢迎使用 Cnote 新画布',
        color: 'yellow',
        background: 'solid',
      },
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
  }
}

function renderNodeContent(node: NodeSpec) {
  switch (node.kind) {
    case 'sticky':
      return <StickyContent node={node} />
    case 'browser':
      return <BrowserContent node={node} />
    case 'ai':
      return <AIContent node={node} />
    case 'request':
      return <RequestContent node={node} />
    case 'content':
      return <ContentContent node={node} />
    case 'group':
      return <GroupContent node={node} />
    default:
      return null
  }
}

export function CanvasEditorPage() {
  const { flowId } = useParams<{ flowId?: string }>()
  const navigate = useNavigate()
  const currentDocument = useGraphStore((state) => state.currentDocument)
  const view = useGraphStore((state) => state.view)
  const canvasRef = useRef<HTMLDivElement>(null)
  const containerSize = useContainerSize(canvasRef)
  const [saving, setSaving] = useState(false)
  const [persistTick, setPersistTick] = useState(0)
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const overlayInsets = canvasOverlayInsets({ showNodePanel, showExtensionPanel, extensionWidth })
  const leftInset = overlayInsets.left
  const rightInset = overlayInsets.right
  const dirty = persistTick >= 0 && isGraphDirty(currentDocument, view)
  const saveStatus: SaveStatus = saving ? 'saving' : dirty ? 'unsaved' : 'saved'

  const saveCurrentDocument = useCallback(async () => {
    setSaving(true)
    try {
      await flushGraphPersist(currentGraphSource)
      setPersistTick((value) => value + 1)
    } catch (error) {
      showMessage(error instanceof Error && error.message.trim() ? error.message : '保存失败，请稍后重试。')
      throw error
    } finally {
      setSaving(false)
    }
  }, [])

  const openLoaded = useCallback((doc: FlowDocument) => {
    useGraphStore.getState().openDocument(doc)
    const search = new URLSearchParams(window.location.hash.split('?')[1] || window.location.search)
    const node = doc.nodes.find(candidate => candidate.id === search.get('node'))
    if (node) {
      useGraphStore.getState().setSelection([node.id])
      const zoom = Math.min(1, (window.innerWidth - 160) / node.size.width, (window.innerHeight - 160) / node.size.height)
      useGraphStore.getState().setViewport({ x: window.innerWidth / 2 - (node.position.x + node.size.width / 2) * zoom, y: window.innerHeight / 2 - (node.position.y + node.size.height / 2) * zoom, zoom })
      if (node.kind === 'content' && node.payload && (node.payload.kind === 'image' || node.payload.kind === 'video')) {
        const index = Number(search.get('resource'))
        if (Number.isInteger(index) && index >= 0 && index < (node.payload.resources?.length || 0)) useGraphStore.getState().updateNode(node.id, { payload: { ...node.payload, activeResourceIndex: index } })
      }
    }
    rememberOpenedGraph(doc, doc.viewport)
    setPersistTick((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        await hydrateRuntimeStore()
        if (cancelled) return

        if (flowId) {
          const loaded = await loadDocument(flowId)
          if (cancelled) return
          if (loaded.ok) {
            openLoaded(loaded.doc)
            return
          }
        }

        await migrateLegacyFlows()
        if (cancelled) return

        if (flowId) {
          const retried = await loadDocument(flowId)
          if (cancelled) return
          if (retried.ok) {
            openLoaded(retried.doc)
            return
          }
        }

        const docs = await listDocuments()
        if (cancelled) return
        const first = docs[0]
        if (first) {
          openLoaded(first)
          if (first.id !== flowId) navigate(`/flows/${first.id}`, { replace: true })
          return
        }

        const empty = createEmptyDocument()
        await createDocument(empty)
        if (cancelled) {
          await deleteDocument(empty.id).catch(() => undefined)
          await removeDocumentIndex(empty.id).catch(() => undefined)
          return
        }
        openLoaded(empty)
        if (empty.id !== flowId) navigate(`/flows/${empty.id}`, { replace: true })
      } catch {
        if (cancelled) return
        if (useGraphStore.getState().currentDocument) return
        const empty = createEmptyDocument()
        try {
          await createDocument(empty)
        } catch {
          // Keep the in-memory canvas even if the first persist fails.
        }
        if (cancelled) {
          await deleteDocument(empty.id).catch(() => undefined)
          await removeDocumentIndex(empty.id).catch(() => undefined)
          return
        }
        openLoaded(empty)
      }
    }

    void boot()
    return () => {
      cancelled = true
      const { currentDocument: doc, view: currentView } = useGraphStore.getState()
      void flushGraphPersist(() => ({ doc, view: currentView }))
    }
  }, [flowId, navigate, openLoaded])

  useEffect(() => {
    if (!currentDocument) return
    if (!isGraphDirty(currentDocument, view)) return
    scheduleGraphPersist(currentGraphSource, GRAPH_AUTOSAVE_DELAY_MS, {
      onSaved: () => setPersistTick((value) => value + 1),
    })
    return () => cancelScheduledGraphPersist()
  }, [currentDocument, view])

  useEffect(() => {
    const flushOpenGraph = () => {
      const { currentDocument: doc, view: currentView } = useGraphStore.getState()
      void flushGraphPersist(() => ({ doc, view: currentView }))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushOpenGraph()
    }
    window.addEventListener('pagehide', flushOpenGraph)
    window.addEventListener('beforeunload', flushOpenGraph)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushOpenGraph)
      window.removeEventListener('beforeunload', flushOpenGraph)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (isMod && key === 's') {
        event.preventDefault()
        void saveCurrentDocument().catch(() => undefined)
        return
      }

      if (isEditableTarget(event.target)) return

      if (!isMod && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        const graph = useGraphStore.getState()
        if (graph.isLocked) return
        const selectedEdgeId = useUiStore.getState().selectedEdgeId
        if (selectedEdgeId) {
          graph.deleteEdge(selectedEdgeId)
          useUiStore.getState().setSelectedEdgeId(null)
        } else {
          graph.deleteSelected()
        }
        return
      }

      if (!isMod) return

      if (key === 'g' && event.shiftKey) {
        event.preventDefault()
        useGraphStore.getState().ungroupSelected()
        return
      }
      if (key === 'g') {
        event.preventDefault()
        useGraphStore.getState().groupSelected()
        return
      }
      if (key === 'd') {
        event.preventDefault()
        useGraphStore.getState().duplicateSelected()
        return
      }
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        useGraphStore.getState().redo()
        return
      }
      if (key === 'z') {
        event.preventDefault()
        useGraphStore.getState().undo()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        useGraphStore.getState().redo()
      }
    },
    [saveCurrentDocument],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      void handleCanvasPaste(event)
    }
    const onCopy = (event: ClipboardEvent) => {
      handleCanvasCopy(event)
    }
    window.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('copy', onCopy)
    }
  }, [])

  return (
    <div ref={canvasRef} className="relative h-dvh w-full overflow-hidden bg-background">
      {currentDocument == null ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          正在加载画布…
        </div>
      ) : (
        <>
          <CanvasToolbar
            containerSize={containerSize}
            saveStatus={saveStatus}
            onSave={() => saveCurrentDocument()}
            leftInset={leftInset}
            rightInset={rightInset}
          />
          <CanvasViewport className="h-full w-full">{renderNodeContent}</CanvasViewport>
        </>
      )}
    </div>
  )
}

export default CanvasEditorPage
