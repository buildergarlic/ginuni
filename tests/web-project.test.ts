import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScriptRow } from '../src/shared/types'
import { SAMPLE_MEDIA } from '../src/web/sample-media'
import sampleTranscript from '../src/web/sample-transcript.json'
import { SPEECH_LANGUAGES, TRANSLATION_LANGUAGE_CODES } from '../src/web/languages'
import {
  createProject,
  createSampleProject,
  deleteProject,
  importSubtitle,
  loadProjects,
  MAX_MEDIA_DURATION_MS,
  parseProject,
  resolveAttachedMediaDuration,
  saveProject,
  serializeProject,
  type WebProject
} from '../src/web/project'

const STORAGE_KEY = 'ginuni-web-projects-v1'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  quotaExceeded = false
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void {
    if (this.quotaExceeded) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    this.values.set(key, value)
  }
}

function row(overrides: Partial<ScriptRow> = {}): ScriptRow {
  return { id: 'row-1', kind: 'dialogue', startMs: 1_000, endMs: 2_000, content: '함께 걸을까?', speakers: ['지우'], sourceSegmentIds: [], reviewed: false, ...overrides }
}

function project(overrides: Partial<WebProject> = {}): WebProject {
  return { schemaVersion: 1, id: 'project-1', title: '공원에서', updatedAt: '2026-09-19T12:00:00.000Z', mediaName: '공원.mp4', durationMs: 45_000, rows: [row()], source: 'manual', ...overrides }
}

let storage: MemoryStorage
beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => vi.unstubAllGlobals())

describe('web project backups', () => {
  it('preserves Korean ASR settings, recovery evidence and independent translation review through save and restore', () => {
    const draft = project({ koreanAsrMode: 'precision', lastAsrProfile: 'korean-turbo', rows: [{
      ...row(), asrWarnings: ['repetition', 'token-limit'], asrOriginalText: '처음 인식한 대사 '.repeat(1500), asrRetryCount: 1,
      translation: { sourceContent: '함께 걸을까?', content: '함께 걸을까요?', draft: '함께 걸을까요?', reviewed: true }
    }] })
    const restored = parseProject(serializeProject(draft))
    expect(restored).toEqual(draft)
    saveProject(restored)
    expect(loadProjects()).toEqual([draft])
    expect(restored.rows[0].reviewed).toBe(false)
  })

  it.each([
    { koreanAsrMode: 'tiny' }, { lastAsrProfile: 'unknown' },
    { rows: [{ ...row(), asrWarnings: ['invented'] }] },
    { rows: [{ ...row(), asrRetryCount: -1 }] }
  ])('rejects unsupported ASR settings/evidence in imported backups: %j', invalid => {
    expect(() => parseProject(JSON.stringify({ ...project(), ...invalid }))).toThrow(/형식/)
  })

  it('creates an empty manual draft that round trips independently from the sample', () => {
    const draft = createProject()
    expect(draft.id).not.toBe(createProject().id)
    expect(parseProject(serializeProject(draft))).toMatchObject({ source: 'manual', durationMs: 60_000, rows: [] })
  })

  it('preserves the real English sample capture as unreviewed dialogue without invented descriptions', () => {
    const capturedSegments: Array<{ id: string; startMs: number; endMs: number; text: string }> = sampleTranscript.segments
    expect(capturedSegments.length).toBeGreaterThan(0)
    expect(sampleTranscript.sampleId).toBe(SAMPLE_MEDIA.id)
    expect(sampleTranscript.language).toBe('english')
    const sample = parseProject(serializeProject(createSampleProject()))
    expect(sample).toMatchObject({
      title: SAMPLE_MEDIA.title,
      source: 'sample',
      sample: true,
      sampleId: SAMPLE_MEDIA.id,
      durationMs: SAMPLE_MEDIA.durationMs,
      transcriptionLanguage: 'english'
    })
    expect(sample.rows.map(({ content, startMs, endMs, sourceSegmentIds }) => ({ content, startMs, endMs, sourceSegmentIds }))).toEqual(
      capturedSegments.map(({ id, text, startMs, endMs }) => ({ content: text, startMs, endMs, sourceSegmentIds: [id] }))
    )
    expect(sample.rows).toHaveLength(capturedSegments.length)
    expect(sample.rows.every(item => item.kind === 'dialogue' && !item.reviewed && item.reviewStatus === 'unreviewed')).toBe(true)
    expect(sample.rows.every(item => item.speakers.length === 0 && /[A-Za-z]/.test(item.content) && !/[가-힣]/.test(item.content))).toBe(true)
  })

  it('preserves legacy sample drafts without assigning unrelated real footage', () => {
    const oldSample = project({ source: 'sample', sample: true })
    const restored = parseProject(serializeProject(oldSample))
    expect(restored.rows).toEqual(oldSample.rows)
    expect(restored.durationMs).toBe(45_000)
    expect(restored.sampleId).toBeUndefined()
  })

  it('preserves the old Market Street sample backup without rewriting its footage, title or descriptions', () => {
    const oldSample = project({
      source: 'sample',
      sample: true,
      sampleId: 'market-street-1906',
      title: 'Market Street (1906) · 내가 고친 대본',
      mediaName: 'sample-market-street-1906.mp4',
      durationMs: 60_000,
      rows: [row({ kind: 'descriptionGap', startMs: 0, endMs: 8000, content: '노면전차 앞으로 사람들이 지나간다.' })]
    })
    const restored = parseProject(serializeProject(oldSample))
    expect(restored).toEqual(oldSample)
    expect(restored.sampleId).not.toBe(SAMPLE_MEDIA.id)
    expect(restored.title).not.toBe(SAMPLE_MEDIA.title)
    expect(restored.transcriptionLanguage).toBeUndefined()
  })

  it('round trips Korean text and approved rows while stripping unknown project and row properties', () => {
    const backup = { ...project(), mediaBytes: 'private media', script: 'unknown', rows: [{ ...row({ reviewed: true, reviewStatus: 'approved', approvedAt: '2026-09-19T12:00:00.000Z' }), privatePath: 'C:/private' }] }
    const restored = parseProject(JSON.stringify(backup))
    expect(restored.rows[0]).toMatchObject({ content: '함께 걸을까?', reviewed: true, reviewStatus: 'approved' })
    expect(restored).not.toHaveProperty('mediaBytes')
    expect(restored).not.toHaveProperty('script')
    expect(restored.rows[0]).not.toHaveProperty('privatePath')
    expect(serializeProject(restored)).not.toContain('private')
  })

  it.each([
    { schemaVersion: 2 }, { id: '' }, { source: 'external' }, { title: '' }, { durationMs: -1 },
    { durationMs: MAX_MEDIA_DURATION_MS + 1 }, { durationMs: 1.5 }, { updatedAt: 'yesterday' },
    { rows: [row(), row()] }, { rows: [row({ endMs: 46_000 })] },
    { rows: [row({ startMs: 2_000, endMs: 1_000 })] }, { rows: [row({ startMs: 1.5 })] },
    { rows: [row({ content: '가'.repeat(10_001) })] }, { rows: [row({ kind: 'unknown' as ScriptRow['kind'] })] },
    { rows: [row({ reviewed: 'yes' as unknown as boolean })] },
    { rows: [row({ endMs: Infinity })] },
    { rows: Array.from({ length: 20_001 }, (_, index) => row({ id: `row-${index}` })) }
  ])('rejects invalid backups without touching saved work (case %#)', overrides => {
    saveProject(project())
    const before = storage.getItem(STORAGE_KEY)
    expect(() => parseProject(JSON.stringify({ ...project(), ...overrides }))).toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('reports malformed JSON as an import error', () => {
    expect(() => parseProject('{broken')).toThrow(/백업|프로젝트|JSON/)
  })

  it('validates an in-memory project before serializing, including nonfinite times', () => {
    expect(() => serializeProject(project({ rows: [row({ endMs: NaN })] }))).toThrow()
  })
})

describe('reattaching media to an existing timeline', () => {
  it('accepts the real 2 ms decoder disagreement without changing any restored row or timestamp', () => {
    const draft = parseProject(serializeProject(project({
      source: 'transcription',
      durationMs: 1_461_662,
      rows: [
        { ...row({ id: 'first', startMs: 0, endMs: 6000 }), asrWarnings: ['repetition'], asrOriginalText: '처음 인식한 대사', asrRetryCount: 1 },
        row({ id: 'last-dialogue', startMs: 1_450_000, endMs: 1_458_500, reviewed: true }),
        row({ id: 'trailing-description', kind: 'descriptionGap', startMs: 1_458_500, endMs: 1_461_662, content: '화면이 어두워진다.' })
      ]
    })))
    const before = serializeProject(draft)
    for (const item of draft.rows) Object.freeze(item)
    Object.freeze(draft.rows)
    Object.freeze(draft)

    const durationMs = resolveAttachedMediaDuration(draft, 1_461_660)

    expect(durationMs).toBe(1_461_662)
    expect(serializeProject(draft)).toBe(before)
    expect(parseProject(serializeProject({ ...draft, durationMs })).rows).toEqual(draft.rows)
  })

  it.each([1, 2, 9, 10])('preserves a %i ms rounding difference at the end of the existing timeline', delta => {
    const draft = project({ durationMs: 30_000 + delta, rows: [row({ endMs: 30_000 + delta })] })
    expect(resolveAttachedMediaDuration(draft, 30_000)).toBe(draft.durationMs)
    expect(draft.rows[0].endMs).toBe(30_000 + delta)
  })

  it.each([11, 1000])('rejects a file %i ms shorter than the last row and leaves the draft unchanged', delta => {
    const draft = project({ durationMs: 30_000 + delta, rows: [row({ endMs: 30_000 + delta })] })
    const before = serializeProject(draft)
    expect(() => resolveAttachedMediaDuration(draft, 30_000)).toThrow(/선택한 영상이 대본의 종료 시간보다 짧습니다/)
    expect(serializeProject(draft)).toBe(before)
  })

  it('refuses a near-boundary row when the saved project duration describes a substantially longer file', () => {
    const draft = project({ durationMs: 45_000, rows: [row({ endMs: 30_002 })] })
    expect(() => resolveAttachedMediaDuration(draft, 30_000)).toThrow(/선택한 영상이 대본의 종료 시간보다 짧습니다/)
    expect(draft.durationMs).toBe(45_000)
    expect(draft.rows[0].endMs).toBe(30_002)
  })

  it('uses the observed duration when there are no rows, including the supported 3 hour boundary', () => {
    const draft = project({ durationMs: 0, rows: [] })
    expect(resolveAttachedMediaDuration(draft, 1)).toBe(1)
    expect(resolveAttachedMediaDuration(draft, MAX_MEDIA_DURATION_MS)).toBe(MAX_MEDIA_DURATION_MS)
    expect(draft.durationMs).toBe(0)
  })

  it.each([30_000, 30_002, 45_000])('uses the observed duration when all rows fit even if the old duration was %i ms', durationMs => {
    const draft = project({ durationMs, rows: [row({ endMs: 30_000 })] })
    expect(resolveAttachedMediaDuration(draft, 30_000)).toBe(30_000)
    expect(draft.durationMs).toBe(durationMs)
    expect(draft.rows[0].endMs).toBe(30_000)
  })

  it.each([NaN, 0, -1, Infinity, 1.5, MAX_MEDIA_DURATION_MS + 1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid observed media duration %s before applying any tolerance', observed => {
    const draft = project({ rows: [] })
    expect(() => resolveAttachedMediaDuration(draft, observed)).toThrow(/영상 길이/)
    expect(draft.durationMs).toBe(45_000)
    expect(draft.rows).toEqual([])
  })
})

describe('browser draft storage', () => {
  it('saves and updates only the selected project and deletes only its ID', () => {
    saveProject(project())
    saveProject(project({ id: 'project-2', title: '두 번째' }))
    saveProject(project({ title: '수정한 공원' }))
    expect(loadProjects().map(item => item.title).sort()).toEqual(['두 번째', '수정한 공원'])
    deleteProject('project-1')
    expect(loadProjects().map(item => item.id)).toEqual(['project-2'])
  })

  it('refuses an eleventh project without evicting saved projects, but allows existing-project updates', () => {
    for (let index = 0; index < 10; index += 1) saveProject(project({ id: `project-${index}` }))
    expect(() => saveProject(project({ id: 'eleventh' }))).toThrow(/10|열/)
    expect(loadProjects()).toHaveLength(10)
    saveProject(project({ id: 'project-3', title: '수정됨' }))
    expect(loadProjects().find(item => item.id === 'project-3')?.title).toBe('수정됨')
  })

  it.each(['{broken', '{}', '[{"id":"broken"}]', JSON.stringify([project(), project()])])('refuses to overwrite corrupted storage: %s', stored => {
    storage.setItem(STORAGE_KEY, stored)
    expect(() => loadProjects()).toThrow(/저장|복구|손상/)
    expect(() => saveProject(project({ id: 'new' }))).toThrow()
    expect(() => deleteProject('project-1')).toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBe(stored)
  })

  it('preserves previous work and reports quota failures instead of pretending to save', () => {
    saveProject(project())
    storage.quotaExceeded = true
    expect(() => saveProject(project({ title: '저장되지 않을 수정' }))).toThrow(/용량|저장/)
    expect(loadProjects()[0].title).toBe('공원에서')
    expect(() => deleteProject('project-1')).toThrow(/저장|삭제/)
    expect(loadProjects()).toHaveLength(1)
  })

  it('reports unavailable browser storage rather than returning an empty project list', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => loadProjects()).toThrow(/저장/)
    expect(() => saveProject(project())).toThrow(/저장/)
  })
})

describe('web translation backup compatibility', () => {
  const translation = {
    sourceContent: 'Hello.', content: '수정한 번역입니다.', draft: '안녕하세요.',
    reviewed: true, approvedAt: '2026-09-19T13:00:00.000Z'
  }

  it('round trips source, Korean edit, original machine draft and separate review state through storage and JSON', () => {
    const translated = project({
      dialogueLanguage: 'korean', translationSourceLanguage: 'en', transcriptionLanguage: 'english',
      rows: [{ ...row({ content: 'Hello.', reviewed: false, sourceCueIds: ['cue-original'] }), translation }]
    })
    const restored = parseProject(serializeProject(translated))
    expect(restored).toEqual(translated)
    saveProject(restored)
    expect(loadProjects()[0]).toEqual(translated)
    storage.quotaExceeded = true
    expect(() => saveProject({ ...translated, dialogueLanguage: 'original' })).toThrow(/저장/)
    expect(loadProjects()[0]).toEqual(translated)
  })

  it('retains old v1 drafts without adding translation fields or changing their content', () => {
    const old = project()
    const restored = parseProject(serializeProject(old))
    expect(restored).toEqual(old)
    expect(restored.rows[0]).not.toHaveProperty('translation')
    expect(restored).not.toHaveProperty('dialogueLanguage')
    expect(restored).not.toHaveProperty('translationSourceLanguage')
  })

  it('accepts every supported speech/translation language and excludes unsupported language values', () => {
    for (const { speech } of SPEECH_LANGUAGES)
      expect(parseProject(serializeProject(project({ transcriptionLanguage: speech }))).transcriptionLanguage).toBe(speech)
    for (const code of TRANSLATION_LANGUAGE_CODES)
      expect(parseProject(serializeProject(project({ translationSourceLanguage: code }))).translationSourceLanguage).toBe(code)
    for (const overrides of [{ transcriptionLanguage: 'unknown' }, { translationSourceLanguage: 'ko' }, { dialogueLanguage: 'english' }])
      expect(() => parseProject(JSON.stringify({ ...project(), ...overrides }))).toThrow()
  })

  it('canonicalizes translation metadata and treats missing translation approval as unreviewed', () => {
    const restored = parseProject(JSON.stringify({ ...project(), rows: [{ ...row(), translation: { ...translation, reviewed: undefined, privateToken: 'never-store' } }] }))
    expect(restored.rows[0].translation?.reviewed).toBe(false)
    expect(restored.rows[0].translation).not.toHaveProperty('privateToken')
  })

  it.each([
    { sourceContent: 'a'.repeat(10001) }, { content: '가'.repeat(10001) }, { draft: '가'.repeat(10001) },
    { sourceContent: 12 }, { content: null }, { draft: undefined }, { reviewed: 'yes' }, { approvedAt: 'yesterday' }
  ])('rejects invalid translation backups without changing saved originals (%#)', invalid => {
    saveProject(project())
    const before = storage.getItem(STORAGE_KEY)
    expect(() => parseProject(JSON.stringify({ ...project(), rows: [{ ...row(), translation: { ...translation, ...invalid } }] }))).toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBe(before)
  })
})

describe('web subtitle import', () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('applies offsets and adds leading and trailing description candidates for the full media duration', () => {
    const imported = importSubtitle(encode('1\n00:00:01,000 --> 00:00:03,000\n<b>안녕</b>\n'), 10_000, 1_000)
    expect(imported.rows.map(item => [item.kind, item.startMs, item.endMs])).toEqual([
      ['descriptionGap', 0, 2_000], ['dialogue', 2_000, 4_000], ['descriptionGap', 4_000, 10_000]
    ])
    expect(imported.rows[1].content).toBe('안녕')
    expect(imported.warnings.length).toBeGreaterThan(0)
  })

  it('infers a standalone subtitle timeline from the final cue when there is no media duration', () => {
    const imported = importSubtitle(encode('1\n00:00:00,000 --> 00:00:04,500\n안녕\n'), 0)
    expect(imported.rows.at(-1)?.endMs).toBe(4_500)
  })

  it.each([
    ['1\n00:00:01,000 --> 00:00:04,000\n첫 줄\n\n2\n00:00:03,000 --> 00:00:05,000\n겹침\n', 10_000, 0],
    ['1\n00:00:bad --> 00:00:04,000\n잘못된 자막\n', 10_000, 0],
    ['1\n00:00:01,000 --> 00:00:04,000\n범위 초과\n', 2_000, 0],
    ['1\n00:00:01,000 --> 00:00:04,000\n음수 시간\n', 10_000, -2_000],
    ['1\n03:00:00,000 --> 03:00:01,000\n너무 긴 자막\n', 0, 0],
    ['', 10_000, 0]
  ])('rejects invalid subtitle imports without modifying existing drafts or input bytes', (text, durationMs, offsetMs) => {
    saveProject(project())
    const saved = storage.getItem(STORAGE_KEY)
    const bytes = encode(text)
    const original = bytes.slice()
    expect(() => importSubtitle(bytes, durationMs, offsetMs)).toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBe(saved)
    expect(bytes).toEqual(original)
  })

  it('rejects corrupt encoding and noninteger parameters', () => {
    expect(() => importSubtitle(new Uint8Array([0xc3, 0x28]), 10_000)).toThrow(/인코딩/)
    const bytes = encode('1\n00:00:01,000 --> 00:00:04,000\n안녕\n')
    expect(() => importSubtitle(bytes, Infinity)).toThrow()
    expect(() => importSubtitle(bytes, 10_000, 0.5)).toThrow()
  })
})
