import { Routes, Route, Navigate } from 'react-router-dom'

import { lazy, Suspense, useEffect, useState } from 'react'
import { hydrateRuntimeStore, persistSessionForExit, startRuntimePersistence } from '@/storage'
import { RunningHubWorkflowsDialog } from '@/components/runninghub/RunningHubWorkflowsDialog'
import { useGenerationStore } from '@/stores/use-generation-store'

const Gallery = lazy(() => import('@/pages/Gallery').then(module => ({ default: module.Gallery })))
const Dashboard = lazy(() => import('@/pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const CanvasEditor = lazy(() => import('@/pages/CanvasEditorPage').then((module) => ({ default: module.CanvasEditorPage })))
const TemplatesManager = lazy(() => import('@/pages/TemplatesManager').then((module) => ({ default: module.TemplatesManager })))
const SourcesManager = lazy(() => import('@/pages/SourcesManager').then((module) => ({ default: module.SourcesManager })))
const APIKeysManager = lazy(() => import('@/components/settings/APIKeysManager').then((module) => ({ default: module.APIKeysManager })))

hydrateRuntimeStore()

function RunningHubWorkflowDialogBridge() {
  const channels = useGenerationStore(state => state.channels)
  const [channelId, setChannelId] = useState<string | null>(null)
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ channelId?: string }>).detail?.channelId
      if (id && channels.some(channel => channel.id === id && channel.protocol === 'runninghub')) setChannelId(id)
    }
    window.addEventListener('cnote:open-runninghub-settings', open)
    return () => window.removeEventListener('cnote:open-runninghub-settings', open)
  }, [channels])
  if (!channelId) return null
  return <RunningHubWorkflowsDialog channelId={channelId} open onOpenChange={open => { if (!open) setChannelId(null) }} />
}

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('cnote-theme') || 'light'
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
  }, [])

  useEffect(() => startRuntimePersistence(), [])
  useEffect(() => {
    let stopped = false
    const sweep = () => { if (!stopped) void import('@/storage/resource-library').then(async library => { await library.resumeResourceCleanup(); await library.collectUnusedResources() }).catch(error => console.warn('资源清理暂缓', error)) }
    const initial = window.setTimeout(sweep, 30000)
    const periodic = window.setInterval(sweep, 6 * 60 * 60 * 1000)
    return () => { stopped = true; clearTimeout(initial); clearInterval(periodic) }
  }, [])

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
      <>
        <RunningHubWorkflowDialogBridge />
        <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/flows/:flowId" element={<CanvasEditor />} />
        <Route path="/templates" element={<TemplatesManager />} />
        <Route path="/sources" element={<SourcesManager />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/outputs" element={<Navigate to="/settings/api-keys" replace />} />
        <Route path="/settings" element={<APIKeysManager />} />
        <Route path="/settings/api-keys" element={<APIKeysManager />} />
        <Route path="/settings/generation-channels" element={<Navigate to="/settings/api-keys?tab=generation" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </>
    </Suspense>
  )
}

export default App
