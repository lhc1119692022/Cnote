import { useEffect, useState } from 'react'
import { Plus, Trash2, FileText } from 'lucide-react'
import { useTemplateStore } from '@/stores/use-template-store'
import { useFlowStore } from '@/stores/use-flow-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function TemplatesManager() {
  const { templates, deleteTemplate, incrementUsage, getAllCategories, initialize } =
    useTemplateStore()
  const { createFlow, loadFlow } = useFlowStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  useEffect(() => {
    initialize()
  }, [initialize])

  // 筛选模板
  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory = !selectedCategory || template.category === selectedCategory

    return matchesSearch && matchesCategory
  })

  // 获取所有分类
  const categories = getAllCategories()

  // 使用模板
  const handleUseTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId)
    if (!template) return

    // 创建新 Flow
    const newFlow = createFlow(
      `基于 ${template.title} 的 Flow`,
      template.description
    )

    // 加载 Flow
    loadFlow(newFlow.id)

    // 增加使用次数
    incrementUsage(templateId)

    // TODO: 导航到 Flow 编辑器
    window.location.href = `/flows/${newFlow.id}`
  }

  // 删除模板
  const handleDeleteTemplate = (id: string) => {
    if (confirm('确定要删除这个模板吗？')) {
      deleteTemplate(id)
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
              <a href="/templates" className="text-[#34c759] font-medium">
                模板
              </a>
              <a href="/sources" className="text-[#6e6e73] hover:text-[#1d1d1f]">
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
        {/* 标题和搜索 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-2">模板库</h2>
            <p className="text-[#6e6e73]">快速开始你的创作</p>
          </div>

          <div className="flex items-center gap-3">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模板..."
              className="w-64"
            />
          </div>
        </div>

        {/* 分类筛选 */}
        {categories.length > 0 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                selectedCategory === null
                  ? 'bg-[#34c759] text-white'
                  : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
              }`}
            >
              全部
            </button>
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                  selectedCategory === category
                    ? 'bg-[#34c759] text-white'
                    : 'bg-white text-[#6e6e73] hover:bg-[#f2f2f7]'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        )}

        {/* 模板列表 */}
        {filteredTemplates.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="w-16 h-16 text-[#8e8e93] mb-4" />
              <h3 className="text-xl font-medium text-[#1d1d1f] mb-2">
                没有找到模板
              </h3>
              <p className="text-[#6e6e73]">
                {searchQuery || selectedCategory
                  ? '尝试调整筛选条件'
                  : '开始创建你的第一个模板'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                className="hover:shadow-lg transition-shadow"
              >
                <CardHeader>
                  <CardTitle className="text-lg">{template.title}</CardTitle>
                  {template.description && (
                    <CardDescription>{template.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-[#8e8e93] mb-4">
                    <div className="flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      <span>{template.nodes.length} 个节点</span>
                    </div>
                    {template.category && (
                      <span className="px-2 py-1 bg-[#f2f2f7] rounded text-xs">
                        {template.category}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-[#8e8e93] mb-4">
                    使用 {template.usageCount} 次 · {formatDate(template.createdAt)}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="flex-1 bg-[#34c759] hover:bg-[#2fb350] text-white"
                      size="sm"
                      onClick={() => handleUseTemplate(template.id)}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      使用模板
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-8 h-8"
                      onClick={() => handleDeleteTemplate(template.id)}
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
