import { rowReviewStatus } from '@shared/workflow'
import type { ScriptRow } from '@shared/types'

export function nextUnreviewedRow(rows: ScriptRow[], currentId: string): ScriptRow | undefined {
  const index = rows.findIndex((row) => row.id === currentId)
  return rows.slice(index + 1).find((row) => rowReviewStatus(row) !== 'approved')
    ?? rows.slice(0, index + 1).find((row) => rowReviewStatus(row) !== 'approved')
}

export function scrollTopToRevealRow(scrollTop: number, viewportHeight: number, rowTop: number, rowHeight: number, headerHeight: number): number {
  const visibleTop = scrollTop + headerHeight
  // Tall rows must start below the sticky heading so the writer sees their beginning.
  if (rowHeight > viewportHeight - headerHeight || rowTop < visibleTop) {
    return Math.max(0, rowTop - headerHeight)
  }
  if (rowTop + rowHeight > scrollTop + viewportHeight) {
    return Math.max(0, rowTop + rowHeight - viewportHeight)
  }
  return scrollTop
}
