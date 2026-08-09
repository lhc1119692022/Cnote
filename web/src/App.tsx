import { Routes, Route } from 'react-router-dom'

function App() {
  return (
    <div className="min-h-screen bg-[#f2f2f7]">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<div>Dashboard - Coming Soon</div>} />
      </Routes>
    </div>
  )
}

function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[#1d1d1f] mb-2">
          Cnote
        </h1>
        <p className="text-lg text-[#6e6e73]">AI 驱动的知识工作流平台</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="w-24 h-24 bg-[#34c759] rounded-2xl flex items-center justify-center">
          <span className="text-4xl text-white font-bold">C</span>
        </div>
        <p className="text-sm text-[#8e8e93] max-w-md text-center">
          Phase 1 基础架构已完成 ✅
          <br />
          下一步：Flow 编辑器开发
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="p-4 rounded-lg bg-white border border-[#d2d2d7]">
          <div className="font-medium text-[#1d1d1f] mb-1">✅ 已完成</div>
          <div className="text-[#8e8e93]">
            • Vite + React 19 项目<br />
            • TailwindCSS 配置<br />
            • LocalForage 存储<br />
            • 基础 UI 组件<br />
            • 国际化支持
          </div>
        </div>
        <div className="p-4 rounded-lg bg-white border border-[#d2d2d7]">
          <div className="font-medium text-[#1d1d1f] mb-1">⏳ 进行中</div>
          <div className="text-[#8e8e93]">
            • Flow 编辑器<br />
            • 节点组件<br />
            • AI 集成<br />
            • 数据流引擎
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
