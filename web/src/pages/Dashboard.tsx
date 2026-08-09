import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Clock } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function Dashboard() {
  const navigate = useNavigate()
  const { flows, createFlow, loadFlow, deleteFlow, initialize } = useFlowStore()
  const [showNewFlowDialog, setShowNewFlowDialog] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')
  const [newFlowDescription, setNewFlowDescription] = useState('')

  useEffect(() => {
    initialize()
  }, [initialize])

  // 创建新 Flow
  const handleCreateFlow = () => {
    if (!newFlowName.trim()) return

    const flow = createFlow(newFlowName, newFlowDescription)
    setShowNewFlowDialog(false)
    setNewFlowName('')
    setNewFlowDescription('')

    // 导航到 Flow 编辑器
    navigate(`/flows/${flow.id}`)
  }

  // 打开 Flow
  const handleOpenFlow = (id: string) => {
    loadFlow(id)
    navigate(`/flows/${id}`)
  }

  // 删除 Flow
  const handleDeleteFlow = (id: string) => {
    if (confirm('确定要删除这个 Flow 吗？')) {
      deleteFlow(id)
    }
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
              <a href="#flows" className="text-[#34c759] font-medium">Flows</a>
              <a href="#templates" className="text-[#6e6e73] hover:text-[#1d1d1f]">模板</a>
              <a href="#sources" className="text-[#6e6e73] hover:text-[#1d1d1f]">内容库</a>
              <a href="#outputs" className="text-[#6e6e73] hover:text-[#1d1d1f]">输出历史</a>
              <button
                onClick={() => navigate('/settings/api-keys')}
                className="text-[#6e6e73] hover:text-[#1d1d1f]"
              >
                设置
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 标题和创建按钮 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-[#1d1d1f] mb-2">我的 Flows</h2>
            <p className="text-[#6e6e73]">创建和管理你的工作流</p>
          </div>

          <Button
            onClick={() => setShowNewFlowDialog(true)}
            className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
          >
            <Plus className="w-5 h-5" />
            新建 Flow
          </Button>
        </div>

        {/* Flow 列表 */}
        {flows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="w-16 h-16 text-[#8e8e93] mb-4" />
              <h3 className="text-xl font-medium text-[#1d1d1f] mb-2">
                还没有 Flow
              </h3>
              <p className="text-[#6e6e73] mb-6">
                创建你的第一个工作流，开始创作之旅
              </p>
              <Button
                onClick={() => setShowNewFlowDialog(true)}
                className="bg-[#34c759] hover:bg-[#2fb350] text-white gap-2"
              >
                <Plus className="w-5 h-5" />
                创建第一个 Flow
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flows.map((flow) => (
              <Card
                key={flow.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => handleOpenFlow(flow.id)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{flow.name}</CardTitle>
                  {flow.description && (
                    <CardDescription>{flow.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-[#8e8e93]">
                    <div className="flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      <span>{flow.nodes?.length || 0} 个节点</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(flow.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteFlow(flow.id)
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* 新建 Flow 对话框 */}
      {showNewFlowDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-[#1d1d1f] mb-4">
              创建新 Flow
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                  Flow 名称
                </label>
                <Input
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  placeholder="如: 文章写作流程"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                  描述（可选）
                </label>
                <Input
                  value={newFlowDescription}
                  onChange={(e) => setNewFlowDescription(e.target.value)}
                  placeholder="简要描述这个 Flow 的用途"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowNewFlowDialog(false)
                  setNewFlowName('')
                  setNewFlowDescription('')
                }}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-[#34c759] hover:bg-[#2fb350] text-white"
                onClick={handleCreateFlow}
                disabled={!newFlowName.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
