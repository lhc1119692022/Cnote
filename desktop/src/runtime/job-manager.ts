import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { JobPort, JobRecord, JobUpdate } from './types'

export class JobManager implements JobPort {
  private readonly filePath: string
  private jobs = new Map<string, JobRecord>()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(job: JobRecord) => void>()

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'runtime-jobs.json')
  }

  private async ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || typeof (item as JobRecord).id !== 'string') continue
          const job = this.normalizeJob(item as JobRecord)
          if (job.status === 'running') {
            job.status = 'queued'
            job.resumeRequired = true
            job.error = '应用上次关闭时任务被暂停，可继续执行。'
            job.updatedAt = new Date().toISOString()
          }
          this.jobs.set(job.id, job)
        }
      }
      await this.persist()
    } catch (error) {
      const missing = Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT')
      if (missing) return
      // Keep the desktop shell usable, but preserve evidence for recovery
      // instead of silently discarding a damaged task journal.
      console.warn('Cnote runtime job journal could not be read:', error)
      try {
        await fs.copyFile(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        // The backup copy is best-effort.
      }
    }
  }

  private async persist() {
    const snapshot = JSON.stringify([...this.jobs.values()], null, 2)
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, snapshot, 'utf8')
    })
    return this.writeChain
  }

  private normalizeJob(job: JobRecord): JobRecord {
    const status: JobRecord['status'] = ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)
      ? job.status
      : 'queued'
    const now = new Date().toISOString()
    return {
      id: String(job.id),
      kind: String(job.kind || 'unknown'),
      status,
      createdAt: typeof job.createdAt === 'string' ? job.createdAt : now,
      updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : now,
      retryCount: Number.isFinite(job.retryCount) ? Math.max(0, Math.floor(job.retryCount)) : 0,
      ...(job.checkpoint === undefined ? {} : { checkpoint: job.checkpoint }),
      ...(job.error ? { error: String(job.error) } : {}),
      ...(job.startedAt ? { startedAt: String(job.startedAt) } : {}),
      ...(job.completedAt ? { completedAt: String(job.completedAt) } : {}),
      ...(job.resumeRequired ? { resumeRequired: true } : {}),
    }
  }

  private emit(job: JobRecord) {
    const snapshot = this.normalizeJob(job)
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch {
        // A renderer listener must never interrupt persistence or another listener.
      }
    })
  }

  async list() {
    await this.ensureLoaded()
    return [...this.jobs.values()]
      .map((job) => this.normalizeJob(job))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(kind: string, checkpoint?: unknown) {
    await this.ensureLoaded()
    const now = new Date().toISOString()
    const job: JobRecord = {
      id: randomUUID(),
      kind: kind.trim() || 'unknown',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      checkpoint,
    }
    this.jobs.set(job.id, job)
    await this.persist()
    this.emit(job)
    return job
  }

  async update(id: string, update: JobUpdate) {
    await this.ensureLoaded()
    const job = this.jobs.get(id)
    if (!job) throw new Error('Job not found')

    const now = new Date().toISOString()
    if (update.status) job.status = update.status
    if ('checkpoint' in update) job.checkpoint = update.checkpoint
    if ('error' in update) job.error = update.error
    if (update.retryCount !== undefined && Number.isFinite(update.retryCount)) {
      job.retryCount = Math.max(0, Math.floor(update.retryCount))
    }
    if (update.resumeRequired !== undefined) job.resumeRequired = update.resumeRequired
    if (job.status === 'running') {
      job.startedAt ||= now
      job.completedAt = undefined
      job.resumeRequired = false
    }
    if (job.status === 'queued' && update.status === 'queued') {
      job.completedAt = undefined
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      job.completedAt ||= now
      if (job.status !== 'completed') job.resumeRequired = false
    }
    job.updatedAt = now
    await this.persist()
    this.emit(job)
    return job
  }

  async cancel(id: string) {
    await this.ensureLoaded()
    const job = this.jobs.get(id)
    if (!job) throw new Error('Job not found')
    if (job.status === 'completed' || job.status === 'failed') return job
    job.status = 'cancelled'
    job.updatedAt = new Date().toISOString()
    job.completedAt = job.updatedAt
    job.resumeRequired = false
    await this.persist()
    this.emit(job)
    return job
  }

  onUpdated(listener: (job: JobRecord) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
