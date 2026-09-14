import { describe, expect, it } from 'vitest'
import { parseSrt } from '@main/services/subtitle-import'

describe('subtitle parser review cases', () => {
  it('reports a missing blank separator instead of absorbing the next cue as dialogue text', () => {
    const parsed = parseSrt([
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '첫째 대사',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      '둘째 대사'
    ].join('\n'), 'asset-1')

    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'syntax', severity: 'error' }))
    expect(parsed.cues).toEqual([])
  })
})
