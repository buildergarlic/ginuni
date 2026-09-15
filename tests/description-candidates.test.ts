import { describe, expect, it } from 'vitest'
import { DESCRIPTION_CANDIDATE_TEXT } from '@shared/constants'
import { addDescriptionCandidates, isUntouchedSubtitleGap } from '@shared/description-candidates'
import type { ScriptRow } from '@shared/types'

function row(id: string, startMs: number, endMs: number, changes: Partial<ScriptRow> = {}): ScriptRow {
  return {
    id, kind: 'dialogue', startMs, endMs, speakers: [], content: id,
    sourceSegmentIds: [], sourceCueIds: [id], reviewed: false, ...changes
  }
}

function candidates(rows: ScriptRow[]): number[][] {
  return rows.filter(isUntouchedSubtitleGap).map(item => [item.startMs, item.endMs])
}

describe('addDescriptionCandidates', () => {
  it('fills leading, internal and trailing spaces with neutral unreviewed candidates', () => {
    const input = [row('first', 2_500, 4_100), row('second', 6_350, 7_600)]
    const output = addDescriptionCandidates(input, 10_000)
    expect(candidates(output)).toEqual([[0, 2_500], [4_100, 6_350], [7_600, 10_000]])
    expect(output.map(item => item.startMs)).toEqual([0, 2_500, 4_100, 6_350, 7_600])
    for (const candidate of output.filter(isUntouchedSubtitleGap)) {
      expect(candidate).toMatchObject({
        kind: 'descriptionGap', content: DESCRIPTION_CANDIDATE_TEXT, speakers: [],
        sourceSegmentIds: [], sourceCueIds: [], reviewed: false, reviewStatus: 'unreviewed',
        subtitleGapCandidate: true
      })
      expect(candidate.content).not.toContain('사람 목소리 없음')
    }
    expect(new Set(output.map(item => item.id)).size).toBe(output.length)
  })

  it('includes exactly two seconds but excludes shorter spaces without rounding milliseconds', () => {
    const output = addDescriptionCandidates([
      row('first', 1_999, 2_351), row('second', 4_351, 5_002), row('third', 7_001, 8_000)
    ], 10_000)
    expect(candidates(output)).toEqual([[2_351, 4_351], [8_000, 10_000]])
  })

  it('keeps every original field and object unchanged while sorting a copied collection', () => {
    const approved = row('approved', 6_201, 8_102, {
      content: '첫 줄\n둘째 줄', speakers: ['화자 A'], reviewed: true, reviewStatus: 'approved',
      approvedAt: '2026-09-15T00:00:00Z', sourceSegmentIds: ['segment'], sourceCueIds: ['cue-a', 'cue-b']
    })
    const early = row('early', 500, 900)
    const input = Object.freeze([approved, early]) as unknown as ScriptRow[]
    const before = structuredClone(input)
    const output = addDescriptionCandidates(input, 10_500)
    expect(input).toEqual(before)
    expect(output).not.toBe(input)
    expect(output.find(item => item.id === 'approved')).toBe(approved)
    expect(output.find(item => item.id === 'early')).toBe(early)
    expect(candidates(output)).toEqual([[900, 6_201], [8_102, 10_500]])
  })

  it('treats existing authored descriptions and the union of overlapping rows as occupied', () => {
    const authored = row('authored', 4_000, 6_000, { kind: 'descriptionGap', content: '주인공이 문을 연다.', sourceCueIds: [] })
    const output = addDescriptionCandidates([
      row('nested', 1_500, 2_000), row('outer', 1_000, 5_000), authored, row('last', 8_000, 9_000)
    ], 12_000)
    expect(candidates(output)).toEqual([[6_000, 8_000], [9_000, 12_000]])
    expect(output.find(item => item.id === 'authored')).toBe(authored)
  })

  it('is idempotent and never duplicates existing candidates', () => {
    const once = addDescriptionCandidates([row('dialogue', 2_000, 4_000)], 7_000)
    const twice = addDescriptionCandidates(once, 7_000)
    expect(twice).toEqual(once)
    expect(twice.every(item => once.includes(item))).toBe(true)
  })

  it('does not manufacture a whole-film candidate from an empty draft', () => {
    expect(addDescriptionCandidates([], 90_000)).toEqual([])
    expect(addDescriptionCandidates([], 0)).toEqual([])
  })

  it('returns only existing rows when the timeline is completely occupied', () => {
    const input = [row('a', 0, 1_234), row('b', 1_234, 3_000)]
    expect(addDescriptionCandidates(input, 3_000)).toEqual(input)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid media duration %s even for an empty draft', duration => {
      expect(() => addDescriptionCandidates([], duration)).toThrow(/영상|시간|길이/)
    }
  )

  it.each([
    [-1, 1], [0.5, 1], [0, 0], [2, 1], [0, 10_001],
    [0, Number.NaN], [0, Number.POSITIVE_INFINITY], [0, Number.MAX_SAFE_INTEGER + 1]
  ])('rejects invalid row bounds %s..%s', (start, end) => {
    expect(() => addDescriptionCandidates([row('invalid', start, end)], 10_000)).toThrow(/행|시간|범위/)
  })

  it.each([null, {}, [undefined], new Array(1)])('rejects malformed row collections', rows => {
    expect(() => addDescriptionCandidates(rows as unknown as ScriptRow[], 10_000)).toThrow(/행/)
  })

  it('handles the safe-integer boundary without adding or rounding timestamps', () => {
    const maximum = Number.MAX_SAFE_INTEGER
    const output = addDescriptionCandidates([row('final', maximum - 4_000, maximum - 2_000)], maximum)
    expect(candidates(output)).toEqual([[0, maximum - 4_000], [maximum - 2_000, maximum]])
  })

  it('allows 100,000 occupied rows but rejects input or candidate expansion above the limit', () => {
    const atLimit = Array.from({ length: 100_000 }, (_, index) => row(String(index), index, index + 1))
    expect(addDescriptionCandidates(atLimit, 100_000)).toHaveLength(100_000)
    expect(() => addDescriptionCandidates(atLimit, 102_000)).toThrow(/100,000|100000/)
    expect(() => addDescriptionCandidates([...atLimit, row('excess', 100_000, 100_001)], 100_001)).toThrow(/100,000|100000/)
  })
})

describe('isUntouchedSubtitleGap', () => {
  function candidate(changes: Partial<ScriptRow> = {}): ScriptRow {
    return row('candidate', 0, 2_000, {
      kind: 'descriptionGap', content: DESCRIPTION_CANDIDATE_TEXT, sourceCueIds: [],
      reviewStatus: 'unreviewed', subtitleGapCandidate: true, ...changes
    })
  }

  it('recognizes only explicitly marked, unreviewed neutral candidates', () => {
    expect(isUntouchedSubtitleGap(candidate())).toBe(true)
    expect(isUntouchedSubtitleGap(candidate({ sourceCueIds: undefined }))).toBe(true)
    expect(isUntouchedSubtitleGap(candidate({ reviewStatus: undefined }))).toBe(true)
  })

  it.each([
    { subtitleGapCandidate: undefined }, { subtitleGapCandidate: false }, { kind: 'dialogue' },
    { content: '그가 돌아선다.' }, { content: `${DESCRIPTION_CANDIDATE_TEXT} ` },
    { reviewed: true }, { reviewStatus: 'approved' }, { sourceSegmentIds: ['segment'] }, { sourceCueIds: ['cue'] }
  ] as Partial<ScriptRow>[])('preserves a row that is no longer an untouched candidate: %j', changes => {
    expect(isUntouchedSubtitleGap(candidate(changes))).toBe(false)
  })
})
