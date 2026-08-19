import { describe, expect, it } from 'vitest'
import { parseVadMappings, parseWhisperJson, parseWhisperWords } from '@main/services/local-transcription'

describe('parseWhisperJson', () => {
  it('whisper.cpp 밀리초 구간을 화자 미확인 로컬 세그먼트로 변환한다', () => {
    const result = parseWhisperJson({
      transcription: [
        { offsets: { from: 1250, to: 3780 }, text: '  안녕하세요.  ' },
        { offsets: { from: 4000, to: 4000 }, text: '빈 구간' },
        { offsets: { from: 5000, to: 6200 }, text: '두 번째   대사' }
      ]
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ startMs: 1250, endMs: 3780, speakerId: '', text: '안녕하세요.' })
    expect(result[1].text).toBe('두 번째 대사')
  })

  it('VAD 원본 구간을 사용해 2초 이상 무음에서 대사를 나눈다', () => {
    const logs = [
      'vad_segment_info: orig_start: 0.03, orig_end: 5.60, vad_start: 0.00, vad_end: 5.17',
      'vad_segment_info: orig_start: 8.70, orig_end: 12.87, vad_start: 5.37, vad_end: 9.54'
    ].join('\n')
    const result = parseWhisperJson({ transcription: [{
      offsets: { from: 30, to: 12870 },
      text: '첫 문장. 두 번째 문장.',
      tokens: [
        { offsets: { from: 100, to: 4_900 }, text: ' 첫 문장' },
        { offsets: { from: 4_900, to: 5_100 }, text: '.' },
        { offsets: { from: 5_500, to: 9_300 }, text: ' 두 번째 문장.' },
        { offsets: { from: 9_500, to: 9_500 }, text: '[_TT_550]' }
      ]
    }] }, parseVadMappings(logs))

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ startMs: 30, endMs: 5600, text: '첫 문장.' })
    expect(result[1]).toMatchObject({ startMs: 8700, endMs: 12870, text: '두 번째 문장.' })
  })

  it('화자 분리용 단어 타임스탬프를 VAD 압축 시간에서 원본 시간으로 복원한다', () => {
    const mappings = parseVadMappings([
      'vad_segment_info: orig_start: 0.03, orig_end: 5.60, vad_start: 0.00, vad_end: 5.17',
      'vad_segment_info: orig_start: 8.70, orig_end: 12.87, vad_start: 5.37, vad_end: 9.54'
    ].join('\n'))
    const words = parseWhisperWords({ transcription: [{
      tokens: [
        { offsets: { from: 100, to: 4_900 }, text: ' 첫 문장' },
        { offsets: { from: 5_500, to: 9_300 }, text: ' 두 번째 문장' }
      ]
    }] }, mappings)

    expect(words).toEqual([
      { startMs: 130, endMs: 4_930, text: ' 첫 문장', mappingIndex: 0 },
      { startMs: 8_830, endMs: 12_630, text: ' 두 번째 문장', mappingIndex: 1 }
    ])
  })
})
