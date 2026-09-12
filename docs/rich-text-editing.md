# Rich-text editing

Text nodes, sticky notes, and manually created text/documents use the shared
`RichTextEditor` (Tiptap/ProseMirror). Canvas and panel render the same schema and
styles. Focusing a text node does not replace it with a Markdown textarea.

The persisted document is `RichTextDocument` with `format: 'tiptap-json'` and
`json`. Its plain-text projection is used for search, character counts, and AI
context. Formatting-only updates must synchronize even when plain text is
unchanged. No Markdown source is generated on save, and no historical Markdown
document migration is provided.

Markdown is accepted as an input format for file imports, pasted text, and AI
responses. It is parsed into the editor schema rather than exposed in an editor.
Read-only AI messages share the rich-text renderer. Code-block contents remain
literal. URLs, AI prompts, and generation parameters remain plain-text controls.
Mind maps use the structural outline editor, without a Markdown source tab.

Run `npm run test:rich-text` in `web` to test the actual editor and React controls:
JSON persistence, format-only synchronization, selection stability, undo/redo,
Chinese text, Markdown import, tables, and unsafe-link filtering. Also run
`npm run build` and `npm run lint`. Check native Chinese IME composition manually
in the desktop build; DOM tests do not emulate an OS input method.
