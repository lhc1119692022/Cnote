import type {
  JobPort,
  JobRecord,
  NativeJobPort,
  NativeJobRequest,
  NativeNetworkJobRequest,
  NetworkPort,
  SecretPort,
  ContentPort,
} from './types'

const CHECKPOINT_SCHEMA_VERSION = 1
const MAX_PERSISTED_RESULT_BYTES = 12 * 1024 * 1024

type NativeJobCheckpoint = {
  schemaVersion: 1
  request: NativeJobRequest
  phase: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  output?: unknown
  error?: string
  resultOmitted?: boolean
}

type PersistedNativeJobRequest = {
  kind: 'native:network-request'
  input: Omit<NativeNetworkJobRequest, 'body'> & {
    body?: string | { __cnoteBinaryBase64: string }
  }
}

type PersistedNativeJobCheckpoint = Omit<NativeJobCheckpoint, 'request'> & {
  request: PersistedNativeJobRequest | NativeJobRequest
}

function serializeRequest(request: NativeJobRequest): PersistedNativeJobRequest | NativeJobRequest {
  if (request.kind !== 'native:network-request' || !(request.input.body instanceof Uint8Array)) return request
  return {
    kind: request.kind,
    input: {
      ...request.input,
      body: { __cnoteBinaryBase64: encodeBytes(request.input.body) },
    },
  }
}

function checkpointForPersistence(checkpoint: NativeJobCheckpoint, phase: NativeJobCheckpoint['phase'], extra: Partial<Pick<NativeJobCheckpoint, 'output' | 'error' | 'resultOmitted'>> = {}): PersistedNativeJobCheckpoint {
  return {
    ...checkpoint,
    request: serializeRequest(checkpoint.request as NativeJobRequest),
    phase,
    ...extra,
  }
}

function restoreRequest(request: PersistedNativeJobCheckpoint['request']): NativeJobRequest {
  if (request.kind !== 'native:network-request') return request as NativeJobRequest
  const body = request.input.body
  if (!body || typeof body === 'string') {
    return { kind: request.kind, input: { ...request.input, body: body as string | undefined } }
  }
  if (body instanceof Uint8Array) return request as NativeJobRequest
  if (typeof body === 'object' && '__cnoteBinaryBase64' in body && typeof body.__cnoteBinaryBase64 === 'string') {
    return {
      kind: request.kind,
      input: {
        ...request.input,
        body: new Uint8Array(Buffer.from(body.__cnoteBinaryBase64, 'base64')),
      },
    }
  }
  return request as NativeJobRequest
}

function checkpointOf(job: JobRecord): NativeJobCheckpoint | null {
  if (!job.checkpoint || typeof job.checkpoint !== 'object') return null
  const value = job.checkpoint as Partial<PersistedNativeJobCheckpoint>
  if (value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || !value.request || typeof value.request !== 'object') return null
  if (value.request.kind !== 'native:network-request' && value.request.kind !== 'native:content-parse') return null
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    request: restoreRequest(value.request as PersistedNativeJobCheckpoint['request']),
    phase: value.phase === 'running' || value.phase === 'completed' || value.phase === 'failed' || value.phase === 'cancelled' ? value.phase : 'queued',
    ...(value.output === undefined ? {} : { output: value.output }),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(value.resultOmitted ? { resultOmitted: true } : {}),
  }
}

function persistedSize(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function encodeBytes(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

function mergeSecretHeaders(input: NativeNetworkJobRequest, secrets: Record<string, string>) {
  const headers = { ...(input.headers || {}) }
  Object.entries(input.secretRefs || {}).forEach(([header, secretName]) => {
    const value = secrets[secretName]
    if (!value) throw new Error(`SecretStore 中未找到请求头密钥：${secretName}`)
    Object.keys(headers).filter((name) => name.toLowerCase() === header.toLowerCase()).forEach((name) => delete headers[name])
    headers[header] = value
  })
  return headers
}

export class NativeJobRunner implements NativeJobPort {
  private readonly active = new Map<string, AbortController>()
  private pumping = false
  private started = false

  constructor(
    private readonly jobs: JobPort,
    private readonly network: NetworkPort,
    private readonly content: ContentPort,
    private readonly secrets: SecretPort,
  ) {
    this.jobs.onUpdated((job) => {
      if (job.status === 'cancelled') this.active.get(job.id)?.abort()
      if (this.started && job.status === 'queued') void this.pump()
    })
  }

  async start() {
    this.started = true
    await this.pump()
  }

  async enqueue(request: NativeJobRequest) {
  const checkpoint: PersistedNativeJobCheckpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      request: serializeRequest(request),
      phase: 'queued',
    }
    const job = await this.jobs.create(request.kind, checkpoint)
    if (this.started) void this.pump()
    return job
  }

  async cancel(id: string) {
    this.active.get(id)?.abort()
    return this.jobs.cancel(id)
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      const queued = (await this.jobs.list()).filter((job) => job.kind.startsWith('native:') && job.status === 'queued')
      for (const job of queued) {
        if (this.active.has(job.id)) continue
        // Keep the first implementation deliberately bounded. A later worker
        // pool can raise this without changing the persisted job contract.
        if (this.active.size >= 2) break
        void this.run(job)
      }
    } finally {
      this.pumping = false
    }
  }

  private async run(job: JobRecord) {
    const controller = new AbortController()
    this.active.set(job.id, controller)
    const checkpoint = checkpointOf(job)
    if (!checkpoint) {
      await this.jobs.update(job.id, { status: 'failed', error: 'Native Job 检查点格式无效。' }).catch(() => undefined)
      this.active.delete(job.id)
      return
    }

    try {
      await this.jobs.update(job.id, {
        status: 'running',
        checkpoint: checkpointForPersistence(checkpoint, 'running'),
        error: undefined,
        resumeRequired: false,
      })
      const output = await this.execute(checkpoint.request, controller.signal)
      const resultOmitted = persistedSize(output) > MAX_PERSISTED_RESULT_BYTES
      const completedCheckpoint = checkpointForPersistence(checkpoint, 'completed', resultOmitted ? { resultOmitted: true } : { output })
      await this.jobs.update(job.id, {
        status: 'completed',
        checkpoint: completedCheckpoint,
        error: undefined,
        resumeRequired: false,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        await this.jobs.update(job.id, {
          status: 'cancelled',
          checkpoint: checkpointForPersistence(checkpoint, 'cancelled'),
          error: '任务已取消。',
          resumeRequired: false,
        }).catch(() => undefined)
      } else {
        const message = error instanceof Error ? error.message : 'Native Job 执行失败。'
        await this.jobs.update(job.id, {
          status: 'failed',
          checkpoint: checkpointForPersistence(checkpoint, 'failed', { error: message }),
          error: message,
          resumeRequired: false,
        }).catch(() => undefined)
      }
    } finally {
      this.active.delete(job.id)
      void this.pump()
    }
  }

  private async execute(request: NativeJobRequest, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('任务已取消。', 'AbortError')
    if (request.kind === 'native:content-parse') {
      return this.content.parseHtml(request.input)
    }

    const secretRefs = request.input.secretRefs || {}
    const secretValues: Record<string, string> = {}
    for (const secretName of Object.values(secretRefs)) {
      const value = await this.secrets.get(secretName)
      if (value) secretValues[secretName] = value
    }
    const response = await this.network.request({
      ...request.input,
      headers: mergeSecretHeaders(request.input, secretValues),
      signal,
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(Object.entries(response.headers).filter(([name]) => !/^(set-cookie|cookie|authorization|proxy-authenticate)$/i.test(name))),
      url: response.url,
      bodyBase64: encodeBytes(response.body),
    }
  }
}
