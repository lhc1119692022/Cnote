import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Dashboard } from '@/pages/Dashboard'
import { FlowEditor } from '@/components/flow/FlowEditor'
import { TemplatesManager } from '@/pages/TemplatesManager'
import { SourcesManager } from '@/pages/SourcesManager'
import { APIKeysManager } from '@/components/settings/APIKeysManager'

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('cnote-theme') || 'dark'
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
  }, [])

  return (
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
  )
}

export default App
