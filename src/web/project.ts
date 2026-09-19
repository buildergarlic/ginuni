import { z } from 'zod'
import { addDescriptionCandidates } from '../shared/description-candidates'
import { decodeSubtitleBytes, parseSrt } from '../shared/subtitle-parser'
import {
  generateSubtitleRows,
  validateSubtitleRows
} from '../shared/subtitle-rows'
import type { ScriptRow } from '../shared/types'
import { SAMPLE_MEDIA } from './sample-media'
import sampleTranscript from './sample-transcript.json'
import type { TranscriptionLanguage } from './transcription-types'
import { SPEECH_LANGUAGES, TRANSLATION_LANGUAGE_CODES, type TranslationSourceLanguage } from './languages'

export const MAX_MEDIA_DURATION_MS = 3 * 60 * 60 * 1_000
const MAX_ROWS = 20_000
const MAX_PROJECTS = 10
const STORAGE_KEY = 'ginuni-web-projects-v1'

export interface RowTranslation {
  sourceContent: string
  content: string
  draft: string
  reviewed: boolean
  approvedAt?: string
}

export interface WebScriptRow extends ScriptRow {
  translation?: RowTranslation
}

export interface WebProject {
  schemaVersion: 1
  id: string
  title: string
  updatedAt: string
  mediaName: string
  durationMs: number
  rows: WebScriptRow[]
  source: 'sample' | 'manual' | 'subtitle' | 'transcription'
  sample?: boolean
  sampleId?: string
  transcriptionLanguage?: TranscriptionLanguage
  dialogueLanguage?: 'original' | 'korean'
  translationSourceLanguage?: TranslationSourceLanguage
}

const identifierSchema = z.string().trim().min(1).max(200)
const timeSchema = z.number().int().min(0).max(MAX_MEDIA_DURATION_MS)
const rowSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['dialogue', 'descriptionGap']),
    startMs: timeSchema,
    endMs: timeSchema,
    speakers: z.array(z.string().max(200)).max(100),
    content: z.string().max(10_000),
    sourceSegmentIds: z.array(identifierSchema).max(MAX_ROWS),
    sourceCueIds: z.array(identifierSchema).max(MAX_ROWS).optional(),
    subtitleGapCandidate: z.boolean().optional(),
    reviewed: z.boolean(),
    reviewStatus: z
      .enum(['unreviewed', 'needsAttention', 'approved'])
      .optional(),
    approvedAt: z.string().datetime({ offset: true }).optional(),
    translation: z.object({
      sourceContent: z.string().max(10_000),
      content: z.string().max(10_000),
      draft: z.string().max(10_000),
      reviewed: z.boolean().default(false),
      approvedAt: z.string().datetime({ offset: true }).optional()
    }).optional()
  })
  .refine((row) => row.endMs > row.startMs, {
    message: '행의 종료 시간은 시작 시간보다 뒤여야 합니다.'
  })

const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifierSchema,
    title: z.string().trim().min(1).max(500),
    updatedAt: z.string().datetime({ offset: true }),
    mediaName: z.string().max(1_000),
    durationMs: timeSchema,
    rows: z.array(rowSchema).max(MAX_ROWS),
    source: z.enum(['sample', 'manual', 'subtitle', 'transcription']),
    sample: z.boolean().optional(),
    sampleId: z.enum(['market-street-1906', 'shy-guy-1947']).optional(),
    transcriptionLanguage: z.enum(SPEECH_LANGUAGES.map(item => item.speech)).optional(),
    dialogueLanguage: z.enum(['original', 'korean']).optional(),
    translationSourceLanguage: z.enum(TRANSLATION_LANGUAGE_CODES).optional()
  })
  .superRefine((project, context) => {
    const ids = new Set<string>()
    for (const [index, row] of project.rows.entries()) {
      if (ids.has(row.id))
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'id'],
          message: '대본 행 ID가 중복되었습니다.'
        })
      ids.add(row.id)
      if (row.endMs > project.durationMs)
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'endMs'],
          message: '대본 행이 영상 길이를 벗어났습니다.'
        })
    }
  })

function validatedProject(value: unknown): WebProject {
  const result = projectSchema.safeParse(value)
  if (!result.success) {
    const detail = result.error.issues[0]
    throw new Error(
      `프로젝트 형식이 올바르지 않습니다 (${detail.path.join('.') || '프로젝트'}): ${detail.message}`
    )
  }
  // Zod object schemas strip unknown keys so neither backup files nor browser
  // drafts can introduce executable properties or accidentally persist media.
  return result.data
}

export function createProject(title = '새 화면해설 대본'): WebProject {
  return validatedProject({
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    title,
    updatedAt: new Date().toISOString(),
    mediaName: '',
    durationMs: 60_000,
    rows: [],
    source: 'manual'
  })
}

export function createSampleProject(): WebProject {
  const sample = createProject(SAMPLE_MEDIA.title)
  const rows: ScriptRow[] = sampleTranscript.segments.map(
    ({ id, startMs, endMs, text }) => ({
      id: globalThis.crypto.randomUUID(),
      kind: 'dialogue',
      startMs,
      endMs,
      speakers: [],
      content: text,
      sourceSegmentIds: [id],
      reviewed: false,
      reviewStatus: 'unreviewed'
    })
  )
  return {
    ...sample,
    durationMs: SAMPLE_MEDIA.durationMs,
    rows,
    source: 'sample',
    sample: true,
    sampleId: SAMPLE_MEDIA.id,
    transcriptionLanguage: 'english'
  }
}

export function parseProject(text: string): WebProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      '프로젝트 백업 JSON을 읽을 수 없습니다. 올바른 기누니 웹 백업 파일인지 확인해 주세요.'
    )
  }
  return validatedProject(parsed)
}

export function serializeProject(project: WebProject): string {
  return JSON.stringify(validatedProject(project), null, 2)
}

function browserStorage(): Storage {
  try {
    const storage = globalThis.localStorage
    if (storage) return storage
  } catch {
    // Browsers may deny access before getItem itself is called.
  }
  throw new Error(
    '브라우저 저장소를 사용할 수 없습니다. 작업 내용을 JSON 백업으로 내려받아 주세요.'
  )
}

export function loadProjects(): WebProject[] {
  let stored: string | null
  try {
    stored = browserStorage().getItem(STORAGE_KEY)
  } catch {
    throw new Error(
      '브라우저에 저장된 작업을 읽을 수 없습니다. 저장소 설정을 확인하고 현재 작업을 JSON 백업으로 보관해 주세요.'
    )
  }
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed) || parsed.length > MAX_PROJECTS)
      throw new Error('잘못된 프로젝트 목록')
    const projects = parsed.map(validatedProject)
    if (new Set(projects.map((project) => project.id)).size !== projects.length)
      throw new Error('중복된 프로젝트 ID')
    return projects.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )
  } catch {
    throw new Error(
      '브라우저에 저장된 작업 데이터가 손상되어 덮어쓰지 않았습니다. 기존 저장 데이터를 보존한 뒤 JSON 백업으로 복구해 주세요.'
    )
  }
}

function writeProjects(projects: WebProject[]): void {
  const serialized = JSON.stringify(projects)
  try {
    browserStorage().setItem(STORAGE_KEY, serialized)
  } catch {
    // localStorage.setItem is atomic: a quota error leaves the old value intact.
    throw new Error(
      '브라우저 저장에 실패했습니다. 저장 용량이나 브라우저 설정을 확인하고 현재 작업을 JSON 백업으로 내려받아 주세요.'
    )
  }
}

export function saveProject(project: WebProject): void {
  const validated = validatedProject(project)
  const projects = loadProjects()
  const existingIndex = projects.findIndex((item) => item.id === validated.id)
  if (existingIndex >= 0) projects[existingIndex] = validated
  else {
    if (projects.length >= MAX_PROJECTS)
      throw new Error(
        '브라우저에는 최대 10개의 프로젝트를 저장할 수 있습니다. 기존 작업을 JSON으로 백업한 뒤 필요 없는 프로젝트를 삭제해 주세요.'
      )
    projects.push(validated)
  }
  writeProjects(projects)
}

export function deleteProject(id: string): void {
  const projects = loadProjects()
  if (!projects.some((project) => project.id === id)) return
  writeProjects(projects.filter((project) => project.id !== id))
}

export function importSubtitle(
  bytes: Uint8Array,
  durationMs: number,
  offsetMs = 0
): { rows: ScriptRow[]; warnings: string[] } {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_MEDIA_DURATION_MS
  ) {
    throw new Error('영상 길이는 0부터 3시간 이내의 정수 밀리초여야 합니다.')
  }
  if (!Number.isSafeInteger(offsetMs))
    throw new Error('자막 시간차는 유한한 정수 밀리초여야 합니다.')
  const { text } = decodeSubtitleBytes(bytes)
  const parsed = parseSrt(text, globalThis.crypto.randomUUID())
  const errors = parsed.issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    const first = errors[0]
    throw new Error(
      `자막을 가져오지 않았습니다${first.ordinal ? ` (${first.ordinal}번)` : ''}: ${first.message}`
    )
  }
  if (parsed.cues.length > MAX_ROWS)
    throw new Error('자막은 20,000개 이내로 가져올 수 있습니다.')
  const dialogueRows = generateSubtitleRows(parsed.cues, offsetMs)
  const lastEnd = dialogueRows.reduce(
    (maximum, row) => Math.max(maximum, row.endMs),
    0
  )
  const effectiveDuration = durationMs || lastEnd
  if (effectiveDuration > MAX_MEDIA_DURATION_MS)
    throw new Error('자막의 전체 길이는 3시간을 초과할 수 없습니다.')
  const invalidRow = validateSubtitleRows(dialogueRows, effectiveDuration).find(
    (issue) => issue.severity === 'error'
  )
  if (invalidRow)
    throw new Error(`자막을 가져오지 않았습니다: ${invalidRow.message}`)
  const rows = addDescriptionCandidates(dialogueRows, effectiveDuration)
  if (rows.length > MAX_ROWS)
    throw new Error(
      '해설 후보를 포함한 대본 행은 20,000개를 초과할 수 없습니다.'
    )
  return {
    rows,
    warnings: parsed.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.message)
  }
}
