import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Download, FileText, Folder, FolderOpen, MoreVertical, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { FlowBackupError, restoreFlowBackup, saveFlowBackup } from '@/lib/flow-backup'

export function Dashboard() {
  const navigate = useNavigate()
  const flows = useFlowStore((state) => state.flows)
  const folders = useFlowStore((state) => state.folders)
  const createFlow = useFlowStore((state) => state.createFlow)
  const createFolder = useFlowStore((state) => state.createFolder)
  const deleteFolder = useFlowStore((state) => state.deleteFolder)
  const moveFlowToFolder = useFlowStore((state) => state.moveFlowToFolder)
  const loadFlow = useFlowStore((state) => state.loadFlow)
  const deleteFlow = useFlowStore((state) => state.deleteFlow)
  const initialize = useFlowStore((state) => state.initialize)
  const { templates, incrementUsage, initialize: initializeTemplates } = useTemplateStore()
  const [showNewFlowDialog, setShowNewFlowDialog] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')
  const [newFlowDescription, setNewFlowDescription] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [openFlowMenuId, setOpenFlowMenuId] = useState<string | null>(null)
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null)
  const [groupMenuDirection, setGroupMenuDirection] = useState<'left' | 'right'>('right')
  const [pendingFolderFlowId, setPendingFolderFlowId] = useState<string | null>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    initialize()
    initializeTemplates()
  }, [initialize, initializeTemplates])

  useEffect(() => {
    if (!openFlowMenuId) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-flow-card-menu]')) return
      setOpenFlowMenuId(null)
      setOpenGroupMenuId(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick, true)
  }, [openFlowMenuId])

  const handleCreateFlow = () => {
    if (!newFlowName.trim()) return
    const template = selectedTemplateId
      ? templates.find((item) => item.id === selectedTemplateId)
      : undefined
    const flow = createFlow(
      newFlowName,
      newFlowDescription,
      activeFolderId || undefined,
      template ? { nodes: template.nodes, edges: template.edges } : undefined
    )
    if (template) incrementUsage(template.id)

    setShowNewFlowDialog(false)
    setNewFlowName('')
    setNewFlowDescription('')
    setSelectedTemplateId(null)
    navigate(`/flows/${flow.id}`)
  }

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return
    const folder = createFolder(newFolderName)
    if (pendingFolderFlowId) {
      moveFlowToFolder(pendingFolderFlowId, folder.id)
    } else {
      setActiveFolderId(folder.id)
    }
    setShowNewFolderDialog(false)
    setNewFolderName('')
    setPendingFolderFlowId(null)
  }

  const openNewFolderDialog = (flowId?: string) => {
    setPendingFolderFlowId(flowId || null)
    setNewFolderName('')
    setOpenFlowMenuId(null)
    setOpenGroupMenuId(null)
    setShowNewFolderDialog(true)
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
    setShowNewFlowDialog(true)
  }

  const handleDeleteFlow = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('确定要删除这个 Flow 吗？')) {
      deleteFlow(id)
    }
  }

  const handleBackupFlow = async (event: React.MouseEvent, flow: (typeof flows)[number]) => {
    event.preventDefault()
    event.stopPropagation()
    setOpenFlowMenuId(null)
    setOpenGroupMenuId(null)
    try {
      await saveFlowBackup(flow)
    } catch (error) {
      alert(error instanceof FlowBackupError ? error.message : 'Flow 备份失败，请稍后重试。')
    }
  }

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const flowId = await restoreFlowBackup(file)
      if (flowId) navigate(`/flows/${flowId}`)
    } catch (error) {
      alert(error instanceof FlowBackupError ? error.message : '备份文件无效或无法读取。')
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
            <input ref={backupInputRef} type="file" accept=".zip,.cnote.zip,application/zip" className="hidden" onChange={handleImportBackup} />
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => backupInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              恢复备份
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
                  onClick={() => openNewFolderDialog()}
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,220px))]">
                {visibleFlows.map((flow) => (
                  <a
                    key={flow.id}
                    href={`/flows/${flow.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      handleOpenFlow(flow.id)
                    }}
                    className={`group relative block rounded-xl border border-border bg-card transition-all hover:border-primary hover:shadow-sm ${openFlowMenuId === flow.id ? 'z-20' : ''}`}
                  >
                    {/* 缩略图 */}
                    <div className="relative aspect-[5/4] w-full border-b border-border">
                      <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-t-[11px] bg-background">
                        {flow.thumbnail ? (
                          <img src={flow.thumbnail} alt={flow.name} className="h-full w-full bg-background object-contain" />
                        ) : (
                          <FileText className="w-12 h-12 text-muted-foreground/40" strokeWidth={1} />
                        )}
                      </div>

                      <div data-flow-card-menu className="absolute right-2 top-2 z-30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground" aria-label={`打开 ${flow.name} 操作菜单`} aria-expanded={openFlowMenuId === flow.id} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenFlowMenuId((current) => current === flow.id ? null : flow.id); setOpenGroupMenuId(null) }}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openFlowMenuId === flow.id && <div className="absolute right-0 top-10 z-30 w-40 rounded-xl border border-border bg-card p-1.5 text-left shadow-xl" onMouseLeave={() => setOpenGroupMenuId(null)}>
                          <div className="relative" onMouseEnter={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setGroupMenuDirection(bounds.right + 160 <= window.innerWidth ? 'right' : 'left'); setOpenGroupMenuId(flow.id) }} onMouseLeave={() => setOpenGroupMenuId(null)}>
                            <button type="button" aria-haspopup="menu" aria-expanded={openGroupMenuId === flow.id} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted" onClick={(event) => { event.preventDefault(); event.stopPropagation() }}>
                              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{flow.folderId ? folders.find((folder) => folder.id === flow.folderId)?.name || '分组' : '未分组'}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            {openGroupMenuId === flow.id && <div role="menu" className={`absolute top-0 w-40 rounded-xl border border-border bg-card p-1.5 shadow-xl ${groupMenuDirection === 'right' ? 'left-full' : 'right-full'}`}>
                              <button type="button" className={`flex w-full rounded-lg px-2.5 py-2 text-left text-xs ${!flow.folderId ? 'bg-muted font-medium' : 'hover:bg-muted'}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); moveFlowToFolder(flow.id, null); setOpenFlowMenuId(null); setOpenGroupMenuId(null) }}>未分组</button>
                              {folders.map((folder) => <button key={folder.id} type="button" className={`flex w-full truncate rounded-lg px-2.5 py-2 text-left text-xs ${flow.folderId === folder.id ? 'bg-muted font-medium' : 'hover:bg-muted'}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); moveFlowToFolder(flow.id, folder.id); setOpenFlowMenuId(null); setOpenGroupMenuId(null) }}>{folder.name}</button>)}
                              <div className="my-1 border-t border-border" />
                              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openNewFolderDialog(flow.id) }}><Plus className="h-3.5 w-3.5 text-muted-foreground" />新建分组</button>
                            </div>}
                          </div>
                          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted" onMouseEnter={() => setOpenGroupMenuId(null)} onClick={(event) => void handleBackupFlow(event, flow)}><Download className="h-3.5 w-3.5 text-muted-foreground" />备份</button>
                          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10" onMouseEnter={() => setOpenGroupMenuId(null)} onClick={(event) => { setOpenFlowMenuId(null); setOpenGroupMenuId(null); handleDeleteFlow(event, flow.id) }}><Trash2 className="h-3.5 w-3.5" />删除</button>
                        </div>}
                      </div>
                    </div>

                    {/* 内容 */}
                    <div className="h-[88px] p-3">
                      <h3 className="text-[14px] font-medium text-foreground mb-1 truncate">
                        {flow.name}
                      </h3>

                      <p className="min-h-[18px] line-clamp-1 text-[12px] leading-[18px] text-muted-foreground">
                        {flow.description || '\u00a0'}
                      </p>

                      <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
                        <span>{formatDate(flow.updatedAt)}</span>
                        <span>含 {flow.nodes?.length || 0} 个节点</span>
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
                  选择模板（可选）
                </label>
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedTemplateId(null)}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
                      selectedTemplateId === null
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/30 hover:border-primary/50'
                    }`}
                  >
                    <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selectedTemplateId === null ? 'bg-primary' : 'bg-muted-foreground'}`}></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">空白画布</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">不使用模板，从空白画布开始</p>
                    </div>
                  </button>

                  {templates.map((template) => (
                    <button
                      type="button"
                      key={template.id}
                      onClick={() => setSelectedTemplateId(template.id)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
                        selectedTemplateId === template.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/30 hover:border-primary/50'
                      }`}
                    >
                      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selectedTemplateId === template.id ? 'bg-primary' : 'bg-muted-foreground'}`}></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{template.title}</p>
                        {template.description && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{template.description}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {templates.length === 0 && (
                  <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
                    暂无已保存模板。空白画布会作为默认选项。
                  </p>
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
                  setPendingFolderFlowId(null)
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
