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

export interface NetworkPort {
  request(input: NetworkRequest): Promise<NetworkResponse>
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

export interface SystemPort {
  openFile(request?: OpenFileRequest): Promise<OpenFileResult | null>
  saveFile(request: SaveFileRequest): Promise<boolean>
}

export interface BrowserPort {
  popout(url: string, title?: string): void
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
  secrets: SecretPort
  jobs: JobPort
  nativeJobs: NativeJobPort
}
