import { describe, expect, it } from 'vitest'
import {
  applyDiarization,
  parseDiarizationProgress,
  parseDiarizationSegments,
  requiredDiarizationMemoryBytes,
  validateDiarizationConfig
} from '@main/services/speaker-diarization'
import type { TranscriptSegment } from '@shared/types'

function plain(startMs: number, endMs: number, text: string): TranscriptSegment {
  return { id: `segment-${startMs}`, startMs, endMs, speakerId: '', text }
}

describe('sherpa-onnx 화자 분리 결과', () => {
  it('진행률을 추출하고 유효 범위로 제한한다', () => {
    expect(parseDiarizationProgress('progress 0%\rprogress 53.5%\rprogress 120%')).toEqual([0, 53.5, 100])
  })

  it('화자 구간을 시간순으로 정렬하고 최초 등장 순서로 이름 붙인다', () => {
    const result = parseDiarizationSegments([
      ' 4.000 -- 5.000 speaker_8',
      ' 0.200 -- 1.500 speaker_3',
      ' 2.000 -- 3.000 speaker_8'
    ].join('\n'))

    expect(result).toEqual([
      { startMs: 200, endMs: 1_500, speakerId: '화자1' },
      { startMs: 2_000, endMs: 3_000, speakerId: '화자2' },
      { startMs: 4_000, endMs: 5_000, speakerId: '화자2' }
    ])
  })

  it('자동 감지와 2~10명 설정만 허용한다', () => {
    expect(validateDiarizationConfig({ mode: 'sherpa-onnx', speakerCount: null })).toEqual({ mode: 'sherpa-onnx', speakerCount: null })
    expect(validateDiarizationConfig({ mode: 'sherpa-onnx', speakerCount: 10 }).speakerCount).toBe(10)
    expect(validateDiarizationConfig({ mode: 'none', speakerCount: 4 })).toEqual({ mode: 'none', speakerCount: null })
    expect(() => validateDiarizationConfig({ mode: 'sherpa-onnx', speakerCount: 1 })).toThrow('2명에서 10명')
    expect(() => validateDiarizationConfig({ mode: 'sherpa-onnx', speakerCount: 11 })).toThrow('2명에서 10명')
  })

  it('짧은 영상도 최소 768MiB 여유 메모리를 요구한다', () => {
    expect(requiredDiarizationMemoryBytes(56_861)).toBe(768 * 1024 * 1024)
    expect(requiredDiarizationMemoryBytes(3 * 60 * 60 * 1000)).toBeGreaterThan(768 * 1024 * 1024)
  })
})

describe('Whisper 단어와 화자 구간 병합', () => {
  it('가장 오래 겹치는 화자를 단어별로 배정하고 문장부호를 직전 단어에 붙인다', () => {
    const result = applyDiarization(
      [plain(0, 3_000, '안녕 반가워.')],
      [
        { startMs: 100, endMs: 900, text: ' 안녕', mappingIndex: 0 },
        { startMs: 1_100, endMs: 2_500, text: ' 반가워', mappingIndex: 0 },
        { startMs: 2_500, endMs: 2_600, text: '.', mappingIndex: 0 }
      ],
      [
        { startMs: 0, endMs: 1_000, speakerId: '화자1' },
        { startMs: 1_000, endMs: 3_000, speakerId: '화자2' }
      ]
    )

    expect(result.usedWordTimestamps).toBe(true)
    expect(result.segments.map((segment) => ({ speakerId: segment.speakerId, text: segment.text }))).toEqual([
      { speakerId: '화자1', text: '안녕' },
      { speakerId: '화자2', text: '반가워.' }
    ])
    expect(result.detectedSpeakerCount).toBe(2)
  })

  it('동률과 무겹침 단어는 화자를 추측하지 않는다', () => {
    const result = applyDiarization(
      [plain(0, 4_000, '동률 미배정')],
      [
        { startMs: 1_000, endMs: 2_000, text: ' 동률' },
        { startMs: 3_000, endMs: 4_000, text: ' 미배정' }
      ],
      [
        { startMs: 1_000, endMs: 1_500, speakerId: '화자1' },
        { startMs: 1_500, endMs: 2_000, speakerId: '화자2' }
      ]
    )

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].speakerId).toBe('')
    expect(result.ambiguousWordCount).toBe(1)
    expect(result.unassignedWordCount).toBe(2)
  })

  it('단어 타임스탬프가 맞지 않으면 문장 구간 최대 겹침으로 안전하게 대체한다', () => {
    const result = applyDiarization(
      [plain(0, 2_000, '원래 문장')],
      [{ startMs: 100, endMs: 500, text: ' 다른 단어' }],
      [{ startMs: 0, endMs: 1_800, speakerId: '화자1' }]
    )

    expect(result.usedWordTimestamps).toBe(false)
    expect(result.segments[0]).toMatchObject({ speakerId: '화자1', text: '원래 문장' })
  })
})
