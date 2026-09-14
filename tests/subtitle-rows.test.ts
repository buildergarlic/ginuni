import { describe, expect, it } from 'vitest'
import { generateSubtitleRows, validateSubtitleRows } from '@shared/subtitle-rows'
import type { SubtitleCue, SubtitleResolution } from '@shared/subtitle-types'

const cue = (id: string, ordinal: number, startMs: number, endMs: number, text: string): SubtitleCue => ({
  id,
  assetId: 'asset-1',
  ordinal,
  startMs,
  endMs,
  text
})

describe('generateSubtitleRows', () => {
  it.each([
    [null, []],
    [[undefined], []],
    [[{ id: 'a', assetId: 'asset-1', ordinal: 1, startMs: 0, endMs: 1, text: null }], []],
    [[cue('a', 1, 0, 1, 'A')], null],
    [[cue('a', 1, 0, 1, 'A')], [undefined]],
    [[cue('a', 1, 0, 1, 'A')], [{ cueIds: 'a', startMs: 0, endMs: 1, reason: 'x' }]],
    [[cue('a', 1, 0, 1, 'A')], [{ cueIds: ['a'], startMs: 0, endMs: 1, reason: null }]]
  ])('rejects malformed cue or resolution payloads with a stable validation error', (cues, resolutions) => {
    expect(() => generateSubtitleRows(cues as unknown as SubtitleCue[], 0, resolutions as unknown as SubtitleResolution[])).toThrow(/자막|해결/)
  })

  it('maps one cue to one dialogue row with exact times and no ASR gaps, rounding, or voice inference', () => {
    const cues = [
      cue('a', 1, 1_250, 1_375, '짧은 대사'),
      cue('b', 2, 2_000, 65_500, '긴 대사')
    ]
    const rows = generateSubtitleRows(cues, 0)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => ({
      kind: row.kind,
      startMs: row.startMs,
      endMs: row.endMs,
      content: row.content,
      speakers: row.speakers,
      sourceSegmentIds: row.sourceSegmentIds,
      sourceCueIds: row.sourceCueIds,
      reviewed: row.reviewed
    }))).toEqual([
      { kind: 'dialogue', startMs: 1_250, endMs: 1_375, content: '짧은 대사', speakers: [], sourceSegmentIds: [], sourceCueIds: ['a'], reviewed: false },
      { kind: 'dialogue', startMs: 2_000, endMs: 65_500, content: '긴 대사', speakers: [], sourceSegmentIds: [], sourceCueIds: ['b'], reviewed: false }
    ])
  })

  it('retains repeated text at different times and applies a negative offset from a one-hour source origin', () => {
    const rows = generateSubtitleRows([
      cue('a', 1, 3_600_125, 3_601_250, '같은 문장'),
      cue('b', 2, 3_602_125, 3_603_250, '같은 문장')
    ], -3_600_000)
    expect(rows.map(row => ({ startMs: row.startMs, endMs: row.endMs, content: row.content }))).toEqual([
      { startMs: 125, endMs: 1_250, content: '같은 문장' },
      { startMs: 2_125, endMs: 3_250, content: '같은 문장' }
    ])
  })

  it('uses explicit effective project times and joins merged source text in ordinal order', () => {
    const cues = [
      cue('second', 20, 2_000, 4_000, '둘째'),
      cue('first', 10, 1_000, 3_000, '첫째'),
      cue('tail', 30, 5_000, 6_000, '끝')
    ]
    const resolutions: SubtitleResolution[] = [{ cueIds: ['second', 'first'], startMs: 1_100, endMs: 3_900, reason: '겹침 그룹 병합' }]
    const rows = generateSubtitleRows(cues, 500, resolutions)
    expect(rows.map(row => ({ startMs: row.startMs, endMs: row.endMs, content: row.content, sourceCueIds: row.sourceCueIds }))).toEqual([
      { startMs: 1_100, endMs: 3_900, content: '첫째\n둘째', sourceCueIds: ['first', 'second'] },
      { startMs: 5_500, endMs: 6_500, content: '끝', sourceCueIds: ['tail'] }
    ])
  })

  it('accepts separate timing resolutions for overlapping cues and custom text', () => {
    const rows = generateSubtitleRows([
      cue('a', 1, 0, 2_000, 'A'),
      cue('b', 2, 1_500, 3_000, 'B')
    ], 0, [
      { cueIds: ['a'], startMs: 0, endMs: 1_500, reason: '첫 큐 종료 조정' },
      { cueIds: ['b'], startMs: 1_500, endMs: 3_000, text: '수정 B', reason: '둘째 큐 시작 조정' }
    ])
    expect(rows.map(row => [row.startMs, row.endMs, row.content])).toEqual([[0, 1_500, 'A'], [1_500, 3_000, '수정 B']])
    expect(validateSubtitleRows(rows, 3_000)).toEqual([])
  })

  it('accepts a detailed nonempty resolution reason without changing row text', () => {
    const reason = '검수 근거 '.repeat(300)
    const rows = generateSubtitleRows([cue('a', 1, 0, 1_000, 'A')], 0, [
      { cueIds: ['a'], startMs: 0, endMs: 900, reason }
    ])
    expect(rows[0].content).toBe('A')
  })

  it.each([
    ['unknown cue', [{ cueIds: ['missing'], startMs: 0, endMs: 1, reason: 'x' }]],
    ['duplicate within group', [{ cueIds: ['a', 'a'], startMs: 0, endMs: 1, reason: 'x' }]],
    ['cue reused across groups', [
      { cueIds: ['a'], startMs: 0, endMs: 1, reason: 'x' },
      { cueIds: ['a'], startMs: 1, endMs: 2, reason: 'y' }
    ]],
    ['blank reason', [{ cueIds: ['a'], startMs: 0, endMs: 1, reason: ' ' }]],
    ['empty cue list', [{ cueIds: [], startMs: 0, endMs: 1, reason: 'x' }]],
    ['fractional time', [{ cueIds: ['a'], startMs: 0.5, endMs: 1, reason: 'x' }]],
    ['non-finite time', [{ cueIds: ['a'], startMs: 0, endMs: Number.POSITIVE_INFINITY, reason: 'x' }]],
    ['reversed time', [{ cueIds: ['a'], startMs: 2, endMs: 1, reason: 'x' }]],
    ['blank replacement', [{ cueIds: ['a'], startMs: 0, endMs: 1, text: ' ', reason: 'x' }]]
  ] as const)('rejects invalid resolution input: %s', (_name, resolutions) => {
    expect(() => generateSubtitleRows([cue('a', 1, 0, 1, 'A')], 0, resolutions as unknown as SubtitleResolution[])).toThrow(/해결|resolution|자막/)
  })

  it('does not mutate raw cues or resolution records', () => {
    const cues = [cue('b', 2, 2_000, 3_000, 'B'), cue('a', 1, 0, 1_000, 'A')]
    const resolutions: SubtitleResolution[] = [{ cueIds: ['b'], startMs: 2_100, endMs: 2_900, reason: '조정' }]
    const beforeCues = structuredClone(cues)
    const beforeResolutions = structuredClone(resolutions)
    generateSubtitleRows(cues, 0, resolutions)
    expect(cues).toEqual(beforeCues)
    expect(resolutions).toEqual(beforeResolutions)
  })

  it('rejects offsets that cannot preserve exact integer milliseconds', () => {
    expect(() => generateSubtitleRows([cue('a', 1, 0, 1, 'A')], Number.MAX_SAFE_INTEGER + 1)).toThrow(/시간차|해결/)
  })
})

describe('validateSubtitleRows', () => {
  it('rejects a malformed row collection with a stable validation error', () => {
    expect(() => validateSubtitleRows([undefined] as unknown as Parameters<typeof validateSubtitleRows>[0], 1_000)).toThrow(/자막 행/)
  })

  it('checks effective video bounds only after offset generation', () => {
    const rows = generateSubtitleRows([cue('a', 1, 3_600_000, 3_601_000, 'A')], -3_600_000)
    expect(validateSubtitleRows(rows, 1_000)).toEqual([])
    expect(validateSubtitleRows(generateSubtitleRows([cue('b', 1, 3_600_000, 3_602_000, 'B')], -3_600_000), 1_000))
      .toContainEqual(expect.objectContaining({ code: 'range', severity: 'error' }))
  })

  it('reports negative, reversed, fractional, and overlapping effective rows', () => {
    const rows = generateSubtitleRows([
      cue('negative', 1, -1, 10, 'A'),
      cue('reversed', 2, 20, 10, 'B'),
      cue('fractional', 3, 30.5, 40, 'C'),
      cue('valid', 4, 30, 40, 'D'),
      cue('overlap', 5, 35, 50, 'E')
    ], 0)
    const issues = validateSubtitleRows(rows, 100)
    expect(issues.filter(issue => issue.code === 'range')).toHaveLength(3)
    expect(issues).toContainEqual(expect.objectContaining({ code: 'overlap', severity: 'error' }))
  })

  it('requires a finite nonnegative integer video duration', () => {
    const rows = generateSubtitleRows([cue('a', 1, 0, 1, 'A')], 0)
    for (const duration of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateSubtitleRows(rows, duration)).toThrow(/duration|영상|길이/)
    }
    expect(() => validateSubtitleRows(rows, Number.MAX_SAFE_INTEGER + 1)).toThrow(/duration|영상|길이/)
  })
})
