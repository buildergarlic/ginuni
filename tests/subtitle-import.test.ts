import { describe, expect, it } from 'vitest'
import { decodeSubtitleBytes, parseSrt } from '@main/services/subtitle-import'
import { validateSubtitleCues } from '@shared/subtitle-rows'
import type { SubtitleCue, SubtitlePreview, SubtitlePreviewOptions } from '@shared/subtitle-types'

const cue = (overrides: Partial<SubtitleCue> = {}): SubtitleCue => ({
  id: 'cue-1',
  assetId: 'asset-1',
  ordinal: 1,
  startMs: 1_000,
  endMs: 2_000,
  text: '대사',
  ...overrides
})

describe('decodeSubtitleBytes', () => {
  it.each([
    ['utf-8 BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('첫 줄\r\n둘째 줄')]), undefined, 'utf-8'],
    ['utf-16le BOM', new Uint8Array([0xff, 0xfe, 0x4c, 0xd1, 0xa4, 0xc2, 0xb8, 0xd2]), undefined, 'utf-16le'],
    ['utf-16be BOM', new Uint8Array([0xfe, 0xff, 0xd1, 0x4c, 0xc2, 0xa4, 0xd2, 0xb8]), undefined, 'utf-16be']
  ] as const)('decodes %s without leaking the BOM into text', (_name, bytes, encoding, expectedEncoding) => {
    const decoded = decodeSubtitleBytes(bytes, encoding)
    expect(decoded).toEqual({ text: _name === 'utf-8 BOM' ? '첫 줄\r\n둘째 줄' : '테스트', encoding: expectedEncoding })
  })

  it('uses strict UTF-8 by default and asks for an explicit legacy encoding when bytes are invalid', () => {
    expect(() => decodeSubtitleBytes(new Uint8Array([0xc3, 0x28]))).toThrow(/인코딩|UTF-8/)
  })

  it('decodes EUC-KR only when it is explicitly selected', () => {
    const bytes = new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7])
    expect(decodeSubtitleBytes(bytes, 'euc-kr')).toEqual({ text: '안녕', encoding: 'euc-kr' })
    expect(() => decodeSubtitleBytes(bytes)).toThrow()
  })
})

describe('parseSrt', () => {
  it('preserves exact milliseconds, multiline text, CRLF input, and irregular cue numbers', () => {
    const parsed = parseSrt([
      '7',
      '00:00:01,250 --> 00:00:02,875',
      '첫 줄',
      '둘째 줄',
      '',
      '42',
      '00:00:03,001 --> 00:00:03,099',
      '같은 문장',
      '',
      '99',
      '00:00:04,001 --> 00:00:04,099',
      '같은 문장',
      ''
    ].join('\r\n'), 'asset-1')

    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(parsed.cues.map(({ ordinal, startMs, endMs, text }) => ({ ordinal, startMs, endMs, text }))).toEqual([
      { ordinal: 7, startMs: 1_250, endMs: 2_875, text: '첫 줄\n둘째 줄' },
      { ordinal: 42, startMs: 3_001, endMs: 3_099, text: '같은 문장' },
      { ordinal: 99, startMs: 4_001, endMs: 4_099, text: '같은 문장' }
    ])
    expect(new Set(parsed.cues.map(item => item.id)).size).toBe(3)
    expect(parsed.cues.every(item => item.assetId === 'asset-1')).toBe(true)
  })

  it('accepts hour-based source times before an effective offset is applied', () => {
    const parsed = parseSrt('1\n01:00:00,125 --> 01:00:01,250\n대사\n', 'asset-1')
    expect(parsed.cues[0]).toMatchObject({ startMs: 3_600_125, endMs: 3_601_250 })
    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('converts known SRT formatting tags, reports the conversion, and leaves unknown markup inert as text', () => {
    const parsed = parseSrt('1\n00:00:00,000 --> 00:00:01,000\n<b>굵게</b> <i>기울임</i> <script>alert(1)</script>\n', 'asset-1')
    expect(parsed.cues[0].text).toBe('굵게 기울임 <script>alert(1)</script>')
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'style', severity: 'warning', ordinal: 1 }))
  })

  it('reports malformed timing and empty text instead of silently treating the input as valid', () => {
    const parsed = parseSrt([
      '1',
      '00:00:bad --> 00:00:02,000',
      '손상된 시간',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      ''
    ].join('\n'), 'asset-1')

    expect(parsed.cues).toHaveLength(1)
    expect(parsed.cues[0]).toMatchObject({ ordinal: 2, text: '' })
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'syntax', severity: 'error', ordinal: 1 }),
      expect.objectContaining({ code: 'syntax', severity: 'error', ordinal: 2 })
    ]))
  })
})

describe('validateSubtitleCues', () => {
  it.each([
    null,
    [undefined],
    [{ id: 7, assetId: 'asset-1', ordinal: 1, startMs: 0, endMs: 1, text: 'A' }],
    [{ id: 'a', assetId: null, ordinal: 1, startMs: 0, endMs: 1, text: 'A' }]
  ])('rejects malformed cue collections with a stable validation error', malformed => {
    expect(() => validateSubtitleCues(malformed as unknown as SubtitleCue[])).toThrow(/자막 큐|자막 입력/)
  })

  it('reports duplicate IDs, blank text, invalid integer ranges, and overlong cue text', () => {
    const issues = validateSubtitleCues([
      cue(),
      cue({ ordinal: 2, startMs: -1, endMs: 1.5, text: ' ' }),
      cue({ id: 'cue-3', ordinal: 3, text: '가'.repeat(10_001) })
    ])
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'syntax', severity: 'error', ordinal: 2 }),
      expect.objectContaining({ code: 'range', severity: 'error', ordinal: 2 }),
      expect.objectContaining({ code: 'range', severity: 'error', ordinal: 3 })
    ]))
  })

  it('rejects integer-looking timestamps that cannot preserve exact milliseconds', () => {
    expect(validateSubtitleCues([cue({ startMs: Number.MAX_SAFE_INTEGER + 1, endMs: Number.MAX_SAFE_INTEGER + 2 })]))
      .toContainEqual(expect.objectContaining({ code: 'range', severity: 'error' }))
  })

  it('reports reversed times and overlapping source cues while preserving them for explicit resolution', () => {
    const cues = [
      cue({ id: 'a', ordinal: 1, startMs: 1_000, endMs: 3_000 }),
      cue({ id: 'b', ordinal: 2, startMs: 2_000, endMs: 4_000 }),
      cue({ id: 'c', ordinal: 3, startMs: 5_000, endMs: 4_500 })
    ]
    const before = structuredClone(cues)
    const issues = validateSubtitleCues(cues)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'overlap', severity: 'error', ordinal: 2 }),
      expect.objectContaining({ code: 'range', severity: 'error', ordinal: 3 })
    ]))
    expect(cues).toEqual(before)
  })

  it('warns when source times need sorting without changing original ordinals or array order', () => {
    const cues = [
      cue({ id: 'later', ordinal: 10, startMs: 5_000, endMs: 6_000 }),
      cue({ id: 'earlier', ordinal: 20, startMs: 1_000, endMs: 2_000 })
    ]
    expect(validateSubtitleCues(cues)).toContainEqual(expect.objectContaining({ code: 'range', severity: 'warning', ordinal: 20 }))
    expect(cues.map(item => item.id)).toEqual(['later', 'earlier'])
    expect(cues.map(item => item.ordinal)).toEqual([10, 20])
  })

  it('validates numbering, order, and overlap independently for each subtitle asset', () => {
    const cues = [
      cue({ id: 'asset-a-1', assetId: 'asset-a', ordinal: 1, startMs: 0, endMs: 2_000 }),
      cue({ id: 'asset-b-1', assetId: 'asset-b', ordinal: 1, startMs: 0, endMs: 2_000 }),
      cue({ id: 'asset-a-2', assetId: 'asset-a', ordinal: 2, startMs: 3_000, endMs: 4_000 })
    ]
    expect(validateSubtitleCues(cues)).toEqual([])
  })

  it('exposes preview duration and bounded encoding/source options in the shared contract', () => {
    const options: SubtitlePreviewOptions = { encoding: 'utf-16be', sourceKind: 'ocr-srt', declaredAuthority: 'support-produced' }
    const preview = { durationMs: 90_000 } as SubtitlePreview
    expect(options).toEqual({ encoding: 'utf-16be', sourceKind: 'ocr-srt', declaredAuthority: 'support-produced' })
    expect(preview.durationMs).toBe(90_000)
  })
})
