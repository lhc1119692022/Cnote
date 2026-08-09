import { useReactFlow } from 'reactflow'
import {
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Lock,
  Unlock,
  Moon,
  Sun,
} from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export function CanvasControls() {
  const reactFlowInstance = useReactFlow()
  const [isDarkMode, setIsDarkMode] = useState(false)

  const { undo, redo, canUndo, canRedo, isLocked, toggleLock } = useFlowStore()

  // 撤销
  const handleUndo = () => {
    if (canUndo()) {
      undo()
    }
  }

  // 重做
  const handleRedo = () => {
    if (canRedo()) {
      redo()
    }
  }

  // 放大
  const handleZoomIn = () => {
    reactFlowInstance.zoomIn()
  }

  // 缩小
  const handleZoomOut = () => {
    reactFlowInstance.zoomOut()
  }

  // 适应视图
  const handleFitView = () => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 })
  }

  // 切换锁定
  const handleToggleLock = () => {
    toggleLock()
  }

  // 切换深色模式
  const handleToggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
    // TODO: 实现深色模式切换
  }

  return (
    <div className="absolute bottom-6 left-6 z-50 flex flex-col gap-2">
      {/* 编辑控制 */}
      <div className="flex gap-2 p-2 bg-white/80 backdrop-blur-sm rounded-lg border border-[#d2d2d7] shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleUndo}
          disabled={!canUndo()}
          title="撤销 (⌘Z)"
        >
          <Undo className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleRedo}
          disabled={!canRedo()}
          title="重做 (⌘⇧Z)"
        >
          <Redo className="w-4 h-4" />
        </Button>
      </div>

      {/* 视图控制 */}
      <div className="flex gap-2 p-2 bg-white/80 backdrop-blur-sm rounded-lg border border-[#d2d2d7] shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleZoomIn}
          title="放大 (+/⌘+)"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleZoomOut}
          title="缩小 (-/⌘-)"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 bg-[#34c759] text-white hover:bg-[#2fb350] hover:text-white"
          onClick={handleFitView}
          title="适应视图 (F/⌘0)"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
      </div>

      {/* 其他控制 */}
      <div className="flex gap-2 p-2 bg-white/80 backdrop-blur-sm rounded-lg border border-[#d2d2d7] shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleToggleLock}
          title={isLocked ? '解锁画布' : '锁定画布'}
        >
          {isLocked ? (
            <Lock className="w-4 h-4" />
          ) : (
            <Unlock className="w-4 h-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={handleToggleDarkMode}
          title="切换深色模式"
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
