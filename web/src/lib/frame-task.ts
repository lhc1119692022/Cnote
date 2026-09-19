export interface FrameClock {
  request: (callback: () => void) => number
  cancel: (handle: number) => void
}

export function createFrameTask(clock: FrameClock) {
  let pending: (() => void) | undefined
  let handle: number | undefined
  const cancel = () => {
    if (handle !== undefined) clock.cancel(handle)
    handle = undefined
    pending = undefined
  }
  const flush = () => {
    const callback = pending
    cancel()
    callback?.()
  }
  return {
    schedule(callback: () => void) {
      pending = callback
      if (handle === undefined) handle = clock.request(flush)
    },
    flush,
    cancel,
  }
}

export function createDisplayBuffer(emit: (text: string) => void, delay = 50) {
  let chunks: string[] = []
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
    frame = undefined
    timer = undefined
  }
  const flush = () => {
    clear()
    if (!chunks.length) return
    const text = chunks.join('')
    chunks = []
    emit(text)
  }
  return {
    append(text: string) {
      if (!text) return
      chunks.push(text)
      if (timer !== undefined) return
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush)
      timer = setTimeout(flush, delay)
    },
    flush,
    cancel() {
      clear()
      chunks = []
    },
  }
}
