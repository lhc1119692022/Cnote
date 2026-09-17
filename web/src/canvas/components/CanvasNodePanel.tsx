/**
 * 画布节点列表面板：按 kind 过滤、按标题搜索，点击选中并定位视口。
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, Globe, Layers3, Sparkles, StickyNote, X, type LucideIcon } from 'lucide-react'
import type { NodeKind, NodeSpec } from '@/domain'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'
import { useCanvas } from './CanvasProvider'

const KIND_META: Record<NodeKind, { label: string; icon: LucideIcon; iconClass: string }> = {
  sticky: { label: '贴纸', icon: StickyNote, iconClass: 'text-amber-500' },
  browser: { label: '浏览器节点', icon: Globe, iconClass: 'text-cyan-600' },
  ai: { label: 'AI 节点', icon: Sparkles, iconClass: 'text-violet-500' },
  request: { label: '请求体', icon: Sparkles, iconClass: 'text-primary' },
  content: { label: '内容节点', icon: Layers3, iconClass: 'text-blue-500' },
  group: { label: '分组', icon: Layers3, iconClass: 'text-muted-foreground' },
}

const PANEL_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'sticky', label: KIND_META.sticky.label },
  { value: 'browser', label: KIND_META.browser.label },
  { value: 'ai', label: KIND_META.ai.label },
  { value: 'request', label: KIND_META.request.label },
  { value: 'content', label: KIND_META.content.label },
  { value: 'group', label: KIND_META.group.label },
]

function nodeTitle(node: NodeSpec): string {
  const trimmed = node.label.trim()
  return trimmed || KIND_META[node.kind].label
}

function stopCanvasPointer(event: ReactPointerEvent): void {
  event.stopPropagation()
}

export function CanvasNodePanel() {
  const showNodePanel = useUiStore((state) => state.showNodePanel)
  const panelFilter = useUiStore((state) => state.panelFilter)
  const panelSearch = useUiStore((state) => state.panelSearch)
  const { nodes, selection, centerOnWorld } = useCanvas()
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setFilterOpen(false)
        return
      }
      if (filterRef.current?.contains(event.target as Node)) return
      setFilterOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
    }
  }, [filterOpen])

  useEffect(() => {
    if (!showNodePanel) setFilterOpen(false)
  }, [showNodePanel])

  const filtered = useMemo(() => {
    const query = panelSearch.trim().toLowerCase()
    return nodes.filter((node) => {
      if (panelFilter !== 'all' && node.kind !== panelFilter) return false
      if (!query) return true
      return nodeTitle(node).toLowerCase().includes(query)
    })
  }, [nodes, panelFilter, panelSearch])

  if (!showNodePanel) return null

  const currentFilterLabel =
    PANEL_FILTERS.find((item) => item.value === panelFilter)?.label ?? '全部'

  const focusNode = (node: NodeSpec) => {
    useGraphStore.getState().setSelection([node.id])
    useUiStore.getState().setSelectedEdgeId(null)
    const width = Number.isFinite(node.size.width) ? Math.max(0, node.size.width) : 0
    const height = Number.isFinite(node.size.height) ? Math.max(0, node.size.height) : 0
    centerOnWorld({
      x: node.position.x + width / 2,
      y: node.position.y + height / 2,
    })
  }

  return (
    <aside
      data-node-panel
      data-canvas-chrome="true"
      className="pointer-events-auto absolute bottom-4 left-4 top-4 z-40 flex w-[260px] flex-col overflow-visible rounded-[14px] border border-border bg-card shadow-[0_12px_30px_rgb(15_23_42/0.1)]"
      aria-label="节点面板"
      onPointerDown={stopCanvasPointer}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <h2 className="min-w-0 flex-1 px-2 text-sm font-semibold text-foreground">节点</h2>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭节点面板"
          title="关闭节点面板"
          onClick={() => useUiStore.getState().setShowNodePanel(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <input
          value={panelSearch}
          onChange={(event) => useUiStore.getState().setPanelSearch(event.target.value)}
          placeholder="搜索节点"
          aria-label="搜索节点"
          title="搜索节点"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground/30"
        />
        <div ref={filterRef} className="relative flex-none">
          <button
            type="button"
            aria-label="节点类型筛选"
            title="节点类型筛选"
            aria-haspopup="listbox"
            aria-expanded={filterOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-foreground hover:bg-muted"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <span className="whitespace-nowrap">{currentFilterLabel}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${filterOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {filterOpen ? (
            <div
              role="listbox"
              aria-label="节点类型"
              className="cnote-menu-surface absolute right-0 top-full z-50 mt-1.5 w-max min-w-[116px]"
            >
              {PANEL_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="option"
                  aria-selected={panelFilter === item.value}
                  data-active={panelFilter === item.value}
                  className="cnote-menu-item"
                  onClick={() => {
                    useUiStore.getState().setPanelFilter(item.value)
                    setFilterOpen(false)
                  }}
                >
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
        {filtered.map((node) => {
          const meta = KIND_META[node.kind]
          const Icon = meta.icon
          const active = selection.includes(node.id)
          return (
            <button
              key={node.id}
              type="button"
              className="cnote-menu-item"
              data-active={active}
              aria-current={active ? 'true' : undefined}
              onClick={() => focusNode(node)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <Icon className={`h-3.5 w-3.5 ${meta.iconClass}`} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{nodeTitle(node)}</span>
            </button>
          )
        })}
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {nodes.length === 0 ? '当前画布暂无节点' : '暂无匹配节点'}
          </p>
        ) : null}
      </div>
    </aside>
  )
}
