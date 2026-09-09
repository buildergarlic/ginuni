import { describe, expect, it } from 'vitest'
import { ceilToSecond, floorToSecond, formatTimecode, intervalSeconds, parseTimecode } from '@shared/timecode'

describe('timecode', () => {
  it('preserves millisecond endpoints for short intervals and accepts fractional edits', () => {
    expect(formatTimecode(10_500)).toBe('00:10.500')
    expect(formatTimecode(400)).toBe('00:00.400')
    expect(parseTimecode('00:10.5')).toBe(10_500)
    expect(parseTimecode('00:00.04')).toBe(40)
    expect(parseTimecode('00:00.001')).toBe(1)
    expect(parseTimecode('00:10.1234')).toBeNull()
  })
  it('시작은 내리고 종료는 올린다', () => {
    expect(floorToSecond(3_999)).toBe(3_000)
    expect(ceilToSecond(3_001)).toBe(4_000)
  })

  it('한 시간이 넘어도 누적 분 MM:SS로 표시한다', () => {
    expect(formatTimecode(62 * 60_000 + 3_000)).toBe('62:03')
    expect(parseTimecode('125:07')).toBe(7_507_000)
  })

  it('잘못된 시간은 거부하고 간격은 초로 계산한다', () => {
    expect(parseTimecode('01:60')).toBeNull()
    expect(intervalSeconds(1_000, 3_400)).toBe(2)
  })
})
