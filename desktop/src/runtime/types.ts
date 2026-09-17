export interface RuntimeInfo {
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  desktopVersion: string
  userDataPath: string
  webRuntime: 'development-server' | 'built-web' | 'fallback'
}

export interface NetworkRequest {
  url: string
  requestId?: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeoutMs?: number
  signal?: AbortSignal
}

export interface NativeNetworkJobRequest extends Omit<NetworkRequest, 'headers'> {
  headers?: Record<string, string>
  /** Header name -> SecretStore key. Secret values never enter the job checkpoint. */
  secretRefs?: Record<string, string>
}

export type NativeJobRequest =
  | { kind: 'native:network-request'; input: NativeNetworkJobRequest }
  | { kind: 'native:content-parse'; input: ContentParseInput }

export interface NativeJobPort {
  enqueue(request: NativeJobRequest): Promise<JobRecord>
  cancel(id: string): Promise<JobRecord>
  start(): Promise<void>
}

export interface NetworkResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: Uint8Array
  url: string
}

export interface NetworkStreamResponse extends Omit<NetworkResponse, 'body'> {
  read(): Promise<Uint8Array | null>
  cancel(): Promise<void>
}

export interface NetworkPort {
  openStream(input: NetworkRequest): Promise<NetworkStreamResponse>
  request(input: NetworkRequest): Promise<NetworkResponse>
}

export interface BrowserSessionSummary {
  id: string
  name: string
  partition: string
  persistent: boolean
  url: string
  title: string
  visible: boolean
  presentation: 'embedded' | 'popup' | 'hidden'
  createdAt: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserViewportRequest {
  width: number
  height: number
  scale: number
}

export interface BrowserFrame {
  sessionId: string
  width: number
  height: number
  data: Buffer
}

export type BrowserInputEvent =
  | { type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseEnter' | 'mouseLeave'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: number; modifiers?: string[] }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: string[] }
  | { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers?: string[] }

export interface BrowserCapture {
  sessionId: string
  capturedAt: string
  url: string
  title: string
  text: string
  html: string
}

export interface ContentParseInput {
  html: string
  url?: string
  title?: string
}

export interface ParsedPageContent {
  url: string
  title: string
  description?: string
  text: string
  headings: Array<{ level: number; text: string }>
  links: Array<{ text: string; url: string }>
  parserId: string
  parserVersion: string
  warnings: string[]
}

export interface ContentPort {
  parseHtml(input: ContentParseInput): Promise<ParsedPageContent>
}

export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface DirectoryDialogRequest {
  title?: string
  defaultPath?: string
}

export interface OpenFileRequest {
  title?: string
  filters?: FileDialogFilter[]
}

export interface SaveFileRequest {
  title?: string
  suggestedName: string
  filters?: FileDialogFilter[]
  data: Uint8Array
}

export interface OpenFileResult {
  name: string
  data: Uint8Array
}

export interface SaveResourceRequest {
  resourceId: string
  fileName: string
  data: Uint8Array
}

export interface SystemPort {
  openFile(request?: OpenFileRequest): Promise<OpenFileResult | null>
  saveFile(request: SaveFileRequest): Promise<boolean>
  saveResource(request: SaveResourceRequest): Promise<string>
  selectDirectory(request?: DirectoryDialogRequest): Promise<string | null>
  getStorageLocation(): Promise<import('./storage-location').StorageLocationInfo>
  setStorageLocation(value: string): Promise<import('./storage-location').StorageLocationInfo>
  resetStorageLocation(): Promise<import('./storage-location').StorageLocationInfo>
  restart(): Promise<void>
}

export interface StoragePort {
  keys(): Promise<string[]>
  read(key: string): Promise<Uint8Array | null>
  write(key: string, data: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
}

export interface BrowserPort {
  popout(url: string, title?: string): void
  createSession(options?: { id?: string; name?: string; persistent?: boolean; url?: string }): Promise<BrowserSessionSummary>
  listSessions(): BrowserSessionSummary[]
  onSessionUpdated(listener: (session: BrowserSessionSummary) => void): () => void
  onFrame(listener: (frame: BrowserFrame) => void): () => void
  onCursorChanged(listener: (change: { sessionId: string; cursor: string }) => void): () => void
  setSessionViewport(id: string, viewport: BrowserViewportRequest): void
  sendInput(id: string, event: BrowserInputEvent): void
  showSession(id: string): void
  popoutSession(id: string): void
  navigate(id: string, url: string): Promise<BrowserSessionSummary>
  reload(id: string): Promise<BrowserSessionSummary>
  goBack(id: string): Promise<BrowserSessionSummary>
  goForward(id: string): Promise<BrowserSessionSummary>
  capture(id: string): Promise<BrowserCapture>
  closeSession(id: string): Promise<void>
}

export interface SecretPort {
  has(name: string): Promise<boolean>
  set(name: string, value: string): Promise<void>
  get(name: string): Promise<string | null>
  delete(name: string): Promise<void>
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobUpdate {
  status?: JobStatus
  checkpoint?: unknown
  error?: string
  retryCount?: number
  resumeRequired?: boolean
}

export interface JobRecord {
  id: string
  kind: string
  status: JobStatus
  createdAt: string
  updatedAt: string
  retryCount: number
  checkpoint?: unknown
  error?: string
  startedAt?: string
  completedAt?: string
  resumeRequired?: boolean
}

export interface JobPort {
  list(): Promise<JobRecord[]>
  create(kind: string, checkpoint?: unknown): Promise<JobRecord>
  update(id: string, update: JobUpdate): Promise<JobRecord>
  cancel(id: string): Promise<JobRecord>
  onUpdated(listener: (job: JobRecord) => void): () => void
}

export interface RuntimePorts {
  network: NetworkPort
  browser: BrowserPort
  content: ContentPort
  system: SystemPort
  storage: StoragePort
  secrets: SecretPort
  jobs: JobPort
  nativeJobs: NativeJobPort
}
