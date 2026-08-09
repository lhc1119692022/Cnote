import { useEffect, useState } from 'react'
import { Plus, Trash2, Edit, Search } from 'lucide-react'
import { useSourceStore } from '@/stores/use-source-store'
import type { ContentMode } from '@/types/flow'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const CONTENT_TYPES: { value: ContentMode; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'table', label: '表格' },
  { value: 'pdf', label: 'PDF' },
]

export function SourcesManager() {
  const { sources, createSource, deleteSource, searchSources, getSourcesByType, initialize } =
    useSourceStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<ContentMode | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<ContentMode>('text')

  useEffect(() => {
    initialize()
  }, [initialize])

  // 筛选内容
  const filteredSources = searchQuery
    ? searchSources(searchQuery)
    : selectedType
    ? getSourcesByType(selectedType)
    : sources

  // 创建新内容源
  const handleCreateSource = () => {
    if (!newTitle.trim() || !newContent.trim()) return

    createSource(newTitle, newContent, newType)
    setShowNewDialog(false)
    setNewTitle('')
    setNewContent('')
    setNewType('text')
  }

  // 删除内容源
  const handleDeleteSource = (id: string) => {
    if (confirm('确定要删除这个内容吗？')) {
      deleteSource(id)
    }
  }

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  // 获取类型标签
  const getTypeLabel = (type: ContentMode) => {
    return CONTENT_TYPES.find((t) => t.value === type)?.label || type
  }

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
              <a href="/sources" className="text-[#34c759] font-medium">
                内容库
              </a>
              <a href="/outputs" className="text-[#6e6e73] hover:text-[#1d1d1f]">
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
        {/* 标题和操作 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-2">内容库</h2>
            <p className="text-[#6e6e73]">管理你的内容素材</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e8e93]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索内容..."
                className="w-64 pl-10"
              />
            </div>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
            >
              <Plus className="w-5 h-5" />
              新建内容
            </Button>
          </div>
        </div>

        {/* 类型筛选 */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedType(null)}
            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
              selectedType === null
                ? 'bg-[#34c759] text-white'
                : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
            }`}
          >
            全部 ({sources.length})
          </button>
          {CONTENT_TYPES.map((type) => {
            const count = getSourcesByType(type.value).length
            return (
              <button
                key={type.value}
                onClick={() => setSelectedType(type.value)}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                  selectedType === type.value
                    ? 'bg-[#34c759] text-white'
                    : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
                }`}
              >
                {type.label} ({count})
              </button>
            )
          })}
        </div>

        {/* 内容列表 */}
        {filteredSources.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Search className="w-16 h-16 text-[#8e8e93] mb-4" />
              <h3 className="text-xl font-medium text-[#1d1d1f] mb-2">
                没有找到内容
              </h3>
              <p className="text-[#6e6e73] mb-6">
                {searchQuery || selectedType
                  ? '尝试调整筛选条件'
                  : '开始添加你的第一个内容'}
              </p>
              <Button
                onClick={() => setShowNewDialog(true)}
                className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
              >
                <Plus className="w-5 h-5" />
                创建第一个内容
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSources.map((source) => (
              <Card key={source.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{source.title}</CardTitle>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-1 bg-[#f2f2f7] rounded text-xs">
                          {getTypeLabel(source.type)}
                        </span>
                        <span className="text-xs text-[#8e8e93]">
                          {formatDate(source.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-3 mb-4">
                    {source.content}
                  </CardDescription>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        // TODO: 实现编辑功能
                        console.log('Edit source:', source.id)
                      }}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-8 h-8"
                      onClick={() => handleDeleteSource(source.id)}
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

      {/* 新建内容对话框 */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新内容</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                标题
              </label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="输入内容标题..."
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                类型
              </label>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setNewType(type.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      newType === type.value
                        ? 'bg-[#34c759] text-white'
                        : 'bg-[#f2f2f7] text-[#6e6e73] hover:bg-[#e5e5ea]'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                内容
              </label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="输入内容..."
                className="w-full h-32 px-3 py-2 border border-[#d2d2d7] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#34c759] text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowNewDialog(false)
                setNewTitle('')
                setNewContent('')
                setNewType('text')
              }}
            >
              取消
            </Button>
            <Button
              className="flex-1 bg-[#34c759] hover:bg-[#2fb350] text-white"
              onClick={handleCreateSource}
              disabled={!newTitle.trim() || !newContent.trim()}
            >
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
