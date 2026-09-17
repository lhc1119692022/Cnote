import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code2, Link, Undo2, Redo2, Table, ListChecks, Unlink } from 'lucide-react'
import { importMarkdownDocument, richTextContent, richTextExtensions } from '@/lib/rich-text'
import type { RichTextDocument } from '@/types/flow'
import { cn } from '@/lib/utils'
import './rich-text-editor.css'

function EditorToolbar({ editor, compact = false }: { editor: Editor; compact?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [linkError, setLinkError] = useState(false)
  useEditorState({ editor, selector: ({ editor: current }) => current.state })
  const actions = [
    { label: '撤销', icon: Undo2, run: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { label: '重做', icon: Redo2, run: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },
    ...([Heading1, Heading2, Heading3] as const).map((icon, index) => ({ label: `${index + 1} 级标题`, icon, active: editor.isActive('heading', { level: index + 1 }), run: () => editor.chain().focus().toggleHeading({ level: (index + 1) as 1 | 2 | 3 }).run() })),
    { label: '粗体', icon: Bold, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: '引用', icon: Quote, active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '无序列表', icon: List, active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '任务列表', icon: ListChecks, active: editor.isActive('taskList'), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: '行内代码', icon: Code2, active: editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    { label: '链接', icon: Link, active: editor.isActive('link'), run: () => { setUrl(String(editor.getAttributes('link').href || '')); setLinkError(false); setLinkOpen(!linkOpen) } },
    { label: '取消链接', icon: Unlink, disabled: !editor.isActive('link'), run: () => editor.chain().focus().unsetLink().run() },
    { label: '插入表格', icon: Table, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ]
  return <div className="shrink-0 border-b border-border">
    <div role="toolbar" aria-label="文本格式" className={cn('flex min-w-0 flex-wrap gap-0.5 py-2', compact ? 'px-1' : 'px-3')}>
      {actions.filter(action => !compact || ['撤销', '重做', '粗体', '斜体', '无序列表', '任务列表'].includes(action.label)).map(({ label, icon: Icon, run, ...state }) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={'active' in state ? state.active : undefined} disabled={'disabled' in state && state.disabled} className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30', 'active' in state && state.active && 'bg-muted text-foreground')} onMouseDown={(event) => event.preventDefault()} onClick={run}><Icon className="h-4 w-4" /></button>)}
    </div>
    {linkOpen && <form className="flex flex-wrap gap-2 px-3 pb-2" onSubmit={(event) => {
      event.preventDefault()
      if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { setLinkError(true); return }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
      setLinkOpen(false)
    }}><input autoFocus aria-label="链接地址" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm" /><button type="submit" className="text-sm">应用</button><button type="button" className="text-sm" onClick={() => { setLinkOpen(false); editor.commands.focus() }}>取消</button>{linkError && <span role="alert" className="w-full text-xs text-destructive">请输入 http、https 或 mailto 链接。</span>}</form>}
    {!compact && editor.isActive('table') && <div className="flex flex-wrap gap-2 px-3 pb-2 text-xs">{[
      ['添加行', () => editor.chain().focus().addRowAfter().run()],
      ['添加列', () => editor.chain().focus().addColumnAfter().run()],
      ['删除行', () => editor.chain().focus().deleteRow().run()],
      ['删除列', () => editor.chain().focus().deleteColumn().run()],
      ['删除表格', () => editor.chain().focus().deleteTable().run()],
    ].map(([label, run]) => <button key={String(label)} type="button" onMouseDown={(event) => event.preventDefault()} onClick={run as () => void}>{String(label)}</button>)}</div>}
  </div>
}

interface RichTextEditorProps {
  value: string
  document?: RichTextDocument
  onChange?: (value: string, document: RichTextDocument) => void
  onCommit?: (value: string) => void
  onActivate?: () => void
  editable?: boolean
  toolbar?: boolean
  compactToolbar?: boolean
  placeholder?: string
  className?: string
  contentClassName?: string
  markdownSource?: boolean
  onLinkClick?: (url: string) => void
}

export function RichTextEditor({ value, document, onChange, onCommit, onActivate, editable = true, toolbar = true, compactToolbar = false, placeholder = '此处粘贴或编辑', className, contentClassName, markdownSource = false, onLinkClick }: RichTextEditorProps) {
  const callbacks = useRef({ onChange, onCommit, onActivate })
  callbacks.current = { onChange, onCommit, onActivate }
  const lastValue = useRef(value)
  const lastDocument = useRef(document)
  const dirty = useRef(false)
  const editor = useEditor({
    extensions: [...richTextExtensions(), Placeholder.configure({ placeholder })],
    content: markdownSource ? value : richTextContent(value, document),
    contentType: markdownSource ? 'markdown' : 'json',
    editable,
    editorProps: {
      attributes: { class: 'cnote-rich-text outline-none', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '富文本内容' },
      handlePaste: (view, event) => {
        if (event.clipboardData?.getData('text/html') || event.clipboardData?.files.length) return false
        const text = event.clipboardData?.getData('text/plain')
        if (!text) return false
        const parsed = view.state.schema.nodeFromJSON(importMarkdownDocument(text).json)
        event.preventDefault()
        const slice = parsed.slice(0, parsed.content.size)
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const plainText = current.getText()
      const nextDocument: RichTextDocument = { version: 1, format: 'tiptap-json', plainText, json: current.getJSON() }
      lastValue.current = plainText
      lastDocument.current = nextDocument
      dirty.current = true
      callbacks.current.onChange?.(plainText, nextDocument)
    },
    onFocus: () => callbacks.current.onActivate?.(),
  })
  useEffect(() => { editor?.setEditable(editable, false) }, [editor, editable])
  useEffect(() => {
    const commit = () => {
      if (!dirty.current) return
      dirty.current = false
      callbacks.current.onCommit?.(lastValue.current)
    }
    window.document.addEventListener('cnote:flush-node-editors', commit)
    return () => { window.document.removeEventListener('cnote:flush-node-editors', commit); commit() }
  }, [])
  useEffect(() => {
    if (!editor || (value === lastValue.current && document === lastDocument.current)) return
    if (editor.view.composing) return
    lastValue.current = value
    lastDocument.current = document
    const content = markdownSource ? value : richTextContent(value, document)
    if (!markdownSource && JSON.stringify(editor.getJSON()) === JSON.stringify(content)) return
    editor.commands.setContent(content, { contentType: markdownSource ? 'markdown' : 'json', emitUpdate: false })
  }, [editor, value, document, markdownSource])
  return <div className={cn('nodrag nopan nowheel flex min-h-0 min-w-0 flex-col', className)} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dirty.current) {
      dirty.current = false
      callbacks.current.onCommit?.(lastValue.current)
    }
  }}>
    {editor && toolbar && editable && <EditorToolbar editor={editor} compact={compactToolbar} />}
    <EditorContent editor={editor} className={cn('custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto', contentClassName)} onClick={(event) => {
      const anchor = (event.target as HTMLElement).closest('a')
      const href = anchor?.getAttribute('href')?.trim()
      if (!href || !/^https?:\/\//i.test(href) || !onLinkClick) return
      event.preventDefault()
      event.stopPropagation()
      onLinkClick(href)
    }} />
  </div>
}

export function RichTextPreview({ source, placeholder }: { source: string; placeholder?: string }) {
  return <RichTextEditor value={source} editable={false} toolbar={false} placeholder={placeholder} markdownSource />
}
