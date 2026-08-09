import { useEffect, useState } from 'react'
import { Trash2, Download, Search, FileText, Calendar } from 'lucide-react'
import { useOutputStore } from '@/stores/use-output-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function OutputsManager() {
  const {
    outputs,
    deleteOutput,
    searchOutputs,
    getOutputsByFormat,
    getTotalWordCount,
    getOutputCount,
    initialize,
  } = useOutputStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFormat, setSelectedFormat] = useState<'html' | 'markdown' | 'text' | null>(null)

  useEffect(() => {
    initialize()
  }, [initialize])

  // 筛选输出
  const filteredOutputs = searchQuery
    ? searchOutputs(searchQuery)
    : selectedFormat
    ? getOutputsByFormat(selectedFormat)
    : outputs

  // 删除输出
  const handleDeleteOutput = (id: string) => {
    if (confirm('确定要删除这个输出吗？')) {
      deleteOutput(id)
    }
  }

  // 下载输出
  const handleDownloadOutput = (output: any) => {
    const blob = new Blob([output.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${output.title}.${output.format === 'text' ? 'txt' : output.format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 格式化字数
  const formatWordCount = (count: number) => {
    if (count >= 10000) {
      return `${(count / 10000).toFixed(1)}万`
    }
    return count.toString()
  }

  const totalWordCount = getTotalWordCount()
  const outputCount = getOutputCount()

  return (
    <div className="min-h-screen bg-[#f2f2f7]">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-[#d2d2d7]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#34c759] rounded-xl flex items-center justify-center">
                <span className="text-xl text-white font-bold">C</span>
              </div>
              <h1 className="text-2xl font-bold text-[#1d1d1f]">Cnote</h1>
            </div>

            <nav className="flex items-center gap-6">
              <a href="/dashboard" className="text-[#6e6e73] hover:text-[#1d1d1f]">
                Flows
              </a>
              <a href="/templates" className="text-[#6e6e73] hover:text-[#1d1d1f]">
                模板
              </a>
              <a href="/sources" className="text-[#6e6e73] hover:text-[#1d1d1f]">
                内容库
              </a>
              <a href="/outputs" className="text-[#34c759] font-medium">
                输出历史
              </a>
              <a href="/settings" className="text-[#6e6e73] hover:text-[#1d1d1f]">
                设置
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 标题和统计 */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-2">输出历史</h2>
            <p className="text-[#6e6e73]">
              共 {outputCount} 个输出，累计 {formatWordCount(totalWordCount)} 字
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e8e93]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索输出..."
              className="w-64 pl-10"
            />
          </div>
        </div>

        {/* 格式筛选 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setSelectedFormat(null)}
            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
              selectedFormat === null
                ? 'bg-[#34c759] text-white'
                : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
            }`}
          >
            全部 ({outputs.length})
          </button>
          {(['text', 'markdown', 'html'] as const).map((format) => {
            const count = getOutputsByFormat(format).length
            return (
              <button
                key={format}
                onClick={() => setSelectedFormat(format)}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                  selectedFormat === format
                    ? 'bg-[#34c759] text-white'
                    : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
                }`}
              >
                {format.toUpperCase()} ({count})
              </button>
            )
          })}
        </div>

        {/* 输出列表 */}
        {filteredOutputs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="w-16 h-16 text-[#8e8e93] mb-4" />
              <h3 className="text-xl font-medium text-[#1d1d1f] mb-2">
                没有找到输出
              </h3>
              <p className="text-[#6e6e73]">
                {searchQuery || selectedFormat
                  ? '尝试调整筛选条件'
                  : '执行 Flow 后会在这里看到输出结果'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredOutputs.map((output) => (
              <Card key={output.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{output.title}</CardTitle>
                      <div className="flex items-center gap-3 mt-2 text-sm text-[#8e8e93]">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{formatDate(output.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="w-4 h-4" />
                          <span>{formatWordCount(output.wordCount)} 字</span>
                        </div>
                        <span className="px-2 py-1 bg-[#f2f2f7] rounded text-xs">
                          {output.format.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-3 mb-4 whitespace-pre-wrap">
                    {output.content}
                  </CardDescription>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadOutput(output)}
                    >
                      <Download className="w-4 h-4 mr-1" />
                      下载
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-8 h-8"
                      onClick={() => handleDeleteOutput(output.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
