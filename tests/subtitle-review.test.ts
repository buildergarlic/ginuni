import { describe, expect, it } from 'vitest'
import { getExportGate } from '@main/services/export-workflow'
import { validateSubtitleWorkspace } from '@main/services/subtitle-workspace'
import type { ScriptProject } from '@shared/types'
import type { SubtitleResolution, SubtitleWorkspace } from '@shared/subtitle-types'

function workspace(resolutions: SubtitleResolution[]): SubtitleWorkspace {
  return {
    version: 1,
    assets: [{
      id: 'asset-1', fileName: 'input.srt', sha256: 'a'.repeat(64), encoding: 'utf-8', language: 'ko',
      sourceKind: 'provided-srt', declaredAuthority: 'unknown', importedAt: '2026-09-15T00:00:00.000Z',
      originalRelativePath: 'subtitles/asset-1.srt'
    }],
    cues: [{ id: 'cue-1', assetId: 'asset-1', ordinal: 1, startMs: 0, endMs: 1_000, text: '대사' }],
    imports: [{ id: 'import-1', assetId: 'asset-1', at: '2026-09-15T00:00:00.000Z', cueCount: 1, appliedRowCount: 1, offsetMs: 0, resolutions }],
    activeAssetId: 'asset-1'
  }
}

function project(startMs: number, endMs: number): ScriptProject {
  return {
    schemaVersion: 3,
    id: 'project-1',
    title: '검토',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    status: 'review',
    transcriptionEngine: 'local',
    localDiarization: { mode: 'none', speakerCount: null },
    source: { kind: 'local', uri: 'movie.mp4', displayName: 'movie.mp4', sha256: 'b'.repeat(64) },
    media: { durationMs: 5_125 },
    segments: [],
    rows: [{ id: 'row-1', kind: 'dialogue', startMs, endMs, speakers: [], content: '대사', sourceSegmentIds: [], sourceCueIds: ['cue-1'], reviewed: false }],
    runs: [],
    exports: [],
    workflow: { version: 1, revision: 1, consent: {}, events: [], proposals: [] },
    subtitleWorkspace: workspace([])
  }
}

describe('subtitle integration review regressions', () => {
  it.each([
    ['duplicate IDs inside one group', [{ cueIds: ['cue-1', 'cue-1'], startMs: 0, endMs: 1_000, reason: '병합' }]],
    ['one cue reused by separate groups', [
      { cueIds: ['cue-1'], startMs: 0, endMs: 900, reason: '첫 조정' },
      { cueIds: ['cue-1'], startMs: 0, endMs: 800, reason: '둘째 조정' }
    ]],
    ['blank resolution reason', [{ cueIds: ['cue-1'], startMs: 0, endMs: 1_000, reason: ' ' }]],
    ['blank replacement text', [{ cueIds: ['cue-1'], startMs: 0, endMs: 1_000, reason: '수정', text: ' ' }]]
  ] as const)('rejects persisted resolution evidence with %s', (_name, resolutions) => {
    expect(() => validateSubtitleWorkspace(workspace(resolutions as unknown as SubtitleResolution[]))).toThrow(/자막 원본 데이터/)
  })

  it('rejects a persisted zero cue ordinal consistently with source cue validation', () => {
    const invalid = workspace([])
    invalid.cues[0].ordinal = 0
    expect(() => validateSubtitleWorkspace(invalid)).toThrow(/자막 원본 데이터/)
  })

  it('rejects duplicate ordinals within a persisted subtitle asset', () => {
    const invalid = workspace([])
    invalid.cues.push({ ...invalid.cues[0], id: 'cue-2' })
    expect(() => validateSubtitleWorkspace(invalid)).toThrow(/자막 원본 데이터/)
  })

  it.each([
    ['fractional milliseconds', 1_000.25, 2_000.75],
    ['an end past the exact media duration', 4_000, 5_500]
  ])('blocks SRT export with %s', (_name, startMs, endMs) => {
    expect(getExportGate(project(startMs, endMs), 'srt').errors).not.toEqual([])
  })
})
