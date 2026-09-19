// Preserve desktop exports while sharing serialization with the browser.
import { writeFile } from 'node:fs/promises'
import { nextVersionedExportPath } from './export-path'
import type { ScriptRow } from '@shared/types'
import { buildSrtContent } from '@shared/srt'
export { buildSrtContent, formatSrtTimestamp } from '@shared/srt'

export interface SrtExportInput {
  outputDirectory: string
  projectTitle: string
  rows: ScriptRow[]
  includeSpeakerLabels: boolean
}

export interface SrtExportResult {
  path: string
}

export async function buildAndWriteSrt(input: SrtExportInput): Promise<SrtExportResult> {
  const outputPath = await nextVersionedExportPath(input.outputDirectory, input.projectTitle, 'srt')
  await writeFile(outputPath, buildSrtContent(input.rows, input.includeSpeakerLabels), { encoding: 'utf8' })
  return { path: outputPath }
}
