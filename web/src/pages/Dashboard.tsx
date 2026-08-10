import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Search, FolderOpen, Folder, Trash2 } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'

export function Dashboard() {
  const navigate = useNavigate()
  const { flows, folders, createFlow, createFolder, deleteFolder, moveFlowToFolder, loadFlow, deleteFlow, initialize } = useFlowStore()
  const { templates, incrementUsage, initialize: initializeTemplates } = useTemplateStore()
  const [showNewFlowDialog, setShowNewFlowDialog] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')
  const [newFlowDescription, setNewFlowDescription] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)

  useEffect(() => {
    initialize()
    initializeTemplates()
  }, [initialize, initializeTemplates])

  const handleCreateFlow = () => {
    if (!newFlowName.trim()) return
    const template = selectedTemplateId
      ? templates.find((item) => item.id === selectedTemplateId)
      : undefined
    const flow = createFlow(
      newFlowName,
      newFlowDescription,
      selectedFolderId || undefined,
      template ? { nodes: template.nodes, edges: template.edges } : undefined
    )
    if (template) incrementUsage(template.id)

    setShowNewFlowDialog(false)
    setNewFlowName('')
    setNewFlowDescription('')
    setSelectedTemplateId(null)
    setSelectedFolderId(null)
    navigate(`/flows/${flow.id}`)
  }

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return
    const folder = createFolder(newFolderName)
    setActiveFolderId(folder.id)
    setShowNewFolderDialog(false)
    setNewFolderName('')
  }

  const handleDeleteFolder = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirm('确定要删除这个文件夹吗？文件夹内的 Flow 将移至根目录。')) {
      deleteFolder(id)
    }
  }

  const getFlowsByFolder = (folderId: string | null) => {
    return folderId === null ? flows : flows.filter((flow) => flow.folderId === folderId)
  }

  const visibleFlows = getFlowsByFolder(activeFolderId).filter((flow) =>
    flow.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleOpenFlow = (id: string) => {
    loadFlow(id)
    navigate(`/flows/${id}`)
  }

  const openNewFlowDialog = () => {
    setSelectedFolderId(activeFolderId)
    setShowNewFlowDialog(true)
  }

  const handleDeleteFlow = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('确定要删除这个 Flow 吗？')) {
      deleteFlow(id)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}月${day}日`
  }

  return (
    <AppShell>
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-[60px] bg-card border-b border-border flex items-center justify-between px-6 shrink-0">
          <div className="flex-1 max-w-[400px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-muted-foreground" strokeWidth={2} />
              <input
                type="text"
                placeholder="搜索流程..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[36px] pl-9 pr-3 text-[13px] bg-muted/30 border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-background transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">
              使用指南
            </Button>
            <Button variant="secondary" size="sm">
              导入
            </Button>
            <Button
              size="sm"
              onClick={openNewFlowDialog}
              className="gap-1.5"
            >
              <Plus className="w-[14px] h-[14px]" strokeWidth={2.5} />
              创建 Flow
            </Button>
          </div>
        </header>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto">
          <div className="grid min-h-full grid-cols-[180px_minmax(0,1fr)] gap-6 p-6">
            {/* 文件夹导航 */}
            <aside className="border-r border-border pr-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-[14px] h-[14px] text-muted-foreground" strokeWidth={2} />
                  <h2 className="text-[13px] font-medium text-muted-foreground">文件夹</h2>
                </div>
                <button
                  onClick={() => setShowNewFolderDialog(true)}
                  className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveFolderId(null)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    activeFolderId === null ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <FolderOpen className="w-[16px] h-[16px]" strokeWidth={2} />
                  <span className="text-[13px] font-medium text-foreground">全部 Flows</span>
                  <span className="ml-auto text-[12px] text-muted-foreground">{flows.length}</span>
                </button>

                {folders.map((folder) => {
                  const folderFlows = getFlowsByFolder(folder.id)

                  return (
                    <div key={folder.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => setActiveFolderId(folder.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          activeFolderId === folder.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                        }`}
                      >
                          <Folder className="w-[16px] h-[16px] text-muted-foreground" strokeWidth={2} style={{ color: folder.color }} />
                          <span className="truncate text-[13px] text-foreground">{folder.name}</span>
                          <span className="ml-auto text-[12px] text-muted-foreground">{folderFlows.length}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteFolder(e, folder.id)}
                        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
                        aria-label={`删除文件夹 ${folder.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </aside>

            {/* Flow 卡片网格 */}
            <section className="min-w-0">
            {visibleFlows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-muted-foreground/50" strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-medium text-foreground mb-2">
                  还没有 Flow
                </h3>
                <p className="text-[13px] text-muted-foreground mb-6">
                  创建你的第一个工作流
                </p>
                <Button
                  onClick={openNewFlowDialog}
                  size="sm"
                  className="gap-1.5"
                >
                  <Plus className="w-[14px] h-[14px]" strokeWidth={2.5} />
                  创建 Flow
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {visibleFlows.map((flow) => (
                  <a
                    key={flow.id}
                    href={`/flows/${flow.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      handleOpenFlow(flow.id)
                    }}
                    className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary hover:shadow-sm transition-all group block"
                  >
                    {/* 缩略图 */}
                    <div className="w-full h-[160px] bg-background flex items-center justify-center border-b border-border overflow-hidden">
                      {flow.thumbnail ? (
                        <img src={flow.thumbnail} alt={flow.name} className="h-full w-full bg-background object-contain" />
                      ) : (
                        <FileText className="w-12 h-12 text-muted-foreground/40" strokeWidth={1} />
                      )}
                    </div>

                    {/* 内容 */}
                    <div className="p-4">
                      <h3 className="text-[14px] font-medium text-foreground mb-1 truncate">
                        {flow.name}
                      </h3>
                      <p className="text-[12px] text-muted-foreground mb-3">
                        {formatDate(flow.updatedAt)}
                      </p>

                      {flow.description && (
                        <p className="text-[12px] text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                          {flow.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                        <span>含 {flow.nodes?.length || 0} 个节点</span>
                        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <select
                            value={flow.folderId || ''}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onChange={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              moveFlowToFolder(flow.id, event.target.value || null)
                            }}
                            className="max-w-24 rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                            aria-label={`移动 ${flow.name} 到文件夹`}
                          >
                            <option value="">未分组</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>{folder.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={(e) => handleDeleteFlow(e, flow.id)}
                            className="text-muted-foreground transition-colors hover:text-red-500"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
            </section>
          </div>
        </div>
      </main>

      {/* 新建 Flow 对话框 */}
      {showNewFlowDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-center justify-center mb-6">
              <FileText className="w-12 h-12 text-muted-foreground/40" strokeWidth={1} />
            </div>

            <h3 className="text-[16px] font-semibold text-foreground mb-2 text-center">
              新建 Flow
            </h3>
            <p className="text-[12px] text-muted-foreground text-center mb-5">
              从空白画布开始，或选择你已保存的模板。
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  Flow 名称
                </label>
                <input
                  type="text"
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  placeholder="输入 Flow 名称"
                  autoFocus
                  className="w-full h-[40px] bg-background px-3 text-[13px] text-foreground border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  描述（可选）
                </label>
                <input
                  type="text"
                  value={newFlowDescription}
                  onChange={(e) => setNewFlowDescription(e.target.value)}
                  placeholder="输入描述..."
                  className="w-full h-[40px] bg-background px-3 text-[13px] text-foreground border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  保存到文件夹
                </label>
                <select
                  value={selectedFolderId || ''}
                  onChange={(event) => setSelectedFolderId(event.target.value || null)}
                  className="w-full h-[40px] bg-background px-3 text-[13px] text-foreground border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">未分组</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  开始方式
                </label>
                <div
                  onClick={() => setSelectedTemplateId(null)}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer transition-all ${
                    selectedTemplateId === null
                      ? 'bg-primary/10 border-primary'
                      : 'bg-muted/50 border-border hover:border-primary/50'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${selectedTemplateId === null ? 'bg-primary' : 'bg-muted-foreground'}`}></div>
                  <span className="text-[13px] text-foreground">空白画布</span>
                  <span className="text-[12px] text-muted-foreground ml-auto">从空白画布开始</span>
                </div>

                {templates.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-[12px] text-muted-foreground px-1">选择模板</p>
                    <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                      {templates.map((template) => (
                        <div
                          key={template.id}
                          onClick={() => setSelectedTemplateId(template.id)}
                          className={`flex items-start gap-2 px-3 py-2.5 border rounded-lg cursor-pointer transition-all ${
                            selectedTemplateId === template.id
                              ? 'bg-primary/10 border-primary'
                              : 'bg-muted/30 border-border hover:border-primary/50'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full mt-1 ${selectedTemplateId === template.id ? 'bg-primary' : 'bg-muted-foreground'}`}></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-foreground font-medium truncate">{template.title}</p>
                            {template.description && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{template.description}</p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {template.nodes.length} 个节点 • 使用 {template.usageCount} 次
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 px-3 py-2 bg-muted/30 rounded-lg">
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      暂无已保存模板。 先保存一个 Flow 为模板后可在这里复用。
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowNewFlowDialog(false)
                  setNewFlowName('')
                  setNewFlowDescription('')
                  setSelectedTemplateId(null)
                }}
                className="flex-1"
              >
                取消
              </Button>
              <Button
                onClick={handleCreateFlow}
                disabled={!newFlowName.trim()}
                className="flex-1"
              >
                创建
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 新建文件夹对话框 */}
      {showNewFolderDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-center justify-center mb-6">
              <Folder className="w-12 h-12 text-muted-foreground/40" strokeWidth={1} />
            </div>

            <h3 className="text-[16px] font-semibold text-foreground mb-2 text-center">
              新建文件夹
            </h3>
            <p className="text-[12px] text-muted-foreground text-center mb-5">
              创建一个文件夹来组织你的 Flows。
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  文件夹名称
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="输入文件夹名称"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  className="w-full h-[40px] bg-background px-3 text-[13px] text-foreground border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowNewFolderDialog(false)
                  setNewFolderName('')
                }}
                className="flex-1"
              >
                取消
              </Button>
              <Button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1"
              >
                创建
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
