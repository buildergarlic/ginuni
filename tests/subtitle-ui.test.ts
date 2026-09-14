import { describe, expect, it } from 'vitest'
import { buildSubtitlePreviewState, resolutionForOverlap } from '../src/renderer/src/subtitle-ui'
import type { SubtitlePreview } from '../src/shared/subtitle-types'

const preview: SubtitlePreview = {
  previewId: 'preview-1',
  expectedRevision: 3,
  durationMs: 10_000,
  asset: {
    id: 'asset-1', fileName: 'sample.srt', sha256: 'hash', encoding: 'utf-8', language: 'ko',
    sourceKind: 'provided-srt', declaredAuthority: 'festival-provided', importedAt: 'now', originalRelativePath: ''
  },
  cues: [
    { id: 'cue-1', assetId: 'asset-1', ordinal: 1, startMs: 1000, endMs: 3000, text: '첫 문장' },
    { id: 'cue-2', assetId: 'asset-1', ordinal: 2, startMs: 2500, endMs: 4000, text: '둘째 문장' }
  ],
  issues: [{ code: 'overlap', severity: 'error', ordinal: 2, message: '원본 자막 큐가 앞 큐와 겹칩니다.' }]
}

describe('subtitle import preview state', () => {
  it('recomputes effective cue times from one integer offset', () => {
    const state = buildSubtitlePreviewState(preview, -1000, [])
    expect(state.rows.map((row) => [row.startMs, row.endMs])).toEqual([[0, 2000], [1500, 3000]])
  })

  it('creates an explicit union resolution for an overlapping group', () => {
    const initial = buildSubtitlePreviewState(preview, 0, [])
    expect(initial.overlapGroups).toHaveLength(1)
    const resolution = resolutionForOverlap(initial.overlapGroups[0])
    expect(resolution).toEqual({ cueIds: ['cue-1', 'cue-2'], startMs: 1000, endMs: 4000, reason: '겹치는 자막 그룹을 명시적으로 합침' })

    const resolved = buildSubtitlePreviewState(preview, 0, [resolution])
    expect(resolved.rows).toHaveLength(1)
    expect(resolved.rows[0].sourceCueIds).toEqual(['cue-1', 'cue-2'])
    expect(resolved.blockingIssues).toEqual([])
  })
})
