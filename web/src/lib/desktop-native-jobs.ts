type DesktopNativeJobRequest =
  | { kind: 'native:content-parse'; input: { html: string; url?: string; title?: string } }
  | { kind: 'native:network-request'; input: { url: string; method?: string; headers?: Record<string, string>; secretRefs?: Record<string, string>; body?: string | Uint8Array; timeoutMs?: number } }

type DesktopJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  checkpoint?: unknown
  error?: string
}

function outputOf<T>(job: DesktopJob) {
  const checkpoint = job.checkpoint as { output?: unknown; resultOmitted?: boolean } | undefined
  if (checkpoint?.resultOmitted) throw new Error('Desktop Native Job 结果过大，未写入任务检查点。')
  return checkpoint?.output as T
}

export async function runDesktopNativeJob<T>(request: DesktopNativeJobRequest, signal?: AbortSignal): Promise<T> {
  const desktop = typeof window !== 'undefined' ? window.cnoteDesktop : undefined
  if (!desktop?.jobs?.enqueueNative) throw new Error('当前运行时不支持 Desktop Native Job。')
  if (signal?.aborted) throw new DOMException('执行已停止', 'AbortError')

  const created = await desktop.jobs.enqueueNative(request)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      if (timer) clearInterval(timer)
      timer = null
      unsubscribe?.()
      unsubscribe = null
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const handle = (job: DesktopJob) => {
      if (job.id !== created.id) return
      if (job.status === 'completed') finish(() => {
        try {
          resolve(outputOf<T>(job))
        } catch (error) {
          reject(error)
        }
      })
      else if (job.status === 'failed') finish(() => reject(new Error(job.error || 'Desktop Native Job 执行失败。')))
      else if (job.status === 'cancelled') finish(() => reject(new DOMException('执行已停止', 'AbortError')))
    }
    const onAbort = () => {
      void desktop.jobs.cancel(created.id).catch(() => undefined)
      finish(() => reject(new DOMException('执行已停止', 'AbortError')))
    }

    unsubscribe = desktop.jobs.onUpdated(handle)
    signal?.addEventListener('abort', onAbort, { once: true })
    handle(created)
    timer = setInterval(() => {
      void desktop.jobs.list().then((jobs) => {
        const current = jobs.find((job) => job.id === created.id)
        if (current) handle(current)
      }).catch(() => undefined)
    }, 250)
  })
}
