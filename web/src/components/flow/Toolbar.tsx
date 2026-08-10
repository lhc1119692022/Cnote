import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Sparkles,
  Save,
  Layers,
  Download,
  Upload,
} from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { useTemplateStore } from '@/stores/use-template-store'
import { captureFlowThumbnail } from '@/lib/flow/thumbnail'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Toolbar() {
  const navigate = useNavigate()
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateCategory, setTemplateCategory] = useState('')
  const createTemplate = useTemplateStore((state) => state.createTemplate)

  const {
    currentFlow,
    nodes,
    edges,
    saveCurrentFlow,
    addNode,
    exportFlowAsJSON,
    importFlowFromJSON,
  } = useFlowStore()

  // 生成画布缩略图
  const generateThumbnail = async () => {
    if (nodes.length === 0) return undefined
    return captureFlowThumbnail()
  }

  // 返回 Dashboard
  const handleBack = async () => {
    try {
      const thumbnail = await generateThumbnail()
      saveCurrentFlow(thumbnail)
      navigate('/dashboard')
    } catch (error) {
      console.error('handleBack 错误:', error)
      navigate('/dashboard')
    }
  }

  // 添加内容节点
  const handleAddContent = () => {
    const position = {
      x: Math.random() * 500,
      y: Math.random() * 500,
    }

    addNode({
      type: 'content',
      position,
      data: {
        label: '内容节点',
        mode: 'text',
        content: '',
      },
    })
  }

  // 添加 AI 节点
  const handleAddAI = () => {
    const position = {
      x: Math.random() * 500,
      y: Math.random() * 500,
    }

    addNode({
      type: 'ai',
      position,
      data: {
        label: 'AI 节点',
        model: 'gpt-4o-mini',
        systemPrompt: 'Generate content based on the inputs.',
        messages: [],
      },
    })
  }

  // 保存
  const handleSave = async () => {
    const thumbnail = await generateThumbnail()
    saveCurrentFlow(thumbnail)
    // TODO: 显示保存成功提示
  }

  // 保存为模板
  const handleSaveAsTemplate = () => {
    if (!currentFlow || nodes.length === 0) return
    setTemplateTitle(currentFlow.name)
    setTemplateDescription(currentFlow.description || '')
    setShowTemplateDialog(true)
  }

  const handleCreateTemplate = () => {
    if (!templateTitle.trim() || nodes.length === 0) return
    createTemplate(
      templateTitle.trim(),
      templateDescription.trim(),
      nodes,
      edges,
      templateCategory.trim() || undefined
    )
    setShowTemplateDialog(false)
    setTemplateTitle('')
    setTemplateDescription('')
    setTemplateCategory('')
  }

  // 导出
  const handleExport = () => {
    const json = exportFlowAsJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentFlow?.name || 'flow'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 导入
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (e) => {
        const json = e.target?.result as string
        try {
          importFlowFromJSON(json)
          // TODO: 显示导入成功提示
        } catch (error) {
          // TODO: 显示导入失败提示
          console.error('导入失败:', error)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <>
    <div className="absolute top-0 left-0 right-0 z-50 flex items-center gap-2 bg-card border-b border-border px-4 py-2">
      {/* 左侧 */}
      <div className="flex items-center gap-2">
        {/* 返回按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-10"
          onClick={handleBack}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-border" />

        {/* 内容按钮 */}
        <Button
          variant="ghost"
          className="h-9 gap-2"
          onClick={handleAddContent}
        >
          <FileText className="w-4 h-4" />
          内容
        </Button>

        {/* AI 节点按钮 */}
        <Button
          variant="ghost"
          className="h-9 gap-2"
          onClick={handleAddAI}
        >
          <Sparkles className="w-4 h-4" />
          AI
        </Button>
      </div>

      {/* 中间 - Flow 名称 */}
      <div className="flex-1 text-center">
        <h1 className="text-sm font-medium text-foreground">
          {currentFlow?.name || 'Untitled Flow'}
        </h1>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        {/* 保存 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-9"
          onClick={handleSave}
          title="保存 (Ctrl+S)"
        >
          <Save className="w-4 h-4" />
        </Button>

        {/* 模板 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-9"
          onClick={handleSaveAsTemplate}
          title="保存为模板"
        >
          <Layers className="w-4 h-4" />
        </Button>

        {/* 导出 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-9"
          onClick={handleExport}
          title="导出"
        >
          <Download className="w-4 h-4" />
        </Button>

        {/* 导入 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-9"
          onClick={handleImport}
          title="导入"
        >
          <Upload className="w-4 h-4" />
        </Button>

      </div>
    </div>

    <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-base">保存为模板</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <label className="block text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">模板名称</span>
            <input autoFocus value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">描述（可选）</span>
            <input value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
          <label className="block text-[13px] text-muted-foreground">
            <span className="mb-2 block font-medium">分类（可选）</span>
            <input value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)} placeholder="例如：内容处理" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" />
          </label>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowTemplateDialog(false)}>取消</Button>
          <Button className="flex-1" onClick={handleCreateTemplate} disabled={!templateTitle.trim()}>保存模板</Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
