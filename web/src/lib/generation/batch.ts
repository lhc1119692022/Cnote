import type { GenerationTaskState } from '@/types/flow'

interface BatchOptions {
  count: number
  submittedAt: number
  elapsedOffset?: number
  initialTasks?: GenerationTaskState[]
  onTaskUpdate: (task: GenerationTaskState) => void
  run: (index: number, update: (task: Partial<GenerationTaskState>) => void) => Promise<GenerationTaskState>
}

export async function runGenerationBatch(options: BatchOptions): Promise<GenerationTaskState> {
  const tasks = Array.from({ length: options.count }, (_, index) => ({ ...(options.initialTasks?.[index] || { status: 'submitting' as const }) }))
  const settled = tasks.map((task) => task.status === 'completed')
  const publish = () => {
    const done = settled.every(Boolean)
    const incomplete = tasks.find((task) => task.status !== 'completed')
    const status = !done ? 'in_progress' : incomplete?.status || 'completed'
    const state: GenerationTaskState = {
      ...tasks[0],
      taskId: options.count === 1 ? tasks[0].taskId : undefined,
      requestSnapshot: tasks.find((task) => task.requestSnapshot)?.requestSnapshot,
      status,
      submittedAt: options.submittedAt,
      elapsedMs: (options.elapsedOffset || 0) + Date.now() - options.submittedAt,
      completedAt: done ? Date.now() : undefined,
      error: done ? incomplete?.error : undefined,
      resultUrls: [...new Set(tasks.flatMap((task) => task.resultUrls || []))],
      resultResourceIds: [...new Set(tasks.flatMap((task) => task.resultResourceIds || []))],
      resultMimeTypes: tasks.flatMap((task) => task.resultMimeTypes || []),
      resultFileNames: tasks.flatMap((task) => task.resultFileNames || []),
      children: options.count > 1 ? tasks.map((task) => ({ ...task })) : undefined,
    }
    options.onTaskUpdate(state)
    return state
  }
  publish()
  await Promise.all(tasks.map(async (_, index) => {
    if (settled[index]) return
    try {
      const result = await options.run(index, (update) => {
        tasks[index] = { ...tasks[index], ...update }
        publish()
      })
      tasks[index] = { ...tasks[index], ...result }
      if (result.status === 'completed' && !result.resultUrls?.length && !result.resultResourceIds?.length) {
        tasks[index] = { ...tasks[index], status: 'failed', error: '任务已完成，但服务端没有返回可预览的结果' }
      }
    } catch (error) {
      tasks[index] = { ...tasks[index], status: error instanceof DOMException && error.name === 'AbortError' ? 'idle' : 'failed', error: error instanceof Error ? error.message : '生成失败' }
    } finally {
      settled[index] = true
      publish()
    }
  }))
  return publish()
}
