import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { APP_SCHEMA_VERSION, PROJECTS_DIRECTORY_NAME } from '@shared/constants'
import { removeLegacyLocalSpeakerLabels } from '@shared/rows'
import { getReviewIssues, normalizeWorkflow, rowReviewStatus } from '@shared/workflow'
import type { CreateProjectInput, LocalDiarizationConfig, ProjectSnapshot, ProjectSummary, ScriptProject, ScriptRow, TranscriptionEngine, WorkflowEvent } from '@shared/types'
import { safeFileName } from './file-name'

const PROJECT_FILE = 'project.json'
const DEFAULT_DIARIZATION: LocalDiarizationConfig = { mode: 'none', speakerCount: null }
const locks = new Map<string, Promise<unknown>>()

async function serialized<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const prior = locks.get(id) ?? Promise.resolve()
  const next = prior.catch(() => undefined).then(operation)
  locks.set(id, next)
  try { return await next } finally { if (locks.get(id) === next) locks.delete(id) }
}

function revision(project: ScriptProject, expected: number | undefined, optional = false): void {
  if (!(optional && expected === undefined) && (!Number.isInteger(expected) || expected !== project.workflow!.revision)) throw new Error('프로젝트가 변경되었습니다. 다시 불러오세요. (revision conflict)')
}

function audit(project: ScriptProject, action: string, before: ScriptRow[] = [], detail?: string): void {
  const previous = new Map(before.map(r => [r.id, r]))
  const current = new Map(project.rows.map(r => [r.id, r]))
  const changes: NonNullable<WorkflowEvent['changes']> = []
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    if (JSON.stringify(previous.get(id)) !== JSON.stringify(current.get(id))) changes.push({ rowId: id, before: previous.get(id), after: current.get(id) })
  }
  project.workflow!.events.push({ id: randomUUID(), at: new Date().toISOString(), actor: 'writer', action, rowIds: changes.map(c => c.rowId), changes: structuredClone(changes), detail })
}

function validateIncomingRows(rows: ScriptRow[]): void {
  if (!Array.isArray(rows) || rows.length > 100000) throw new Error('올바르지 않은 행 목록입니다.')
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || !['dialogue', 'descriptionGap'].includes(row.kind) || !Number.isFinite(row.startMs) || !Number.isFinite(row.endMs)
      || typeof row.content !== 'string' || !denseStrings(row.speakers)
      || !denseStrings(row.sourceSegmentIds)) throw new Error('올바르지 않은 행 데이터입니다.')
    ids.add(row.id)
  }
}

function denseStrings(value: unknown): value is string[] {
  return Array.isArray(value) && Array.from(value).every(item => typeof item === 'string')
}

function editable(row: ScriptRow): string {
  return JSON.stringify([row.kind, row.startMs, row.endMs, row.speakers, row.content, row.sourceSegmentIds])
}
function unapprove(row: ScriptRow): ScriptRow { return { ...row, reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined } }

function normalizedDiarization(config?: Partial<LocalDiarizationConfig>): LocalDiarizationConfig {
  if (config?.mode !== 'sherpa-onnx') return { ...DEFAULT_DIARIZATION }
  const speakerCount = config.speakerCount
  if (speakerCount !== null && speakerCount !== undefined && (!Number.isInteger(speakerCount) || speakerCount < 2 || speakerCount > 10)) {
    throw new Error('화자 수는 자동 또는 2명에서 10명 사이로 지정하세요.')
  }
  return { mode: 'sherpa-onnx', speakerCount: speakerCount ?? null }
}

export function projectsRoot(): string {
  return join(app.getPath('documents'), PROJECTS_DIRECTORY_NAME, 'Projects')
}

function defaultTitle(input: CreateProjectInput): string {
  if (input.title?.trim()) return input.title.trim()
  if (input.kind === 'local' && input.localPath) return basename(input.localPath).replace(/\.[^.]+$/, '')
  return '유튜브 영상'
}

export async function createProject(input: CreateProjectInput): Promise<ScriptProject> {
  if (input.kind === 'local' && !input.localPath) throw new Error('동영상 파일을 선택하세요.')
  if (input.kind === 'youtube' && !input.youtubeUrl) throw new Error('유튜브 링크를 입력하세요.')
  const now = new Date().toISOString()
  const id = randomUUID()
  const title = defaultTitle(input)
  const project: ScriptProject = {
    schemaVersion: APP_SCHEMA_VERSION,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    transcriptionEngine: input.transcriptionEngine ?? 'local',
    localDiarization: normalizedDiarization(input.localDiarization),
    source: {
      kind: input.kind,
      uri: input.kind === 'local' ? input.localPath! : input.youtubeUrl!,
      displayName: title,
      localMediaPath: input.kind === 'local' ? input.localPath : undefined
    },
    media: { durationMs: 0 },
    segments: [],
    rows: [],
    runs: [],
    exports: [],
    workflow: { version: 1, revision: 0, consent: { rightsConfirmedAt: input.rightsConfirmed === true ? now : undefined, cloudAudioConsentAt: input.cloudAudioConsent === true ? now : undefined }, events: [], proposals: [] }
  }
  const directory = join(projectsRoot(), `${safeFileName(title)}_${id.slice(0, 8)}`)
  await mkdir(join(directory, 'media'), { recursive: true })
  await saveProject(project, directory)
  return project
}

async function projectDirectories(): Promise<string[]> {
  await mkdir(projectsRoot(), { recursive: true })
  const entries = await readdir(projectsRoot(), { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(projectsRoot(), entry.name))
}

export async function projectDirectory(id: string): Promise<string> {
  for (const directory of await projectDirectories()) {
    try {
      const project = JSON.parse(await readFile(join(directory, PROJECT_FILE), 'utf8')) as ScriptProject
      if (project.id === id) return directory
    } catch {
      // 손상된 프로젝트는 최근 목록에서 제외한다.
    }
  }
  throw new Error('프로젝트를 찾을 수 없습니다.')
}

async function loadUnlocked(id: string): Promise<ScriptProject> {
  const directory = await projectDirectory(id)
  const project = JSON.parse(await readFile(join(directory, PROJECT_FILE), 'utf8')) as ScriptProject
  validateIncomingRows(project.rows)
  if (!Array.isArray(project.segments) || !Array.isArray(project.runs) || !Array.isArray(project.exports)
    || (project.workflow && (project.workflow.version !== 1 || !Number.isSafeInteger(project.workflow.revision) || project.workflow.revision < 0
      || !project.workflow.consent || !Array.isArray(project.workflow.events) || !Array.isArray(project.workflow.proposals)))) throw new Error('프로젝트 데이터가 올바르지 않습니다.')
  const legacyNormalized = removeLegacyLocalSpeakerLabels(project)
  const normalized: ScriptProject = normalizeWorkflow(legacyNormalized.schemaVersion < APP_SCHEMA_VERSION || !legacyNormalized.localDiarization
    ? {
        ...legacyNormalized,
        schemaVersion: APP_SCHEMA_VERSION,
        localDiarization: normalizedDiarization(legacyNormalized.localDiarization)
      }
    : legacyNormalized)
  if (normalized !== project) {
    await writeFileAtomic(join(directory, PROJECT_FILE), `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8' })
  }
  return normalized
}

export async function loadProject(id: string): Promise<ScriptProject> {
  return serialized(id, () => loadUnlocked(id))
}

export async function updateProject(id: string, update: (project: ScriptProject) => void | Promise<void>): Promise<ScriptProject> {
  return serialized(id, async () => {
    const project = await loadUnlocked(id)
    const previousRevision = project.workflow!.revision
    await update(project)
    project.workflow!.revision = previousRevision + 1
    await saveProject(project)
    return project
  })
}

export async function saveProject(project: ScriptProject, knownDirectory?: string): Promise<void> {
  const directory = knownDirectory ?? (await projectDirectory(project.id))
  project.updatedAt = new Date().toISOString()
  await writeFileAtomic(join(directory, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8' })
}

export async function saveRows(id: string, rows: ScriptRow[], expectedRevision?: number): Promise<ScriptProject> {
  validateIncomingRows(rows)
  const incoming = structuredClone(rows)
  return updateProject(id, async project => {
    revision(project, expectedRevision, true)
    const before = structuredClone(project.rows)
    const previous = new Map(before.map(row => [row.id, row]))
    const next = incoming.map(row => {
      const old = previous.get(row.id)
      const safe: ScriptRow = { id: row.id, kind: row.kind, startMs: row.startMs, endMs: row.endMs, speakers: row.speakers, content: row.content, sourceSegmentIds: row.sourceSegmentIds, reviewed: false }
      return old && editable(old) === editable(row) ? { ...safe, reviewed: rowReviewStatus(old) === 'approved', reviewStatus: rowReviewStatus(old), approvedAt: old.approvedAt } : unapprove(safe)
    })
    const nextIds = new Set(next.map(r => r.id))
    const changedCount = next.filter(r => !previous.has(r.id) || editable(previous.get(r.id)!) !== editable(r)).length + before.filter(r => !nextIds.has(r.id)).length
    if (changedCount >= 10) await snapshotProject(project, 'before-bulk-edit')
    project.rows = next
    for (const proposal of project.workflow!.proposals) if (proposal.status === 'pending' && !next.some(r => r.id === proposal.rowId && r.content === proposal.before && previous.has(r.id) && editable(previous.get(r.id)!) === editable(r))) proposal.status = 'stale'
    audit(project, 'rows-edited', before)
  })
}

export async function setTranscriptionEngine(id: string, engine: TranscriptionEngine): Promise<ScriptProject> {
  if (engine !== 'local' && engine !== 'openai') throw new Error('지원하지 않는 음성 분석 방식입니다.')
  return updateProject(id, project => { project.transcriptionEngine = engine })
}

export async function setLocalDiarizationConfig(id: string, config: LocalDiarizationConfig): Promise<ScriptProject> {
  return updateProject(id, project => { project.localDiarization = normalizedDiarization(config) })
}

export async function reviewRows(id: string, rowIds: string[], approved: boolean, expectedRevision: number): Promise<ScriptProject> {
  if (!Array.isArray(rowIds) || !rowIds.length || !rowIds.every(id => typeof id === 'string') || typeof approved !== 'boolean') throw new Error('승인할 행을 선택하세요.')
  return updateProject(id, project => {
    revision(project, expectedRevision)
    if (rowIds.some(id => !project.rows.some(r => r.id === id))) throw new Error('행을 찾을 수 없습니다.')
    if (approved && getReviewIssues(project).some(i => i.severity === 'error' && rowIds.includes(i.rowId ?? ''))) throw new Error('행의 오류를 수정한 뒤 승인하세요.')
    const before = structuredClone(project.rows)
    project.rows = project.rows.map(row => !rowIds.includes(row.id) ? row : approved ? { ...row, reviewed: true, reviewStatus: 'approved', approvedAt: new Date().toISOString() } : unapprove(row))
    audit(project, approved ? 'rows-approved' : 'approval-cleared', before)
  })
}

export async function setProjectConsent(id: string, consent: { rightsConfirmed: boolean; cloudAudioConsent: boolean; cloudCorrectionConsent: boolean }): Promise<ScriptProject> {
  if (!consent || [consent.rightsConfirmed, consent.cloudAudioConsent, consent.cloudCorrectionConsent].some(v => typeof v !== 'boolean')) throw new Error('올바르지 않은 동의 요청입니다.')
  return updateProject(id, project => {
    const now = new Date().toISOString()
    const old = project.workflow!.consent
    project.workflow!.consent = { rightsConfirmedAt: consent.rightsConfirmed ? old.rightsConfirmedAt ?? now : undefined, cloudAudioConsentAt: consent.cloudAudioConsent ? old.cloudAudioConsentAt ?? now : undefined, cloudCorrectionConsentAt: consent.cloudCorrectionConsent ? old.cloudCorrectionConsentAt ?? now : undefined }
    audit(project, 'consent-changed', project.rows, JSON.stringify({ rightsConfirmed: consent.rightsConfirmed, cloudAudioConsent: consent.cloudAudioConsent, cloudCorrectionConsent: consent.cloudCorrectionConsent }))
  })
}

export async function snapshotProject(project: ScriptProject, reason: string, knownDirectory?: string): Promise<ProjectSnapshot> {
  const directory = join(knownDirectory ?? await projectDirectory(project.id), 'snapshots')
  await mkdir(directory, { recursive: true })
  const existing = await readSnapshots(directory)
  // Keep creation order stable even when the clock has millisecond ties or moves backward.
  const createdAt = new Date(Math.max(Date.now(), existing[0] ? Date.parse(existing[0].createdAt) + 1 : 0)).toISOString()
  const snapshot: ProjectSnapshot = { id: randomUUID(), createdAt, reason, rowCount: project.rows.length }
  await writeFileAtomic(join(directory, `${snapshot.id}.json`), JSON.stringify({ ...snapshot, projectId: project.id, rows: project.rows, proposals: project.workflow?.proposals ?? [], segments: project.segments }), { encoding: 'utf8' })
  const entries = await readSnapshots(directory)
  for (const entry of entries.slice(10)) await rm(join(directory, `${entry.id}.json`))
  return snapshot
}

type StoredSnapshot = ProjectSnapshot & { projectId: string; rows: ScriptRow[]; proposals: NonNullable<ScriptProject['workflow']>['proposals']; segments: ScriptProject['segments'] }

async function readSnapshot(path: string, expectedId: string): Promise<StoredSnapshot> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as StoredSnapshot
    if (!data || data.id !== expectedId || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))
      || typeof data.reason !== 'string' || !Number.isSafeInteger(data.rowCount) || data.rowCount < 0
      || typeof data.projectId !== 'string' || !Array.isArray(data.rows) || data.rowCount !== data.rows.length
      || !Array.isArray(data.proposals) || !Array.isArray(data.segments)) throw new Error('invalid snapshot')
    validateIncomingRows(data.rows)
    if (data.proposals.some(p => !p || typeof p.id !== 'string' || typeof p.rowId !== 'string' || typeof p.before !== 'string'
      || typeof p.after !== 'string' || !['pending', 'applied', 'rejected', 'stale'].includes(p.status))) throw new Error('invalid proposals')
    return data
  } catch {
    throw new Error('복구 항목이 손상되었거나 읽을 수 없습니다.')
  }
}

async function readSnapshots(directory: string): Promise<ProjectSnapshot[]> {
  const entries: ProjectSnapshot[] = []
  let files: string[]
  try { files = await readdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  for (const file of files.filter(f => /^[\da-f-]+\.json$/i.test(f))) {
    try {
      const data = await readSnapshot(join(directory, file), file.slice(0, -5))
      entries.push({ id: data.id, reason: data.reason, createdAt: data.createdAt, rowCount: data.rowCount })
    } catch {
      // Retain corrupt evidence on disk, but do not let it disable healthy backups.
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export async function listSnapshots(id: string): Promise<ProjectSnapshot[]> {
  return serialized(id, async () => readSnapshots(join(await projectDirectory(id), 'snapshots')))
}

export async function restoreSnapshot(id: string, snapshotId: string, expectedRevision: number): Promise<ScriptProject> {
  if (typeof snapshotId !== 'string' || !/^[\da-f-]{36}$/i.test(snapshotId)) throw new Error('올바르지 않은 복구 항목입니다.')
  return updateProject(id, async project => {
    revision(project, expectedRevision)
    const directory = await projectDirectory(id)
    const snapshot = await readSnapshot(join(directory, 'snapshots', `${snapshotId}.json`), snapshotId)
    if (snapshot.projectId !== id) throw new Error('다른 프로젝트의 복구 항목입니다.')
    validateIncomingRows(snapshot.rows)
    await snapshotProject(project, 'before-restore', directory)
    const before = structuredClone(project.rows)
    const sourceMatches = JSON.stringify(snapshot.segments) === JSON.stringify(project.segments)
    project.rows = snapshot.rows.map(row => sourceMatches ? row : unapprove(row))
    project.workflow!.proposals = snapshot.proposals.map(p => p.status === 'pending' && (!sourceMatches || !project.rows.some(r => r.id === p.rowId && r.content === p.before)) ? { ...p, status: 'stale' } : p)
    audit(project, 'snapshot-restored', before, snapshotId)
  })
}

export async function decideCorrection(id: string, proposalId: string, decision: 'apply' | 'reject', expectedRevision: number): Promise<ScriptProject> {
  if (decision !== 'apply' && decision !== 'reject') throw new Error('올바르지 않은 교정 결정입니다.')
  return updateProject(id, async project => {
    revision(project, expectedRevision)
    const proposal = project.workflow!.proposals.find(p => p.id === proposalId)
    if (!proposal || proposal.status !== 'pending') throw new Error('사용할 수 없는 교정 제안입니다.')
    const row = project.rows.find(r => r.id === proposal.rowId)
    const before = structuredClone(project.rows)
    if (decision === 'apply') {
      if (!row || row.kind !== 'dialogue' || row.content !== proposal.before) throw new Error('원문이 변경되어 교정을 적용할 수 없습니다.')
      await snapshotProject(project, 'before-correction')
      Object.assign(row, unapprove({ ...row, content: proposal.after }))
    }
    proposal.status = decision === 'apply' ? 'applied' : 'rejected'
    proposal.decidedAt = new Date().toISOString()
    audit(project, `correction-${decision}`, before, proposalId)
  })
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects: ProjectSummary[] = []
  for (const directory of await projectDirectories()) {
    try {
      const project = JSON.parse(await readFile(join(directory, PROJECT_FILE), 'utf8')) as ScriptProject
      projects.push({
        id: project.id,
        title: project.title,
        status: project.status,
        updatedAt: project.updatedAt,
        sourceKind: project.source.kind,
        durationMs: project.media.durationMs
      })
    } catch {
      // 손상된 프로젝트는 건너뛴다.
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProject(id: string): Promise<void> {
  const directory = resolve(await projectDirectory(id))
  const root = resolve(projectsRoot())
  const relativePath = relative(root, directory)
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(':')) {
    throw new Error('프로젝트 폴더 범위를 벗어난 삭제 요청입니다.')
  }
  await rm(directory, { recursive: true, force: true })
}
