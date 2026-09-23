import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localForageStorage } from '@/lib/localforage-storage'
import type { RHWorkflow } from '@/lib/runninghub/workflow'

interface RunningHubStore {
  workflows: RHWorkflow[]
  save: (workflow: RHWorkflow) => void
  remove: (id: string) => void
}

export const useRunningHubStore = create<RunningHubStore>()(persist((set) => ({
  workflows: [],
  save: workflow => set(state => ({ workflows: [...state.workflows.filter(item => item.id !== workflow.id), structuredClone(workflow)] })),
  remove: id => set(state => ({ workflows: state.workflows.filter(item => item.id !== id) })),
}), { name: 'cnote-runninghub-workflows', storage: createJSONStorage(() => localForageStorage), version: 1 }))
