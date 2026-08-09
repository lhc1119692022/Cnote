import { Routes, Route, Navigate } from 'react-router-dom'
import { Dashboard } from '@/pages/Dashboard'
import { FlowEditor } from '@/components/flow/FlowEditor'
import { TemplatesManager } from '@/pages/TemplatesManager'
import { SourcesManager } from '@/pages/SourcesManager'
import { OutputsManager } from '@/pages/OutputsManager'
import { APIKeysManager } from '@/components/settings/APIKeysManager'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/flows/:flowId" element={<FlowEditor />} />
      <Route path="/templates" element={<TemplatesManager />} />
      <Route path="/sources" element={<SourcesManager />} />
      <Route path="/outputs" element={<OutputsManager />} />
      <Route path="/settings" element={<APIKeysManager />} />
      <Route path="/settings/api-keys" element={<APIKeysManager />} />
    </Routes>
  )
}

export default App
