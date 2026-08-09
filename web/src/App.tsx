import { Routes, Route, Navigate } from 'react-router-dom'
import { Dashboard } from '@/pages/Dashboard'
import { FlowEditor } from '@/components/flow/FlowEditor'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/flows/:flowId" element={<FlowEditor />} />
    </Routes>
  )
}

export default App
