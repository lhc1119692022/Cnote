import { Routes, Route, Navigate } from 'react-router-dom'
import { Dashboard } from '@/pages/Dashboard'
import { FlowEditor } from '@/components/flow/FlowEditor'
import { APIKeysManager } from '@/components/settings/APIKeysManager'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/flows/:flowId" element={<FlowEditor />} />
      <Route path="/settings/api-keys" element={<APIKeysManager />} />
    </Routes>
  )
}

export default App
