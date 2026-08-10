import { useEffect, useState } from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { useOutputStore } from '@/stores/use-output-store'
import type { Output } from '@/types/flow'

type OutputFormat = 'html' | 'markdown' | 'text'

export function OutputsManager() {
  const { outputs, deleteOutput, searchOutputs, getOutputsByFormat, getTotalWordCount, getOutputCount, initialize } = useOutputStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFormat, setSelectedFormat] = useState<OutputFormat | null>(null)

  useEffect(() => {
    initialize()
  }, [initialize])

  const filteredOutputs = searchQuery
    ? searchOutputs(searchQuery)
    : selectedFormat
      ? getOutputsByFormat(selectedFormat)
      : outputs

  const handleDownloadOutput = (event: React.MouseEvent, output: Output) => {
    event.stopPropagation()
    const blob = new Blob([output.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${output.title}.${output.format === 'text' ? 'txt' : output.format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDeleteOutput = (event: React.MouseEvent, id: string) => {
    event.stopPropagation()
    if (confirm('确定要删除这个输出吗？')) deleteOutput(id)
  }

  const formatCount = (count: number) => count >= 10000 ? `${(count / 10000).toFixed(1)}万` : count.toString()

  return (
    <AppShell>
      <main className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <div className="relative w-full max-w-[400px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索输出..." className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </div>
          <Button variant="secondary" size="sm">使用指南</Button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <p className="mb-4 text-[13px] text-muted-foreground">共 {getOutputCount()} 个输出，累计 {formatCount(getTotalWordCount())} 字</p>
          <div className="mb-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedFormat(null)} className={selectedFormat === null ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>全部 ({outputs.length})</button>
            {(['text', 'markdown', 'html'] as const).map((format) => (
              <button key={format} type="button" onClick={() => setSelectedFormat(format)} className={selectedFormat === format ? 'rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground' : 'rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted dark:border-0 dark:bg-secondary'}>{format.toUpperCase()} ({getOutputsByFormat(format).length})</button>
            ))}
          </div>

          {filteredOutputs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FileText className="mb-4 h-10 w-10 text-muted-foreground/50" />
              <h2 className="text-sm font-medium">没有找到输出</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">执行 Flow 后会在这里看到输出结果</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {filteredOutputs.map((output) => (
                <article key={output.id} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary">
                  <div className="flex h-36 items-center justify-center border-b border-border bg-background"><FileText className="h-10 w-10 text-muted-foreground/40" /></div>
                  <div className="p-4">
                    <h3 className="truncate text-sm font-medium">{output.title}</h3>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded bg-muted px-2 py-0.5">{output.format.toUpperCase()}</span><span>{formatCount(output.wordCount)} 字</span></div>
                    <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{output.content}</p>
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={(event) => handleDownloadOutput(event, output)}><Download className="h-3.5 w-3.5" />下载</Button>
                      <button type="button" onClick={(event) => handleDeleteOutput(event, output.id)} className="text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">删除</button>
                    </div>
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