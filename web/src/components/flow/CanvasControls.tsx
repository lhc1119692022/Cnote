import { useReactFlow } from 'reactflow'
import {
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Map,
  LayoutGrid,
  CircleHelp,
  LocateFixed,
  Moon,
  Sun,
} from 'lucide-react'
import { useFlowStore } from '@/stores/use-flow-store'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'

interface CanvasControlsProps {
  minimapVisible: boolean
  onToggleMinimap: () => void
  onArrange: () => void
  onGuide: () => void
  leftOffset?: number
}

export function CanvasControls({ minimapVisible, onToggleMinimap, onArrange, onGuide, leftOffset = 24 }: CanvasControlsProps) {
  const reactFlowInstance = useReactFlow()
  const { theme, toggleTheme } = useTheme()

  const undo = useFlowStore((state) => state.undo)
  const redo = useFlowStore((state) => state.redo)
  const canUndo = useFlowStore((state) => state.historyIndex > 0)
  const canRedo = useFlowStore((state) => state.historyIndex < state.history.length - 1)

  // 撤销
  const handleUndo = () => {
    if (canUndo) {
      undo()
    }
  }

  // 重做
  const handleRedo = () => {
    if (canRedo) {
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

  return (
    <div className="pointer-events-none absolute bottom-6 z-50 transition-[left]" style={{ left: leftOffset }}>
      {/* 编辑控制 */}
      <div className="pointer-events-auto flex w-12 flex-col items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleUndo}
          disabled={!canUndo}
          title="撤销 (⌘Z)"
        >
          <Undo className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleRedo}
          disabled={!canRedo}
          title="重做 (⌘⇧Z)"
        >
          <Redo className="w-4 h-4" />
        </Button>
        <div className="my-1 h-px w-7 bg-border" />
      {/* 视图控制 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleZoomIn}
          title="放大 (+/⌘+)"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleZoomOut}
          title="缩小 (-/⌘-)"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleFitView}
          title="聚焦节点 / 适应视图"
        >
          <LocateFixed className="w-4 h-4" />
        </Button>
        <div className="my-1 h-px w-7 bg-border" />
      <div className="contents">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onToggleMinimap} title={minimapVisible ? '隐藏小地图' : '显示小地图'}><Map className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onArrange} title="整理节点"><LayoutGrid className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onGuide} title="操作指南"><CircleHelp className="h-4 w-4" /></Button>
        <div className="my-1 h-px w-7 bg-border" />
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={toggleTheme} title="切换主题">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
      </div></div>
    </div>
  )
}
