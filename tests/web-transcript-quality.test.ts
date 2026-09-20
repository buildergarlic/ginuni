import { describe, expect, it } from 'vitest'
import { assessTranscriptQuality, planTranscriptionRetries } from '../src/web/transcript-quality'

describe('conservative transcript repetition warning', () => {
  const warning = { warningCodes: ['repetition'] }
  const clear = { warningCodes: [] }

  it('warns on long contiguous Korean glyph and phrase loops without producing replacement text', () => {
    for (const source of ['가'.repeat(200), '감사합니다. '.repeat(30), ' 안녕하세요'.repeat(30)]) {
      expect(assessTranscriptQuality(source)).toEqual(warning)
    }
  })

  it('warns on ASCII phrases and repeated supplementary Unicode characters', () => {
    expect(assessTranscriptQuality('Thank you. '.repeat(20))).toEqual(warning)
    expect(assessTranscriptQuality('😀'.repeat(64))).toEqual(warning)
    expect(assessTranscriptQuality('𠮷野家'.repeat(30))).toEqual(warning)
  })

  it('requires at least 64 Unicode code points in the whole output', () => {
    expect(assessTranscriptQuality('가'.repeat(63))).toEqual(clear)
    expect(assessTranscriptQuality('가'.repeat(64))).toEqual(warning)
    // Astral characters occupy two UTF-16 code units but still count as one character.
    expect(assessTranscriptQuality('😀'.repeat(63))).toEqual(clear)
  })

  it('requires a repeated span of at least 48 code points even in a long output', () => {
    const context = '이 문장은 반복 앞에 놓인 정상적인 원문 문맥입니다. '
    expect(assessTranscriptQuality(context + '가'.repeat(47))).toEqual(clear)
    expect(assessTranscriptQuality(context + '가'.repeat(48))).toEqual(warning)
  })

  it('requires at least eight complete repeats even when seven exceed the span threshold', () => {
    const context = '정상적인 앞부분과 뒷부분 문맥을 포함합니다. '
    expect(assessTranscriptQuality(context + 'abcdefgh'.repeat(7))).toEqual(clear)
    expect(assessTranscriptQuality(context + 'abcdefgh'.repeat(8))).toEqual(warning)
  })

  it('detects phrase units up to 32 code points and does not expand to longer units', () => {
    const unit32 = 'abcdefghijklmnopqrstuvwxyz012345'
    expect(Array.from(unit32)).toHaveLength(32)
    expect(assessTranscriptQuality(unit32.repeat(8))).toEqual(warning)
    expect(assessTranscriptQuality(`${unit32}6`.repeat(8))).toEqual(clear)
  })

  it('finds an internal loop while leaving preceding and following context available to callers', () => {
    const source = '앞부분의 실제 대사입니다. ' + '반복 문장! '.repeat(12) + '뒤에는 다른 대사가 이어집니다.'
    const result = assessTranscriptQuality(source)
    expect(result).toEqual(warning)
    expect(result).not.toHaveProperty('text')
    expect(source).toContain('앞부분의 실제 대사입니다.')
    expect(source).toContain('뒤에는 다른 대사가 이어집니다.')
  })

  it('preserves ordinary short repetitions, including those inside a longer Korean paragraph', () => {
    const source = '오늘 수업에서 선생님은 학생들에게 물었습니다. 네, 네, 네. 학생들은 고개를 끄덕였습니다. 괜찮아요, 괜찮아요. 잠시 후 다음 설명이 이어졌습니다.'
    expect(assessTranscriptQuality(source)).toEqual(clear)
    expect(assessTranscriptQuality('감사합니다. 감사합니다. 감사합니다.')).toEqual(clear)
  })

  it('does not treat recurring Korean particles or varied sentences as a contiguous loop', () => {
    const source = '저는 아침에 창문을 열고 바깥을 바라봅니다. 길을 걷는 사람들은 각자의 일터로 향합니다. 한 사람이 버스를 기다리는 동안 다른 사람은 가게의 문을 엽니다. 잠시 뒤 화면에는 조용한 공원이 보입니다.'
    expect(assessTranscriptQuality(source)).toEqual(clear)
  })

  it('ignores formatting-only runs and empty input', () => {
    expect(assessTranscriptQuality('')).toEqual(clear)
    expect(assessTranscriptQuality(' '.repeat(200))).toEqual(clear)
    expect(assessTranscriptQuality('앞부분' + '\n\t '.repeat(50) + '뒤쪽')).toEqual(clear)
  })

  it('does not join separated repeats into an artificial contiguous run', () => {
    const source = Array.from({ length: 12 }, (_, index) => `다시 확인하세요 ${index + 1}. 다른 설명입니다. `).join('')
    expect(assessTranscriptQuality(source)).toEqual(clear)
  })
})

describe('bounded transcription retry windows', () => {
  it('covers a 64-second chunk using 13-second ownership and at most one second of context per side', () => {
    expect(planTranscriptionRetries(64000)).toEqual([
      { id: 'quality-retry-1', startMs: 0, endMs: 14000, contentStartMs: 0, contentEndMs: 13000 },
      { id: 'quality-retry-2', startMs: 12000, endMs: 27000, contentStartMs: 13000, contentEndMs: 26000 },
      { id: 'quality-retry-3', startMs: 25000, endMs: 40000, contentStartMs: 26000, contentEndMs: 39000 },
      { id: 'quality-retry-4', startMs: 38000, endMs: 53000, contentStartMs: 39000, contentEndMs: 52000 },
      { id: 'quality-retry-5', startMs: 51000, endMs: 64000, contentStartMs: 52000, contentEndMs: 64000 }
    ])
  })

  it('returns a single unchanged input window for short audio', () => {
    expect(planTranscriptionRetries(5000)).toEqual([
      { id: 'quality-retry-1', startMs: 0, endMs: 5000, contentStartMs: 0, contentEndMs: 5000 }
    ])
  })

  it('does not append an empty final range on an exact ownership boundary', () => {
    expect(planTranscriptionRetries(13000)).toHaveLength(1)
    const ranges = planTranscriptionRetries(26000)
    expect(ranges).toHaveLength(2)
    expect(ranges.at(-1)).toEqual({ id: 'quality-retry-2', startMs: 12000, endMs: 26000, contentStartMs: 13000, contentEndMs: 26000 })
  })

  it('retains a short fractional last range without rounding away audio', () => {
    expect(planTranscriptionRetries(13000.0625)).toEqual([
      { id: 'quality-retry-1', startMs: 0, endMs: 13000.0625, contentStartMs: 0, contentEndMs: 13000 },
      { id: 'quality-retry-2', startMs: 12000, endMs: 13000.0625, contentStartMs: 13000, contentEndMs: 13000.0625 }
    ])
  })

  it.each([0.0625, 999.5, 1000, 12999.9375, 13000, 13000.0625, 15000, 26000, 64000])(
    'has contiguous ownership and bounded context for %s ms', durationMs => {
      const ranges = planTranscriptionRetries(durationMs)
      expect(ranges[0].contentStartMs).toBe(0)
      expect(ranges.at(-1)?.contentEndMs).toBe(durationMs)
      expect(new Set(ranges.map(range => range.id)).size).toBe(ranges.length)
      for (const [index, range] of ranges.entries()) {
        expect(range.startMs).toBeGreaterThanOrEqual(0)
        expect(range.endMs).toBeLessThanOrEqual(durationMs)
        expect(range.endMs - range.startMs).toBeLessThanOrEqual(15000)
        expect(range.contentEndMs).toBeGreaterThan(range.contentStartMs)
        expect(range.contentEndMs - range.contentStartMs).toBeLessThanOrEqual(13000)
        expect(range.startMs).toBeLessThanOrEqual(range.contentStartMs)
        expect(range.endMs).toBeGreaterThanOrEqual(range.contentEndMs)
        expect(range.contentStartMs - range.startMs).toBeLessThanOrEqual(1000)
        expect(range.endMs - range.contentEndMs).toBeLessThanOrEqual(1000)
        if (index) expect(range.contentStartMs).toBe(ranges[index - 1].contentEndMs)
      }
      expect(planTranscriptionRetries(durationMs)).toEqual(ranges)
    }
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 64000.0625])(
    'rejects invalid or oversized duration %s before planning', durationMs => {
      expect(() => planTranscriptionRetries(durationMs)).toThrow()
    }
  )
})
