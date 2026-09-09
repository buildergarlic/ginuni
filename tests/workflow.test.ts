import { describe, expect, it } from 'vitest'
import * as workflow from '@shared/workflow'
import type { ScriptProject, ScriptRow } from '@shared/types'

const row: ScriptRow = { id: 'r', kind: 'dialogue', startMs: 0, endMs: 1000, speakers: [], content: '말', sourceSegmentIds: ['s'], reviewed: true }
const project = (): ScriptProject => ({ schemaVersion: 2, id: 'p', title: 't', createdAt: '', updatedAt: '', status: 'review', localDiarization: { mode: 'none', speakerCount: null }, source: { kind: 'local', uri: '', displayName: '' }, media: { durationMs: 2000 }, segments: [{ id: 's', startMs: 0, endMs: 1000, text: '말', speakerId: '' }], rows: [{ ...row }], runs: [], exports: [] })

describe('workflow checks', () => {
  it('migrates old edited flags without inventing writer approval', () => {
    const migrated = workflow.normalizeWorkflow(project())
    expect(migrated.workflow?.revision).toBe(0)
    expect(workflow.rowReviewStatus(migrated.rows[0])).toBe('unreviewed')
    expect(migrated.rows[0].reviewed).toBe(false)
    expect(workflow.normalizeWorkflow(migrated)).toEqual(migrated)
  })
  it('reports structural errors separately from semantic review warnings', () => {
    const p = project()
    p.rows[0] = { ...row, endMs: 3000, content: '', sourceSegmentIds: ['missing'] }
    expect(workflow.getReviewIssues(p).filter(x => x.severity === 'error').map(x => x.code)).toEqual(expect.arrayContaining(['ROW_DURATION', 'ROW_TEXT', 'ROW_SOURCE']))
    expect(workflow.getReviewIssues(project()).some(x => x.code === 'REVIEW_PENDING' && x.severity === 'warning')).toBe(true)
  })
  it('rejects nonfinite, inverted and unordered recognition segments', () => {
    const segments = [{ id: 's', startMs: 1000, endMs: 500, text: '말', speakerId: '' }, { id: 't', startMs: 0, endMs: Infinity, text: '', speakerId: '' }]
    expect(workflow.validateSegments(segments, 2000).map(x => x.code)).toEqual(expect.arrayContaining(['SEGMENT_TIME', 'SEGMENT_ORDER', 'SEGMENT_TEXT']))
  })
  it('accepts archived source references and warns for manually authored dialogue without a source', () => {
    const p = project()
    p.runs = [{ id: 'old', startedAt: '', provider: 'local', model: 'm', sourceSegments: p.segments }]
    p.segments = []
    expect(workflow.getReviewIssues(p).filter(i => i.code === 'ROW_SOURCE')).toEqual([])
    p.rows[0].sourceSegmentIds = []
    expect(workflow.getReviewIssues(p).filter(i => i.severity === 'error')).toEqual([])
    expect(workflow.getReviewIssues(p).some(i => i.code === 'ROW_SOURCE_MISSING' && i.severity === 'warning')).toBe(true)
  })
})
