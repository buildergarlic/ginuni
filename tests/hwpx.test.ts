import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildHwpx, nextVersionedHwpxPath } from '@main/services/hwpx'
import { readZipEntries } from '@main/services/zip'
import type { ScriptRow } from '@shared/types'

let tempDirectory = ''

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

describe('HWPX export', () => {
  it('첨부 양식의 스타일 패키지에 새 행과 미리보기 텍스트를 기록한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-hwpx-'))
    const outputPath = join(tempDirectory, 'result.hwpx')
    const rows: ScriptRow[] = [
      { id: 'g', kind: 'descriptionGap', startMs: 0, endMs: 3_000, speakers: [], content: '무시되는 값', sourceSegmentIds: [], reviewed: false },
      { id: 'd', kind: 'dialogue', startMs: 3_000, endMs: 14_000, speakers: ['화자1'], content: '[화자1] [화자1] <안녕> & 반가워요', sourceSegmentIds: ['s1'], reviewed: true }
    ]
    await buildHwpx({
      templatePath: resolve('resources/templates/screen-description-template.hwpx'),
      outputPath,
      title: '테스트 & 제목',
      rows
    })

    const entries = await readZipEntries(outputPath)
    expect(entries.get('mimetype')?.toString()).toBe('application/hwp+zip')
    expect(entries.has('Preview/PrvImage.png')).toBe(false)
    const section = entries.get('Contents/section0.xml')?.toString('utf8') ?? ''
    expect(section).toContain('rowCnt="3"')
    expect(section).toContain('테스트 &amp; 제목')
    expect(section).toContain('&lt;안녕&gt; &amp; 반가워요')
    expect(section).not.toContain('hp:linesegarray')
    const content = entries.get('Contents/content.hpf')?.toString('utf8') ?? ''
    expect(content).toContain('name="creator" content="text">화면해설 대본 도구</opf:meta>')
    expect(content).not.toContain('content="화면해설 대본 도구"')
    expect(entries.get('Preview/PrvText.txt')?.toString('utf8')).toContain('※ (사람 목소리 없음) 해설 삽입 권장 구간')
  })

  it('셀 안의 줄바꿈을 HWPX 줄바꿈 요소로 기록한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-line-break-'))
    const outputPath = join(tempDirectory, 'line-break.hwpx')
    await buildHwpx({
      templatePath: resolve('resources/templates/screen-description-template.hwpx'),
      outputPath,
      title: '줄바꿈',
      rows: [{
        id: 'line-break', kind: 'dialogue', startMs: 0, endMs: 2_000, speakers: ['화자1'],
        content: '[화자1] 첫 줄\n[화자1] 둘째 줄', sourceSegmentIds: ['s1'], reviewed: true
      }]
    })
    const entries = await readZipEntries(outputPath)
    const section = entries.get('Contents/section0.xml')?.toString('utf8') ?? ''
    expect(section).toContain('첫 줄<hp:lineBreak/>[화자1] 둘째 줄')
  })

  it('화자 분리 없는 로컬 대사는 HWPX와 미리보기에 화자 표기 없이 기록한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-local-dialogue-'))
    const outputPath = join(tempDirectory, 'local-dialogue.hwpx')
    await buildHwpx({
      templatePath: resolve('resources/templates/screen-description-template.hwpx'),
      outputPath,
      title: '로컬 분석',
      rows: [{
        id: 'local', kind: 'dialogue', startMs: 0, endMs: 2_000, speakers: [],
        content: '화자 표기 없는 대사', sourceSegmentIds: ['s1'], reviewed: false
      }]
    })

    const entries = await readZipEntries(outputPath)
    const section = entries.get('Contents/section0.xml')?.toString('utf8') ?? ''
    const preview = entries.get('Preview/PrvText.txt')?.toString('utf8') ?? ''
    expect(section).toContain('화자 표기 없는 대사')
    expect(preview).toContain('화자 표기 없는 대사')
    expect(section).not.toContain('[화자1]')
    expect(preview).not.toContain('[화자1]')
  })

  it('기존 파일을 덮어쓰지 않고 다음 버전을 만든다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-version-'))
    const first = await nextVersionedHwpxPath(tempDirectory, '작품:이름')
    expect(first).toMatch(/작품_이름_화면해설대본_V01\.hwpx$/)
    await buildHwpx({ templatePath: resolve('resources/templates/screen-description-template.hwpx'), outputPath: first, title: '작품 이름', rows: [] })
    const second = await nextVersionedHwpxPath(tempDirectory, '작품:이름')
    expect(second).toMatch(/V02\.hwpx$/)
  })

  it('배포 템플릿에 원본 작품 대사가 남아 있지 않다', async () => {
    const entries = await readZipEntries(resolve('resources/templates/screen-description-template.hwpx'))
    const allText = [...entries.values()].map((entry) => entry.toString('utf8')).join('\n')
    expect(allText).not.toContain('독립의 맛')
    expect(allText).not.toContain('자, 얘들아')
  })
})
