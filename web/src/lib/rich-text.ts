import type { JSONContent } from '@tiptap/core'
import { generateText } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import type { RichTextDocument, TextPayload } from '@/types/flow'

export function richTextExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    TableKit, TaskList, TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: false }),
  ]
}

export function richTextContent(value: string, document?: RichTextDocument): JSONContent {
  return document?.plainText === value ? document.json : plainTextDocument(value).json
}

export function plainTextDocument(value: string): RichTextDocument {
  return {
    version: 1, format: 'tiptap-json', plainText: value,
    json: { type: 'doc', content: value.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) },
  }
}

export function richTextPayload(value: string, document: RichTextDocument): TextPayload {
  return { kind: 'text', value, format: 'rich-text', document }
}

export function importMarkdownDocument(source: string): RichTextDocument {
  const extensions = richTextExtensions()
  const json = new MarkdownManager({ extensions, markedOptions: { gfm: true, breaks: true } }).parse(source)
  return { version: 1, format: 'tiptap-json', json, plainText: generateText(json, extensions) }
}

export function importedTextPayload(value: string, markdown: boolean): TextPayload {
  const document = markdown ? importMarkdownDocument(value) : plainTextDocument(value)
  return richTextPayload(document.plainText, document)
}
