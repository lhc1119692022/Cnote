import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { AIContent } from '@/canvas/contents/AIContent'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import type { ContentNodeSpec, NodeSpec } from '@/domain'
import { markdownToMindmap } from '@/lib/content-import'
import type { MindmapTreeNode } from '@/types/flow'
import { EXTENSION_PANEL_MAX_WIDTH, EXTENSION_PANEL_MIN_WIDTH } from '@/canvas/overlay-insets'
import { useGraphStore } from '@/stores/graph-store'
import { useUiStore } from '@/stores/ui-store'

type MindmapPath = number[]

function countMindmapNodes(node: MindmapTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + countMindmapNodes(child), 0)
}

function updateMindmapTreeNode(root: MindmapTreeNode, path: MindmapPath, update: (node: MindmapTreeNode) => MindmapTreeNode): MindmapTreeNode {
  if (path.length === 0) return update(root)
  const [childIndex, ...rest] = path
  if (childIndex === undefined) return root
  return {
    ...root,
    children: root.children.map((child, index) => index === childIndex ? updateMindmapTreeNode(child, rest, update) : child),
  }
}

function removeMindmapTreeNode(root: MindmapTreeNode, path: MindmapPath): MindmapTreeNode {
  if (path.length === 0) return root
  return updateMindmapTreeNode(root, path.slice(0, -1), (parent) => ({
    ...parent,
    children: parent.children.filter((_, index) => index !== path[path.length - 1]),
  }))
}

function mindmapToMarkdown(root: MindmapTreeNode): string {
  const lines: string[] = []
  const visit = (node: MindmapTreeNode, depth: number) => {
    if (depth === 0) lines.push(`# ${node.text || '中心主题'}`)
    else lines.push(`${'  '.repeat(Math.max(0, depth - 1))}- ${node.text}`)
    node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(root, 0)
  return lines.join('\n')
}

function emptyMindmapRoot(): MindmapTreeNode {
  return { id: 'mindmap-editor-root', text: '', children: [] }
}

function persistMindmap(node: ContentNodeSpec, root: MindmapTreeNode): void {
  const value = mindmapToMarkdown(root)
  useGraphStore.getState().updateNode(node.id, {
    content: value,
    source: { kind: 'text', mimeType: 'text/markdown' },
    subtype: 'markdown-mindmap',
    payload: { kind: 'mindmap', root, sourceMarkdown: value },
    state: root.text.trim() || root.children.length ? 'ready' : 'empty',
  } as Partial<NodeSpec>)
}

function MindmapStructureRow({
  node,
  path,
  depth,
  onTextChange,
  onAddChild,
  onRemove,
  onCommit,
}: {
  node: MindmapTreeNode
  path: MindmapPath
  depth: number
  onTextChange: (path: MindmapPath, value: string) => void
  onAddChild: (path: MindmapPath) => void
  onRemove: (path: MindmapPath) => void
  onCommit: () => void
}) {
  const label = depth === 0 ? '中心主题' : depth === 1 ? '主分支' : depth === 2 ? '子项' : `${depth - 1} 级子项`
  const placeholder = depth === 0 ? '输入中心主题' : depth === 1 ? '输入主分支' : '输入子项'
  const tone = depth === 0
    ? 'border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/25'
    : depth === 1
      ? 'border-cyan-200 bg-cyan-50/50 dark:border-cyan-800 dark:bg-cyan-950/20'
      : 'border-border bg-card'
  const rows = Math.min(6, Math.max(1, node.text.split(/\r?\n/).length))
  return (
    <div className={depth === 0 ? '' : 'ml-3 border-l border-border pl-2.5'}>
      <div className={`rounded-lg border p-2.5 ${tone}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title={depth === 0 ? '添加主分支' : '添加下级子项'}
              aria-label={depth === 0 ? '添加主分支' : '添加下级子项'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAddChild(path)}
            >
              <Plus className="h-3.5 w-3.5" />
              {depth === 0 ? '主分支' : '子项'}
            </button>
            {depth > 0 && (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                title="删除此主题"
                aria-label="删除此主题"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRemove(path)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <textarea
          value={node.text}
          rows={rows}
          onChange={(event) => onTextChange(path, event.target.value)}
          onBlur={onCommit}
          placeholder={placeholder}
          aria-label={`${label}内容`}
          className="mt-1 min-h-9 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child, index) => (
            <MindmapStructureRow
              key={child.id || `${path.join('.')}.${index}`}
              node={child}
              path={[...path, index]}
              depth={depth + 1}
              onTextChange={onTextChange}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onCommit={onCommit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MindmapEditor({ node }: { node: ContentNodeSpec }) {
  const payloadRoot = node.payload?.kind === 'mindmap' ? node.payload.root : null
  const initialMarkdown = node.payload?.kind === 'mindmap'
    ? node.payload.sourceMarkdown ?? (node.content || mindmapToMarkdown(node.payload.root))
    : node.content || ''
  const [root, setRoot] = useState<MindmapTreeNode>(payloadRoot || (initialMarkdown.trim() ? markdownToMindmap(initialMarkdown).root : emptyMindmapRoot()))

  useEffect(() => {
    if (node.payload?.kind === 'mindmap') setRoot(node.payload.root)
  }, [node.id, node.payload])

  const apply = (next: MindmapTreeNode, persist = false) => {
    setRoot(next)
    if (persist) {
      persistMindmap(node, next)
      useGraphStore.getState().commitHistory()
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-border p-4">
      <div className="text-xs text-muted-foreground">
        {countMindmapNodes(root)} 个主题 · {root.children.length} 个主分支
      </div>
      <MindmapStructureRow
        node={root}
        path={[]}
        depth={0}
        onTextChange={(path, value) => apply(updateMindmapTreeNode(root, path, (item) => ({ ...item, text: value })))}
        onAddChild={(path) => apply(updateMindmapTreeNode(root, path, (item) => ({
          ...item,
          children: [...item.children, { id: nanoid(), text: '', children: [] }],
        })), true)}
        onRemove={(path) => apply(removeMindmapTreeNode(root, path), true)}
        onCommit={() => apply(root, true)}
      />
    </div>
  )
}

function stopCanvasPointer(event: ReactPointerEvent): void {
  event.stopPropagation()
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  )
}

function patchNode(id: string, patch: Partial<NodeSpec>): void {
  useGraphStore.getState().updateNode(id, patch)
  useGraphStore.getState().commitHistory()
}

function NodeDetails({ node }: { node: NodeSpec }) {
  if (node.kind === 'ai') {
    return <div className="min-h-0 flex-1 border-t border-border p-3"><AIContent key={node.id} node={node} presentation="panel" /></div>
  }

  if (node.kind === 'browser') {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-border p-4">
        <PanelSection title="浏览器节点">
          <Field label="网址">
            <input
              value={node.url || ''}
              onChange={(event) => useGraphStore.getState().updateNode(node.id, { url: event.target.value })}
              onBlur={() => useGraphStore.getState().commitHistory()}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/30"
              placeholder="https://example.com"
            />
          </Field>
          <Field label="输出模式">
            <select
              value={node.outputMode || 'url'}
              onChange={(event) => patchNode(node.id, { outputMode: event.target.value as typeof node.outputMode })}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/30"
            >
              <option value="url">网页地址</option>
              <option value="text">网页文本</option>
              <option value="both">地址和文本</option>
            </select>
          </Field>
        </PanelSection>
      </div>
    )
  }

  if (node.kind === 'sticky') {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-border p-4">
        <PanelSection title="贴纸节点">
          <RichTextEditor
            key={node.id}
            value={node.content || ''}
            onChange={(value) => useGraphStore.getState().updateNode(node.id, { content: value })}
            onCommit={() => useGraphStore.getState().commitHistory()}
            className="h-80 rounded-xl border border-border text-foreground"
            placeholder="输入贴纸内容"
          />
          <Field label="颜色">
            <select
              value={node.color || 'yellow'}
              onChange={(event) => patchNode(node.id, { color: event.target.value as typeof node.color })}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/30"
            >
              <option value="yellow">黄色</option>
              <option value="pink">粉色</option>
              <option value="green">绿色</option>
              <option value="blue">蓝色</option>
              <option value="purple">紫色</option>
            </select>
          </Field>
        </PanelSection>
      </div>
    )
  }

  if (node.kind === 'group') {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-border p-4">
        <PanelSection title="编组节点">
          <p className="text-sm text-foreground">包含 {node.memberCount || 0} 个节点</p>
          <Field label="内边距">
            <input
              type="number"
              min={0}
              value={node.padding || 24}
              onChange={(event) => patchNode(node.id, { padding: Math.max(0, Number(event.target.value) || 0) })}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/30"
            />
          </Field>
        </PanelSection>
      </div>
    )
  }

  if (node.kind === 'request') {
    const variant = node.variant === 'video' ? 'video' : 'image'
    return <div className="min-h-0 flex-1 border-t border-border p-4">
      {node.variant === 'body' ? <p className="text-sm text-muted-foreground">在画布中选择图片生成或视频生成。</p> : <Field label={variant === 'image' ? '图片提示词' : '视频提示词'}>
        <textarea value={node[variant]?.prompt || ''} rows={7} className="w-full resize-y rounded-xl border border-border bg-card p-3 text-sm outline-none" onChange={(event) => useGraphStore.getState().updateNode(node.id, { [variant]: { ...node[variant], prompt: event.target.value } })} onBlur={() => useGraphStore.getState().commitHistory()} />
      </Field>}
    </div>
  }

  if (node.kind === 'content') {
    if (node.category === 'mindmap') return <MindmapEditor node={node} />
    if (node.category === 'text') {
      const text = node.payload?.kind === 'text' ? node.payload.value : node.content || ''
      return (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border p-3">

            <RichTextEditor
              key={node.id}
              value={text}
              markdownSource
              onChange={(value) => useGraphStore.getState().updateNode(node.id, {
                content: value,
                payload: { kind: 'text', value, format: 'markdown' },
              })}
              onCommit={() => useGraphStore.getState().commitHistory()}
              className="min-h-0 flex-1 text-foreground"
              placeholder="输入文本内容"
            />

        </div>
      )
    }
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-border p-4">
        <PanelSection title="内容节点">
          <p className="text-sm text-foreground">{node.label || '内容'}</p>
          <p className="text-xs text-muted-foreground">
            {node.category ? `类型：${node.category}` : '尚未选择内容类型'}
          </p>
          {node.source?.kind === 'url' && (
            <Field label="链接">
              <input
                value={node.source.url}
                onChange={(event) => useGraphStore.getState().updateNode(node.id, {
                  source: { ...node.source, url: event.target.value },
                } as Partial<NodeSpec>)}
                onBlur={() => useGraphStore.getState().commitHistory()}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/30"
              />
            </Field>
          )}
          {node.preview?.description && (
            <p className="text-xs leading-5 text-muted-foreground">{node.preview.description}</p>
          )}
          {node.content && (
            <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-3 text-sm text-foreground">
              {node.content}
            </div>
          )}
        </PanelSection>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border px-8 text-center text-sm text-muted-foreground">
      当前节点没有可编辑的详情。
    </div>
  )
}

export function CanvasExtensionPanel() {
  const showExtensionPanel = useUiStore((state) => state.showExtensionPanel)
  const extensionWidth = useUiStore((state) => state.extensionWidth)
  const selection = useGraphStore((state) => state.selection)
  const nodes = useGraphStore((state) => state.currentDocument?.nodes)
  const selectedNode = useMemo(
    () => nodes?.find((node) => node.id === selection[0]),
    [nodes, selection],
  )

  if (!showExtensionPanel) return null

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = Math.max(EXTENSION_PANEL_MIN_WIDTH, extensionWidth)
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        EXTENSION_PANEL_MAX_WIDTH,
        Math.max(EXTENSION_PANEL_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
      )
      useUiStore.getState().setExtensionWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      data-extension-panel
      data-canvas-chrome="true"
      className="pointer-events-auto absolute bottom-4 right-4 top-4 z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      style={{ width: Math.max(EXTENSION_PANEL_MIN_WIDTH, extensionWidth) }}
      aria-label="节点详情"
      onPointerDown={stopCanvasPointer}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整详情面板宽度"
        title="拖动调整宽度"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-transparent hover:bg-foreground/10"
        onPointerDown={onResizePointerDown}
      />
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <h2 className="min-w-0 flex-1 px-2 text-sm font-semibold text-foreground">
          {selectedNode?.label || '节点详情'}
        </h2>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭面板"
          title="关闭面板"
          onClick={() => useUiStore.getState().setShowExtensionPanel(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {selectedNode ? (
        <NodeDetails node={selectedNode} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border px-8 text-center text-sm text-muted-foreground">
          选择一个节点以查看详情。
        </div>
      )}
    </aside>
  )
}
