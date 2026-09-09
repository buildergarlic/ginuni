import { describe, expect, it } from 'vitest'
import { nextUnreviewedRow, scrollTopToRevealRow } from '../src/renderer/src/review-navigation'
import type { ScriptRow } from '../src/shared/types'

const makeRow = (id: string, approved = false): ScriptRow => ({
  id, kind: 'dialogue', startMs: 0, endMs: 1000, content: id,
  speakers: [], sourceSegmentIds: ['source'], reviewed: approved,
  reviewStatus: approved ? 'approved' : 'unreviewed',
  approvedAt: approved ? '2026-09-10T00:00:00Z' : undefined
})

describe('revealing the selected row inside the script viewport', () => {
  it('leaves the scroll position unchanged when the row is already visible below the sticky heading', () => {
    expect(scrollTopToRevealRow(100, 400, 180, 80, 50)).toBe(100)
  })
  it('reveals a following row below the viewport with the smallest scroll', () => {
    expect(scrollTopToRevealRow(100, 400, 600, 80, 50)).toBe(280)
  })
  it('reveals the beginning when wrapping to an earlier row under the sticky heading', () => {
    expect(scrollTopToRevealRow(600, 400, 50, 80, 50)).toBe(0)
    expect(scrollTopToRevealRow(100, 400, 130, 80, 50)).toBe(80)
  })
  it('reveals the beginning of a row taller than the available viewport rather than its end', () => {
    expect(scrollTopToRevealRow(100, 400, 600, 500, 50)).toBe(550)
  })
  it('does not scroll past the top when a heading or row begins at the content boundary', () => {
    expect(scrollTopToRevealRow(200, 400, 0, 500, 50)).toBe(0)
  })
})

describe('next row to review', () => {
  it('skips approved rows after the current row', () => {
    expect(nextUnreviewedRow([makeRow('a'), makeRow('b', true), makeRow('c')], 'a')?.id).toBe('c')
  })
  it('wraps to the first remaining row', () => {
    expect(nextUnreviewedRow([makeRow('a'), makeRow('b', true), makeRow('c', true)], 'c')?.id).toBe('a')
  })
  it('returns no row after all approvals or with empty input', () => {
    expect(nextUnreviewedRow([makeRow('a', true)], 'a')).toBeUndefined()
    expect(nextUnreviewedRow([], '')).toBeUndefined()
  })
  it('starts at the first remaining row when selection is missing', () => {
    expect(nextUnreviewedRow([makeRow('a', true), makeRow('b')], 'missing')?.id).toBe('b')
  })
  it('does not trust approval without its timestamp', () => {
    expect(nextUnreviewedRow([makeRow('a', true), { ...makeRow('b', true), approvedAt: undefined }], 'a')?.id).toBe('b')
  })
})
