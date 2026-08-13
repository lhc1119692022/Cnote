import { useEffect, useState } from 'react'
import { FileText, Plus, Search } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSourceStore } from '@/stores/use-source-store'
import type { ContentCategory, ContentNodeData } from '@/types/flow'
import { getContentCategoryVisual } from '@/lib/content-visuals'
import { emptyContentData } from '@/lib/content-import'
import { checksumText } from '@/lib/resource-storage'

const CONTENT_TYPES: { value: ContentCategory; label: string }[] = [
  { value: 'video', label: '视频' },
  { value: 'social', label: '社媒' },
  { value: 'document', label: '文档' },
  { value: 'data', label: '数据' },
  { value: 'presentation', label: '演示文稿' },
  { value: 'mindmap', label: '思维导图' },
  { value: 'image', label: '图片' },
]

export function SourcesManager() {
  const { sources, createSource, deleteSource, searchSources, getSourcesByCategory, initialize } = useSourceStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<ContentCategory | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<ContentCategory>('document')

  useEffect(() => {
    initialize()
  }, [initialize])

  const filteredSources = searchQuery
    ? searchSources(searchQuery)
    : selectedType
      ? getSourcesByCategory(selectedType)
      : sources

  const resetDialog = () => {
    setShowNewDialog(false)
    setNewTitle('')
    setNewContent('')
    setNewType('document')
  }

  const handleCreateSource = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    const checksum = await checksumText(newContent)
    const nodeData: ContentNodeData = {
      ...emptyContentData(newTitle),
      category: newType,
      subtype: newType === 'document' ? 'plain-text' : null,
      state: 'ready',
      source: { kind: 'text', text: newContent, checksum, mimeType: 'text/plain' },
      payload: newType === 'document' ? { kind: 'document', rawText: newContent, plainText: newContent } : undefined,
      preview: { title: newTitle, description: newContent.slice(0, 160), badge: CONTENT_TYPES.find((item) => item.value === newType)?.label },
    }
    createSource(newTitle, nodeData)
    resetDialog()
  }

  const handleDeleteSource = (event: React.MouseEvent, id: string) => {
    event.stopPropagation()
    if (confirm('确定要删除这个内容吗？')) deleteSource(id)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  const getTypeLabel = (type: ContentCategory | null) =>
    CONTENT_TYPES.find((item) => item.value === type)?.label || type

  const getSourceVisual = (source: (typeof sources)[number]) =>
    getContentCategoryVisual(undefined, source.nodeData.category || undefined)

  const sourceDescription = (source: (typeof sources)[number]) => {
    const payload = source.nodeData.payload
    if (payload?.kind === 'document') return payload.plainText
    if (payload?.kind === 'social') return payload.bodyText
    if (payload?.kind === 'video') return payload.transcript || payload.title || source.nodeData.preview?.description || ''
    return source.nodeData.preview?.description || JSON.stringify(payload || '')
  }

  return (
    <AppShell>
      <main className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <div className="relative w-full max-w-[400px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索内容..."
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">使用指南</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowNewDialog(true)}>
              <Plus className="h-3.5 w-3.5" />
              新建内容
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedType(null)}
              className={selectedType === null ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}
            >
              全部 ({sources.length})
            </button>
            {CONTENT_TYPES.map((type) => { const visual = getContentCategoryVisual(type.value); const Icon = visual?.icon || FileText; return (
              <button
                key={type.value}
                type="button"
                onClick={() => setSelectedType(type.value)}
                className={selectedType === type.value ? 'flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}
              >
                <Icon className={`h-3.5 w-3.5 ${selectedType === type.value ? '' : visual?.iconClass || ''}`} />
                {type.label} ({getSourcesByCategory(type.value).length})
              </button>
            )})}
          </div>

          {filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FileText className="mb-4 h-10 w-10 text-muted-foreground/50" />
              <h2 className="text-sm font-medium">没有找到内容</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">开始添加你的第一个内容</p>
              <Button size="sm" className="mt-6 gap-1.5" onClick={() => setShowNewDialog(true)}>
                <Plus className="h-3.5 w-3.5" />
                新建内容
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {filteredSources.map((source) => { const visual = getSourceVisual(source); const Icon = visual?.icon || FileText; return (
                <article key={source.id} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary">
                  <div className={`flex h-36 items-center justify-center border-b border-border ${visual?.iconSurfaceClass || 'bg-background'}`}>
                    <Icon className={`h-10 w-10 ${visual?.iconClass || 'text-muted-foreground/40'}`} />
                  </div>
                  <div className="p-4">
                    <h3 className="truncate text-sm font-medium">{source.title}</h3>
                    <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-2 py-0.5">{getTypeLabel(source.nodeData.category)}</span>
                      <span>{formatDate(source.createdAt)}</span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{sourceDescription(source)}</p>
                    <div className="mt-4 flex justify-end">
                      <button type="button" onClick={(event) => handleDeleteSource(event, source.id)} className="text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">删除</button>
                    </div>
                  </div>
                </article>
              )})}
            </div>
          )}
        </div>
      </main>

      <Dialog open={showNewDialog} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-base">创建新内容</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <label className="block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">标题</span>
              <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="输入内容标题" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
            </label>
            <div>
              <span className="mb-2 block text-[13px] font-medium text-muted-foreground">类型</span>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((type) => (
                  <button key={type.value} type="button" onClick={() => setNewType(type.value)} className={newType === type.value ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>{type.label}</button>
                ))}
              </div>
            </div>
            <label className="block text-[13px] text-muted-foreground">
              <span className="mb-2 block font-medium">内容</span>
              <textarea value={newContent} onChange={(event) => setNewContent(event.target.value)} placeholder="输入内容..." className="h-32 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
            </label>
          </div>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={resetDialog}>取消</Button>
            <Button className="flex-1" onClick={handleCreateSource} disabled={!newTitle.trim() || !newContent.trim()}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
