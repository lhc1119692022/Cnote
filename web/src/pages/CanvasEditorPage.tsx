/**
 * 正式新画布编辑器：加载/保存/撤销与节点增删走 graph-store + storage。
 * 不接入旧 reactflow / use-flow-store。路由替换由后续阶段完成。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Globe,
  Layers3,
  Lock,
  Map,
  Plus,
  Redo2,
  Save,
  Sparkles,
  StickyNote,
  Undo2,
  Unlock,
  type LucideIcon,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { screenToWorld } from '@/canvas'
import { CanvasViewport } from '@/canvas/components'
import { AIContent, BrowserContent, ContentContent, RequestContent, StickyContent } from '@/canvas/contents'
import type { FlowDocument, GenerationConfig, NodeKind, NodeSpec, Point, Size, Viewport } from '@/domain'
import { showMessage } from '@/lib/app-dialog'
import {
  AI_NODE_DEFAULT_SIZE,
  BROWSER_NODE_DEFAULT_SIZE,
  CONTENT_NODE_DEFAULT_SIZE,
  REQUEST_NODE_DEFAULT_SIZE,
  STICKY_NODE_DEFAULT_SIZE,
} from '@/lib/flow/node-dimensions'
import { migrateLegacyFlows } from '@/runtime/legacy-loader'
import { appendDocumentIndex, listDocuments, loadDocument, saveDocument } from '@/storage'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'

type AddableKind = Exclude<NodeKind, 'group'>

const DEFAULT_BROWSER_URL = 'https://www.google.com/'

const ADD_MENU_ITEMS: ReadonlyArray<{
  kind: AddableKind
  label: string
  icon: LucideIcon
  iconClass: string
}> = [
  { kind: 'sticky', label: '贴纸', icon: StickyNote, iconClass: 'text-amber-500' },
  { kind: 'browser', label: '浏览器节点', icon: Globe, iconClass: 'text-cyan-600' },
  { kind: 'ai', label: 'AI 节点', icon: Sparkles, iconClass: 'text-violet-500' },
  { kind: 'request', label: '请求体', icon: Sparkles, iconClass: 'text-primary' },
  { kind: 'content', label: '内容类型选择', icon: Layers3, iconClass: 'text-blue-500' },
]

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
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
      return null
    default:
      return null
  }
}

function defaultSizeFor(kind: AddableKind): Size {
  switch (kind) {
    case 'sticky':
      return { width: STICKY_NODE_DEFAULT_SIZE.width, height: STICKY_NODE_DEFAULT_SIZE.height }
    case 'browser':
      return { width: BROWSER_NODE_DEFAULT_SIZE.width, height: BROWSER_NODE_DEFAULT_SIZE.height }
    case 'ai':
      return { width: AI_NODE_DEFAULT_SIZE.width, height: AI_NODE_DEFAULT_SIZE.height }
    case 'request':
      return { width: REQUEST_NODE_DEFAULT_SIZE.width, height: REQUEST_NODE_DEFAULT_SIZE.height }
    case 'content':
      return { width: CONTENT_NODE_DEFAULT_SIZE.width, height: CONTENT_NODE_DEFAULT_SIZE.height }
  }
}

function defaultLabelFor(kind: AddableKind): string {
  switch (kind) {
    case 'sticky':
      return '贴纸'
    case 'browser':
      return '浏览器节点'
    case 'ai':
      return 'AI 节点'
    case 'request':
      return '请求体'
    case 'content':
      return '内容类型选择'
  }
}

function emptyGenerationConfig(variant: 'image' | 'video'): GenerationConfig {
  if (variant === 'image') {
    return { prompt: '', capability: 'text-to-image', resolution: 'auto', aspectRatio: '16:9' }
  }
  return {
    prompt: '',
    capability: 'reference-to-video',
    seconds: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    generateAudio: true,
  }
}

function createAddableNode(kind: AddableKind, position: Point): NodeSpec {
  const size = defaultSizeFor(kind)
  const label = defaultLabelFor(kind)
  const id = nanoid()
  switch (kind) {
    case 'sticky':
      return { id, kind, position, size, label, content: '', color: 'yellow', background: 'solid' }
    case 'browser':
      return { id, kind, position, size, label, url: DEFAULT_BROWSER_URL }
    case 'ai':
      return { id, kind, position, size, label }
    case 'request':
      return {
        id,
        kind,
        position,
        size,
        label,
        variant: 'body',
        image: emptyGenerationConfig('image'),
        video: emptyGenerationConfig('video'),
      }
    case 'content':
      return { id, kind, position, size, label, category: null, subtype: null, source: null }
  }
}

/** 屏幕中心换世界坐标，再把节点中心对齐到该点。 */
function viewportCenterPosition(container: Size, view: Viewport, nodeSize: Size): Point {
  const width = container.width > 0 ? container.width : window.innerWidth
  const height = container.height > 0 ? container.height : window.innerHeight
  const world = screenToWorld({ x: width / 2, y: height / 2 }, view)
  return {
    x: world.x - nodeSize.width / 2,
    y: world.y - nodeSize.height / 2,
  }
}

function updateDocumentName(name: string): void {
  const doc = useGraphStore.getState().currentDocument
  if (!doc) return
  const nextName = name.trim() || '未命名画布'
  if (doc.name === nextName && doc.title === nextName) return
  useGraphStore.setState({
    currentDocument: {
      ...doc,
      name: nextName,
      title: nextName,
      updatedAt: Date.now(),
    },
  })
}

function ToolbarButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function EditorToolbar({
  containerSize,
  nameDraft,
  saving,
  onNameDraftChange,
  onNameCommit,
  onSave,
}: {
  containerSize: Size
  nameDraft: string
  saving: boolean
  onNameDraftChange: (value: string) => void
  onNameCommit: () => void
  onSave: () => void
}) {
  const navigate = useNavigate()
  const documentName = useGraphStore((state) => state.currentDocument?.name ?? '')
  const isLocked = useGraphStore((state) => state.isLocked)
  const canUndo = useGraphStore((state) => state.canUndo())
  const canRedo = useGraphStore((state) => state.canRedo())
  const showMinimap = useUiStore((state) => state.showMinimap)

  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAddMenu) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setShowAddMenu(false)
        return
      }
      if (addMenuRef.current?.contains(event.target as Node)) return
      setShowAddMenu(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
    }
  }, [showAddMenu])

  const addNodeOfKind = useCallback(
    (kind: AddableKind) => {
      const view = useGraphStore.getState().view
      const size = defaultSizeFor(kind)
      const position = viewportCenterPosition(containerSize, view, size)
      useGraphStore.getState().addNode(createAddableNode(kind, position))
      setShowAddMenu(false)
    },
    [containerSize],
  )

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-14 items-center justify-between px-3"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="cnote-toolbar-surface pointer-events-auto flex items-center gap-1 px-1.5 py-1">
        <ToolbarButton label="返回控制台" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
        </ToolbarButton>
        <input
          value={nameDraft}
          aria-label="画布名称"
          title="画布名称"
          onChange={(event) => onNameDraftChange(event.target.value)}
          onBlur={onNameCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              onNameDraftChange(documentName)
            }
          }}
          className="h-8 w-44 bg-transparent px-2 text-sm font-medium text-foreground outline-none"
        />
      </div>

      <div className="cnote-toolbar-surface pointer-events-auto relative flex items-center gap-0.5 px-1.5 py-1">
        <div ref={addMenuRef} className="relative">
          <ToolbarButton
            label="新增节点"
            pressed={showAddMenu}
            onClick={() => setShowAddMenu((open) => !open)}
          >
            <Plus className="h-4 w-4" />
          </ToolbarButton>
          {showAddMenu ? (
            <div
              role="menu"
              aria-label="新增节点"
              className="cnote-menu-surface absolute right-0 top-[calc(100%+8px)] z-50 w-48"
            >
              {ADD_MENU_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.kind}
                    type="button"
                    role="menuitem"
                    className="cnote-menu-item"
                    onClick={() => addNodeOfKind(item.kind)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                      <Icon className={`h-3.5 w-3.5 ${item.iconClass}`} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <ToolbarButton label={saving ? '正在保存' : '保存'} disabled={saving} onClick={onSave}>
          <Save className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="撤销" disabled={!canUndo} onClick={() => useGraphStore.getState().undo()}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="重做" disabled={!canRedo} onClick={() => useGraphStore.getState().redo()}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={isLocked ? '解锁画布' : '锁定画布'}
          pressed={isLocked}
          onClick={() => useGraphStore.getState().toggleLock()}
        >
          {isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </ToolbarButton>
        <ToolbarButton
          label={showMinimap ? '隐藏小地图' : '显示小地图'}
          pressed={showMinimap}
          onClick={() => useUiStore.getState().toggleMinimap()}
        >
          <Map className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  )
}

export function CanvasEditorPage() {
  const { flowId } = useParams<{ flowId?: string }>()
  const currentDocument = useGraphStore((state) => state.currentDocument)
  const documentName = currentDocument?.name ?? ''
  const canvasRef = useRef<HTMLDivElement>(null)
  const containerSize = useContainerSize(canvasRef)
  const [nameDraft, setNameDraft] = useState(documentName)
  const [saving, setSaving] = useState(false)
  const nameDraftRef = useRef(nameDraft)
  const savingRef = useRef(false)
  nameDraftRef.current = nameDraft

  useEffect(() => {
    let cancelled = false

    async function openFirstListed(): Promise<boolean> {
      const docs = await listDocuments()
      if (cancelled) return true
      const first = docs[0]
      if (!first) return false
      useGraphStore.getState().openDocument(first)
      return true
    }

    async function boot() {
      try {
        if (flowId) {
          const loaded = await loadDocument(flowId)
          if (cancelled) return
          if (loaded.ok) {
            useGraphStore.getState().openDocument(loaded.doc)
            return
          }
        }

        await migrateLegacyFlows()
        if (cancelled) return

        if (flowId) {
          const retried = await loadDocument(flowId)
          if (cancelled) return
          if (retried.ok) {
            useGraphStore.getState().openDocument(retried.doc)
            return
          }
        }

        if (await openFirstListed()) return
        if (cancelled) return
        useGraphStore.getState().openDocument(createEmptyDocument())
      } catch {
        if (!cancelled && !useGraphStore.getState().currentDocument) {
          useGraphStore.getState().openDocument(createEmptyDocument())
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [flowId])

  useEffect(() => {
    setNameDraft(documentName)
  }, [documentName])

  const saveCurrentDocument = useCallback(async () => {
    if (savingRef.current) return
    updateDocumentName(nameDraftRef.current)
    const { currentDocument: doc, view } = useGraphStore.getState()
    if (!doc) return
    const next: FlowDocument = {
      ...doc,
      viewport: view,
      updatedAt: Date.now(),
    }
    useGraphStore.setState({ currentDocument: next })
    savingRef.current = true
    setSaving(true)
    try {
      await saveDocument(next)
      await appendDocumentIndex(next.id)
    } catch (error) {
      showMessage(error instanceof Error && error.message.trim() ? error.message : '保存失败，请稍后重试。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey
      if (!isMod) return
      const key = event.key.toLowerCase()

      if (key === 's') {
        event.preventDefault()
        void saveCurrentDocument()
        return
      }

      if (isEditableTarget(event.target)) return

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
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveCurrentDocument])

  return (
    <div ref={canvasRef} className="relative h-dvh w-full overflow-hidden bg-background">
      {currentDocument == null ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          正在加载画布…
        </div>
      ) : (
        <>
          <EditorToolbar
            containerSize={containerSize}
            nameDraft={nameDraft}
            saving={saving}
            onNameDraftChange={setNameDraft}
            onNameCommit={() => updateDocumentName(nameDraft)}
            onSave={() => {
              void saveCurrentDocument()
            }}
          />
          <CanvasViewport className="h-full w-full">{renderNodeContent}</CanvasViewport>
        </>
      )}
    </div>
  )
}

export default CanvasEditorPage
