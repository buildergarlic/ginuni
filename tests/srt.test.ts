import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAndWriteSrt, buildSrtContent, formatSrtTimestamp } from '@main/services/srt'
import { nextVersionedExportPath } from '@main/services/export-path'
import type { ScriptRow } from '@shared/types'

let tempDirectory = ''

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

describe('SRT timestamp', () => {
  it('밀리초를 SRT 타임코드로 변환한다', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000')
    expect(formatSrtTimestamp(999)).toBe('00:00:00,999')
    expect(formatSrtTimestamp(60_000)).toBe('00:01:00,000')
    expect(formatSrtTimestamp(3_599_000)).toBe('00:59:59,000')
  })
})

describe('SRT content', () => {
  const rows: ScriptRow[] = [
    { id: 'd1', kind: 'dialogue', startMs: 0, endMs: 2_000, speakers: ['화자1'], content: '안녕하세요', sourceSegmentIds: ['s1'], reviewed: true },
    { id: 'g1', kind: 'descriptionGap', startMs: 2_000, endMs: 4_000, speakers: [], content: '무음 구간', sourceSegmentIds: [], reviewed: true },
    { id: 'd2', kind: 'dialogue', startMs: 4_000, endMs: 7_500, speakers: ['화자2'], content: '다음 문장', sourceSegmentIds: ['s2'], reviewed: true },
    { id: 'd3', kind: 'dialogue', startMs: 2_500, endMs: 3_000, speakers: ['화자1'], content: '섞인 입력 정렬', sourceSegmentIds: ['s3'], reviewed: true }
  ]

  it('대사 행만 추려 내보내고 시간순 정렬한다', () => {
    const content = buildSrtContent(rows, true)
    expect(content).toContain('[화자1] 안녕하세요')
    expect(content).toContain('[화자2] 다음 문장')
    expect(content).toContain('[화자1] 섞인 입력 정렬')
    expect(content).not.toContain('무음 구간')
    const blocks = content.split('\r\n\r\n')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toContain('00:00:00,000 --> 00:00:02,000')
    expect(blocks[1]).toContain('00:00:02,500 --> 00:00:03,000')
    expect(blocks[2]).toContain('00:00:04,000 --> 00:00:07,500')
  })

  it('로컬 모드에서는 화자 라벨 없이 대사만 출력한다', () => {
    const content = buildSrtContent(rows, false)
    expect(content).toContain('안녕하세요')
    expect(content).not.toContain('[화자1] 안녕하세요')
  })
})

describe('SRT export path', () => {
  it('확장자별 버전 증가 경로를 생성한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-srt-'))
    const first = await nextVersionedExportPath(tempDirectory, '테스트 영상', 'srt')
    expect(first).toMatch(/화면해설대본_V01\.srt$/)
    await writeFile(first, 'x')
    const second = await nextVersionedExportPath(tempDirectory, '테스트 영상', 'srt')
    expect(second).toMatch(/화면해설대본_V02\.srt$/)
  })
})

describe('SRT writer', () => {
  it('행 목록으로 SRT 파일을 생성한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-srt-write-'))
    const output = await buildAndWriteSrt({
      outputDirectory: tempDirectory,
      projectTitle: '최종 결과',
      rows: [{ id: 'd1', kind: 'dialogue', startMs: 1000, endMs: 2500, speakers: ['화자1'], content: '결과 확인', sourceSegmentIds: ['s1'], reviewed: true }],
      includeSpeakerLabels: true
    })
    const text = await readFile(output.path, 'utf8')
    expect(text).toContain('00:00:01,000 --> 00:00:02,500')
    expect(text).toContain('[화자1] 결과 확인')
    expect(output.path).toMatch(/화면해설대본_V01\.srt$/)
  })
})
