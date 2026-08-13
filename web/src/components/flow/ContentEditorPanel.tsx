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
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { markdownPlainText, markdownToMindmap } from '@/lib/content-import'
import { saveMindmapContentToNode, saveTextContentToNode } from '@/lib/content-import-controller'
import { useFlowStore } from '@/stores/use-flow-store'
import { useContentEditorStore } from '@/stores/use-content-editor-store'
import type { ContentNodeData } from '@/types/flow'

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

type FormatAction = { label: string; icon: typeof Bold; prefix: string; suffix?: string; linePrefix?: string }

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

function EditorToolbar({ textarea, value, onChange, actions = formatActions, readOnly = false, onActivate }: { textarea: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (value: string) => void; actions?: FormatAction[]; readOnly?: boolean; onActivate?: () => void }) {
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
      const selectedLines = value.slice(lineStart, end).split('\n').map((line) => `${action.linePrefix}${line}`).join('\n')
      next = `${value.slice(0, lineStart)}${selectedLines}${value.slice(end)}`
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
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="撤销" onClick={() => { if (readOnly) { onActivate?.(); return }; textarea.current?.focus(); document.execCommand('undo') }}><Undo2 className="h-4 w-4" /></Button>
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="重做" onClick={() => { if (readOnly) { onActivate?.(); return }; textarea.current?.focus(); document.execCommand('redo') }}><Redo2 className="h-4 w-4" /></Button>
    <span className="mx-1 h-5 w-px bg-border" />
    {actions.map((action) => { const Icon = action.icon; return <Button key={action.label} type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title={action.label} onClick={() => applyFormat(action)}><Icon className="h-4 w-4" /></Button> })}
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
      ? mindmapToOutline(data.payload.root)
      : ''
  const [draft, setDraft] = useState(initialValue)
  const isText = data?.category === 'text'
  const isMindmap = data?.category === 'mindmap'

  useEffect(() => setDraft(initialValue), [initialValue, nodeId])

  if (!node || !data) return null

  const updateTextLive = (value: string) => {
    setDraft(value)
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
    const payload = markdownToMindmap(value)
    updateNode(nodeId, {
      data: {
        ...data,
        subtype: 'markdown-mindmap',
        state: value.trim() ? 'ready' : 'empty',
        source: null,
        payload,
        preview: { title: payload.root.text || '无主题', badge: '思维导图' },
        parse: undefined,
      } satisfies ContentNodeData,
    })
  }

  const isPanelEditorActive = activeEditorNodeId === nodeId && editorMode === 'panel'

  if (isText) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
    <EditorToolbar textarea={textareaRef} value={draft} onChange={updateTextLive} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} />
    <textarea ref={textareaRef} autoFocus={isPanelEditorActive} readOnly={!isPanelEditorActive} value={draft} onClick={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }} onFocus={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }} onChange={(event) => updateTextLive(event.target.value)} onBlur={() => void saveTextContentToNode(nodeId, draft, true)} placeholder="此处粘贴或编辑" className="min-h-0 flex-1 resize-none bg-card p-5 text-base leading-7 outline-none" />
    <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground">{markdownPlainText(draft).length} 字符</div>
  </div>

  if (isMindmap) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
    <EditorToolbar textarea={textareaRef} value={draft} onChange={updateMindmapLive} actions={formatActions.filter((action) => ['一级标题', '二级标题', '无序列表'].includes(action.label))} readOnly={!isPanelEditorActive} onActivate={() => openContentEditor(nodeId)} />
    <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">用一级标题表示中心主题，二级标题表示主分支，无序列表继续添加下级内容。</div>
    <textarea
      ref={textareaRef}
      autoFocus={isPanelEditorActive}
      readOnly={!isPanelEditorActive}
      value={draft}
      onClick={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }}
      onFocus={() => { if (!isPanelEditorActive) openContentEditor(nodeId) }}
      onChange={(event) => updateMindmapLive(event.target.value)}
      onBlur={() => void saveMindmapContentToNode(nodeId, draft)}
      placeholder={'# 中心主题\n## 分支一\n- 子主题\n## 分支二'}
      className="min-h-0 flex-1 resize-none bg-card p-5 text-base leading-8 outline-none placeholder:text-muted-foreground/60"
    />
    <div className="flex items-center justify-end border-t border-border px-5 py-2 text-xs text-muted-foreground"><span>{draft.split(/\r?\n/).filter((line) => line.trim()).length} 个主题</span></div>
  </div>

  return <div className="flex h-[calc(100%-52px)] items-center justify-center border-t border-border px-8 text-center text-sm text-muted-foreground">当前节点的内容可在画布节点中查看。</div>
}

function mindmapToOutline(root: ReturnType<typeof markdownToMindmap>['root']) {
  const lines: string[] = []
  const visit = (node: typeof root, depth: number) => {
    if (node.text) {
      if (depth === 0) lines.push(`# ${node.text}`)
      else if (depth === 1) lines.push(`## ${node.text}`)
      else lines.push(`${'  '.repeat(Math.max(0, depth - 2))}- ${node.text}`)
    }
    node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(root, 0)
  return lines.join('\n')
}
