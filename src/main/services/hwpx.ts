// File-backed export wrapper; document rendering is shared with the web app.
import { basename } from 'node:path'
import { DESCRIPTION_TEXT } from '@shared/constants'
import type { ScriptRow } from '@shared/types'
import { renderHwpxEntries } from '@shared/hwpx-document'
import { nextVersionedExportPath } from './export-path'
import { readZipEntries, writeZipEntries } from './zip'

export async function nextVersionedHwpxPath(outputDirectory: string, title: string): Promise<string> {
  return nextVersionedExportPath(outputDirectory, title, 'hwpx')
}

export async function buildHwpx(options: {
  templatePath: string
  outputPath: string
  title: string
  rows: ScriptRow[]
}): Promise<void> {
  const template = await readZipEntries(options.templatePath)
  const entries = renderHwpxEntries(template, options.title, options.rows)
  await writeZipEntries(options.outputPath, new Map([...entries].map(([name, bytes]) => [name, Buffer.from(bytes)])))
}

export async function sanitizeHwpxTemplate(sourcePath: string, targetPath: string): Promise<void> {
  const placeholderRows: ScriptRow[] = [
    {
      id: 'template-gap',
      kind: 'descriptionGap',
      startMs: 0,
      endMs: 2_000,
      speakers: [],
      content: DESCRIPTION_TEXT,
      sourceSegmentIds: [],
      reviewed: false
    },
    {
      id: 'template-dialogue',
      kind: 'dialogue',
      startMs: 2_000,
      endMs: 4_000,
      speakers: ['화자1'],
      content: '[화자1] [화자1] 대사',
      sourceSegmentIds: [],
      reviewed: false
    }
  ]
  await buildHwpx({ templatePath: sourcePath, outputPath: targetPath, title: '새 프로젝트', rows: placeholderRows })
}

export function templateName(filePath: string): string {
  return basename(filePath)
}
