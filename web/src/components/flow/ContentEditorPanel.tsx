import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Undo2,
  Workflow,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/button'
import { markdownPlainText, markdownToMindmap } from '@/lib/content-import'
import { saveMindmapContentToNode, saveTextContentToNode } from '@/lib/content-import-controller'
import { useFlowStore } from '@/stores/use-flow-store'
import { useContentEditorStore } from '@/stores/use-content-editor-store'
import type { ContentNodeData, MindmapTreeNode } from '@/types/flow'

function inlineMarkdown(value: string): ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|\*[^*]+\*)/g
  return value.split(tokenPattern).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('~~') && part.endsWith('~~')) return <s key={index}>{part.slice(2, -2)}</s>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="text-sky-600 underline underline-offset-2" onClick={(event) => event.stopPropagation()}>{link[1]}</a>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return <span key={index}>{part}</span>
  })
}

export function MarkdownPreview({ source, placeholder = '此处粘贴或编辑' }: { source: string; placeholder?: string }) {
  const lines = source.split(/\r?\n/)
  let inCode = false
  const codeLines: string[] = []
  const rendered: ReactNode[] = []

  lines.forEach((line, index) => {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        rendered.push(<pre key={`code-${index}`} className="my-2 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5"><code>{codeLines.join('\n')}</code></pre>)
        codeLines.length = 0
      }
      inCode = !inCode
      return
    }
    if (inCode) {
      codeLines.push(line)
      return
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      rendered.push(<div key={index} className={`${level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : level === 3 ? 'text-lg' : 'text-base'} mb-2 mt-3 font-semibold leading-tight`}>{inlineMarkdown(heading[2])}</div>)
      return
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      rendered.push(<blockquote key={index} className="my-2 border-l-2 border-foreground/20 pl-3 text-muted-foreground">{inlineMarkdown(quote[1])}</blockquote>)
      return
    }
    const list = line.match(/^(\s*)[-*+]\s+(.+)$/)
    const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/)
    if (list || ordered) {
      const match = list || ordered!
      const depth = Math.min(4, Math.floor(match[1].replace(/\t/g, '  ').length / 2))
      rendered.push(<div key={index} className="flex gap-2 leading-7" style={{ paddingLeft: depth * 18 }}><span className="select-none text-muted-foreground">{ordered ? `${index + 1}.` : '•'}</span><span>{inlineMarkdown(match[2])}</span></div>)
      return
    }
    if (!line.trim()) rendered.push(<div key={index} className="h-3" />)
    else rendered.push(<p key={index} className="whitespace-pre-wrap leading-7">{inlineMarkdown(line)}</p>)
  })
  if (inCode && codeLines.length) rendered.push(<pre key="code-final" className="my-2 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5"><code>{codeLines.join('\n')}</code></pre>)

  return <div className={`break-words text-base leading-7 text-foreground ${source.trim() ? '' : 'flex min-h-40 items-center justify-center text-muted-foreground'}`}>{source.trim() ? rendered : placeholder}</div>
}

type FormatAction = { label: string; icon: typeof Bold; prefix: string; suffix?: string; linePrefix?: string; replaceLinePrefix?: boolean }

const formatActions: FormatAction[] = [
  { label: '一级标题', icon: Heading1, prefix: '', linePrefix: '# ' },
  { label: '二级标题', icon: Heading2, prefix: '', linePrefix: '## ' },
  { label: '三级标题', icon: Heading3, prefix: '', linePrefix: '### ' },
  { label: '粗体', icon: Bold, prefix: '**', suffix: '**' },
  { label: '斜体', icon: Italic, prefix: '*', suffix: '*' },
  { label: '删除线', icon: Strikethrough, prefix: '~~', suffix: '~~' },
  { label: '引用', icon: Quote, prefix: '', linePrefix: '> ' },
  { label: '无序列表', icon: List, prefix: '', linePrefix: '- ' },
  { label: '有序列表', icon: ListOrdered, prefix: '', linePrefix: '1. ' },
  { label: '行内代码', icon: Code2, prefix: '`', suffix: '`' },
  { label: '链接', icon: Link, prefix: '[', suffix: '](https://)' },
]

const mindmapFormatActions: FormatAction[] = [
  { label: '中心主题', icon: Heading1, prefix: '', linePrefix: '# ', replaceLinePrefix: true },
  { label: '主分支', icon: Heading2, prefix: '', linePrefix: '## ', replaceLinePrefix: true },
  { label: '子项', icon: List, prefix: '', linePrefix: '- ', replaceLinePrefix: true },
]

function EditorToolbar({ textarea, value, onChange, actions = formatActions, readOnly = false, onActivate, showActionLabels = false }: { textarea: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (value: string) => void; actions?: FormatAction[]; readOnly?: boolean; onActivate?: () => void; showActionLabels?: boolean }) {
  const applyFormat = (action: FormatAction) => {
    if (readOnly) {
      onActivate?.()
      return
    }
    const input = textarea.current
    if (!input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const selection = value.slice(start, end) || '文本'
    let next: string
    let nextStart: number
    let nextEnd: number
    if (action.linePrefix) {
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const lineEndIndex = value.indexOf('\n', Math.max(lineStart, end))
      const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex
      const selectedLines = value.slice(lineStart, lineEnd).split('\n').map((line) => {
        const content = action.replaceLinePrefix ? line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)?/, '') : line
        return `${action.linePrefix}${content}`
      }).join('\n')
      next = `${value.slice(0, lineStart)}${selectedLines}${value.slice(lineEnd)}`
      nextStart = lineStart + action.linePrefix.length
      nextEnd = lineStart + selectedLines.length
    } else {
      const suffix = action.suffix || ''
      next = `${value.slice(0, start)}${action.prefix}${selection}${suffix}${value.slice(end)}`
      nextStart = start + action.prefix.length
      nextEnd = nextStart + selection.length
    }
    onChange(next)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(nextStart, nextEnd)
    })
  }

  return <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2">
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="撤销" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (readOnly) { onActivate?.(); return }; textarea.current?.focus(); document.execCommand('undo') }}><Undo2 className="h-4 w-4" /></Button>
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="重做" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (readOnly) { onActivate?.(); return }; textarea.current?.focus(); document.execCommand('redo') }}><Redo2 className="h-4 w-4" /></Button>
    <span className="mx-1 h-5 w-px bg-border" />
    {actions.map((action) => { const Icon = action.icon; return <Button key={action.label} type="button" variant="ghost" size="icon" className={`h-8 ${showActionLabels ? 'w-auto gap-1.5 px-2 text-xs' : 'w-8'} text-muted-foreground hover:text-foreground`} title={action.label} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(action)}><Icon className="h-4 w-4" />{showActionLabels && <span>{action.label}</span>}</Button> })}
  </div>
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const data = node?.data as ContentNodeData | undefined
  const initialValue = data?.payload?.kind === 'text'
    ? data.payload.value
    : data?.payload?.kind === 'mindmap' && data.state !== 'empty'
      ? data.payload.sourceMarkdown ?? (data.source?.kind === 'text' ? data.source.text : mindmapToMarkdown(data.payload.root))
      : ''
  const [draft, setDraft] = useState(initialValue)
  const draftRef = useRef(initialValue)
  const [mindmapTreeDraft, setMindmapTreeDraft] = useState<MindmapTreeNode | null>(null)
  const [mindmapEditorMode, setMindmapEditorMode] = useState<'structure' | 'markdown'>('structure')
  const isText = data?.category === 'text'
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

  const updateTextLive = (value: string) => {
    setDraft(value)
    draftRef.current = value
    updateNode(nodeId, {
      data: {
        ...data,
        subtype: 'markdown',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload: { kind: 'text', value, format: 'rich-text', document: { version: 1, source: value, format: 'markdown', plainText: markdownPlainText(value) } },
        preview: { title: '文本', badge: '富文本', meta: [`${markdownPlainText(value).length} 字符`] },
        parse: undefined,
      } satisfies ContentNodeData,
    })
  }

  const updateMindmapLive = (value: string) => {
    setDraft(value)
    draftRef.current = value
    const payload = markdownToMindmap(value)
    setMindmapTreeDraft(payload.root)
    const latest = useFlowStore.getState().nodes.find((item) => item.id === nodeId)
    if (!latest) return
    updateNode(nodeId, {
      data: {
        ...latest.data,
        subtype: 'markdown-mindmap',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload,
        preview: { title: payload.root.text || '无主题', badge: '思维导图' },
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

  if (isText) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
    <EditorToolbar textarea={textareaRef} value={draft} onChange={updateTextLive} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} />
    <textarea ref={textareaRef} autoFocus={isPanelEditorActive} readOnly={!isPanelEditorActive} value={draft} onClick={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }} onFocus={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }} onChange={(event) => updateTextLive(event.target.value)} onBlur={() => void saveTextContentToNode(nodeId, draft, true)} placeholder="此处粘贴或编辑" className="min-h-0 flex-1 resize-none bg-card p-5 text-base leading-7 outline-none" />
    <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground">{markdownPlainText(draft).length} 字符</div>
  </div>

  if (isMindmap) {
    const nodeCount = draft.trim() && liveMindmap ? countMindmapNodes(liveMindmap.root) : 0
    const branchCount = draft.trim() && liveMindmap ? liveMindmap.root.children.length : 0
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div role="tablist" aria-label="思维导图编辑方式" className="inline-flex rounded-lg bg-muted p-1">
          <button type="button" role="tab" aria-selected={mindmapEditorMode === 'structure'} onClick={() => setMindmapEditorMode('structure')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${mindmapEditorMode === 'structure' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Workflow className="h-3.5 w-3.5" />结构编辑</button>
          <button type="button" role="tab" aria-selected={mindmapEditorMode === 'markdown'} onClick={() => setMindmapEditorMode('markdown')} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${mindmapEditorMode === 'markdown' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Code2 className="h-3.5 w-3.5" />Markdown</button>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{nodeCount} 个主题 · {branchCount} 个主分支</span>
      </div>
      {mindmapEditorMode === 'structure'
        ? <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <MindmapStructureRow node={editableMindmapRoot} path={[]} depth={0} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} onTextChange={updateMindmapText} onAddChild={addMindmapChild} onRemove={removeMindmapItem} onCommit={saveMindmapDraft} />
          </div>
        : <div className="flex min-h-0 flex-1 flex-col">
            <EditorToolbar textarea={textareaRef} value={draft} onChange={updateMindmapLive} actions={mindmapFormatActions} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} showActionLabels />
            <textarea
              ref={textareaRef}
              autoFocus={isPanelEditorActive}
              readOnly={!isPanelEditorActive}
              value={draft}
              onClick={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }}
              onFocus={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }}
              onChange={(event) => updateMindmapLive(event.target.value)}
              onBlur={saveMindmapDraft}
              placeholder={'# 中心主题\n## 主分支\n- 子项\n  补充说明'}
              className="custom-scrollbar min-h-0 flex-1 resize-none bg-card p-5 text-base leading-8 outline-none placeholder:text-muted-foreground/60"
            />
          </div>}
    </div>
  }

  return <div className="flex h-[calc(100%-52px)] items-center justify-center border-t border-border px-8 text-center text-sm text-muted-foreground">当前节点的内容可在画布节点中查看。</div>
}
