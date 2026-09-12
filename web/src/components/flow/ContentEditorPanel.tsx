import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { markdownToMindmap } from '@/lib/content-import'
import { richTextPayload } from '@/lib/rich-text'
import { createBrowserNodeFromLink, saveMindmapContentToNode, saveTextContentToNode } from '@/lib/content-import-controller'
import { useFlowStore } from '@/stores/use-flow-store'
import { useContentEditorStore } from '@/stores/use-content-editor-store'
import type { ContentNodeData, MindmapTreeNode, RichTextDocument } from '@/types/flow'

export { RichTextPreview as MarkdownPreview } from '@/components/ui/rich-text-editor'

function countMindmapNodes(node: ReturnType<typeof markdownToMindmap>['root']): number {
  return 1 + node.children.reduce((total, child) => total + countMindmapNodes(child), 0)
}

type MindmapPath = number[]

function updateMindmapTreeNode(root: MindmapTreeNode, path: MindmapPath, update: (node: MindmapTreeNode) => MindmapTreeNode): MindmapTreeNode {
  if (!path.length) return update(root)
  const [childIndex, ...rest] = path
  return {
    ...root,
    children: root.children.map((child, index) => index === childIndex ? updateMindmapTreeNode(child, rest, update) : child),
  }
}

function removeMindmapTreeNode(root: MindmapTreeNode, path: MindmapPath): MindmapTreeNode {
  if (!path.length) return root
  const childIndex = path[path.length - 1]
  return updateMindmapTreeNode(root, path.slice(0, -1), (parent) => ({
    ...parent,
    children: parent.children.filter((_, index) => index !== childIndex),
  }))
}

function mindmapToMarkdown(root: MindmapTreeNode) {
  const lines: string[] = []
  const escapeContinuation = (value: string) => value.replace(/^(#{1,6}|[-*+])(\s)/, '\\$1$2')
  const visit = (node: MindmapTreeNode, depth: number) => {
    const [title = '', ...details] = node.text.replace(/\r\n?/g, '\n').split('\n')
    const prefix = depth === 0 ? '# ' : depth === 1 ? '## ' : `${'  '.repeat(depth - 2)}- `
    lines.push(`${prefix}${title}`)
    details.forEach((line) => lines.push(`  ${escapeContinuation(line)}`))
    node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(root, 0)
  return lines.join('\n')
}

function emptyMindmapRoot(): MindmapTreeNode {
  return { id: 'mindmap-editor-root', text: '', children: [] }
}

function MindmapStructureRow({ node, path, depth, readOnly, onActivate, onTextChange, onAddChild, onRemove, onCommit }: {
  node: MindmapTreeNode
  path: MindmapPath
  depth: number
  readOnly: boolean
  onActivate: () => void
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
  const childLabel = depth === 0 ? '添加主分支' : '添加下级子项'
  const rows = Math.min(6, Math.max(1, node.text.split(/\r?\n/).length))

  return <div className={depth === 0 ? '' : 'ml-3 border-l border-border pl-2.5'}>
    <div className={`group/outline-row rounded-lg border p-2.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground" title={childLabel} aria-label={childLabel} onMouseDown={(event) => event.preventDefault()} onClick={() => readOnly ? onActivate() : onAddChild(path)}><Plus className="h-3.5 w-3.5" />{depth === 0 ? '主分支' : '子项'}</Button>
          {depth > 0 && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" title="删除此主题" aria-label="删除此主题" onMouseDown={(event) => event.preventDefault()} onClick={() => readOnly ? onActivate() : onRemove(path)}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      </div>
      <textarea
        value={node.text}
        rows={rows}
        readOnly={readOnly}
        onClick={() => { if (readOnly) onActivate() }}
        onFocus={() => { if (readOnly) onActivate() }}
        onChange={(event) => onTextChange(path, event.target.value)}
        onBlur={() => { if (!readOnly) onCommit() }}
        placeholder={placeholder}
        aria-label={`${label}内容`}
        className="custom-scrollbar mt-1 min-h-9 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
    {node.children.length > 0 && <div className="mt-2 space-y-2">{node.children.map((child, index) => <MindmapStructureRow key={`${path.join('.')}.${index}`} node={child} path={[...path, index]} depth={depth + 1} readOnly={readOnly} onActivate={onActivate} onTextChange={onTextChange} onAddChild={onAddChild} onRemove={onRemove} onCommit={onCommit} />)}</div>}
  </div>
}

export function ContentEditorPanel({ nodeId }: { nodeId: string }) {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId))
  const updateNode = useFlowStore((state) => state.updateNode)
  const activeEditorNodeId = useContentEditorStore((state) => state.nodeId)
  const editorMode = useContentEditorStore((state) => state.mode)
  const openContentEditor = useContentEditorStore((state) => state.open)
  const data = node?.data as ContentNodeData | undefined
  const initialValue = data?.payload?.kind === 'text'
    ? data.payload.value
    : data?.payload?.kind === 'document' ? data.payload.plainText
    : data?.payload?.kind === 'mindmap' && data.state !== 'empty'
      ? data.payload.sourceMarkdown ?? (data.source?.kind === 'text' ? data.source.text : mindmapToMarkdown(data.payload.root))
      : ''
  const [draft, setDraft] = useState(initialValue)
  const draftRef = useRef(initialValue)
  const [mindmapTreeDraft, setMindmapTreeDraft] = useState<MindmapTreeNode | null>(null)
  const isText = data?.category === 'text'
  const isRichDocument = data?.payload?.kind === 'document' && Boolean(data.payload.document)
  const isMindmap = data?.category === 'mindmap'
  const liveMindmap = isMindmap ? markdownToMindmap(draft) : undefined
  const editableMindmapRoot = isMindmap && mindmapTreeDraft
    ? mindmapTreeDraft
    : draft.trim() && liveMindmap
      ? liveMindmap.root
      : emptyMindmapRoot()

  useEffect(() => {
    setDraft(initialValue)
    draftRef.current = initialValue
    setMindmapTreeDraft(initialValue.trim() ? markdownToMindmap(initialValue).root : emptyMindmapRoot())
  }, [initialValue, nodeId])

  if (!node || !data) return null

  const updateTextLive = (value: string, document: RichTextDocument) => {
    setDraft(value)
    draftRef.current = value
    updateNode(nodeId, {
      data: {
        ...data,
        subtype: 'plain-text',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload: isRichDocument ? { kind: 'document', plainText: value, document } : richTextPayload(value, document),
        preview: { title: '文本', badge: '富文本', meta: [`${document.plainText.length} 字符`] },
        parse: undefined,
      } satisfies ContentNodeData,
    })
  }

  const applyMindmapTree = (root: MindmapTreeNode, persist = false) => {
    const value = mindmapToMarkdown(root)
    setMindmapTreeDraft(root)
    setDraft(value)
    draftRef.current = value
    const latest = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
    if (latest) updateNode(nodeId, {
      data: {
        ...latest.data,
        subtype: 'markdown-mindmap',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload: { kind: 'mindmap', root, sourceMarkdown: value },
        preview: { title: root.text.split(/\r?\n/, 1)[0].trim() || '无主题', badge: '思维导图' },
        parse: undefined,
      } satisfies ContentNodeData,
    })
    if (persist) void saveMindmapContentToNode(nodeId, value)
  }

  const updateMindmapText = (path: MindmapPath, value: string) => {
    applyMindmapTree(updateMindmapTreeNode(editableMindmapRoot, path, (item) => ({ ...item, text: value })))
  }

  const addMindmapChild = (path: MindmapPath) => {
    const next = updateMindmapTreeNode(editableMindmapRoot, path, (item) => ({
      ...item,
      children: [...item.children, { id: nanoid(), text: '', children: [] }],
    }))
    applyMindmapTree(next, true)
  }

  const removeMindmapItem = (path: MindmapPath) => {
    applyMindmapTree(removeMindmapTreeNode(editableMindmapRoot, path), true)
  }

  const saveMindmapDraft = () => void saveMindmapContentToNode(nodeId, draftRef.current)

  const isPanelEditorActive = activeEditorNodeId === nodeId && editorMode === 'panel'

  if (isText || isRichDocument) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
    <RichTextEditor key={nodeId} value={draft} document={data.payload?.kind === 'text' || data.payload?.kind === 'document' ? data.payload.document : undefined} onLinkClick={(url) => { createBrowserNodeFromLink(url, nodeId) }} onChange={updateTextLive} onActivate={() => openContentEditor(nodeId)} onCommit={(value) => { if (isText) void saveTextContentToNode(nodeId, value, true); else { useFlowStore.getState().addToHistory(); useFlowStore.getState().saveCurrentFlow() } }} className="flex-1" contentClassName="p-5" />
    <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground">{draft.length} 字符</div>
  </div>

  if (isMindmap) {
    const nodeCount = countMindmapNodes(editableMindmapRoot)
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
      <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">{nodeCount} 个主题 · {editableMindmapRoot.children.length} 个主分支</div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <MindmapStructureRow node={editableMindmapRoot} path={[]} depth={0} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} onTextChange={updateMindmapText} onAddChild={addMindmapChild} onRemove={removeMindmapItem} onCommit={saveMindmapDraft} />
      </div>
    </div>
  }
  return <div className="p-5 text-sm text-muted-foreground">当前节点的内容可在画布节点中查看。</div>
}
