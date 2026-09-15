import { generateSubtitleRows, validateSubtitleRows } from '@shared/subtitle-rows'
import { addDescriptionCandidates } from '@shared/description-candidates'
import type { ScriptRow } from '@shared/types'
import type { SubtitleIssue, SubtitlePreview, SubtitleResolution } from '@shared/subtitle-types'

export type SubtitleOverlapGroup = {
  rows: ScriptRow[]
  cueIds: string[]
  startMs: number
  endMs: number
}

function collectOverlapGroups(rows: ScriptRow[]): SubtitleOverlapGroup[] {
  const ordered = [...rows].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  const groups: ScriptRow[][] = []
  let current: ScriptRow[] = []
  let furthestEnd = -1

  for (const row of ordered) {
    if (current.length > 0 && row.startMs < furthestEnd) {
      current.push(row)
      furthestEnd = Math.max(furthestEnd, row.endMs)
      continue
    }
    if (current.length > 1) groups.push(current)
    current = [row]
    furthestEnd = row.endMs
  }
  if (current.length > 1) groups.push(current)

  return groups.map((group) => ({
    rows: group,
    cueIds: [...new Set(group.flatMap((row) => row.sourceCueIds ?? []))],
    startMs: Math.min(...group.map((row) => row.startMs)),
    endMs: Math.max(...group.map((row) => row.endMs))
  }))
}

export function resolutionForOverlap(group: SubtitleOverlapGroup): SubtitleResolution {
  return {
    cueIds: group.cueIds,
    startMs: group.startMs,
    endMs: group.endMs,
    reason: '겹치는 자막 그룹을 명시적으로 합침'
  }
}

export function buildSubtitlePreviewState(preview: SubtitlePreview, offsetMs: number, resolutions: SubtitleResolution[]): {
  rows: ScriptRow[]
  effectiveIssues: SubtitleIssue[]
  blockingIssues: SubtitleIssue[]
  overlapGroups: SubtitleOverlapGroup[]
} {
  const dialogueRows = generateSubtitleRows(preview.cues, offsetMs, resolutions)
  const effectiveIssues = validateSubtitleRows(dialogueRows, preview.durationMs)
  const rawBlockingIssues = preview.issues.filter((issue) => issue.severity === 'error' && issue.code !== 'overlap')
  const blockingIssues = [...rawBlockingIssues, ...effectiveIssues.filter((issue) => issue.severity === 'error')]
  const overlapGroups = collectOverlapGroups(dialogueRows)
  let rows = dialogueRows
  if (dialogueRows.length > 0 && blockingIssues.length === 0 && overlapGroups.length === 0) {
    try {
      rows = addDescriptionCandidates(dialogueRows, preview.durationMs)
    } catch (cause) {
      const issue: SubtitleIssue = {
        code: 'range', severity: 'error',
        message: cause instanceof Error ? cause.message : '해설 후보를 준비할 수 없습니다. 자막의 시간과 개수를 확인하세요.'
      }
      effectiveIssues.push(issue)
      blockingIssues.push(issue)
    }
  }
  return { rows, effectiveIssues, blockingIssues, overlapGroups }
}
