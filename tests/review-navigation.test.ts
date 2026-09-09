import { describe, expect, it } from 'vitest'
import { nextUnreviewedRow } from '../src/renderer/src/review-navigation'
import type { ScriptRow } from '../src/shared/types'

const makeRow = (id: string, approved = false): ScriptRow => ({
  id, kind: 'dialogue', startMs: 0, endMs: 1000, content: id,
  speakers: [], sourceSegmentIds: ['source'], reviewed: approved,
  reviewStatus: approved ? 'approved' : 'unreviewed',
  approvedAt: approved ? '2026-09-10T00:00:00Z' : undefined
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
