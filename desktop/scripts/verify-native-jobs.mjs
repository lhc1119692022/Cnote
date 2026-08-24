import assert from 'node:assert/strict'
import { NativeJobRunner } from '../dist/runtime/native-job-runner.js'

class FakeJobStore {
  jobs = new Map()
  listeners = new Set()
  sequence = 0

  emit(job) {
    for (const listener of this.listeners) listener({ ...job })
  }

  async list() {
    return [...this.jobs.values()].map((job) => ({ ...job }))
  }

  async create(kind, checkpoint) {
    const now = new Date().toISOString()
    const job = { id: `job-${++this.sequence}`, kind, status: 'queued', createdAt: now, updatedAt: now, retryCount: 0, checkpoint }
    this.jobs.set(job.id, job)
    this.emit(job)
    return { ...job }
  }

  async update(id, update) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('missing job')
    Object.assign(job, update, { updatedAt: new Date().toISOString() })
    this.emit(job)
    return { ...job }
  }

  async cancel(id) {
    return this.update(id, { status: 'cancelled', error: '任务已取消。' })
  }

  onUpdated(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

function waitFor(store, id, status) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for ${id} -> ${status}`))
    }, 3000)
    const unsubscribe = store.onUpdated((job) => {
      if (job.id !== id || job.status !== status) return
      clearTimeout(timer)
      unsubscribe()
      resolve(job)
    })
  })
}

const store = new FakeJobStore()
let seenHeaders
const network = {
  async request(input) {
    seenHeaders = input.headers
    if (input.url.includes('/slow')) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        input.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }
    return { status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode('native response'), url: input.url }
  },
}
const content = {
  async parseHtml(input) {
    return { url: input.url || '', title: input.title || 'Native', text: input.html.replace(/<[^>]+>/g, ''), headings: [], links: [], parserId: 'fake', parserVersion: '1', warnings: [] }
  },
}
const secrets = { get: async (name) => name === 'api-key' ? 'super-secret' : null }
const runner = new NativeJobRunner(store, network, content, secrets)

// Simulate a job persisted before the application was started again.
const startupJob = await runner.enqueue({ kind: 'native:content-parse', input: { html: '<p>Recovered</p>', url: 'https://example.test/recovered' } })
await runner.start()
await waitFor(store, startupJob.id, 'completed')
assert.equal(store.jobs.get(startupJob.id).checkpoint.output.text, 'Recovered')

const parseJob = await runner.enqueue({ kind: 'native:content-parse', input: { html: '<h1>Hello</h1>', url: 'https://example.test' } })
await waitFor(store, parseJob.id, 'completed')
assert.equal(store.jobs.get(parseJob.id).checkpoint.output.text, 'Hello')

const networkJob = await runner.enqueue({ kind: 'native:network-request', input: {
  url: 'https://example.test/data',
  secretRefs: { Authorization: 'api-key' },
} })
await waitFor(store, networkJob.id, 'completed')
assert.equal(seenHeaders.Authorization, 'super-secret')
assert.doesNotMatch(JSON.stringify(store.jobs.get(networkJob.id).checkpoint), /super-secret/)

const slowJob = await runner.enqueue({ kind: 'native:network-request', input: { url: 'https://example.test/slow' } })
await new Promise((resolve) => setTimeout(resolve, 20))
const cancelled = waitFor(store, slowJob.id, 'cancelled')
await runner.cancel(slowJob.id)
await cancelled

console.log('Desktop native job runner tests passed.')
