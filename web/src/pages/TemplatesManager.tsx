import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Search } from 'lucide-react'
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
    event.stopPropagation()
    if (confirm('确定要删除这个模板吗？')) deleteTemplate(id)
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {filteredTemplates.map((template) => (
                <article key={template.id} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary">
                  <button type="button" onClick={() => handleUseTemplate(template.id)} className="block w-full text-left">
                    <div className="flex h-36 items-center justify-center border-b border-border bg-background">
                      <FileText className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                    <div className="p-4">
                      <h3 className="truncate text-sm font-medium">{template.title}</h3>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{template.description}</p>
                      <p className="mt-3 text-xs text-muted-foreground">{template.nodes.length} 个节点 · 使用 {template.usageCount} 次</p>
                    </div>
                  </button>
                  <div className="flex justify-end px-4 pb-4">
                    <button type="button" onClick={(event) => handleDeleteTemplate(event, template.id)} className="text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">删除</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}