import { memo, useRef, useState, type ChangeEvent } from 'react'
import { NodeProps, Position } from 'reactflow'
import {
  FileUp,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Presentation,
  Share2,
  Sparkles,
  Table2,
  Type,
  Video,
  Workflow,
  Youtube,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFlowStore } from '@/stores/use-flow-store'
import { NodeHandle, NodeHoverToolbar, NodeResizeArc, NodeResourceLostNotice } from './NodeChrome'

export type ContentMode = 'text' | 'image' | 'video' | 'table' | 'youtube' | 'pdf'
export type ContentLeafType = ContentMode

export interface ContentNodeData {
  label?: string
  mode?: ContentMode
  content?: string
  fileName?: string
  resourceLost?: boolean
  disabled?: boolean
  enabled?: boolean
}

interface ContentTypeOption {
  mode: ContentLeafType
  label: string
  title: string
  icon: LucideIcon
  iconClass: string
}

type ContentCategoryId = 'video' | 'social' | 'document' | 'data' | 'presentation' | 'mindmap'
type PendingImportKind = ContentLeafType | 'auto' | 'document' | 'presentation' | 'mindmap'

interface ContentCategoryOption {
  id: ContentCategoryId
  label: string
  icon: LucideIcon
  iconClass: string
  iconSurfaceClass: string
  hoverClass: string
}

const contentCategoryOptions: ContentCategoryOption[] = [
  { id: 'video', label: '视频', icon: Youtube, iconClass: 'text-red-500', iconSurfaceClass: 'bg-red-50', hoverClass: 'hover:border-red-200 hover:bg-red-50/60' },
  { id: 'social', label: '社媒', icon: Share2, iconClass: 'text-pink-500', iconSurfaceClass: 'bg-pink-50', hoverClass: 'hover:border-pink-200 hover:bg-pink-50/60' },
  { id: 'document', label: '文档', icon: FileText, iconClass: 'text-blue-500', iconSurfaceClass: 'bg-blue-50', hoverClass: 'hover:border-blue-200 hover:bg-blue-50/60' },
  { id: 'data', label: '数据', icon: Table2, iconClass: 'text-emerald-500', iconSurfaceClass: 'bg-emerald-50', hoverClass: 'hover:border-emerald-200 hover:bg-emerald-50/60' },
  { id: 'presentation', label: '演示文稿', icon: Presentation, iconClass: 'text-orange-500', iconSurfaceClass: 'bg-orange-50', hoverClass: 'hover:border-orange-200 hover:bg-orange-50/60' },
  { id: 'mindmap', label: '思维导图', icon: Workflow, iconClass: 'text-violet-500', iconSurfaceClass: 'bg-violet-50', hoverClass: 'hover:border-violet-200 hover:bg-violet-50/60' },
]

export const contentTypeOptions: ContentTypeOption[] = [
  { mode: 'text', label: '文本', title: '文本输入', icon: Type, iconClass: 'text-slate-600' },
  { mode: 'youtube', label: 'YouTube', title: 'YouTube 输入', icon: Youtube, iconClass: 'text-rose-500' },
  { mode: 'pdf', label: 'PDF', title: 'PDF 输入', icon: FileUp, iconClass: 'text-orange-500' },
  { mode: 'image', label: '图片', title: '图片输入', icon: ImageIcon, iconClass: 'text-violet-500' },
  { mode: 'video', label: '视频', title: '视频输入', icon: Video, iconClass: 'text-emerald-500' },
  { mode: 'table', label: '表格', title: '表格输入', icon: Table2, iconClass: 'text-cyan-500' },
]

const modeLabels: Record<ContentMode, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  table: '表格',
  youtube: 'YouTube',
  pdf: 'PDF',
}

function useNodeData(id: string) {
  const updateNode = useFlowStore((state) => state.updateNode)
  return (updates: Partial<ContentNodeData>) => {
    const current = useFlowStore.getState().nodes.find((node) => node.id === id)
    if (current) updateNode(id, { data: { ...current.data, ...updates } })
  }
}

/** Conversion node: choosing a tile switches this node to the selected content type. */
export const ContentNode = memo((props: NodeProps<ContentNodeData>) => {
  const { id, data, selected } = props
  const updateNode = useFlowStore((state) => state.updateNode)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFileMode, setPendingFileMode] = useState<PendingImportKind | null>(null)

  if (data.mode) return <ContentLeafNode {...props} />

  const openResourcePicker = (mode: PendingImportKind) => {
    setPendingFileMode(mode)
    const input = fileInputRef.current
    if (!input) return
    input.accept = mode === 'auto'
      ? '.txt,.md,.markdown,.doc,.docx,.pdf,.csv,.tsv,.xls,.xlsx,.ppt,.pptx,image/*,video/*'
      : mode === 'document'
        ? '.txt,.md,.markdown,.doc,.docx,.pdf,application/pdf'
        : mode === 'presentation'
          ? '.ppt,.pptx,.pdf,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : mode === 'mindmap'
            ? '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,image/*,application/pdf'
            : mode === 'pdf'
      ? '.pdf,application/pdf'
      : mode === 'image'
        ? 'image/*'
        : mode === 'video'
          ? 'video/*'
          : '.csv,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    input.value = ''
    input.click()
  }

  const handleCategoryClick = (category: ContentCategoryId) => {
    if (category === 'social') {
      updateNode(id, { type: 'browser', data: { ...data, label: '社媒节点', url: '', status: 'idle', resourceLost: false, disabled: false } })
    } else if (category === 'video') {
      openResourcePicker('video')
    } else if (category === 'document') {
      openResourcePicker('document')
    } else if (category === 'data') {
      openResourcePicker('table')
    } else if (category === 'presentation') {
      openResourcePicker('presentation')
    } else {
      openResourcePicker('mindmap')
    }
  }

  const handleResourceSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const importKind = pendingFileMode
    setPendingFileMode(null)
    event.target.value = ''
    if (!file || !importKind) return

    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    const detectedMode: ContentLeafType = importKind === 'auto'
      ? file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
          : file.type === 'application/pdf' || extension === 'pdf' ? 'pdf'
            : /^(csv|tsv|xls|xlsx)$/.test(extension) ? 'table'
              : 'text'
      : importKind === 'document' || importKind === 'presentation'
        ? extension === 'pdf' ? 'pdf' : 'text'
        : importKind === 'mindmap'
          ? extension === 'pdf' ? 'pdf' : 'image'
          : importKind
    const mode = detectedMode

    const nextData = {
      ...data,
      label: `${modeLabels[mode]}节点`,
      mode,
      content: mode === 'text' ? `已导入本地文件：${file.name}` : URL.createObjectURL(file),
      fileName: file.name,
      resourceLost: false,
      disabled: false,
    }

    if ((mode === 'text' && (file.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(file.name))) || (mode === 'table' && (file.type.startsWith('text/') || /\.(csv|tsv)$/i.test(file.name)))) {
      const reader = new FileReader()
      reader.onload = () => updateNode(id, { type: mode, data: { ...nextData, content: String(reader.result || '') } })
      reader.readAsText(file)
      return
    }

    updateNode(id, { type: mode, data: nextData })
  }

  return (
    <div className={`node-card node-panel-shadow group relative flex h-full min-h-[420px] w-full min-w-[540px] flex-col rounded-[24px] border bg-card ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={540} minHeight={420} />

      <div className="flex min-h-0 flex-1 items-center justify-center px-12 py-6">
        <div className="w-full">
          <h3 className="mb-5 text-center text-lg font-semibold text-foreground">选择内容类型</h3>
          <div className="grid grid-cols-3 gap-3">
            {contentCategoryOptions.map((option) => {
              const Icon = option.icon
              return (
                <button key={option.id} type="button" onClick={() => handleCategoryClick(option.id)} className={`nodrag flex h-24 flex-col items-center justify-center gap-2.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${option.hoverClass}`}>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${option.iconSurfaceClass}`}><Icon className={`h-6 w-6 stroke-[1.8] ${option.iconClass}`} /></span>
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => openResourcePicker('auto')} className="nodrag mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FileUp className="h-4.5 w-4.5 text-primary" /><span>导入本地内容</span></button>
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 shrink-0 text-orange-400" /><span>可直接粘贴 URL、文本或图片，自动识别内容类型</span></div>
        </div>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleResourceSelected} aria-hidden="true" tabIndex={-1} />
    </div>
  )
})

/** Content node shown after the card switches to a concrete content type. */
export const ContentLeafNode = memo(({ id, data, selected }: NodeProps<ContentNodeData>) => {
  const mode = data.mode || 'text'
  const config = contentTypeOptions.find((option) => option.mode === mode) || contentTypeOptions[0]
  const [content, setContent] = useState(data.content || '')
  const updateData = useNodeData(id)
  const resourceLost = Boolean(data.resourceLost)
  const disabled = Boolean(data.disabled && !resourceLost)

  const updateContent = (value: string) => {
    setContent(value)
    updateData({ content: value, resourceLost: false })
  }

  const markResource = (lost: boolean) => updateData(lost ? { resourceLost: true } : { resourceLost: false, disabled: false, enabled: true })
  const Icon = config.icon

  return (
    <div className={`node-card node-panel-shadow group relative flex h-full min-h-[360px] w-full min-w-[420px] flex-col overflow-visible rounded-[22px] border bg-card ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'} ${disabled ? 'opacity-50 grayscale' : ''}`}>
      <NodeHandle type="target" position={Position.Left} id="in" />
      <NodeHandle type="source" position={Position.Right} id="out" />
      <NodeHoverToolbar nodeId={id} />
      <NodeResizeArc nodeId={id} minWidth={420} minHeight={360} />
      {resourceLost && <NodeResourceLostNotice />}

      <div className="flex h-[76px] items-center justify-between border-b border-border px-7">
        <div className="flex items-center gap-4"><Icon className={`h-8 w-8 stroke-[1.7] ${config.iconClass}`} /><span className="text-[27px] font-medium tracking-tight text-foreground">{config.title}</span></div>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label="展开编辑器"><Maximize2 className="h-5 w-5" /></Button>
      </div>

      <div className="relative min-h-[220px] flex-1 bg-muted/10 p-7">
        {mode === 'text' && <textarea value={content} onChange={(event) => updateContent(event.target.value)} placeholder="输入文本..." className="nodrag nowheel h-[170px] w-full resize-none bg-transparent text-[25px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60" />}
        {mode === 'youtube' && <div className="space-y-4"><Input value={content} onChange={(event) => updateContent(event.target.value)} placeholder="粘贴 YouTube 链接..." className="nodrag h-12 bg-card text-base" /><div className="flex h-28 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground"><Youtube className="mr-2 h-6 w-6 text-rose-500" />{content ? '视频链接已添加' : '等待加载视频'}</div></div>}
        {mode === 'pdf' && <div className="space-y-4"><Input value={content} onChange={(event) => updateContent(event.target.value)} placeholder="粘贴 PDF 链接..." className="nodrag h-12 bg-card text-base" /><div className="flex h-28 items-center justify-center rounded-xl bg-orange-50 text-sm text-orange-600"><FileUp className="mr-2 h-6 w-6" />{content ? 'PDF 链接已添加' : '等待添加 PDF'}</div></div>}
        {mode === 'image' && <div className="flex h-[170px] items-center justify-center rounded-xl border border-dashed border-violet-200 bg-violet-50/60">{content ? <img src={content} alt="" onLoad={() => markResource(false)} onError={() => markResource(true)} className="max-h-full max-w-full rounded-lg object-contain" /> : <><ImageIcon className="mr-2 h-7 w-7 text-violet-500" /><span className="text-sm text-muted-foreground">粘贴或上传图片</span></>}</div>}
        {mode === 'video' && <div className="flex h-[170px] items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60">{content ? <video src={content} muted preload="metadata" onLoadedData={() => markResource(false)} onError={() => markResource(true)} className="max-h-full max-w-full rounded-lg object-contain" /> : <><Video className="mr-2 h-7 w-7 text-emerald-500" /><span className="text-sm text-muted-foreground">粘贴或上传视频</span></>}</div>}
        {mode === 'table' && <div className="nodrag space-y-3 overflow-auto">{data.fileName && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Table2 className="h-4 w-4 text-cyan-500" /><span className="truncate">{data.fileName}</span></div>}<table className="w-full border-collapse text-sm"><tbody>{[0, 1, 2].map((row) => <tr key={row}>{[0, 1, 2].map((col) => <td key={col} className="border border-border px-2 py-2"><input type="text" className="w-full bg-transparent outline-none" placeholder="..." /></td>)}</tr>)}</tbody></table></div>}
        {mode === 'text' && <Button variant="outline" size="icon" className="nodrag absolute bottom-6 right-7 h-11 w-11 rounded-xl bg-card text-muted-foreground" aria-label="语音输入"><Mic className="h-5 w-5" /></Button>}
      </div>
      <div className="flex h-12 items-center justify-between border-t border-border px-7 text-sm text-muted-foreground"><span>{content.length} 字符</span><span>{modeLabels[mode]}</span></div>
    </div>
  )
})

ContentNode.displayName = 'ContentNode'
ContentLeafNode.displayName = 'ContentLeafNode'
