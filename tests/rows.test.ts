import { describe, expect, it } from 'vitest'
import { generateScriptRows, removeLegacyLocalSpeakerLabels, validateRows } from '@shared/rows'
import type { ScriptProject, TranscriptSegment } from '@shared/types'

function segment(id: string, startMs: number, endMs: number, speakerId: string, text: string): TranscriptSegment {
  return { id, startMs, endMs, speakerId, text }
}

describe('generateScriptRows', () => {
  it('1초 공백은 합치고 2초 공백은 해설 행을 만든다', () => {
    const rows = generateScriptRows([
      segment('a', 1_000, 3_000, '화자1', '첫 대사'),
      segment('b', 4_000, 6_000, '화자2', '둘째 대사'),
      segment('c', 8_000, 9_000, '화자1', '셋째 대사')
    ], 10_000)

    expect(rows.map((row) => row.kind)).toEqual(['dialogue', 'descriptionGap', 'dialogue'])
    expect(rows[0].content).toContain('[화자1, 화자2]')
    expect(rows[1]).toMatchObject({ startMs: 6_000, endMs: 8_000 })
  })

  it('겹치는 대사는 하나의 행으로 합친다', () => {
    const rows = generateScriptRows([
      segment('a', 0, 5_200, '화자1', '안녕하세요'),
      segment('b', 4_700, 7_000, '화자2', '반갑습니다')
    ], 7_000)
    expect(rows).toHaveLength(1)
    expect(rows[0].speakers).toEqual(['화자1', '화자2'])
  })

  it('화자 분리를 지원하지 않는 로컬 세그먼트에는 화자 표기를 만들지 않는다', () => {
    const rows = generateScriptRows([
      segment('a', 0, 2_000, '', '첫 대사'),
      segment('b', 2_200, 4_000, '', '두 번째 대사')
    ], 4_000)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ speakers: [], content: '첫 대사 두 번째 대사' })
  })

  it('60초를 넘기기 전에 발화 경계에서 나눈다', () => {
    const rows = generateScriptRows([
      segment('a', 0, 35_000, '화자1', '첫 구간'),
      segment('b', 35_200, 70_000, '화자1', '둘째 구간')
    ], 70_000)
    expect(rows.filter((row) => row.kind === 'dialogue')).toHaveLength(2)
    expect(rows.some((row) => row.kind === 'descriptionGap')).toBe(false)
  })

  it('행 시간 겹침을 검증한다', () => {
    const rows = generateScriptRows([segment('a', 0, 2_000, '화자1', '대사')], 2_000)
    rows.push({ ...rows[0], id: 'duplicate', startMs: 1_000, endMs: 3_000 })
    expect(validateRows(rows)).toHaveLength(1)
  })
})

describe('removeLegacyLocalSpeakerLabels', () => {
  function project(provider: 'local' | 'openai'): ScriptProject {
    return {
      schemaVersion: 1,
      id: 'project',
      title: '테스트',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'review',
      transcriptionEngine: provider,
      localDiarization: { mode: 'none', speakerCount: null },
      source: { kind: 'local', uri: 'video.mp4', displayName: 'video.mp4' },
      media: { durationMs: 2_000 },
      segments: [segment('a', 0, 2_000, '화자1', '대사')],
      rows: [{
        id: 'row',
        kind: 'dialogue',
        startMs: 0,
        endMs: 2_000,
        speakers: ['화자1'],
        content: '[화자1] [화자1] 대사',
        sourceSegmentIds: ['a'],
        reviewed: false
      }],
      runs: [{
        id: 'run',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        provider,
        model: 'test'
      }],
      exports: []
    }
  }

  it('저장된 로컬 프로젝트의 자동 화자1 표기만 제거한다', () => {
    const normalized = removeLegacyLocalSpeakerLabels(project('local'))

    expect(normalized.segments[0].speakerId).toBe('')
    expect(normalized.rows[0]).toMatchObject({ speakers: [], content: '대사' })
  })

  it('OpenAI 화자 분리 결과는 변경하지 않는다', () => {
    const original = project('openai')
    // 검수 결과는 마지막 성공 run 기준이다. 다음 실행 방식만 local로 바꿔도
    // 이미 생성된 OpenAI 화자 정보가 사라지면 안 된다.
    original.transcriptionEngine = 'local'
    expect(removeLegacyLocalSpeakerLabels(original)).toBe(original)
    expect(original.rows[0].content).toBe('[화자1] [화자1] 대사')
  })

  it('로컬 프로젝트에서도 사용자가 지정한 화자명은 보존한다', () => {
    const original = project('local')
    original.rows[0] = {
      ...original.rows[0],
      speakers: ['선생님'],
      content: '[선생님] [선생님] 직접 수정한 대사',
      reviewed: true
    }

    const normalized = removeLegacyLocalSpeakerLabels(original)
    expect(normalized.rows[0]).toEqual(original.rows[0])
  })
})
