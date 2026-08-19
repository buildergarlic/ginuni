export type SourceKind = 'local' | 'youtube'
export type ScriptRowKind = 'dialogue' | 'descriptionGap'
export type ProjectStatus = 'draft' | 'processing' | 'review' | 'exported' | 'error'
export type TranscriptionEngine = 'local' | 'openai'
export type LocalDiarizationMode = 'none' | 'sherpa-onnx'
export type ExternalLinkTarget = 'repository' | 'sponsor' | 'threads' | 'email' | 'kakao'
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
export type LocalProcessingStage = 'media' | 'probe' | 'encoding' | 'model' | 'runtime' | 'transcription' | 'output' | 'building'
export type LocalFailureCode =
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_UNREADABLE'
  | 'FFPROBE_FAILED'
  | 'FFMPEG_FAILED'
  | 'MODEL_MISSING'
  | 'MODEL_CORRUPTED'
  | 'RUNTIME_BLOCKED'
  | 'UNSUPPORTED_ARCHITECTURE'
  | 'INSUFFICIENT_MEMORY'
  | 'WHISPER_FAILED'
  | 'WHISPER_OUTPUT_INVALID'
  | 'PROCESSING_FAILED'

export type DiarizationWarningCode =
  | 'DIARIZATION_RUNTIME_BLOCKED'
  | 'DIARIZATION_MODEL_INVALID'
  | 'DIARIZATION_INSUFFICIENT_MEMORY'
  | 'DIARIZATION_FAILED'
  | 'DIARIZATION_OUTPUT_INVALID'
  | 'DIARIZATION_WORD_TIMESTAMPS_UNAVAILABLE'

export interface LocalDiarizationConfig {
  mode: LocalDiarizationMode
  speakerCount: number | null
}

export interface DiarizationSegment {
  startMs: number
  endMs: number
  speakerId: string
}

export interface ProcessingWarning {
  code: DiarizationWarningCode
  message: string
  detail?: string
  exitCode?: number
}

export interface DiarizationRunInfo {
  engine: 'sherpa-onnx'
  engineVersion: string
  segmentationModel: string
  embeddingModel: string
  requestedSpeakerCount: number | null
  detectedSpeakerCount?: number
  status: 'succeeded' | 'fallback'
  unassignedWordCount?: number
  ambiguousWordCount?: number
}

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
  errorStage?: LocalProcessingStage
  exitCode?: number
  stderrSummary?: string
  appVersion?: string
  platform?: string
  architecture?: string
  totalMemoryBytes?: number
  modelIntegrity?: LocalModelStatus['integrity']
  httpStatus?: number
  requestId?: string
  apiCode?: string
  apiType?: string
  apiParam?: string
  apiDetail?: string
  openaiRequest?: OpenAiRequestInfo
  openaiAudio?: OpenAiAudioInfo
  diarization?: DiarizationRunInfo
  warnings?: ProcessingWarning[]
}

export interface OpenAiRequestInfo {
  model: string
  responseFormat: string
  chunkingStrategy: string
  language?: string
}

export interface OpenAiAudioInfo {
  extension?: string
  bytes?: number
  durationMs?: number
  codec?: string
  sampleRate?: number
  channels?: number
}

export interface ExportRecord {
  path: string
  exportedAt: string
  appVersion: string
  format?: 'hwpx' | 'srt'
}

export interface ScriptProject {
  schemaVersion: number
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  transcriptionEngine?: TranscriptionEngine
  localDiarization: LocalDiarizationConfig
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
  stage: 'preparing' | 'downloading' | 'probing' | 'encoding' | 'downloadingModel' | 'transcribing' | 'diarizing' | 'building' | 'saving' | 'complete'
  percent: number
  message: string
}

export interface TranscriptionRequest {
  audioPath: string
  language: string
  durationMs?: number
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
  localDiarization?: LocalDiarizationConfig
}

export interface LocalModelStatus {
  installed: boolean
  integrity: 'missing' | 'valid' | 'invalid'
  sizeBytes: number
  expectedBytes: number
  modelName: string
}

export interface RuntimeDiagnostic {
  name: 'ffmpeg' | 'ffprobe' | 'whisper-cli' | 'vad-model' | 'sherpa-diarizer' | 'diarization-segmentation-model' | 'diarization-embedding-model'
  available: boolean
  runnable: boolean
  detail?: string
}

export interface LocalDiagnosticReport {
  generatedAt: string
  appVersion: string
  platform: string
  osVersion: string
  processArchitecture: string
  osArchitecture: string
  totalMemoryBytes: number
  freeMemoryBytes: number
  project: {
    id: string
    sourceKind: SourceKind
    sourceExtension?: string
    sourceSizeBytes?: number
    durationMs: number
  }
  latestRun?: Pick<ProcessingRun, 'id' | 'provider' | 'model' | 'startedAt' | 'completedAt' | 'errorCode' | 'errorStage' | 'exitCode' | 'stderrSummary' | 'modelIntegrity' | 'httpStatus' | 'requestId' | 'apiCode' | 'apiType' | 'apiParam' | 'apiDetail' | 'openaiRequest' | 'openaiAudio' | 'diarization' | 'warnings'>
  lastError?: string
  localModel: LocalModelStatus
  diarizationBundle: DiarizationBundleStatus
  runtimes: RuntimeDiagnostic[]
}

export interface DiarizationBundleComponentStatus {
  id: 'runtime' | 'segmentation' | 'embedding'
  name: string
  available: boolean
  integrity: 'missing' | 'valid' | 'invalid'
  sizeBytes: number
  expectedBytes: number
}

export interface DiarizationBundleStatus {
  available: boolean
  integrity: 'missing' | 'valid' | 'invalid'
  engineVersion: string
  installedBytes: number
  expectedBytes: number
  components: DiarizationBundleComponentStatus[]
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
  diarizationBundle: DiarizationBundleStatus
  updateStatus: UpdateStatus
}

export interface AppApi {
  bootstrap(): Promise<BootstrapData>
  chooseLocalMedia(): Promise<string | null>
  createProject(input: CreateProjectInput): Promise<ScriptProject>
  loadProject(id: string): Promise<ScriptProject>
  saveRows(id: string, rows: ScriptRow[]): Promise<ScriptProject>
  exportSrt(id: string): Promise<{ path: string; format: 'srt' } | null>
  setTranscriptionEngine(id: string, engine: TranscriptionEngine): Promise<ScriptProject>
  setLocalDiarizationConfig(id: string, config: LocalDiarizationConfig): Promise<ScriptProject>
  processProject(id: string): Promise<ScriptProject>
  cancelProcessing(id: string): Promise<void>
  deleteProject(id: string): Promise<void>
  exportHwpx(id: string): Promise<{ path: string } | null>
  saveApiKey(key: string): Promise<void>
  clearApiKey(): Promise<void>
  downloadLocalModel(): Promise<LocalModelStatus>
  deleteLocalModel(): Promise<LocalModelStatus>
  exportDiagnostics(id: string): Promise<{ path: string } | null>
  openExternal(target: ExternalLinkTarget): Promise<void>
  openExternalUrl(url: string): Promise<void>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  respondToClose(allow: boolean): Promise<void>
  onProgress(listener: (progress: ProcessingProgress) => void): () => void
  onModelProgress(listener: (progress: ModelDownloadProgress) => void): () => void
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  onCloseRequested(listener: () => void): () => void
}
