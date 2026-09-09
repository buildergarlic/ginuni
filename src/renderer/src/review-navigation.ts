import { rowReviewStatus } from '@shared/workflow'
import type { ScriptRow } from '@shared/types'

export function nextUnreviewedRow(rows: ScriptRow[], currentId: string): ScriptRow | undefined {
  const index = rows.findIndex((row) => row.id === currentId)
  return rows.slice(index + 1).find((row) => rowReviewStatus(row) !== 'approved')
    ?? rows.slice(0, index + 1).find((row) => rowReviewStatus(row) !== 'approved')
}
