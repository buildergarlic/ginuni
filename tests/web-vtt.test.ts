import { describe, expect, it } from 'vitest'
import type { ScriptRow } from '../src/shared/types'
import { buildWebVttContent } from '../src/web/vtt'

function row(content: string, startMs = 1000, endMs = 5000): ScriptRow {
  return {
    id: `${startMs}-${endMs}`,
    kind: 'dialogue',
    startMs,
    endMs,
    content,
    speakers: [],
    sourceSegmentIds: [],
    reviewed: false
  }
}

describe('WebVTT preview serialization', () => {
  it('formats only cue timestamps and preserves spoken timestamp text', () => {
    expect(buildWebVttContent([row('At 00:00:02,420, stop.', 3_600_042, 3_601_567)]))
      .toBe('WEBVTT\n\n1\n01:00:00.042 --> 01:00:01.567\nAt 00:00:02,420, stop.\n')
  })

  it('escapes literal markup and entity text without losing dialogue', () => {
    const vtt = buildWebVttContent([row('Hello <Jane>. A & B > C; literal &amp; and <00:00:03.000>.')])
    expect(vtt).toContain('Hello &lt;Jane&gt;. A &amp; B &gt; C; literal &amp;amp; and &lt;00:00:03.000&gt;.')
    expect(vtt).not.toContain('<Jane>')
  })

  it('keeps multiple blank lines within one cue instead of truncating later paragraphs', () => {
    const vtt = buildWebVttContent([row('First\r\n\r\n\r\n \t\r\nSecond\rLast')])
    expect(vtt).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nFirst\n\u00a0\n\u00a0\n\u00a0\nSecond\nLast\n')
    expect(vtt.trimEnd().split('\n\n')).toHaveLength(2)
  })

  it('preserves leading and trailing blank lines as visible line spacing', () => {
    expect(buildWebVttContent([row('\nHello\n\n')]))
      .toContain('\n\u00a0\nHello\n\u00a0\n\u00a0\n')
  })

  it('escapes speaker labels and avoids duplicating an existing label', () => {
    const labelled = { ...row('[A & B] Hello.'), speakers: ['A & B'] }
    expect(buildWebVttContent([labelled])).toContain('\n[A &amp; B] Hello.\n')
    const unlabelled = { ...row('Hello.'), speakers: ['<Jane>'] }
    expect(buildWebVttContent([unlabelled])).toContain('\n[&lt;Jane&gt;] Hello.\n')
    expect(buildWebVttContent([unlabelled], false)).toContain('\nHello.\n')
  })

  it('keeps only dialogue, sorts without mutating the project, and handles no dialogue', () => {
    const rows = [row('Second', 5000, 6000), { ...row('Description'), kind: 'descriptionGap' as const }, row('First', 1000, 2000)]
    const original = structuredClone(rows)
    const vtt = buildWebVttContent(rows)
    expect(vtt.indexOf('First')).toBeLessThan(vtt.indexOf('Second'))
    expect(vtt).not.toContain('Description')
    expect(rows).toEqual(original)
    expect(buildWebVttContent([rows[1]])).toBe('')
    expect(buildWebVttContent([])).toBe('')
  })
})
