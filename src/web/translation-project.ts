import type { ScriptRow } from '../shared/types'
import type { RowTranslation, WebProject, WebScriptRow } from './project'

export interface TranslationResult {
  rowId: string
  sourceContent: string
  content: string
}

function clearReview<T extends ScriptRow>(row: T): T {
  return { ...row, reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined }
}

function clearTranslationReview(translation: RowTranslation): RowTranslation {
  return { ...translation, reviewed: false, approvedAt: undefined }
}

/** Display/export projection only. Never save these rows as the canonical source. */
export function displayRows(project: WebProject): ScriptRow[] {
  return project.rows.map(({ translation, ...row }) => {
    if (project.dialogueLanguage !== 'korean' || row.kind !== 'dialogue') return row
    const reviewed = Boolean(translation?.reviewed && translation.sourceContent === row.content)
    return {
      ...row,
      content: translation?.content ?? row.content,
      reviewed,
      reviewStatus: reviewed ? 'approved' : 'unreviewed',
      approvedAt: reviewed ? translation?.approvedAt : undefined
    }
  })
}

/** Merge edits from the selected language; keep source text and translation snapshots separate. */
export function mergeDisplayedRows(project: WebProject, incoming: ScriptRow[]): WebScriptRow[] {
  const existing = new Map(project.rows.map(row => [row.id, row]))
  const ids = new Set<string>()
  return incoming.map(item => {
    if (ids.has(item.id)) throw new Error('대본 행 ID가 중복되었습니다.')
    ids.add(item.id)
    // A projected row may have been spread by a caller. Its translation object is never trusted.
    const { translation: ignored, ...shown } = item as WebScriptRow
    const original = existing.get(shown.id)
    if (!original) {
      if (project.dialogueLanguage === 'korean' && shown.kind === 'dialogue') {
        return {
          ...clearReview(shown), content: '',
          translation: { sourceContent: '', content: shown.content, draft: '', reviewed: false }
        }
      }
      return shown
    }
    const sharedChanged = shown.startMs !== original.startMs || shown.endMs !== original.endMs ||
      shown.kind !== original.kind || shown.speakers.length !== original.speakers.length ||
      shown.speakers.some((speaker, index) => speaker !== original.speakers[index])
    let next: WebScriptRow = { ...original, ...shown, translation: original.translation }
    if (project.dialogueLanguage === 'korean' && original.kind === 'dialogue') {
      // The incoming content/review fields describe Korean, even when changing row kind.
      next = { ...next, content: original.content, reviewed: original.reviewed,
        reviewStatus: original.reviewStatus, approvedAt: original.approvedAt }
      const prior = original.translation
      if (prior || shown.content !== original.content) {
        const contentChanged = shown.content !== (prior?.content ?? original.content)
        const translation: RowTranslation = {
          sourceContent: prior?.sourceContent ?? original.content,
          content: shown.content,
          draft: prior?.draft ?? '',
          reviewed: prior ? shown.reviewed : false,
          approvedAt: prior && shown.reviewed ? shown.approvedAt : undefined
        }
        next.translation = contentChanged || sharedChanged || translation.sourceContent !== original.content
          ? clearTranslationReview(translation) : translation
      }
      if (sharedChanged) next = clearReview(next)
    } else if (sharedChanged || shown.content !== original.content) {
      next = clearReview(next)
      if (next.translation) next.translation = clearTranslationReview(next.translation)
    }
    return next
  })
}

/** All nonblank dialogue must succeed against the current source before any result is applied. */
export function applyTranslations(project: WebProject, results: TranslationResult[]): WebProject {
  const eligible = new Map(project.rows.filter(row => row.kind === 'dialogue' && row.content.trim()).map(row => [row.id, row]))
  if (!eligible.size) throw new Error('번역할 원문 대사가 없습니다.')
  const completed = new Map<string, TranslationResult>()
  for (const result of results) {
    if (completed.has(result.rowId)) throw new Error('번역 결과의 행 ID가 중복되었습니다.')
    const source = eligible.get(result.rowId)
    if (!source) throw new Error('번역 대상과 결과가 일치하지 않습니다. 현재 대본은 유지됩니다.')
    if (result.sourceContent !== source.content) throw new Error('번역 중 원문이 변경되었습니다. 현재 대본은 유지됩니다.')
    if (typeof result.content !== 'string' || !result.content.trim() || result.content.length > 10_000)
      throw new Error('번역 결과가 비어 있거나 10,000자를 초과했습니다. 현재 대본은 유지됩니다.')
    completed.set(result.rowId, result)
  }
  if (completed.size !== eligible.size) throw new Error('일부 대사의 번역이 누락되었습니다. 현재 대본은 유지됩니다.')
  return {
    ...project,
    dialogueLanguage: 'korean',
    rows: project.rows.map(row => {
      const result = completed.get(row.id)
      return result ? { ...row, translation: {
        sourceContent: result.sourceContent, content: result.content,
        draft: result.content, reviewed: false
      } } : row
    })
  }
}

/** Restore a row (or all rows) to its translation draft without altering source text or timestamps. */
export function restoreTranslationDraft(project: WebProject, rowId?: string): WebProject {
  if (rowId !== undefined && !project.rows.some(row => row.id === rowId && row.translation?.draft.trim()))
    throw new Error('복원할 번역 초안을 찾을 수 없습니다.')
  return {
    ...project,
    rows: project.rows.map(row => row.translation?.draft.trim() && (rowId === undefined || row.id === rowId)
      ? { ...row, translation: clearTranslationReview({ ...row.translation, content: row.translation.draft }) }
      : row)
  }
}
