import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { hydrateRuntimeStore, persistSessionForExit, startRuntimePersistence } from '@/storage'

const Dashboard = lazy(() => import('@/pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const CanvasEditor = lazy(() => import('@/pages/CanvasEditorPage').then((module) => ({ default: module.CanvasEditorPage })))
const TemplatesManager = lazy(() => import('@/pages/TemplatesManager').then((module) => ({ default: module.TemplatesManager })))
const SourcesManager = lazy(() => import('@/pages/SourcesManager').then((module) => ({ default: module.SourcesManager })))
const APIKeysManager = lazy(() => import('@/components/settings/APIKeysManager').then((module) => ({ default: module.APIKeysManager })))

hydrateRuntimeStore()

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('cnote-theme') || 'light'
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
  }, [])

  useEffect(() => startRuntimePersistence(), [])

  useEffect(() => {
    const flush = () => {
      void persistSessionForExit()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
    const stopFlushRequest = desktop?.session?.onFlushRequest(async () => {
      try {
        await persistSessionForExit()
      } finally {
        desktop?.session?.notifyFlushed()
      }
    })
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      stopFlushRequest?.()
    }
  }, [])

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载...</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/flows/:flowId" element={<CanvasEditor />} />
        <Route path="/templates" element={<TemplatesManager />} />
        <Route path="/sources" element={<SourcesManager />} />
        <Route path="/outputs" element={<Navigate to="/settings/api-keys" replace />} />
        <Route path="/settings" element={<APIKeysManager />} />
        <Route path="/settings/api-keys" element={<APIKeysManager />} />
        <Route path="/settings/generation-channels" element={<Navigate to="/settings/api-keys?tab=generation" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
