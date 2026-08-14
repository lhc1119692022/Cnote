import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'

const Dashboard = lazy(() => import('@/pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const FlowEditor = lazy(() => import('@/components/flow/FlowEditor').then((module) => ({ default: module.FlowEditor })))
const TemplatesManager = lazy(() => import('@/pages/TemplatesManager').then((module) => ({ default: module.TemplatesManager })))
const SourcesManager = lazy(() => import('@/pages/SourcesManager').then((module) => ({ default: module.SourcesManager })))
const APIKeysManager = lazy(() => import('@/components/settings/APIKeysManager').then((module) => ({ default: module.APIKeysManager })))

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('cnote-theme') || 'light'
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
  }, [])

  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">正在加载...</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/flows/:flowId" element={<FlowEditor />} />
        <Route path="/templates" element={<TemplatesManager />} />
        <Route path="/sources" element={<SourcesManager />} />
        <Route path="/outputs" element={<Navigate to="/settings/api-keys" replace />} />
        <Route path="/settings" element={<APIKeysManager />} />
        <Route path="/settings/api-keys" element={<APIKeysManager />} />
      </Routes>
    </Suspense>
  )
}

export default App
