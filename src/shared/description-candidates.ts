import { DESCRIPTION_CANDIDATE_TEXT, DESCRIPTION_GAP_MS } from './constants'
import type { ScriptRow } from './types'

const MAX_ROWS = 100_000

export function isUntouchedSubtitleGap(row: ScriptRow): boolean {
  return row.subtitleGapCandidate === true
    && row.kind === 'descriptionGap'
    && row.content === DESCRIPTION_CANDIDATE_TEXT
    && row.reviewed === false
    && row.reviewStatus !== 'approved'
    && Array.isArray(row.sourceSegmentIds)
    && row.sourceSegmentIds.length === 0
    && (row.sourceCueIds === undefined || (Array.isArray(row.sourceCueIds) && row.sourceCueIds.length === 0))
}

/** Fill unoccupied timeline space; a subtitle gap is not evidence of silence. */
export function addDescriptionCandidates(rows: ScriptRow[], durationMs: number): ScriptRow[] {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error('영상 길이는 음수가 아닌 정수 밀리초여야 합니다.')
  }
  if (!Array.isArray(rows)) throw new Error('대본 행 배열이 올바르지 않습니다.')
  if (rows.length > MAX_ROWS) throw new Error('대본 행은 100,000개를 초과할 수 없습니다.')
  for (const row of rows) {
    if (!row || typeof row !== 'object'
      || !Number.isSafeInteger(row.startMs) || !Number.isSafeInteger(row.endMs)
      || row.startMs < 0 || row.endMs <= row.startMs || row.endMs > durationMs) {
      throw new Error('대본 행 시간은 영상 범위 안의 올바른 정수 밀리초여야 합니다.')
    }
  }
  if (rows.length === 0) return []

  const sorted = [...rows].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  const output: ScriptRow[] = []
  const occupiedIds = new Set(rows.map(row => row.id))
  let candidateCount = 0

  function addCandidate(startMs: number, endMs: number): void {
    if (endMs - startMs < DESCRIPTION_GAP_MS) return
    if (rows.length + candidateCount >= MAX_ROWS) throw new Error('해설 후보를 포함한 대본 행은 100,000개를 초과할 수 없습니다.')
    const baseId = `subtitle-gap-${globalThis.crypto.randomUUID()}`
    let id = baseId
    let suffix = 1
    while (occupiedIds.has(id)) id = `${baseId}-${suffix++}`
    occupiedIds.add(id)
    output.push({
      id,
      kind: 'descriptionGap',
      startMs,
      endMs,
      speakers: [],
      content: DESCRIPTION_CANDIDATE_TEXT,
      sourceSegmentIds: [],
      sourceCueIds: [],
      reviewed: false,
      reviewStatus: 'unreviewed',
      subtitleGapCandidate: true
    })
    candidateCount += 1
  }

  let occupiedEndMs = 0
  for (const row of sorted) {
    addCandidate(occupiedEndMs, row.startMs)
    output.push(row)
    occupiedEndMs = Math.max(occupiedEndMs, row.endMs)
  }
  addCandidate(occupiedEndMs, durationMs)
  return output
}
