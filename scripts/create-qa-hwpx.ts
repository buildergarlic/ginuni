import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildHwpx } from '../src/main/services/hwpx'
import { DESCRIPTION_TEXT } from '../src/shared/constants'
import type { ScriptRow } from '../src/shared/types'

const outputDirectory = resolve('release', 'qa')
const outputPath = resolve(outputDirectory, 'QA_화면해설대본_V01.hwpx')

const rows: ScriptRow[] = [
  {
    id: 'qa-gap-1',
    kind: 'descriptionGap',
    startMs: 0,
    endMs: 3_000,
    speakers: [],
    content: DESCRIPTION_TEXT,
    sourceSegmentIds: [],
    reviewed: true
  },
  {
    id: 'qa-dialogue-1',
    kind: 'dialogue',
    startMs: 3_000,
    endMs: 9_000,
    speakers: ['화자1'],
    content: '[화자1] [화자1] 안녕하세요. 화면해설 대본 도구 문서 검증입니다.',
    sourceSegmentIds: ['qa-segment-1'],
    reviewed: true
  },
  {
    id: 'qa-dialogue-2',
    kind: 'dialogue',
    startMs: 9_000,
    endMs: 17_000,
    speakers: ['화자1', '화자2'],
    content: '[화자1, 화자2] [화자1] 특수문자 <검증> & 줄바꿈도 확인합니다.\n[화자2] 네, 확인했습니다.',
    sourceSegmentIds: ['qa-segment-2', 'qa-segment-3'],
    reviewed: true
  },
  {
    id: 'qa-gap-2',
    kind: 'descriptionGap',
    startMs: 17_000,
    endMs: 20_000,
    speakers: [],
    content: DESCRIPTION_TEXT,
    sourceSegmentIds: [],
    reviewed: true
  }
]

await mkdir(outputDirectory, { recursive: true })
await buildHwpx({
  templatePath: resolve('resources', 'templates', 'screen-description-template.hwpx'),
  outputPath,
  title: '화면해설 대본 도구 문서 검증',
  rows
})

console.log(outputPath)
