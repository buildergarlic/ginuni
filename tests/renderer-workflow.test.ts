import { describe, expect, it, vi } from 'vitest'
import { inspectInlineDraft, prepareEditedRows, savePendingEdits, scheduleDraftSave } from '../src/renderer/src/workflow-editing'
import type { ScriptProject, ScriptRow } from '../src/shared/types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOMParser } from '@xmldom/xmldom'
import { WorkflowPanel } from '../src/renderer/src/WorkflowPanel'
import { initialReviewFontSize } from '../src/renderer/src/App'

const row: ScriptRow = { id: 'one', kind: 'dialogue', startMs: 0, endMs: 1000, content: '원문', speakers: [], sourceSegmentIds: ['s1'], reviewed: true, reviewStatus: 'approved', approvedAt: 'today' }

describe('writer edits', () => {
  it('uses a readable new-profile font while preserving a saved writer preference', () => {
    expect(initialReviewFontSize(null)).toBe(16)
    expect(initialReviewFontSize('')).toBe(16)
    expect(initialReviewFontSize('20')).toBe(20)
    expect(initialReviewFontSize('11')).toBe(11)
  })
  it('commits the current focused draft and saves after the idle delay without any blur event', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      scheduleDraftSave(() => { events.push('commit'); return true }, async () => { events.push('save') }, () => {})
      await vi.advanceTimersByTimeAsync(699)
      expect(events).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(events).toEqual(['commit', 'save'])
    } finally { vi.useRealTimers() }
  })
  it('cancels stale timers and never saves an invalid draft', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const cancel = scheduleDraftSave(() => { events.push('stale'); return true }, async () => { events.push('save') }, () => {})
      cancel()
      scheduleDraftSave(() => false, async () => { events.push('invalid-save') }, () => {})
      await vi.advanceTimersByTimeAsync(1000)
      expect(events).toEqual([])
    } finally { vi.useRealTimers() }
  })
  it('recognizes a focused content draft as unsaved and revokes approval when committed without blur', async () => {
    const draft = { rowId: row.id, start: '00:00', end: '00:01', content: '계속 입력한 대사' }
    const inspected = inspectInlineDraft(row, draft)
    expect(inspected.pending).toBe(true)
    const edited = prepareEditedRows([row], [{ ...row, ...inspected.patch }])
    let savedContent = ''
    await savePendingEdits({ rows: { current: edited }, edited: { current: 1 }, saved: { current: 0 }, revision: { current: 0 } }, async (rows) => {
      savedContent = rows[0].content
      return { rows, workflow: { revision: 1 } } as ScriptProject
    }, () => {})
    expect(savedContent).toBe('계속 입력한 대사')
    expect(edited[0].reviewStatus).toBe('unreviewed')
  })
  it('keeps invalid time and accompanying text pending rather than partially saving or discarding them', () => {
    const draft = { rowId: row.id, start: '00:', end: '00:01', content: '함께 수정한 내용' }
    const inspected = inspectInlineDraft(row, draft)
    expect(inspected.pending).toBe(true)
    expect(inspected.patch).toBeNull()
    expect(inspected.errors.start).toBeTruthy()
    expect(draft).toEqual({ rowId: 'one', start: '00:', end: '00:01', content: '함께 수정한 내용' })
  })
  it('does not schedule another save for a draft matching the saved row', () => {
    const inspected = inspectInlineDraft(row, { rowId: row.id, start: '00:00', end: '00:01', content: '원문' })
    expect(inspected.pending).toBe(false)
  })
  it('keeps unchanged approvals but clears approval on changed and inserted rows', () => {
    const result = prepareEditedRows([row], [row, { ...row, id: 'two' }])
    expect(result[0].reviewStatus).toBe('approved')
    expect(result[1].reviewed).toBe(false)
    const changed = prepareEditedRows([row], [{ ...row, content: '수정' }])[0]
    expect(changed.reviewStatus).toBe('unreviewed')
    expect(changed.approvedAt).toBeUndefined()
  })
  it('saves edits made during an async save with the newly returned revision', async () => {
    const state = { rows: { current: [row] }, edited: { current: 1 }, saved: { current: 0 }, revision: { current: 4 } }
    const writes: { content: string; revision: number }[] = []
    const synchronized: string[] = []
    await savePendingEdits(state, async (rows, revision) => {
      writes.push({ content: rows[0].content, revision })
      if (writes.length === 1) {
        state.rows.current = [{ ...row, content: '저장 중 수정' }]
        state.edited.current = 2
      }
      return { rows, workflow: { revision: revision + 1 } } as ScriptProject
    }, (project) => synchronized.push(project.rows[0].content))
    expect(writes).toEqual([{ content: '원문', revision: 4 }, { content: '저장 중 수정', revision: 5 }])
    expect(synchronized).toEqual(['저장 중 수정'])
    expect(state.saved.current).toBe(2)
    expect(state.revision.current).toBe(6)
  })
  it('does not mark edits saved after a rejected save', async () => {
    const state = { rows: { current: [row] }, edited: { current: 1 }, saved: { current: 0 }, revision: { current: 4 } }
    await expect(savePendingEdits(state, async () => { throw new Error('conflict') }, () => {})).rejects.toThrow('conflict')
    expect(state.saved.current).toBe(0)
    expect(state.rows.current[0].content).toBe('원문')
  })
  it('does not enable paid correction until rights and separate text consent are saved', () => {
    const project: ScriptProject = { schemaVersion: 1, id: 'p', title: '작품', createdAt: 'now', updatedAt: 'now', status: 'review', localDiarization: { mode: 'none', speakerCount: null }, source: { kind: 'local', uri: 'local.mp4', displayName: 'local' }, media: { durationMs: 1000 }, segments: [], rows: [row], runs: [], exports: [], workflow: { version: 1, revision: 0, consent: { cloudCorrectionConsentAt: 'today' }, proposals: [], events: [] } }
    const markup = renderToStaticMarkup(createElement(WorkflowPanel, { project, rows: [row], selected: row, busy: false, mutate: async () => {}, action: async () => {}, choose: () => {}, seek: () => {} }))
    const document = new DOMParser().parseFromString(markup, 'text/html')
    const button = Array.from(document.getElementsByTagName('button')).find((element) => element.textContent?.includes('교정 요청'))
    expect(button?.hasAttribute('disabled')).toBe(true)
  })
})
