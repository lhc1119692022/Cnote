import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Search, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { useFlowStore } from '@/stores/use-flow-store'
import { useTemplateStore } from '@/stores/use-template-store'

export function TemplatesManager() {
  const navigate = useNavigate()
  const { templates, deleteTemplate, incrementUsage, getAllCategories, initialize } = useTemplateStore()
  const { createFlow } = useFlowStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  useEffect(() => {
    initialize()
  }, [initialize])

  const filteredTemplates = templates.filter((template) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch = template.title.toLowerCase().includes(query) || template.description?.toLowerCase().includes(query)
    return matchesSearch && (!selectedCategory || template.category === selectedCategory)
  })

  const handleUseTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    const flow = createFlow(`基于 ${template.title} 的 Flow`, template.description, undefined, {
      nodes: template.nodes,
      edges: template.edges,
    })
    incrementUsage(template.id)
    navigate(`/flows/${flow.id}`)
  }

  const handleDeleteTemplate = (event: React.MouseEvent, id: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (confirm('确定要删除这个模板吗？')) deleteTemplate(id)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  return (
    <AppShell>
      <main className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <div className="relative w-full max-w-[400px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索模板..." className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm">使用指南</Button>
            <Button variant="secondary" size="sm">导入</Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedCategory(null)} className={selectedCategory === null ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>全部</button>
            {getAllCategories().map((category) => (
              <button key={category} type="button" onClick={() => setSelectedCategory(category)} className={selectedCategory === category ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>{category}</button>
            ))}
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FileText className="mb-4 h-10 w-10 text-muted-foreground/50" />
              <h2 className="text-sm font-medium">没有找到模板</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">在 Flow 编辑器中可将当前画布保存为模板</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,220px))]">
              {filteredTemplates.map((template) => (
                <article key={template.id} className="group relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary hover:shadow-sm">
                  <button type="button" onClick={() => handleUseTemplate(template.id)} className="block w-full text-left">
                    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden border-b border-border bg-background">
                      {template.thumbnail ? (
                        <img src={template.thumbnail} alt={template.title} className="h-full w-full bg-background object-contain" />
                      ) : (
                        <FileText className="h-12 w-12 text-muted-foreground/40" strokeWidth={1} />
                      )}
                    </div>

                    <div className="h-[88px] p-3">
                      <h3 className="mb-1 truncate text-[14px] font-medium text-foreground">{template.title}</h3>
                      <p className="min-h-[18px] line-clamp-1 text-[12px] leading-[18px] text-muted-foreground">
                        {template.description || '\u00a0'}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
                        <span>{formatDate(template.createdAt)}</span>
                        <span>含 {template.nodes.length} 个节点</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleDeleteTemplate(event, template.id)}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-all hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={`删除 ${template.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
