import { describe, expect, it } from 'vitest'
import { buildSubtitlePreviewState, resolutionForOverlap } from '../src/renderer/src/subtitle-ui'
import type { SubtitlePreview } from '../src/shared/subtitle-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOMParser } from '@xmldom/xmldom'
import { SubtitleImportDialog } from '../src/renderer/src/SubtitleImportDialog'

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
    expect(resolved.rows).toHaveLength(2)
    expect(resolved.rows[0].sourceCueIds).toEqual(['cue-1', 'cue-2'])
    expect(resolved.rows[1]).toMatchObject({ kind: 'descriptionGap', startMs: 4000, endMs: 10_000 })
    expect(resolved.blockingIssues).toEqual([])
  })

  it('previews dialogue and leading, internal and trailing candidates after validation', () => {
    const ready: SubtitlePreview = {
      ...preview,
      cues: [
        { ...preview.cues[0], startMs: 2000, endMs: 3000 },
        { ...preview.cues[1], startMs: 5000, endMs: 7000 }
      ],
      issues: []
    }
    const state = buildSubtitlePreviewState(ready, 0, [])
    expect(state.rows.map((row) => [row.kind, row.startMs, row.endMs])).toEqual([
      ['descriptionGap', 0, 2000], ['dialogue', 2000, 3000],
      ['descriptionGap', 3000, 5000], ['dialogue', 5000, 7000],
      ['descriptionGap', 7000, 10_000]
    ])
    expect(state.effectiveIssues).toEqual([])
    expect(state.overlapGroups).toEqual([])
  })

  it('does not fill invalid or empty previews before their dialogue is usable', () => {
    for (const draft of [
      preview,
      { ...preview, cues: [preview.cues[0]], issues: [{ code: 'syntax', severity: 'error', message: '형식 오류' }] } as SubtitlePreview,
      { ...preview, cues: [{ ...preview.cues[0], endMs: 11_000 }], issues: [] },
      { ...preview, cues: [], issues: [] }
    ]) {
      expect(buildSubtitlePreviewState(draft, 0, []).rows.every((row) => row.kind === 'dialogue')).toBe(true)
    }
  })

  it('returns a blocking issue when candidate expansion would exceed the row limit', () => {
    const atLimit: SubtitlePreview = {
      ...preview,
      durationMs: 102_000,
      cues: Array.from({ length: 100_000 }, (_, index) => ({
        ...preview.cues[0], id: `cue-${index}`, ordinal: index + 1,
        startMs: index, endMs: index + 1
      })),
      issues: []
    }
    let state: ReturnType<typeof buildSubtitlePreviewState> | undefined
    expect(() => { state = buildSubtitlePreviewState(atLimit, 0, []) }).not.toThrow()
    expect(state?.rows).toHaveLength(100_000)
    expect(state?.rows.every(row => row.kind === 'dialogue')).toBe(true)
    expect(state?.blockingIssues).toEqual([
      expect.objectContaining({ code: 'range', severity: 'error', message: expect.stringContaining('100,000') })
    ])
    expect(state?.effectiveIssues).toEqual(state?.blockingIssues)
  })

  it('shows separate counts and uses only dialogue for video sync checkpoints', () => {
    const ready: SubtitlePreview = {
      ...preview,
      cues: [
        { ...preview.cues[0], startMs: 2000, endMs: 3000 },
        { ...preview.cues[1], startMs: 5000, endMs: 7000 }
      ],
      issues: []
    }
    const markup = renderToStaticMarkup(createElement(SubtitleImportDialog, {
      open: true, preview: ready, busy: false, error: '', hasExistingRows: false,
      onPreview: async () => {}, onApply: async () => {}, onClose: async () => {}
    }))
    const document = new DOMParser().parseFromString(markup, 'text/html')
    const checkpoints = Array.from(document.getElementsByTagName('div')).find((entry) => entry.getAttribute('class') === 'sync-checkpoints')
    expect(checkpoints?.textContent).toContain('첫 문장')
    expect(checkpoints?.textContent).toContain('둘째 문장')
    expect(checkpoints?.textContent).not.toContain('해설 후보')
    expect(document.documentElement?.textContent).toContain('대사 2행 · 해설 후보 3행')
  })
})
