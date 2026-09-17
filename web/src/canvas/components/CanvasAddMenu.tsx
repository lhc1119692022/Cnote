import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addLibrarySource, addNodeAtClient, type AddableKind } from '@/canvas/node-factory'
import { NodeMenuIcon } from '@/canvas/components/NodeMenuIcon'
import { getContentCategoryVisual } from '@/lib/content-visuals'
import { retainLocalResource } from '@/lib/resource-storage'
import { importDroppedFile } from '@/canvas/clipboard-import'
import { useSourceStore } from '@/stores/use-source-store'
import { useUiStore } from '@/stores/ui-store'

export interface CanvasAddMenuState {
  x: number
  y: number
  clientX: number
  clientY: number
}

export function CanvasAddMenu({
  menu,
  container,
  onClose,
}: {
  menu: CanvasAddMenuState
  container: HTMLElement | null
  onClose: () => void
}) {
  const sources = useSourceStore((state) => state.sources)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })
  const [librarySide, setLibrarySide] = useState<'left' | 'right'>('right')
  const libraryItems = sources.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const fileRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const width = container?.clientWidth || window.innerWidth
    const height = container?.clientHeight || window.innerHeight
    if (!root) return
    const menuWidth = root.offsetWidth || 192
    const menuHeight = root.offsetHeight || 420
    setPosition({
      x: Math.max(8, Math.min(menu.x, Math.max(8, width - menuWidth - 8))),
      y: Math.max(8, Math.min(menu.y, Math.max(8, height - menuHeight - 8))),
    })
    setLibrarySide(menu.x + menuWidth + 224 <= width - 8 ? 'right' : 'left')
  }, [container, libraryOpen, menu.x, menu.y])

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && rootRef.current?.contains(event.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
    }
  }, [onClose])

  const add = (kind: AddableKind) => {
    addNodeAtClient(kind, menu.clientX, menu.clientY, container)
    onClose()
  }

  return (
    <div
      ref={rootRef}
      data-canvas-chrome="true"
      data-canvas-add-menu
      role="menu"
      aria-label="添加节点"
      className="cnote-menu-surface pointer-events-auto absolute z-[59] w-48"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => add('content')}>
        <NodeMenuIcon kind="content" compact />
        添加内容节点
      </button>
      <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => add('ai')}>
        <NodeMenuIcon kind="ai" compact />
        添加 AI 节点
      </button>
      <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => add('request')}>
        <NodeMenuIcon kind="request" compact />
        添加请求体
      </button>
      <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => add('browser')}>
        <NodeMenuIcon kind="browser" compact />
        添加浏览器节点
      </button>
      <div role="separator" className="my-1 h-px bg-border/60" />
      <button type="button" role="menuitem" className="cnote-menu-item" onClick={() => add('sticky')}>
        <NodeMenuIcon kind="sticky" compact />
        添加贴纸
      </button>
      <button
        type="button"
        role="menuitem"
        className="cnote-menu-item"
        onClick={() => {
          fileRef.current?.click()
        }}
      >
        <NodeMenuIcon kind="import" compact />
        导入文件
      </button>
      <div role="separator" className="my-1 h-px bg-border/60" />
      <div
        className="relative"
        onMouseEnter={() => setLibraryOpen(true)}
        onMouseLeave={() => setLibraryOpen(false)}
      >
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={libraryOpen} className="cnote-menu-item" onClick={() => setLibraryOpen(true)}>
          <NodeMenuIcon kind="library" compact />
          <span className="min-w-0 flex-1">内容资料库</span>
        </button>
        {libraryOpen && (
          <div
            className={[
              'cnote-menu-surface absolute top-0 z-[60] w-56',
              librarySide === 'right' ? 'left-[calc(100%-4px)]' : 'right-[calc(100%-4px)]',
            ].join(' ')}
          >
            {libraryItems.slice(0, 8).map((item) => {
              const visual = getContentCategoryVisual(undefined, item.nodeData.category ?? undefined)
              const Icon = visual?.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className="cnote-menu-item"
                  onClick={() => {
                    const resource = item.nodeData.source
                    if (resource?.kind === 'file' || resource?.kind === 'clipboard-image') {
                      void retainLocalResource(resource.resourceId)
                    }
                    const size = { width: container?.clientWidth || window.innerWidth, height: container?.clientHeight || window.innerHeight }
                    addLibrarySource(item, size)
                    onClose()
                  }}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {Icon ? <Icon className={`h-3.5 w-3.5 ${visual?.iconClass || 'text-blue-500'}`} /> : null}
                  </span>
                  <span className="truncate">{item.title}</span>
                </button>
              )
            })}
            {libraryItems.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无收藏内容</p>
            )}
            {libraryItems.length > 8 && (
              <button
                type="button"
                className="cnote-menu-item text-primary"
                onClick={() => {
                  useUiStore.getState().setShowNodePanel(true)
                  useUiStore.getState().setPanelTab('content')
                  onClose()
                }}
              >
                展开更多
              </button>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".json,.png,.jpg,.jpeg,.webp,.gif,.md,.txt,.pdf,.docx,.csv,.xlsx,.pptx"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void importDroppedFile(file, menu.clientX, menu.clientY)
          onClose()
        }}
      />
    </div>
  )
}
