import { generateSubtitleRows, validateSubtitleRows } from '@shared/subtitle-rows'
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
  const rows = generateSubtitleRows(preview.cues, offsetMs, resolutions)
  const effectiveIssues = validateSubtitleRows(rows, preview.durationMs)
  const rawBlockingIssues = preview.issues.filter((issue) => issue.severity === 'error' && issue.code !== 'overlap')
  const blockingIssues = [...rawBlockingIssues, ...effectiveIssues.filter((issue) => issue.severity === 'error')]
  return { rows, effectiveIssues, blockingIssues, overlapGroups: collectOverlapGroups(rows) }
}
