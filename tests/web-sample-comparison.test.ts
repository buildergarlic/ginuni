import { describe, expect, it } from 'vitest'
import type { ScriptRow } from '../src/shared/types'
import { compareSampleTranscript } from '../src/web/sample-comparison'

function row(
  content: string,
  startMs = 0,
  endMs = 1000,
  kind: ScriptRow['kind'] = 'dialogue'
): ScriptRow {
  return {
    id: `${kind}-${startMs}-${endMs}-${content}`,
    kind,
    startMs,
    endMs,
    content,
    speakers: [],
    sourceSegmentIds: [],
    reviewed: false
  }
}

const cue = (content: string, startMs = 0, endMs = 1000) => ({ content, startMs, endMs })

describe('sample transcript comparison', () => {
  it('normalizes NFKC, case, both apostrophes, punctuation, symbols and whitespace', () => {
    const result = compareSampleTranscript(
      [cue('ＨＥＬＬＯ, it’s ＭＹ—world ♥ today!')],
      [row(" hello\nIT'S my WORLD + today ")]
    )
    expect(result.available).toBe(true)
    expect(result.wordErrors).toEqual({
      substitutions: 0, deletions: 0, insertions: 0,
      totalReferenceWords: 5, wordErrorRate: 0
    })
    expect(result.matchedTimingCues).toEqual([{
      referenceStartMs: 0, referenceEndMs: 1000,
      actualStartMs: 0, actualEndMs: 1000,
      startErrorMs: 0, endErrorMs: 0
    }])
    expect(result.unmatchedTimingCount).toBe(0)
  })

  it.each([
    { actual: 'one other three', substitutions: 1, deletions: 0, insertions: 0 },
    { actual: 'one three', substitutions: 0, deletions: 1, insertions: 0 },
    { actual: 'one two extra three', substitutions: 0, deletions: 0, insertions: 1 }
  ])('counts word edit operations for "$actual" and returns a ratio', ({ actual, ...counts }) => {
    const result = compareSampleTranscript([cue('one two three')], [row(actual)])
    expect(result.wordErrors).toEqual({
      ...counts, totalReferenceWords: 3, wordErrorRate: 1 / 3
    })
    expect(result.matchedTimingCues).toEqual([])
    expect(result.unmatchedTimingCount).toBe(1)
  })

  it('counts substitutions, deletions and insertions together across the full dialogue corpus', () => {
    const result = compareSampleTranscript(
      [cue('we see a red car', 0, 2000), cue('near the tall green tree', 2000, 4000)],
      [row('we see a blue car', 0, 2000), row('the tall green tree today', 2000, 4000)]
    )
    expect(result.wordErrors).toEqual({
      substitutions: 1, deletions: 1, insertions: 1,
      totalReferenceWords: 10, wordErrorRate: 0.3
    })
  })

  it('joins complete consecutive ASR rows and computes signed timing errors in chronological order', () => {
    const result = compareSampleTranscript(
      [cue('the little bird flies', 1000, 5000), cue('toward home', 7000, 9000)],
      [
        row('toward home', 6800, 8750),
        row('bird flies', 2700, 5300),
        row('the little', 1200, 2600)
      ]
    )
    expect(result.wordErrors).toEqual({
      substitutions: 0, deletions: 0, insertions: 0,
      totalReferenceWords: 6, wordErrorRate: 0
    })
    expect(result.matchedTimingCues).toEqual([
      {
        referenceStartMs: 1000, referenceEndMs: 5000,
        actualStartMs: 1200, actualEndMs: 5300,
        startErrorMs: 200, endErrorMs: 300
      },
      {
        referenceStartMs: 7000, referenceEndMs: 9000,
        actualStartMs: 6800, actualEndMs: 8750,
        startErrorMs: -200, endErrorMs: -250
      }
    ])
    expect(result.unmatchedTimingCount).toBe(0)
  })

  it('does not invent cue boundaries inside a larger ASR row even when word error rate is zero', () => {
    const result = compareSampleTranscript(
      [cue('one two', 0, 1000), cue('three four', 1000, 2000)],
      [row('one two three four', 0, 2000)]
    )
    expect(result.available).toBe(true)
    expect(result.wordErrors?.wordErrorRate).toBe(0)
    expect(result.wordErrors?.totalReferenceWords).toBe(4)
    expect(result.matchedTimingCues).toEqual([])
    expect(result.unmatchedTimingCount).toBe(2)
  })

  it('matches later exact cues after a mismatched cue without dropping that mismatch from word errors', () => {
    const result = compareSampleTranscript(
      [cue('alpha beta', 0, 1000), cue('gamma delta', 2000, 3000), cue('epsilon zeta', 4000, 5000)],
      [row('alpha beta', 100, 1100), row('gamma wrong', 2100, 3100), row('epsilon zeta', 4200, 5100)]
    )
    expect(result.wordErrors).toEqual({
      substitutions: 1, deletions: 0, insertions: 0,
      totalReferenceWords: 6, wordErrorRate: 1 / 6
    })
    expect(result.matchedTimingCues).toEqual([
      {
        referenceStartMs: 0, referenceEndMs: 1000,
        actualStartMs: 100, actualEndMs: 1100,
        startErrorMs: 100, endErrorMs: 100
      },
      {
        referenceStartMs: 4000, referenceEndMs: 5000,
        actualStartMs: 4200, actualEndMs: 5100,
        startErrorMs: 200, endErrorMs: 100
      }
    ])
    expect(result.unmatchedTimingCount).toBe(1)
  })

  it('never reuses one ASR row for repeated reference cues', () => {
    const result = compareSampleTranscript(
      [cue('hello world', 0, 1000), cue('hello world', 2000, 3000)],
      [row('hello world', 100, 1100)]
    )
    expect(result.matchedTimingCues).toEqual([{
      referenceStartMs: 0, referenceEndMs: 1000,
      actualStartMs: 100, actualEndMs: 1100,
      startErrorMs: 100, endErrorMs: 100
    }])
    expect(result.unmatchedTimingCount).toBe(1)
    expect(result.wordErrors).toEqual({
      substitutions: 0, deletions: 2, insertions: 0,
      totalReferenceWords: 4, wordErrorRate: 0.5
    })
  })

  it('does not jump backward to match an earlier unused ASR row', () => {
    const result = compareSampleTranscript(
      [cue('first cue', 0, 1000), cue('second cue', 2000, 3000)],
      [row('second cue', 0, 1000), row('first cue', 2000, 3000)]
    )
    expect(result.matchedTimingCues).toEqual([{
      referenceStartMs: 0, referenceEndMs: 1000,
      actualStartMs: 2000, actualEndMs: 3000,
      startErrorMs: 2000, endErrorMs: 2000
    }])
    expect(result.unmatchedTimingCount).toBe(1)
  })

  it('ignores descriptions and blank dialogue when comparing contiguous speech rows', () => {
    const result = compareSampleTranscript(
      [cue('one two three four', 0, 3000)],
      [
        row('three four', 2000, 3000),
        row('unrelated scene description', 1000, 2000, 'descriptionGap'),
        row(' \n ', 1000, 2000),
        row('one two', 0, 1000)
      ]
    )
    expect(result.wordErrors).toEqual({
      substitutions: 0, deletions: 0, insertions: 0,
      totalReferenceWords: 4, wordErrorRate: 0
    })
    expect(result.matchedTimingCues).toHaveLength(1)
    expect(result.matchedTimingCues[0]).toMatchObject({ actualStartMs: 0, actualEndMs: 3000 })
    expect(result.unmatchedTimingCount).toBe(0)
  })

  it.each([
    { references: [cue('one two'), cue('three four')], rows: [] },
    { references: [cue('one two')], rows: [row(' \n '), row('scene only', 0, 1000, 'descriptionGap')] },
    { references: [], rows: [row('one two')] },
    { references: [cue(''), cue('… ♥ !')], rows: [row('one two')] }
  ])('returns unavailable without dialogue or reference words ($#)', ({ references, rows }) => {
    expect(compareSampleTranscript(references, rows)).toEqual({
      available: false,
      wordErrors: null,
      matchedTimingCues: [],
      unmatchedTimingCount: references.length
    })
  })
})
