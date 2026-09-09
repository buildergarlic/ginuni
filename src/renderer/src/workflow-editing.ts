import type { ScriptProject, ScriptRow } from '@shared/types'
import { formatTimecode, parseTimecode } from '@shared/timecode'

export function scheduleDraftSave(commit: () => boolean, save: () => Promise<void>, onError: (error: unknown) => void): () => void {
  const timer = setTimeout(() => {
    if (commit()) void save().catch(onError)
  }, 700)
  return () => clearTimeout(timer)
}

export function inspectInlineDraft(row: ScriptRow, draft: { start: string; end: string; content: string; rowId: string }): {
  pending: boolean
  patch: Pick<ScriptRow, 'startMs' | 'endMs' | 'content'> | null
  errors: { start?: string; end?: string }
} {
  const startMs = draft.start === formatTimecode(row.startMs) ? row.startMs : parseTimecode(draft.start)
  const endMs = draft.end === formatTimecode(row.endMs) ? row.endMs : parseTimecode(draft.end)
  const errors: { start?: string; end?: string } = {}
  if (startMs === null) errors.start = '시작 시간은 MM:SS 또는 MM:SS.sss 형식으로 입력하세요. (예: 00:10.500)'
  if (endMs === null) errors.end = '종료 시간은 MM:SS 또는 MM:SS.sss 형식으로 입력하세요. (예: 00:10.500)'
  if (startMs !== null && endMs !== null && endMs <= startMs) errors.end = '종료 시간은 시작 시간보다 커야 합니다.'
  return {
    pending: startMs !== row.startMs || endMs !== row.endMs || draft.content !== row.content,
    patch: startMs === null || endMs === null || errors.end ? null : { startMs, endMs, content: draft.content },
    errors
  }
}

export function prepareEditedRows(previous: ScriptRow[], next: ScriptRow[]): ScriptRow[] {
  return next.map((row) => {
    const before = previous.find((entry) => entry.id === row.id)
    if (before && before.kind === row.kind && before.startMs === row.startMs && before.endMs === row.endMs && before.content === row.content && JSON.stringify(before.speakers) === JSON.stringify(row.speakers) && JSON.stringify(before.sourceSegmentIds) === JSON.stringify(row.sourceSegmentIds)) return before
    return { ...row, reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined }
  })
}

type Ref<T> = { current: T }
export async function savePendingEdits(
  state: { rows: Ref<ScriptRow[]>; edited: Ref<number>; saved: Ref<number>; revision: Ref<number> },
  save: (rows: ScriptRow[], revision: number) => Promise<ScriptProject>,
  synchronize: (project: ScriptProject) => void
): Promise<void> {
  while (state.saved.current < state.edited.current) {
    const version = state.edited.current
    const project = await save(state.rows.current, state.revision.current)
    state.revision.current = project.workflow?.revision ?? 0
    state.saved.current = version
    if (version === state.edited.current) synchronize(project)
  }
}
