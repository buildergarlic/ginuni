export type SourceKind = 'local' | 'youtube'
export type ScriptRowKind = 'dialogue' | 'descriptionGap'
export type ProjectStatus = 'draft' | 'processing' | 'review' | 'exported' | 'error'
export type TranscriptionEngine = 'local' | 'openai'
export type ExternalLinkTarget = 'repository' | 'sponsor' | 'threads' | 'email' | 'kakao'
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion?: string
  percent?: number
  message: string
  checkedAt?: string
}

export interface ProjectSource {
  kind: SourceKind
  uri: string
  displayName: string
  localMediaPath?: string
  youtubeVideoId?: string
  sha256?: string
}

export interface MediaInfo {
  durationMs: number
  width?: number
  height?: number
  audioPath?: string
  audioBytes?: number
}

export interface TranscriptSegment {
  id: string
  startMs: number
  endMs: number
  speakerId: string
  text: string
}

export interface ScriptRow {
  id: string
  kind: ScriptRowKind
  startMs: number
  endMs: number
  speakers: string[]
  content: string
  sourceSegmentIds: string[]
  reviewed: boolean
}

export interface ProcessingRun {
  id: string
  startedAt: string
  completedAt?: string
  provider: TranscriptionEngine
  model: string
  errorCode?: string
  httpStatus?: number
  requestId?: string
}

export interface ExportRecord {
  path: string
  exportedAt: string
  appVersion: string
}

export interface ScriptProject {
  schemaVersion: number
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  transcriptionEngine?: TranscriptionEngine
  source: ProjectSource
  media: MediaInfo
  segments: TranscriptSegment[]
  rows: ScriptRow[]
  runs: ProcessingRun[]
  exports: ExportRecord[]
  lastError?: string
}

export interface ProjectSummary {
  id: string
  title: string
  status: ProjectStatus
  updatedAt: string
  sourceKind: SourceKind
  durationMs: number
}

export interface ProcessingProgress {
  projectId: string
  stage: 'preparing' | 'downloading' | 'probing' | 'encoding' | 'downloadingModel' | 'transcribing' | 'building' | 'saving' | 'complete'
  percent: number
  message: string
}

export interface TranscriptionRequest {
  audioPath: string
  language: string
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

export interface TranscriptionProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptSegment[]>
}

export interface CreateProjectInput {
  kind: SourceKind
  localPath?: string
  youtubeUrl?: string
  title?: string
  transcriptionEngine?: TranscriptionEngine
}

export interface LocalModelStatus {
  installed: boolean
  sizeBytes: number
  expectedBytes: number
  modelName: string
}

export interface ModelDownloadProgress {
  percent: number
  downloadedBytes: number
  totalBytes: number
  message: string
}

export interface BootstrapData {
  projects: ProjectSummary[]
  hasApiKey: boolean
  appVersion: string
  projectsRoot: string
  localModel: LocalModelStatus
  updateStatus: UpdateStatus
}

export interface AppApi {
  bootstrap(): Promise<BootstrapData>
  chooseLocalMedia(): Promise<string | null>
  createProject(input: CreateProjectInput): Promise<ScriptProject>
  loadProject(id: string): Promise<ScriptProject>
  saveRows(id: string, rows: ScriptRow[]): Promise<ScriptProject>
  setTranscriptionEngine(id: string, engine: TranscriptionEngine): Promise<ScriptProject>
  processProject(id: string): Promise<ScriptProject>
  cancelProcessing(id: string): Promise<void>
  deleteProject(id: string): Promise<void>
  exportHwpx(id: string): Promise<{ path: string } | null>
  saveApiKey(key: string): Promise<void>
  clearApiKey(): Promise<void>
  downloadLocalModel(): Promise<LocalModelStatus>
  deleteLocalModel(): Promise<LocalModelStatus>
  openExternal(target: ExternalLinkTarget): Promise<void>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  respondToClose(allow: boolean): Promise<void>
  onProgress(listener: (progress: ProcessingProgress) => void): () => void
  onModelProgress(listener: (progress: ModelDownloadProgress) => void): () => void
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  onCloseRequested(listener: () => void): () => void
}
