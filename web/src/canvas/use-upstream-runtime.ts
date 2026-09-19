import { useShallow } from 'zustand/react/shallow'
import { useMemo } from 'react'
import type { NodeSpec } from '@/domain'
import { useRuntimeStore } from '@/stores/runtime-store'

export function useUpstreamRuntime(nodes: readonly NodeSpec[]) {
  const captures = useRuntimeStore(useShallow(state => nodes.flatMap(node => {
    const capture = node.kind === 'browser' && node.latestCaptureId ? state.captures[node.latestCaptureId] : undefined
    return capture ? [capture] : []
  })))
  const aiSessions = useRuntimeStore(useShallow(state => nodes.flatMap(node => {
    const session = node.kind === 'ai' && node.activeSessionId ? state.aiSessions[node.activeSessionId] : undefined
    return session ? [session] : []
  })))
  return useMemo(() => ({
    captures: Object.fromEntries(captures.map(capture => [capture.id, capture])),
    aiSessions: Object.fromEntries(aiSessions.map(session => [session.id, session])),
  }), [captures, aiSessions])
}
