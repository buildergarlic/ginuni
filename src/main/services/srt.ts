import { writeFile } from 'node:fs/promises'
import { nextVersionedExportPath } from './export-path'
import type { ScriptRow } from '@shared/types'

export function formatSrtTimestamp(ms: number): string {
  const totalMilliseconds = Math.max(0, Math.floor(ms))
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const milliseconds = totalMilliseconds % 1000
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function toSrtLine(row: ScriptRow, includeSpeakerLabels: boolean): string {
  const content = row.content.trim()
  if (!includeSpeakerLabels || row.speakers.length === 0) return content
  const label = `[${row.speakers.join(', ')}]`
  return content.startsWith(label) ? content : `${label} ${content}`
}

export interface SrtExportInput {
  outputDirectory: string
  projectTitle: string
  rows: ScriptRow[]
  includeSpeakerLabels: boolean
}

export interface SrtExportResult {
  path: string
}

export function buildSrtContent(rows: ScriptRow[], includeSpeakerLabels: boolean): string {
  const dialogueRows = [...rows]
    .filter((row) => row.kind === 'dialogue')
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

  const blocks = dialogueRows.map((row, index) => (
    `${index + 1}\r\n${formatSrtTimestamp(row.startMs)} --> ${formatSrtTimestamp(row.endMs)}\r\n${toSrtLine(row, includeSpeakerLabels)}`
  ))

  return blocks.join('\r\n\r\n')
}

export async function buildAndWriteSrt(input: SrtExportInput): Promise<SrtExportResult> {
  const outputPath = await nextVersionedExportPath(input.outputDirectory, input.projectTitle, 'srt')
  await writeFile(outputPath, buildSrtContent(input.rows, input.includeSpeakerLabels), { encoding: 'utf8' })
  return { path: outputPath }
}
