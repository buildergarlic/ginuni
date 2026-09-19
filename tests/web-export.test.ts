import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHwpxBlob, safeFileName } from '../src/web/export'
import { buildHwpx } from '@main/services/hwpx'
import { buildSrtContent as desktopSrt } from '@main/services/srt'
import { parseSrt as desktopParser } from '@main/services/subtitle-import'
import { buildSrtContent } from '@shared/srt'
import { parseSrt } from '@shared/subtitle-parser'
import { renderHwpxEntries } from '@shared/hwpx-document'
import type { ScriptRow } from '@shared/types'

const templatePath = resolve('resources/templates/screen-description-template.hwpx')
const rows: ScriptRow[] = [
  { id: 'gap', kind: 'descriptionGap', startMs: 0, endMs: 2_000, speakers: [], content: '창문으로 햇살이 들어온다.', sourceSegmentIds: [], reviewed: false },
  { id: 'dialogue', kind: 'dialogue', startMs: 2_125, endMs: 4_875, speakers: ['민수'], content: '<안녕> & 반가워요\n다시 만났네요.', sourceSegmentIds: [], reviewed: false }
]
let tempDirectory = ''

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

async function serveTemplate(): Promise<void> {
  const bytes = await readFile(templatePath)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
}

describe('browser HWPX export', () => {
  it('produces a real HWPX archive with mimetype first and uncompressed', async () => {
    await serveTemplate()
    const blob = await createHwpxBlob('웹 & 대본', rows)
    expect(blob.type).toBe('application/hwp+zip')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const header = new DataView(bytes.buffer)
    expect(header.getUint32(0, true)).toBe(0x04034b50)
    expect(header.getUint16(8, true)).toBe(0)
    expect(strFromU8(bytes.subarray(30, 30 + header.getUint16(26, true)))).toBe('mimetype')

    const entries = unzipSync(bytes)
    expect(strFromU8(entries.mimetype)).toBe('application/hwp+zip')
    expect(entries['Preview/PrvImage.png']).toBeUndefined()
    expect(strFromU8(entries['Contents/section0.xml'])).toContain('&lt;안녕&gt; &amp; 반가워요<hp:lineBreak/>다시 만났네요.')
    expect(strFromU8(entries['Contents/section0.xml'])).toContain('rowCnt="3"')
    expect(strFromU8(entries['Preview/PrvText.txt'])).toContain('창문으로 햇살이 들어온다.')
  })

  it('preserves the exact desktop XML, styles, metadata and preview output', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'))
    await serveTemplate()
    const webEntries = unzipSync(new Uint8Array(await (await createHwpxBlob('동일한 대본', rows)).arrayBuffer()))
    tempDirectory = await mkdtemp(join(tmpdir(), 'ginuni-web-export-'))
    const outputPath = join(tempDirectory, 'desktop.hwpx')
    await buildHwpx({ templatePath, outputPath, title: '동일한 대본', rows })
    const desktopEntries = unzipSync(await readFile(outputPath))
    expect(Object.keys(webEntries).sort()).toEqual(Object.keys(desktopEntries).sort())
    for (const [name, bytes] of Object.entries(desktopEntries)) expect(webEntries[name]).toEqual(bytes)
  })

  it('reports failed template downloads and invalid template structure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(createHwpxBlob('실패', rows)).rejects.toThrow('양식을 불러오지 못했습니다')
    expect(() => renderHwpxEntries(new Map(), '실패', rows)).toThrow('핵심 XML')
  })

  it('does not mutate the template or leave its old preview in a new document', async () => {
    const template = new Map(Object.entries(unzipSync(await readFile(templatePath))))
    const originalPreview = template.get('Preview/PrvText.txt')!.slice()
    const output = renderHwpxEntries(template, '새로운 작품', rows)
    expect(template.get('Preview/PrvText.txt')).toEqual(originalPreview)
    expect(strFromU8(output.get('Preview/PrvText.txt')!)).toContain('새로운 작품')
    expect(strFromU8(output.get('Preview/PrvText.txt')!)).not.toContain('[화자1] [화자1] 대사')
  })
})

describe('shared subtitle compatibility', () => {
  it('keeps the desktop API bound to the same browser-safe functions', () => {
    expect(desktopSrt).toBe(buildSrtContent)
    expect(desktopParser).toBe(parseSrt)
    const text = buildSrtContent(rows, false)
    const parsed = parseSrt(text, 'web-export')
    expect(parsed.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(parsed.cues).toHaveLength(1)
    expect(parsed.cues[0]).toMatchObject({ startMs: 2_125, endMs: 4_875, text: rows[1].content })
  })

  it('creates usable names without path separators or reserved Windows device names', () => {
    expect(safeFileName('  작품:이름/초안... ')).toBe('작품_이름_초안')
    expect(safeFileName('..')).toBe('새 프로젝트')
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('nul.txt')).toBe('_nul.txt')
    expect(safeFileName('긴'.repeat(200))).toHaveLength(120)
  })
})
