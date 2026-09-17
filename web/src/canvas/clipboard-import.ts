import { screenToWorld } from '@/canvas'
import { importContentIntoNode } from '@/canvas/content-import-adapter'
import { expandDragIds, outlineGapOffset } from '@/canvas/grouping'
import { createAddableNode } from '@/canvas/node-factory'
import type { ContentNodeSpec, EdgeSpec, NodeSpec, Point, Size, Viewport } from '@/domain'
import { showMessage } from '@/lib/app-dialog'
import { classifyContentUrl, type ContentImportInput } from '@/lib/content-import'
import { CONTENT_NODE_DEFAULT_SIZE } from '@/lib/flow/node-dimensions'
import { useGraphStore } from '@/stores/graph-store'

const CLIPBOARD_READ_TIMEOUT_MS = 2000

let lastClientPoint = { x: 0, y: 0 }
let nodeClipboard: NodeSpec[] = []
let edgeClipboard: EdgeSpec[] = []
let pasteGeneration = 0
const NODE_CLIPBOARD_TYPE = 'application/x-cnote-nodes'
let nodeClipboardToken = ''

export function handleCanvasCopy(event: ClipboardEvent): boolean {
  if (isEditableTarget(event.target) || !event.clipboardData) return false
  if (!copySelectedNodes()) return false
  nodeClipboardToken = globalThis.crypto.randomUUID()
  event.clipboardData.setData(NODE_CLIPBOARD_TYPE, nodeClipboardToken)
  event.clipboardData.setData('text/plain', nodeClipboard.map((node) => node.label).join('\n'))
  event.preventDefault()
  return true
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
}

export function rememberClientPoint(clientX: number, clientY: number): void {
  lastClientPoint = { x: clientX, y: clientY }
}

export function lastPointerClient(): { x: number; y: number } {
  if (lastClientPoint.x || lastClientPoint.y) return lastClientPoint
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

export function canvasPositionFromClient(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number },
  viewport: Viewport,
  nodeSize: Size = CONTENT_NODE_DEFAULT_SIZE,
): Point {
  const world = screenToWorld({
    x: clientX - containerRect.left,
    y: clientY - containerRect.top,
  }, viewport)
  return {
    x: world.x - nodeSize.width / 2,
    y: world.y - nodeSize.height / 2,
  }
}

function canvasRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cnote-canvas="engine"]')
}

function positionAtClient(clientX?: number, clientY?: number, nodeSize: Size = CONTENT_NODE_DEFAULT_SIZE): Point {
  const root = canvasRoot()
  const rect = root?.getBoundingClientRect()
  const point = lastPointerClient()
  return canvasPositionFromClient(
    clientX ?? point.x,
    clientY ?? point.y,
    rect ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    useGraphStore.getState().view,
    nodeSize,
  )
}

function withClipboardTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('CLIPBOARD_READ_TIMEOUT')), CLIPBOARD_READ_TIMEOUT_MS)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function addContentNodeAt(position: Point): ContentNodeSpec {
  const node = createAddableNode('content', position) as ContentNodeSpec
  useGraphStore.getState().addNode(node)
  return node
}

export function createClipboardErrorNode(code: string, message: string, clientX?: number, clientY?: number): ContentNodeSpec {
  const created = addContentNodeAt(positionAtClient(clientX, clientY))
  const patch: Partial<ContentNodeSpec> = {
    state: 'error',
    parse: {
      requestId: globalThis.crypto?.randomUUID?.() || 'clipboard',
      revision: 1,
      completedAt: Date.now(),
      error: { code, message, retryable: code === 'CLIPBOARD_PERMISSION_DENIED' },
    },
  }
  useGraphStore.getState().updateNode(created.id, patch as Partial<NodeSpec>)
  useGraphStore.getState().commitHistory()
  return created
}

export async function importClipboardInputAt(input: ContentImportInput, clientX?: number, clientY?: number): Promise<void> {
  const created = addContentNodeAt(positionAtClient(clientX, clientY))
  await importContentIntoNode(created.id, input)
}

export async function importClipboardInputIntoSelectedNode(input: ContentImportInput): Promise<boolean> {
  const { currentDocument, selection } = useGraphStore.getState()
  if (!currentDocument || selection.length !== 1) return false
  const target = currentDocument.nodes.find((node) => node.id === selection[0])
  if (!target || target.kind !== 'content') return false
  const category = target.category
  if (category && category !== 'video' && category !== 'social' && category !== 'document') return false
  if (input.kind === 'text' && !input.text.trim()) return false
  await importContentIntoNode(target.id, input, category || undefined)
  return true
}

export async function importDroppedFile(file: File, clientX: number, clientY: number): Promise<void> {
  rememberClientPoint(clientX, clientY)
  const name = file.name.toLowerCase()
  if (name.endsWith('.json')) {
    showMessage('JSON 画布请使用工具栏的导入。')
    return
  }
  await importClipboardInputAt({
    kind: 'file',
    file,
    fileName: file.name,
    clipboardImage: file.type.startsWith('image/'),
  }, clientX, clientY)
}

export async function handleCanvasDrop(event: DragEvent): Promise<void> {
  const files = event.dataTransfer?.files
  if (!files?.length) return
  event.preventDefault()
  const list = Array.from(files)
  for (const [index, file] of list.entries()) {
    await importDroppedFile(file, event.clientX + index * 24, event.clientY + index * 24)
  }
}

export async function readSystemClipboardAndImport(clientX?: number, clientY?: number): Promise<boolean> {
  let clipboardPermissionIssue = false
  try {
    if (navigator.clipboard?.read) {
      try {
        const items = await withClipboardTimeout(navigator.clipboard.read())
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (!imageType) continue
          const blob = await withClipboardTimeout(item.getType(imageType))
          await importClipboardInputAt({
            kind: 'file',
            file: blob,
            fileName: `clipboard.${imageType.split('/')[1] || 'png'}`,
            clipboardImage: true,
          }, clientX, clientY)
          return true
        }
        for (const item of items) {
          const textType = item.types.includes('text/plain')
            ? 'text/plain'
            : item.types.find((type) => type.startsWith('text/'))
          if (!textType) continue
          const blob = await withClipboardTimeout(item.getType(textType))
          const text = await withClipboardTimeout(blob.text())
          if (!text.trim()) continue
          await importClipboardInputAt({ kind: 'text', text }, clientX, clientY)
          return true
        }
      } catch {
        clipboardPermissionIssue = true
      }
    }
    if (navigator.clipboard?.readText) {
      try {
        const text = await withClipboardTimeout(navigator.clipboard.readText())
        if (text.trim()) {
          await importClipboardInputAt({ kind: 'text', text }, clientX, clientY)
          return true
        }
      } catch {
        clipboardPermissionIssue = true
      }
    }
  } catch {
    clipboardPermissionIssue = true
  }

  if (!navigator.clipboard?.read && !navigator.clipboard?.readText) clipboardPermissionIssue = true
  if (clipboardPermissionIssue) {
    createClipboardErrorNode(
      'CLIPBOARD_PERMISSION_DENIED',
      '浏览器未允许读取剪贴板，请使用 Ctrl/Cmd+V 粘贴。',
      clientX,
      clientY,
    )
    return false
  }
  createClipboardErrorNode('INVALID_CONTENT', '剪贴板中没有可识别的文本、URL 或图片。', clientX, clientY)
  return false
}

export function copySelectedNodes(): boolean {
  const { currentDocument, selection } = useGraphStore.getState()
  if (!currentDocument || selection.length === 0) {
    nodeClipboard = []
    edgeClipboard = []
    return false
  }
  const copiedIds = new Set(expandDragIds(currentDocument.nodes, selection))
  nodeClipboard = currentDocument.nodes
    .filter((node) => copiedIds.has(node.id))
    .map((node) => structuredClone(node))
  edgeClipboard = currentDocument.edges
    .filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target))
    .map((edge) => structuredClone(edge))
  pasteGeneration = 0
  return nodeClipboard.length > 0
}

export function pasteCopiedNodes(): boolean {
  const graph = useGraphStore.getState()
  if (!graph.currentDocument || graph.isLocked || nodeClipboard.length === 0) return false
  pasteGeneration += 1
  const base = outlineGapOffset(nodeClipboard)
  graph.pasteNodes(nodeClipboard, { x: base.x * pasteGeneration, y: base.y * pasteGeneration }, edgeClipboard)
  return true
}

export async function handleCanvasPaste(event: ClipboardEvent): Promise<boolean> {
  if (isEditableTarget(event.target)) return false
  if (useGraphStore.getState().isLocked) return false
  const clipboard = event.clipboardData
  if (!clipboard) return pasteCopiedNodes()
  const token = clipboard.getData(NODE_CLIPBOARD_TYPE)
  if (token && token === nodeClipboardToken) {
    event.preventDefault()
    return pasteCopiedNodes()
  }

  const imageItem = Array.from(clipboard.items).find((item) => item.type.startsWith('image/'))
  if (imageItem) {
    event.preventDefault()
    const file = imageItem.getAsFile()
    const point = lastPointerClient()
    if (!file) {
      createClipboardErrorNode('INVALID_CONTENT', '剪贴板中的图片无法读取，请重试或选择本地文件。', point.x, point.y)
      return true
    }
    const input: ContentImportInput = {
      kind: 'file',
      file,
      fileName: file.name || 'clipboard.png',
      clipboardImage: true,
    }
    const imported = await importClipboardInputIntoSelectedNode(input)
    if (!imported) await importClipboardInputAt(input, point.x, point.y)
    return true
  }

  const text = clipboard.getData('text/plain')
  if (text.trim()) {
    event.preventDefault()
    const point = lastPointerClient()
    const classified = classifyContentUrl(text.trim())
    const input: ContentImportInput = { kind: 'text', text }
    const imported = await importClipboardInputIntoSelectedNode(input)
    if (!imported) {
      if (classified?.category === 'social') {
        await importClipboardInputAt(input, point.x, point.y)
      } else {
        await importClipboardInputAt(input, point.x, point.y)
      }
    }
    return true
  }

  if (nodeClipboard.length) {
    event.preventDefault()
    return pasteCopiedNodes()
  }
  return false
}
