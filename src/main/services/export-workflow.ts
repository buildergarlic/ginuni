import type { ExportProvenance, ScriptProject } from '@shared/types'
import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { getReviewIssues, rowReviewStatus } from '@shared/workflow'
import { supportsSpeakerLabels } from '@shared/speaker-labels'
import { formatTimecode } from '@shared/timecode'
import { DESCRIPTION_TEXT } from '@shared/constants'
import { readZipEntries } from './zip'
import { fileSha256 } from './file-hash'
import { buildSrtContent } from './srt'

export function resolveExportProvenance(project: ScriptProject, format: 'hwpx' | 'srt'): ExportProvenance {
  const rows = format === 'srt' ? project.rows.filter(row => row.kind === 'dialogue') : project.rows
  const sourceRunIds = new Set<string>()
  const unresolvedSourceSegmentIds = new Set<string>()
  const unattributedRowIds = rows.filter(row => !row.sourceSegmentIds.length).map(row => row.id)
  for (const sourceId of new Set(rows.flatMap(row => row.sourceSegmentIds))) {
    const matches = project.runs.filter(run => run.sourceSegments?.some(segment => segment.id === sourceId))
    if (!matches.length) unresolvedSourceSegmentIds.add(sourceId)
    for (const run of matches) sourceRunIds.add(run.id)
  }
  const ids = [...sourceRunIds]
  const missing = unresolvedSourceSegmentIds.size > 0 || unattributedRowIds.length > 0
  const sourceProvenance = !ids.length ? 'unavailable' : missing ? 'partial' : ids.length > 1 ? 'multiple' : 'resolved'
  return { sourceRunIds: ids, sourceProvenance, unresolvedSourceSegmentIds: [...unresolvedSourceSegmentIds], unattributedRowIds,
    ...(sourceProvenance === 'resolved' ? { runId: ids[0] } : {}) }
}

export function getExportGate(project: ScriptProject, format: 'hwpx' | 'srt'): { errors: string[]; unreviewedCount: number } {
  const rows = format === 'srt' ? project.rows.filter((row) => row.kind === 'dialogue') : project.rows
  const ids = new Set(rows.map((row) => row.id))
  const errors = getReviewIssues(project).filter((issue) => issue.severity === 'error' && (!issue.rowId || ids.has(issue.rowId))).map((issue) => issue.message)
  if (!rows.length) errors.unshift('저장할 대본이 없습니다.')
  if (rows.some(row => Math.floor(row.endMs) <= Math.floor(row.startMs))) errors.push('출력 시간은 밀리초 단위에서 종료가 시작보다 뒤여야 합니다.')
  return { errors, unreviewedCount: rows.filter((row) => rowReviewStatus(row) !== 'approved').length }
}

export async function validateExportArtifact(path: string, format: 'hwpx' | 'srt', project: ScriptProject): Promise<string> {
  const invalid = (): never => { throw new Error('출력 파일 검사에 실패했습니다. 대본과 저장 위치를 확인한 뒤 다시 저장해 주세요.') }
  if (getExportGate(project, format).errors.length) invalid()
  if (format === 'srt') {
    const expected = buildSrtContent(project.rows, supportsSpeakerLabels(project))
    if (!expected.trim() || await readFile(path, 'utf8') !== expected) invalid()
  } else {
    try {
      const entries = await readZipEntries(path)
      if (entries.get('mimetype')?.toString() !== 'application/hwp+zip') invalid()
      const xml = entries.get('Contents/section0.xml')?.toString('utf8')
      if (!xml || !entries.has('Contents/content.hpf') || !entries.has('Preview/PrvText.txt')) invalid()
      const document = new DOMParser().parseFromString(xml!, 'application/xml')
      if (document.getElementsByTagName('parsererror').length) invalid()
      const rows = document.getElementsByTagName('hp:tr')
      if (rows.length !== project.rows.length + 1) invalid()
      project.rows.forEach((row, index) => {
        const cells = rows.item(index + 1)!.getElementsByTagName('hp:tc')
        if (cells.length !== 5) invalid()
        const expected = [row.kind === 'dialogue' ? '대사' : '해설', formatTimecode(row.startMs), formatTimecode(row.endMs)]
        expected.forEach((text, cell) => { if (cells.item(cell)?.textContent !== text) invalid() })
        const expectedContent = row.kind === 'descriptionGap' && !row.content.trim() ? DESCRIPTION_TEXT : row.content
        if (cells.item(4)?.textContent !== expectedContent.replace(/\r?\n/g, '')) invalid()
      })
    } catch { invalid() }
  }
  return fileSha256(path)
}
