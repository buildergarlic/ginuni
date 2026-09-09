import { describe, expect, it } from 'vitest'
import type { ScriptProject } from '@shared/types'
import { executeVerifiedAnalysis, type AnalysisStore } from '@main/services/analysis-workflow'
import { formatTimecode, parseTimecode } from '@shared/timecode'

function fixture(): ScriptProject {
  return {
    schemaVersion: 2, id: 'p', title: 'test', createdAt: 'now', updatedAt: 'now', status: 'review',
    transcriptionEngine: 'local', localDiarization: { mode: 'none', speakerCount: null },
    source: { kind: 'local', uri: 'test.wav', displayName: 'test', sha256: 'a'.repeat(64) },
    media: { durationMs: 5000 }, segments: [{ id: 'old', startMs: 0, endMs: 2000, text: '기존 대사', speakerId: '' }],
    rows: [{ id: 'r', kind: 'dialogue', startMs: 0, endMs: 2000, content: '작가가 수정한 대사', speakers: [], sourceSegmentIds: ['old'], reviewed: true, reviewStatus: 'approved' }],
    runs: [], exports: [], workflow: { version: 1, revision: 0, consent: { rightsConfirmedAt: 'now' }, events: [], proposals: [] }
  }
}

function memoryStore(initial: ScriptProject) {
  let saved = structuredClone(initial)
  const snapshots: ScriptProject[] = []
  const store: AnalysisStore = {
    update: async (_id, update) => {
      const copy = structuredClone(saved)
      await update(copy)
      copy.workflow!.revision++
      saved = copy
      return structuredClone(saved)
    },
    snapshot: async (project) => { snapshots.push(structuredClone(project)) }
  }
  return { store, snapshots, current: () => saved }
}

describe('verified analysis transaction', () => {
  it.each([[10_500, 10_100, 10_400, '00:10', '00:10.500'], [400, 100, 300, '00:00', '00:00.400']])('keeps final clamped rows editable without losing original evidence (%s ms)', async (durationMs, startMs, endMs, startText, endText) => {
    const initial = fixture()
    initial.media.durationMs = durationMs
    const state = memoryStore(initial)
    const result = await executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async draft => {
      draft.segments = [{ id: 'fractional', startMs, endMs, text: '끝', speakerId: '' }]
    } })
    const dialogue = result.rows.find(row => row.kind === 'dialogue')!
    expect([formatTimecode(dialogue.startMs), formatTimecode(dialogue.endMs)]).toEqual([startText, endText])
    expect(parseTimecode(formatTimecode(dialogue.endMs))).toBe(durationMs)
    expect(result.runs[0].sourceSegments?.[0]).toMatchObject({ startMs, endMs })
  })
  it('does not call the provider without a rights confirmation or cloud audio consent', async () => {
    for (const cloud of [false, true]) {
      const initial = fixture()
      initial.workflow!.consent = cloud ? { rightsConfirmedAt: 'now' } : {}
      initial.transcriptionEngine = cloud ? 'openai' : 'local'
      const state = memoryStore(initial)
      let called = false
      await expect(executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async () => { called = true } })).rejects.toThrow(/확인|동의/)
      expect(called).toBe(false)
      expect(state.current().runs).toHaveLength(0)
    }
  })

  it('keeps writer content and original segments if a provider fails after mutating its scratch copy', async () => {
    const state = memoryStore(fixture())
    await expect(executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async (draft) => {
      draft.segments = []
      draft.rows = []
      throw new Error('provider rejected')
    } })).rejects.toThrow()
    expect(state.current().rows[0].content).toBe('작가가 수정한 대사')
    expect(state.current().segments[0].id).toBe('old')
    expect(state.current().runs[0].outcome).toBe('failed')
    expect(state.snapshots[0].rows[0].content).toBe('작가가 수정한 대사')
  })

  it('rejects an invalid result before replacing the previous draft', async () => {
    const state = memoryStore(fixture())
    await expect(executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async (draft) => {
      draft.segments = [{ id: 'bad', startMs: 4000, endMs: 3000, text: '오류', speakerId: '' }]
    } })).rejects.toThrow(/검사/)
    expect(state.current().rows[0].id).toBe('r')
    expect(state.current().runs[0].checks?.some((check) => check.severity === 'error')).toBe(true)
  })

  it('records source evidence and creates an unapproved draft on success', async () => {
    const state = memoryStore(fixture())
    const result = await executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async (draft) => {
      draft.segments = [{ id: 'new', startMs: 0, endMs: 2000, text: '새 초안', speakerId: '' }]
    } })
    expect(result.runs[0].inputSha256).toBe('a'.repeat(64))
    expect(result.runs[0].sourceSegments?.[0].text).toBe('새 초안')
    expect(result.rows[0].sourceSegmentIds).toEqual(['new'])
    expect(result.rows.every((row) => !row.reviewed && row.reviewStatus !== 'approved')).toBe(true)
    expect(result.workflow?.events.at(-1)?.action).toBe('analysis-completed')
  })

  it('does not overwrite edits made during a long analysis', async () => {
    const state = memoryStore(fixture())
    await expect(executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: new AbortController().signal, analyze: async (draft) => {
      await state.store.update('p', (live) => { live.rows[0].content = '동시에 쓴 해설' })
      draft.segments = [{ id: 'new', startMs: 0, endMs: 2000, text: '초안', speakerId: '' }]
    } })).rejects.toThrow(/변경/)
    expect(state.current().rows[0].content).toBe('동시에 쓴 해설')
  })

  it('cannot commit a cancelled analysis even if the provider returns successfully', async () => {
    const state = memoryStore(fixture())
    const controller = new AbortController()
    await expect(executeVerifiedAnalysis('p', { store: state.store, model: 'test', signal: controller.signal, analyze: async () => { controller.abort() } })).rejects.toThrow()
    expect(state.current().runs[0].outcome).toBe('cancelled')
    expect(state.current().rows[0].id).toBe('r')
  })
})
