/**
 * Per-entity runtime persistence.
 *
 * Capture html/text stay on `runtime:capture:<id>` and are never folded into
 * one store-wide JSON. Writes go through `localForageStorage` (Desktop StoragePort,
 * Web localforage). Entity write/delete finishes before the manifest is updated.
 */

import type {
  AIMessage,
  AISession,
  BrowserSession,
  BrowserTab,
  Capture,
  CaptureHeading,
  CaptureLink,
  CaptureMedia,
  ContentAsset,
  GenerationRun,
  GenerationRunStatus,
  GenerationTask,
  GenerationTaskRecoveryMetadata,
  GenerationTaskRecoveryState,
  GenerationTaskStatus,
} from '@/domain'
import { localForageStorage } from '@/lib/localforage-storage'
import {
  useRuntimeStore,
  type RuntimeStore,
  type RuntimeStoreState,
} from '@/stores/runtime-store'
import {
  RUNTIME_MANIFEST_KEY,
  runtimeAiSessionKey,
  runtimeAssetKey,
  runtimeCaptureKey,
  runtimeRunKey,
  runtimeSessionKey,
  type RuntimeManifest,
} from './keys'

const TAB_STATUSES = new Set<BrowserTab['status']>(['loading', 'ready', 'error'])
const TASK_STATUSES = new Set<GenerationTaskStatus>([
  'idle',
  'validating',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])
const RUN_STATUSES = new Set<GenerationRunStatus>([
  'created',
  'validating',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting-for-user',
])
const INTERRUPTED_RUN_STATUSES = new Set<GenerationRunStatus>(['validating', 'queued', 'running'])
const GENERATION_VARIANTS = new Set<string>(['image', 'video'])
const RECOVERY_STATES = new Set<GenerationTaskRecoveryState>([
  'pending',
  'submitted',
  'resuming',
  'waiting-for-user',
  'completed',
  'failed',
  'cancelled',
])
const MEDIA_TRANSPORTS = new Set<string>(['inline', 'custom'])
const REFERENCE_TYPES = new Set<string>(['image', 'video', 'audio'])
const REFERENCE_ROLES = new Set<string>([
  'reference_image',
  'reference_video',
  'first_frame',
  'last_frame',
  'reference_voice',
  'reference_audio',
])
const REFERENCE_SOURCES = new Set<string>(['local', 'url', 'uploaded'])
const REFERENCE_STATUSES = new Set<string>(['ready', 'pending-upload', 'unsupported', 'error'])
const GENERATION_CAPABILITIES = new Set<string>([
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'image-to-video',
  'reference-to-video',
  'first-last-frame',
  'video-reference',
  'audio-reference',
  'video-edit',
  'generate-audio',
])
const OUTPUT_FORMATS = new Set<string>(['png', 'jpeg', 'webp'])
const BACKGROUNDS = new Set<string>(['auto', 'opaque', 'transparent'])
const MODERATIONS = new Set<string>(['auto', 'low'])
const THINKING_LEVELS = new Set<string>(['minimal', 'high'])

export class RuntimePersistenceError extends Error {
  constructor(message = '运行时状态持久化失败') {
    super(message)
    this.name = 'RuntimePersistenceError'
  }
}

type RequestSnapshot = NonNullable<GenerationTask['requestSnapshot']>
type VariantConfig = RequestSnapshot['config']
type SnapshotReference = VariantConfig['references'][number]

type ManifestIdsKey = keyof RuntimeManifest
type EntityStateKey = keyof RuntimeStoreState

interface EntityCollection<T> {
  stateKey: EntityStateKey
  idsKey: ManifestIdsKey
  key: (id: string) => string
  parse: (value: unknown, expectedId: string) => T | null
}

interface PersistedIdSets {
  sessionIds: Set<string>
  captureIds: Set<string>
  assetIds: Set<string>
  aiSessionIds: Set<string>
  runIds: Set<string>
}

let writeQueue: Promise<unknown> = Promise.resolve()
let hydratePromise: Promise<void> | null = null
let persistenceReady: Promise<void> | null = null
let persistenceStop: (() => void) | null = null
let persistQueued = false
let persistScheduled = false
let hydrateFailed = false
const lastSerialized = new Map<string, string>()
let persistedIds = createEmptyIdSets()

function createEmptyIdSets(): PersistedIdSets {
  return {
    sessionIds: new Set<string>(),
    captureIds: new Set<string>(),
    assetIds: new Set<string>(),
    aiSessionIds: new Set<string>(),
    runIds: new Set<string>(),
  }
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation)
  writeQueue = next.catch(() => undefined)
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }
  if (isRecord(raw) || Array.isArray(raw)) return raw
  return undefined
}

function serializeEntity(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function pickRuntimeEntities(state: RuntimeStoreState): RuntimeStoreState {
  return {
    sessions: state.sessions,
    captures: state.captures,
    assets: state.assets,
    aiSessions: state.aiSessions,
    runs: state.runs,
  }
}

function runtimeEntitiesChanged(state: RuntimeStoreState, prev: RuntimeStoreState): boolean {
  return (
    state.sessions !== prev.sessions
    || state.captures !== prev.captures
    || state.assets !== prev.assets
    || state.aiSessions !== prev.aiSessions
    || state.runs !== prev.runs
  )
}

function mergeRecords<T>(loaded: Record<string, T>, current: Record<string, T>): Record<string, T> {
  if (Object.keys(loaded).length === 0) return current
  if (Object.keys(current).length === 0) return loaded
  return { ...loaded, ...current }
}

function parseTab(value: unknown): BrowserTab | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id : ''
  const url = typeof value.url === 'string' ? value.url : ''
  const status = typeof value.status === 'string' && TAB_STATUSES.has(value.status as BrowserTab['status'])
    ? value.status as BrowserTab['status']
    : null
  if (!id || !status) return null
  const tab: BrowserTab = { id, url, status }
  if (typeof value.title === 'string') tab.title = value.title
  return tab
}

function parseSession(value: unknown, expectedId: string): BrowserSession | null {
  if (!isRecord(value) || value.id !== expectedId) return null
  if (typeof value.partition !== 'string') return null
  const createdAt = asFiniteNumber(value.createdAt)
  if (createdAt === undefined) return null
  if (value.activeTabId !== null && typeof value.activeTabId !== 'string') return null
  const tabs = Array.isArray(value.tabs) ? value.tabs.map(parseTab).filter((tab): tab is BrowserTab => tab !== null) : []
  return {
    id: expectedId,
    partition: value.partition,
    activeTabId: value.activeTabId,
    tabs,
    createdAt,
  }
}

function parseCaptureMedia(value: unknown): CaptureMedia[] | undefined {
  if (!Array.isArray(value)) return undefined
  const media: CaptureMedia[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (item.kind === 'asset' && typeof item.assetId === 'string') {
      media.push({
        kind: 'asset',
        assetId: item.assetId,
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      })
    } else if (item.kind === 'url' && typeof item.url === 'string') {
      media.push({
        kind: 'url',
        url: item.url,
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      })
    }
  }
  return media
}

function parseCaptureHeadings(value: unknown): CaptureHeading[] | undefined {
  if (!Array.isArray(value)) return undefined
  const headings: CaptureHeading[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const level = asFiniteNumber(item.level)
    if (level === undefined || typeof item.text !== 'string') continue
    headings.push({ level, text: item.text })
  }
  return headings
}

function parseCaptureLinks(value: unknown): CaptureLink[] | undefined {
  if (!Array.isArray(value)) return undefined
  const links: CaptureLink[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.text !== 'string' || typeof item.url !== 'string') continue
    links.push({ text: item.text, url: item.url })
  }
  return links
}

function parseCapture(value: unknown, expectedId: string): Capture | null {
  if (!isRecord(value) || value.id !== expectedId) return null
  if (typeof value.sessionId !== 'string' || typeof value.url !== 'string' || typeof value.text !== 'string') return null
  const fetchedAt = asFiniteNumber(value.fetchedAt)
  if (fetchedAt === undefined) return null
  const capture: Capture = {
    id: expectedId,
    sessionId: value.sessionId,
    url: value.url,
    text: value.text,
    fetchedAt,
  }
  if (typeof value.title === 'string') capture.title = value.title
  if (typeof value.html === 'string') capture.html = value.html
  const media = parseCaptureMedia(value.media)
  if (media) capture.media = media
  const headings = parseCaptureHeadings(value.headings)
  if (headings) capture.headings = headings
  const links = parseCaptureLinks(value.links)
  if (links) capture.links = links
  return capture
}

function parseAsset(value: unknown, expectedId: string): ContentAsset | null {
  if (!isRecord(value) || value.id !== expectedId) return null
  if (typeof value.hash !== 'string' || typeof value.mimeType !== 'string') return null
  const size = asFiniteNumber(value.size)
  if (size === undefined) return null
  return { id: expectedId, hash: value.hash, mimeType: value.mimeType, size }
}

function parseMessage(value: unknown): AIMessage | null {
  if (!isRecord(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (typeof value.content !== 'string') return null
  const message: AIMessage = { role: value.role, content: value.content }
  if (typeof value.channelId === 'string') message.channelId = value.channelId
  if (typeof value.model === 'string') message.model = value.model
  const createdAt = asFiniteNumber(value.createdAt)
  if (createdAt !== undefined) message.createdAt = createdAt
  return message
}

function parseAISession(value: unknown, expectedId: string): AISession | null {
  if (!isRecord(value) || value.id !== expectedId) return null
  if (typeof value.title !== 'string') return null
  const createdAt = asFiniteNumber(value.createdAt)
  const updatedAt = asFiniteNumber(value.updatedAt)
  if (createdAt === undefined || updatedAt === undefined) return null
  const messages = Array.isArray(value.messages)
    ? value.messages.map(parseMessage).filter((message): message is AIMessage => message !== null)
    : []
  const session: AISession = {
    id: expectedId,
    title: value.title,
    messages,
    createdAt,
    updatedAt,
  }
  if (typeof value.nodeId === 'string') session.nodeId = value.nodeId
  if (typeof value.model === 'string') session.model = value.model
  return session
}

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const record: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') record[key] = item
  }
  return record
}

function parseReferenceOverride(value: unknown): NonNullable<VariantConfig['referenceOverrides']>[string] | null {
  if (!isRecord(value)) return null
  const override: NonNullable<VariantConfig['referenceOverrides']>[string] = {}
  if (typeof value.role === 'string' && REFERENCE_ROLES.has(value.role)) {
    override.role = value.role as SnapshotReference['role']
  }
  const order = asFiniteNumber(value.order)
  if (order !== undefined) override.order = order
  if (typeof value.excluded === 'boolean') override.excluded = value.excluded
  return override
}

function parseReferenceOverrides(value: unknown): VariantConfig['referenceOverrides'] {
  if (!isRecord(value)) return undefined
  const record: NonNullable<VariantConfig['referenceOverrides']> = {}
  for (const [key, item] of Object.entries(value)) {
    const override = parseReferenceOverride(item)
    if (override) record[key] = override
  }
  return record
}

function parseSnapshotReference(value: unknown): SnapshotReference | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  if (typeof value.type !== 'string' || !REFERENCE_TYPES.has(value.type)) return null
  if (typeof value.source !== 'string' || !REFERENCE_SOURCES.has(value.source)) return null
  const order = asFiniteNumber(value.order)
  if (order === undefined) return null
  const reference: SnapshotReference = {
    id: value.id,
    type: value.type as SnapshotReference['type'],
    source: value.source as SnapshotReference['source'],
    order,
  }
  if (typeof value.upstreamNodeId === 'string') reference.upstreamNodeId = value.upstreamNodeId
  const expiresAt = asFiniteNumber(value.expiresAt)
  if (expiresAt !== undefined) reference.expiresAt = expiresAt
  if (typeof value.role === 'string' && REFERENCE_ROLES.has(value.role)) {
    reference.role = value.role as SnapshotReference['role']
  }
  if (typeof value.label === 'string') reference.label = value.label
  if (typeof value.url === 'string') reference.url = value.url
  if (typeof value.previewUrl === 'string') reference.previewUrl = value.previewUrl
  if (typeof value.resourceId === 'string') reference.resourceId = value.resourceId
  if (typeof value.fileName === 'string') reference.fileName = value.fileName
  if (typeof value.mimeType === 'string') reference.mimeType = value.mimeType
  const size = asFiniteNumber(value.size)
  if (size !== undefined) reference.size = size
  const duration = asFiniteNumber(value.duration)
  if (duration !== undefined) reference.duration = duration
  if (typeof value.status === 'string' && REFERENCE_STATUSES.has(value.status)) {
    reference.status = value.status as SnapshotReference['status']
  }
  if (typeof value.error === 'string') reference.error = value.error
  return reference
}

function parseVariantConfig(value: unknown): VariantConfig | null {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !Array.isArray(value.references)) return null
  const config: VariantConfig = {
    prompt: value.prompt,
    references: value.references
      .map(parseSnapshotReference)
      .filter((reference): reference is SnapshotReference => reference !== null),
  }
  if (typeof value.channelId === 'string') config.channelId = value.channelId
  if (typeof value.model === 'string') config.model = value.model
  if (typeof value.adapterId === 'string') config.adapterId = value.adapterId
  if (typeof value.capability === 'string' && GENERATION_CAPABILITIES.has(value.capability)) {
    config.capability = value.capability as VariantConfig['capability']
  }
  const promptMentions = parseStringMap(value.promptMentions)
  if (promptMentions) config.promptMentions = promptMentions
  if (typeof value.negativePrompt === 'string') config.negativePrompt = value.negativePrompt
  const referenceOverrides = parseReferenceOverrides(value.referenceOverrides)
  if (referenceOverrides) config.referenceOverrides = referenceOverrides
  if (typeof value.generateAudio === 'boolean') config.generateAudio = value.generateAudio
  if (typeof value.noMusic === 'boolean') config.noMusic = value.noMusic
  const seconds = asFiniteNumber(value.seconds)
  if (seconds !== undefined) config.seconds = seconds
  if (typeof value.resolution === 'string') config.resolution = value.resolution
  if (typeof value.aspectRatio === 'string') config.aspectRatio = value.aspectRatio
  if (typeof value.quality === 'string') config.quality = value.quality
  if (typeof value.background === 'string' && BACKGROUNDS.has(value.background)) {
    config.background = value.background as VariantConfig['background']
  }
  if (typeof value.outputFormat === 'string' && OUTPUT_FORMATS.has(value.outputFormat)) {
    config.outputFormat = value.outputFormat as VariantConfig['outputFormat']
  }
  const outputCompression = asFiniteNumber(value.outputCompression)
  if (outputCompression !== undefined) config.outputCompression = outputCompression
  if (typeof value.moderation === 'string' && MODERATIONS.has(value.moderation)) {
    config.moderation = value.moderation as VariantConfig['moderation']
  }
  const outputCount = asFiniteNumber(value.outputCount)
  if (outputCount !== undefined) config.outputCount = outputCount
  if (typeof value.thinkingLevel === 'string' && THINKING_LEVELS.has(value.thinkingLevel)) {
    config.thinkingLevel = value.thinkingLevel as VariantConfig['thinkingLevel']
  }
  return config
}

function parseRequestSnapshot(value: unknown): RequestSnapshot | null {
  if (!isRecord(value)) return null
  if (typeof value.variant !== 'string' || !GENERATION_VARIANTS.has(value.variant)) return null
  if (typeof value.channelId !== 'string' || typeof value.providerId !== 'string') return null
  if (typeof value.baseURL !== 'string' || typeof value.model !== 'string') return null
  const config = parseVariantConfig(value.config)
  if (!config) return null
  const snapshot: RequestSnapshot = {
    variant: value.variant as RequestSnapshot['variant'],
    channelId: value.channelId,
    providerId: value.providerId,
    baseURL: value.baseURL,
    model: value.model,
    config,
  }
  if (typeof value.inputVersion === 'string' && value.inputVersion) snapshot.inputVersion = value.inputVersion
  if (typeof value.presetId === 'string') snapshot.presetId = value.presetId
  if (typeof value.presetVersion === 'string') snapshot.presetVersion = value.presetVersion
  if (typeof value.protocol === 'string') snapshot.protocol = value.protocol
  if (typeof value.adapterId === 'string') snapshot.adapterId = value.adapterId
  if (typeof value.secretName === 'string') snapshot.secretName = value.secretName
  if (typeof value.mediaTransport === 'string' && MEDIA_TRANSPORTS.has(value.mediaTransport)) {
    snapshot.mediaTransport = value.mediaTransport as RequestSnapshot['mediaTransport']
  }
  if (typeof value.mediaUploadPath === 'string') snapshot.mediaUploadPath = value.mediaUploadPath
  if (typeof value.mediaUploadURL === 'string') snapshot.mediaUploadURL = value.mediaUploadURL
  if (typeof value.mediaUploadSecretName === 'string') snapshot.mediaUploadSecretName = value.mediaUploadSecretName
  return snapshot
}

function parseRecoveryMetadata(value: unknown): GenerationTaskRecoveryMetadata | null {
  if (!isRecord(value)) return null
  if (typeof value.requestNodeId !== 'string' || !value.requestNodeId) return null
  if (typeof value.variant !== 'string' || !GENERATION_VARIANTS.has(value.variant)) return null
  if (typeof value.channelId !== 'string' || !value.channelId) return null
  if (typeof value.model !== 'string' || !value.model) return null
  if (typeof value.inputVersion !== 'string' || !value.inputVersion) return null
  if (typeof value.state !== 'string' || !RECOVERY_STATES.has(value.state as GenerationTaskRecoveryState)) return null
  const updatedAt = asFiniteNumber(value.updatedAt)
  if (updatedAt === undefined) return null
  const recovery: GenerationTaskRecoveryMetadata = {
    requestNodeId: value.requestNodeId,
    variant: value.variant as GenerationTaskRecoveryMetadata['variant'],
    channelId: value.channelId,
    model: value.model,
    inputVersion: value.inputVersion,
    state: value.state as GenerationTaskRecoveryState,
    updatedAt,
  }
  if (typeof value.reason === 'string') recovery.reason = value.reason
  return recovery
}

function parseTask(value: unknown): GenerationTask | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  if (typeof value.status !== 'string' || !TASK_STATUSES.has(value.status as GenerationTaskStatus)) return null
  const task: GenerationTask = { id: value.id, status: value.status as GenerationTaskStatus }
  const progress = asFiniteNumber(value.progress)
  if (progress !== undefined) task.progress = progress
  if (typeof value.channelId === 'string') task.channelId = value.channelId
  if (typeof value.model === 'string') task.model = value.model
  if (Array.isArray(value.resultAssetIds)) {
    task.resultAssetIds = value.resultAssetIds.filter((id): id is string => typeof id === 'string')
  }
  if (typeof value.error === 'string') task.error = value.error
  const submittedAt = asFiniteNumber(value.submittedAt)
  if (submittedAt !== undefined) task.submittedAt = submittedAt
  const completedAt = asFiniteNumber(value.completedAt)
  if (completedAt !== undefined) task.completedAt = completedAt
  if (typeof value.remoteTaskId === 'string' && value.remoteTaskId) task.remoteTaskId = value.remoteTaskId
  if (typeof value.requestNodeId === 'string' && value.requestNodeId) task.requestNodeId = value.requestNodeId
  if (typeof value.variant === 'string' && GENERATION_VARIANTS.has(value.variant)) {
    task.variant = value.variant as GenerationTask['variant']
  }
  if (typeof value.inputVersion === 'string' && value.inputVersion) task.inputVersion = value.inputVersion
  const requestSnapshot = parseRequestSnapshot(value.requestSnapshot)
  if (requestSnapshot) task.requestSnapshot = requestSnapshot
  const recovery = parseRecoveryMetadata(value.recovery)
  if (recovery) task.recovery = recovery
  return task
}

function parseRun(value: unknown, expectedId: string): GenerationRun | null {
  if (!isRecord(value) || value.id !== expectedId) return null
  if (typeof value.status !== 'string' || !RUN_STATUSES.has(value.status as GenerationRunStatus)) return null
  const createdAt = asFiniteNumber(value.createdAt)
  if (createdAt === undefined) return null
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map(parseTask).filter((task): task is GenerationTask => task !== null)
    : []
  const run: GenerationRun = {
    id: expectedId,
    status: value.status as GenerationRunStatus,
    tasks,
    createdAt,
  }
  if (typeof value.requestNodeId === 'string' && value.requestNodeId) run.requestNodeId = value.requestNodeId
  if (typeof value.variant === 'string' && GENERATION_VARIANTS.has(value.variant)) {
    run.variant = value.variant as GenerationRun['variant']
  }
  return run
}

function persistableRun(run: GenerationRun): GenerationRun {
  return parseRun(run, run.id) ?? {
    id: run.id,
    status: RUN_STATUSES.has(run.status) ? run.status : 'waiting-for-user',
    createdAt: Number.isFinite(run.createdAt) ? run.createdAt : 0,
    tasks: run.tasks
      .map((task) => parseTask(task))
      .filter((task): task is GenerationTask => task !== null),
    ...(typeof run.requestNodeId === 'string' && run.requestNodeId ? { requestNodeId: run.requestNodeId } : {}),
    ...(run.variant && GENERATION_VARIANTS.has(run.variant) ? { variant: run.variant } : {}),
  }
}

function serializeCollectionEntity(
  collection: { stateKey: EntityStateKey },
  entity: { id: string },
): string | null {
  if (collection.stateKey === 'runs') return serializeEntity(persistableRun(entity as GenerationRun))
  return serializeEntity(entity)
}

function normalizeInterruptedRun(run: GenerationRun): GenerationRun {
  if (!INTERRUPTED_RUN_STATUSES.has(run.status)) return run
  const updatedAt = Date.now()
  return {
    ...run,
    status: 'waiting-for-user',
    tasks: run.tasks.map((task) => ({
      ...task,
      ...(task.recovery ? {
        recovery: {
          ...task.recovery,
          state: 'waiting-for-user',
          updatedAt,
          reason: '应用重启后等待恢复确认',
        },
      } : {}),
    })),
  }
}

function normalizeInterruptedRuns(runs: Record<string, GenerationRun>): Record<string, GenerationRun> {
  let changed = false
  const next: Record<string, GenerationRun> = {}
  for (const [id, run] of Object.entries(runs)) {
    const normalized = normalizeInterruptedRun(run)
    next[id] = normalized
    if (normalized !== run) changed = true
  }
  return changed ? next : runs
}

const COLLECTIONS = [
  { stateKey: 'sessions', idsKey: 'sessionIds', key: runtimeSessionKey, parse: parseSession },
  { stateKey: 'captures', idsKey: 'captureIds', key: runtimeCaptureKey, parse: parseCapture },
  { stateKey: 'assets', idsKey: 'assetIds', key: runtimeAssetKey, parse: parseAsset },
  { stateKey: 'aiSessions', idsKey: 'aiSessionIds', key: runtimeAiSessionKey, parse: parseAISession },
  { stateKey: 'runs', idsKey: 'runIds', key: runtimeRunKey, parse: parseRun },
] as const satisfies readonly EntityCollection<unknown>[]

function emptyManifest(): RuntimeManifest {
  return {
    sessionIds: [],
    captureIds: [],
    assetIds: [],
    aiSessionIds: [],
    runIds: [],
  }
}

function parseManifest(raw: unknown): RuntimeManifest {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return emptyManifest()
  return {
    sessionIds: stringList(parsed.sessionIds),
    captureIds: stringList(parsed.captureIds),
    assetIds: stringList(parsed.assetIds),
    aiSessionIds: stringList(parsed.aiSessionIds),
    runIds: stringList(parsed.runIds),
  }
}

function manifestFromPersisted(): RuntimeManifest {
  return {
    sessionIds: [...persistedIds.sessionIds].sort(),
    captureIds: [...persistedIds.captureIds].sort(),
    assetIds: [...persistedIds.assetIds].sort(),
    aiSessionIds: [...persistedIds.aiSessionIds].sort(),
    runIds: [...persistedIds.runIds].sort(),
  }
}

async function loadCollection<T>(
  ids: string[],
  keyFor: (id: string) => string,
  parse: (value: unknown, expectedId: string) => T | null,
  idsKey: ManifestIdsKey,
): Promise<Record<string, T>> {
  const record: Record<string, T> = {}
  await Promise.all(ids.map(async (id) => {
    const key = keyFor(id)
    let raw: string | null
    try {
      raw = await localForageStorage.getItem(key)
    } catch (error) {
      console.warn(`Failed to read ${key}`, error)
      return
    }
    if (raw == null) return
    const parsed = parseJson(raw)
    const entity = parse(parsed, id)
    if (!entity) return
    record[id] = entity
    const serialized = serializeEntity(entity)
    if (serialized) lastSerialized.set(key, serialized)
    persistedIds[idsKey].add(id)
  }))
  return record
}

async function loadPersistedEntities(): Promise<RuntimeStoreState> {
  let raw: string | null = null
  try {
    raw = await localForageStorage.getItem(RUNTIME_MANIFEST_KEY)
  } catch (error) {
    console.warn('Failed to read runtime manifest', error)
  }
  const manifest = parseManifest(raw)
  const [sessions, captures, assets, aiSessions, runs] = await Promise.all([
    loadCollection(manifest.sessionIds, runtimeSessionKey, parseSession, 'sessionIds'),
    loadCollection(manifest.captureIds, runtimeCaptureKey, parseCapture, 'captureIds'),
    loadCollection(manifest.assetIds, runtimeAssetKey, parseAsset, 'assetIds'),
    loadCollection(manifest.aiSessionIds, runtimeAiSessionKey, parseAISession, 'aiSessionIds'),
    loadCollection(manifest.runIds, runtimeRunKey, parseRun, 'runIds'),
  ])
  return { sessions, captures, assets, aiSessions, runs }
}

async function writeManifest(strict = false): Promise<void> {
  const serialized = serializeEntity(manifestFromPersisted())
  if (!serialized) {
    if (strict) throw new RuntimePersistenceError('运行时清单无法序列化')
    return
  }
  if (lastSerialized.get(RUNTIME_MANIFEST_KEY) === serialized) return
  try {
    await localForageStorage.setItem(RUNTIME_MANIFEST_KEY, serialized)
    lastSerialized.set(RUNTIME_MANIFEST_KEY, serialized)
  } catch (error) {
    console.warn('Failed to persist runtime manifest', error)
    if (strict) throw error
  }
}

async function persistSnapshot(state: RuntimeStoreState, strict = false): Promise<void> {
  const errors: unknown[] = []
  for (const collection of COLLECTIONS) {
    const records = state[collection.stateKey] as Record<string, { id: string }>
    const known = persistedIds[collection.idsKey]
    const currentIds = new Set(Object.keys(records))

    for (const id of currentIds) {
      const entity = records[id]
      if (!entity) continue
      const serialized = serializeCollectionEntity(collection, entity)
      if (!serialized) continue
      const key = collection.key(id)
      if (lastSerialized.get(key) === serialized) continue
      try {
        await localForageStorage.setItem(key, serialized)
        lastSerialized.set(key, serialized)
        known.add(id)
      } catch (error) {
        console.warn(`Failed to persist ${key}`, error)
        errors.push(error)
      }
    }

    for (const id of [...known]) {
      if (currentIds.has(id)) continue
      const key = collection.key(id)
      try {
        await localForageStorage.removeItem(key)
        lastSerialized.delete(key)
        known.delete(id)
      } catch (error) {
        console.warn(`Failed to remove ${key}`, error)
        errors.push(error)
      }
    }
  }

  try {
    await writeManifest(strict)
  } catch (error) {
    errors.push(error)
  }
  if (strict && errors.length > 0) {
    const first = errors[0]
    throw new RuntimePersistenceError(first instanceof Error ? first.message : '运行时状态持久化失败')
  }
}

function schedulePersist(): void {
  persistQueued = true
  if (persistScheduled) return
  persistScheduled = true
  void enqueueWrite(async () => {
    try {
      if (hydratePromise) await hydratePromise
      while (persistQueued) {
        persistQueued = false
        await persistSnapshot(pickRuntimeEntities(useRuntimeStore.getState()))
      }
    } catch (error) {
      console.warn('Failed to persist runtime entities', error)
    } finally {
      persistScheduled = false
      if (persistQueued) schedulePersist()
    }
  }).catch((error) => {
    persistScheduled = false
    console.warn('Failed to persist runtime entities', error)
  })
}

function applyLoadedEntities(loaded: RuntimeStoreState): void {
  const hydratedRuns = normalizeInterruptedRuns(loaded.runs)
  useRuntimeStore.setState((state) => {
    const sessions = mergeRecords(loaded.sessions, state.sessions)
    const captures = mergeRecords(loaded.captures, state.captures)
    const assets = mergeRecords(loaded.assets, state.assets)
    const aiSessions = mergeRecords(loaded.aiSessions, state.aiSessions)
    const runs = mergeRecords(hydratedRuns, state.runs)
    if (
      sessions === state.sessions
      && captures === state.captures
      && assets === state.assets
      && aiSessions === state.aiSessions
      && runs === state.runs
    ) {
      return state
    }
    return { sessions, captures, assets, aiSessions, runs }
  })
}

async function hydrateOnce(): Promise<void> {
  try {
    const loaded = await loadPersistedEntities()
    applyLoadedEntities(loaded)
    hydrateFailed = false
  } catch (error) {
    hydrateFailed = true
    console.warn('Failed to hydrate runtime store', error)
  }
}

/** Loads persisted runtime entities into the in-memory store. Safe to call repeatedly. */
export function hydrateRuntimeStore(): Promise<void> {
  if (!hydratePromise) hydratePromise = hydrateOnce()
  return hydratePromise
}

/**
 * Subscribe to runtime store changes and persist them serially.
 * Hydrate is awaited first so an empty first paint cannot wipe disk.
 */
export function startRuntimePersistence(): () => void {
  if (persistenceStop) return persistenceStop

  let unsub: (() => void) | null = null
  let stopped = false

  persistenceReady = (async () => {
    await hydrateRuntimeStore()
    if (stopped) return
    unsub = useRuntimeStore.subscribe((state: RuntimeStore, prev: RuntimeStore) => {
      if (!runtimeEntitiesChanged(state, prev)) return
      schedulePersist()
    })
    schedulePersist()
  })()

  persistenceStop = () => {
    stopped = true
    unsub?.()
    unsub = null
    persistenceStop = null
  }
  return persistenceStop
}

export async function flushRuntimePersistence(): Promise<void> {
  await hydrateRuntimeStore()
  if (hydrateFailed) return
  if (persistenceReady) await persistenceReady
  await enqueueWrite(() => persistSnapshot(pickRuntimeEntities(useRuntimeStore.getState()), true))
}

export async function flushRuntimePersistenceForTests(): Promise<void> {
  await hydrateRuntimeStore()
  if (persistenceReady) await persistenceReady.catch(() => undefined)
  if (!persistScheduled) schedulePersist()
  await writeQueue
}

export async function resetRuntimePersistenceForTests(): Promise<void> {
  persistenceStop?.()
  persistenceStop = null
  if (hydratePromise) await hydratePromise.catch(() => undefined)
  if (persistenceReady) await persistenceReady.catch(() => undefined)
  hydratePromise = null
  persistenceReady = null
  hydrateFailed = false
  writeQueue = Promise.resolve()
  persistQueued = false
  persistScheduled = false
  lastSerialized.clear()
  persistedIds = createEmptyIdSets()
}
