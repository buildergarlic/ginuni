import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { APP_SCHEMA_VERSION, PROJECTS_DIRECTORY_NAME } from '@shared/constants'
import { removeLegacyLocalSpeakerLabels } from '@shared/rows'
import type { CreateProjectInput, LocalDiarizationConfig, ProjectSummary, ScriptProject, ScriptRow, TranscriptionEngine } from '@shared/types'
import { safeFileName } from './file-name'

const PROJECT_FILE = 'project.json'
const DEFAULT_DIARIZATION: LocalDiarizationConfig = { mode: 'none', speakerCount: null }

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
    exports: []
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

export async function loadProject(id: string): Promise<ScriptProject> {
  const directory = await projectDirectory(id)
  const project = JSON.parse(await readFile(join(directory, PROJECT_FILE), 'utf8')) as ScriptProject
  const legacyNormalized = removeLegacyLocalSpeakerLabels(project)
  const normalized: ScriptProject = legacyNormalized.schemaVersion < APP_SCHEMA_VERSION || !legacyNormalized.localDiarization
    ? {
        ...legacyNormalized,
        schemaVersion: APP_SCHEMA_VERSION,
        localDiarization: normalizedDiarization(legacyNormalized.localDiarization)
      }
    : legacyNormalized
  if (normalized !== project) {
    await writeFileAtomic(join(directory, PROJECT_FILE), `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8' })
  }
  return normalized
}

export async function saveProject(project: ScriptProject, knownDirectory?: string): Promise<void> {
  const directory = knownDirectory ?? (await projectDirectory(project.id))
  project.updatedAt = new Date().toISOString()
  await writeFileAtomic(join(directory, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8' })
}

export async function saveRows(id: string, rows: ScriptRow[]): Promise<ScriptProject> {
  const project = await loadProject(id)
  project.rows = rows
  await saveProject(project)
  return project
}

export async function setTranscriptionEngine(id: string, engine: TranscriptionEngine): Promise<ScriptProject> {
  if (engine !== 'local' && engine !== 'openai') throw new Error('지원하지 않는 음성 분석 방식입니다.')
  const project = await loadProject(id)
  project.transcriptionEngine = engine
  await saveProject(project)
  return project
}

export async function setLocalDiarizationConfig(id: string, config: LocalDiarizationConfig): Promise<ScriptProject> {
  const project = await loadProject(id)
  project.localDiarization = normalizedDiarization(config)
  await saveProject(project)
  return project
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
