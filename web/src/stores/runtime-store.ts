/**
 * Runtime-entity store (sessions, captures, assets, AI, generation runs).
 *
 * These live outside FlowDocument. Graph nodes reference them by id.
 * In-memory only — persistence is the caller's job via `@/storage`.
 * Updates are immutable: only the touched session/capture/run (and the
 * replaced array element inside it) is a new object.
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  AIMessage,
  AISession,
  BrowserSession,
  BrowserTab,
  Capture,
  ContentAsset,
  GenerationRun,
  GenerationTask,
} from '@/domain'

const DEFAULT_BROWSER_PARTITION = 'persist:cnote-browser'

function omitRecord<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record
  const next = { ...record }
  delete next[id]
  return next
}

export interface RuntimeStoreState {
  sessions: Record<string, BrowserSession>
  captures: Record<string, Capture>
  assets: Record<string, ContentAsset>
  aiSessions: Record<string, AISession>
  runs: Record<string, GenerationRun>
}

export interface RuntimeStoreActions {
  createSession: (partition?: string) => BrowserSession
  addTab: (sessionId: string, url: string) => BrowserTab
  updateTab: (sessionId: string, tabId: string, patch: Partial<BrowserTab>) => void
  removeTab: (sessionId: string, tabId: string) => void
  setSessionActiveTab: (sessionId: string, tabId: string) => void
  putCapture: (capture: Capture) => void
  upsertAsset: (asset: ContentAsset) => void
  removeAsset: (id: string) => void
  putAISession: (session: AISession) => void
  appendMessage: (aiSessionId: string, message: AIMessage) => void
  putRun: (run: GenerationRun) => void
  updateRun: (id: string, patch: Partial<GenerationRun>) => void
  updateTask: (runId: string, taskId: string, patch: Partial<GenerationTask>) => void
  removeSession: (id: string) => void
  removeCapture: (id: string) => void
  removeAISession: (id: string) => void
  removeRun: (id: string) => void
}

export type RuntimeStore = RuntimeStoreState & RuntimeStoreActions

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  sessions: {},
  captures: {},
  assets: {},
  aiSessions: {},
  runs: {},

  createSession: (partition) => {
    const session: BrowserSession = {
      id: nanoid(),
      partition: partition ?? DEFAULT_BROWSER_PARTITION,
      activeTabId: null,
      tabs: [],
      createdAt: Date.now(),
    }
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    }))
    return session
  },

  addTab: (sessionId, url) => {
    const tab: BrowserTab = {
      id: nanoid(),
      url,
      status: 'loading',
    }
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            tabs: [...session.tabs, tab],
            activeTabId: tab.id,
          },
        },
      }
    })
    return tab
  },

  updateTab: (sessionId, tabId, patch) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state
      let changed = false
      const tabs = session.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        changed = true
        return { ...tab, ...patch, id: tab.id }
      })
      if (!changed) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, tabs },
        },
      }
    })
  },

  removeTab: (sessionId, tabId) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state
      const tabs = session.tabs.filter((tab) => tab.id !== tabId)
      if (tabs.length === session.tabs.length) return state
      const activeTabId =
        session.activeTabId === tabId
          ? tabs.length > 0
            ? tabs[tabs.length - 1].id
            : null
          : session.activeTabId
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, tabs, activeTabId },
        },
      }
    })
  },

  setSessionActiveTab: (sessionId, tabId) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session || session.activeTabId === tabId) return state
      if (!session.tabs.some((tab) => tab.id === tabId)) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, activeTabId: tabId },
        },
      }
    })
  },

  putCapture: (capture) => {
    set((state) => {
      if (state.captures[capture.id] === capture) return state
      return { captures: { ...state.captures, [capture.id]: capture } }
    })
  },

  upsertAsset: (asset) => {
    set((state) => {
      if (state.assets[asset.id] === asset) return state
      return { assets: { ...state.assets, [asset.id]: asset } }
    })
  },

  removeAsset: (id) => {
    set((state) => {
      const assets = omitRecord(state.assets, id)
      return assets === state.assets ? state : { assets }
    })
  },

  putAISession: (session) => {
    set((state) => {
      if (state.aiSessions[session.id] === session) return state
      return { aiSessions: { ...state.aiSessions, [session.id]: session } }
    })
  },

  appendMessage: (aiSessionId, message) => {
    set((state) => {
      const session = state.aiSessions[aiSessionId]
      if (!session) return state
      return {
        aiSessions: {
          ...state.aiSessions,
          [aiSessionId]: {
            ...session,
            messages: [...session.messages, message],
            updatedAt: Date.now(),
          },
        },
      }
    })
  },

  putRun: (run) => {
    set((state) => {
      if (state.runs[run.id] === run) return state
      return { runs: { ...state.runs, [run.id]: run } }
    })
  },

  updateRun: (id, patch) => {
    set((state) => {
      const run = state.runs[id]
      if (!run) return state
      return {
        runs: {
          ...state.runs,
          [id]: { ...run, ...patch, id: run.id },
        },
      }
    })
  },

  updateTask: (runId, taskId, patch) => {
    set((state) => {
      const run = state.runs[runId]
      if (!run) return state
      let changed = false
      const tasks = run.tasks.map((task) => {
        if (task.id !== taskId) return task
        changed = true
        return { ...task, ...patch, id: task.id }
      })
      if (!changed) return state
      return {
        runs: {
          ...state.runs,
          [runId]: { ...run, tasks },
        },
      }
    })
  },

  removeSession: (id) => {
    set((state) => {
      const sessions = omitRecord(state.sessions, id)
      return sessions === state.sessions ? state : { sessions }
    })
  },

  removeCapture: (id) => {
    set((state) => {
      const captures = omitRecord(state.captures, id)
      return captures === state.captures ? state : { captures }
    })
  },

  removeAISession: (id) => {
    set((state) => {
      const aiSessions = omitRecord(state.aiSessions, id)
      return aiSessions === state.aiSessions ? state : { aiSessions }
    })
  },

  removeRun: (id) => {
    set((state) => {
      const runs = omitRecord(state.runs, id)
      return runs === state.runs ? state : { runs }
    })
  },
}))
