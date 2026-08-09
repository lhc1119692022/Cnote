import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Menu,
  ArrowLeft,
  FileText,
  Sparkles,
  Save,
  Layers,
  Download,
  Upload,
  PanelRight,
} from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { Button } from '@/components/ui/button'

export function Toolbar() {
  const navigate = useNavigate()
  const [showRightPanel, setShowRightPanel] = useState(false)

  const {
    currentFlow,
    saveCurrentFlow,
    addNode,
    exportFlowAsJSON,
    importFlowFromJSON,
  } = useFlowStore()

  // 返回 Dashboard
  const handleBack = () => {
    saveCurrentFlow()
    navigate('/dashboard')
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
  const handleSave = () => {
    saveCurrentFlow()
    // TODO: 显示保存成功提示
  }

  // 保存为模板
  const handleSaveAsTemplate = () => {
    // TODO: 实现保存为模板功能
    console.log('保存为模板')
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

  // 切换右侧面板
  const handleTogglePanel = () => {
    setShowRightPanel(!showRightPanel)
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-50 flex items-center gap-2 bg-white/80 backdrop-blur-sm border-b border-[#d2d2d7] px-4 py-2">
      {/* 左侧 */}
      <div className="flex items-center gap-2">
        {/* 侧边栏切换 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-10"
          onClick={() => console.log('切换侧边栏')}
        >
          <Menu className="w-5 h-5" />
        </Button>

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
        <div className="w-px h-6 bg-[#d2d2d7]" />

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
        <h1 className="text-sm font-medium text-[#1d1d1f]">
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

        {/* 分隔线 */}
        <div className="w-px h-6 bg-[#d2d2d7]" />

        {/* 面板切换 */}
        <Button
          variant="ghost"
          size="icon"
          className="w-10 h-9"
          onClick={handleTogglePanel}
          title="切换右侧面板"
        >
          <PanelRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
