import { describe, it, expect } from 'vitest'

import {
  parseYouTubeMessage,
  splitSourceSegments,
  splitTextForDurationPoint
} from '../src/renderer/src/App'
import type { ScriptRow } from '../src/shared/types'

describe('splitTextForDurationPoint', () => {
  const baseRow: ScriptRow = {
    id: 'row-1',
    kind: 'dialogue',
    startMs: 0,
    endMs: 10_000,
    speakers: ['화자1'],
    content: '안녕하세요.\n이 부분은 분할됩니다.',
    sourceSegmentIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    reviewed: false
  }

  it('분할 지점이 중간일 때 텍스트를 양쪽에 나눠준다', () => {
    const [left, right] = splitTextForDurationPoint(baseRow.content, baseRow.startMs, baseRow.endMs, 5000)
    expect(left).toContain('안녕하세요.')
    expect(right).toContain('부분은 분할됩니다.')
    expect(`${left}${right}`).toContain('안녕하세요.')
    expect(`${left}${right}`).toContain('분할됩니다.')
  })

  it('텍스트가 빈칸인 경우 양쪽 빈 문자열 처리', () => {
    const [left, right] = splitTextForDurationPoint('   ', 0, 10_000, 5000)
    expect(left).toBe('')
    expect(right).toBe('')
  })

  it('경계값에서 최소 길이를 맞춰 한쪽이 비지지 않게 한다', () => {
    const text = '한글 텍스트 테스트입니다'
    const [left, right] = splitTextForDurationPoint(text, 0, 20_000, 0)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(left.length + right.length).toBeLessThanOrEqual(text.length)
  })

  it('개행이 포함된 텍스트도 개행을 보존한다', () => {
    const text = '1행\n2행\n3행'
    const [left, right] = splitTextForDurationPoint(text, 0, 3000, 1500)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(`${left}${right}`).toContain('1행')
    expect(`${left}${right}`).toContain('2행')
  })
})

describe('splitSourceSegments', () => {
  const row: ScriptRow = {
    id: 'r',
    kind: 'dialogue',
    startMs: 0,
    endMs: 10_000,
    speakers: ['화자1'],
    content: 'x',
    sourceSegmentIds: ['s1', 's2', 's3', 's4', 's5'],
    reviewed: false
  }

  it('구간 비율 기준으로 세그먼트 id를 나눈다', () => {
    const [left, right] = splitSourceSegments(row.sourceSegmentIds, row, 5000)
    expect(left).toEqual(['s1', 's2', 's3'])
    expect(right).toEqual(['s4', 's5'])
  })

  it('세그먼트가 하나 이하일 때는 안전하게 보존한다', () => {
    const [left, right] = splitSourceSegments(['only'], row, 5000)
    expect(left).toEqual(['only'])
    expect(right).toEqual([])
  })
})

describe('parseYouTubeMessage', () => {
  it('이벤트 코드에서 봇/보안 메시지를 식별한다', () => {
    const parsed = parseYouTubeMessage({ event: 'onError', info: { code: 153, message: 'Login required' } })
    expect(parsed.code).toBe(153)
    expect(parsed.message).toContain('event=onError')
  })

  it('문자열 에러 이벤트에서 메시지를 추출한다', () => {
    const parsed = parseYouTubeMessage({ event: 'error', reason: 'Sign in to confirm you are not a bot' })
    expect(parsed.message).toContain('Sign in')
  })
})
