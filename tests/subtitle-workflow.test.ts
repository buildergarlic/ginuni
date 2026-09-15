import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
import * as store from '@main/services/project-store'
import { previewSubtitleFile, applySubtitleImport, shiftSubtitleRows, discardSubtitlePreview, addProjectDescriptionCandidates } from '@main/services/subtitle-ingestion'
import { getReviewIssues } from '@shared/workflow'
import { resolveExportProvenance, getExportGate } from '@main/services/export-workflow'
import { buildSrtContent } from '@main/services/srt'

beforeEach(async () => { state.directory = await mkdtemp(join(tmpdir(), 'ginuni-subtitle-workflow-')) })
afterEach(async () => { await rm(state.directory, { recursive: true, force: true }) })
async function fixture(rights = true) {
  const mediaPath = join(state.directory, '영화.mp4')
  await writeFile(mediaPath, 'public test media')
  let project = await store.createProject({ kind: 'local', localPath: mediaPath, rightsConfirmed: rights })
  project = await store.updateProject(project.id, p => {
    p.media.durationMs = 10000
    p.source.sha256 = createHash('sha256').update('public test media').digest('hex')
    p.rows = [{ id: 'authored', kind: 'descriptionGap', startMs: 0, endMs: 1000, content: '작가가 쓴 해설', sourceSegmentIds: [], speakers: [], reviewed: false }]
  })
  const subtitlePath = join(state.directory, '한국어.srt')
  await writeFile(subtitlePath, '1\n00:00:01,250 --> 00:00:02,875\n안녕하세요.\n두 번째 줄\n\n2\n00:00:03,050 --> 00:00:03,600\n반갑습니다.\n')
  return { project, subtitlePath, mediaPath }
}

it('imports exact cues, preserves raw bytes and authored snapshot, saves references and exports subtitle provenance', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  const imported = await applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)
  expect(imported.rows.map(r => [r.startMs, r.endMs])).toEqual([[1250, 2875], [3050, 3600], [3600, 10000]])
  expect(imported.rows[2]).toMatchObject({ kind: 'descriptionGap', subtitleGapCandidate: true, reviewed: false, sourceCueIds: [] })
  expect(imported.runs).toEqual([])
  expect(imported.rows[0].sourceCueIds).toEqual([preview.cues[0].id])
  expect(getReviewIssues(imported).some(i => ['ROW_SOURCE', 'ROW_SOURCE_MISSING', 'ROW_SPEAKER'].includes(i.code))).toBe(false)
  expect(getExportGate(imported, 'srt').errors).toEqual([])
  expect(resolveExportProvenance(imported, 'srt')).toMatchObject({ sourceProvenance: 'resolved', sourceAssetIds: [preview.asset.id] })
  expect(buildSrtContent(imported.rows, false)).toContain('00:00:01,250 --> 00:00:02,875\r\n안녕하세요.\n두 번째 줄')
  const saved = await store.saveRows(imported.id, [{ ...imported.rows[0], content: '작가 수정' }, imported.rows[1]], imported.workflow!.revision)
  expect((await store.loadProject(saved.id)).rows[0].sourceCueIds).toEqual([preview.cues[0].id])
  const rawPath = join(await store.projectDirectory(saved.id), saved.subtitleWorkspace!.assets[0].originalRelativePath)
  expect(await readFile(rawPath, 'utf8')).toBe(await readFile(subtitlePath, 'utf8'))
  const snapshot = (await store.listSnapshots(saved.id)).find(s => s.reason === '자막 가져오기 전')!
  expect(snapshot).toBeTruthy()
  const restored = await store.restoreSnapshot(saved.id, snapshot.id, saved.workflow!.revision)
  expect(restored.rows[0].content).toBe('작가가 쓴 해설')
  expect(restored.subtitleWorkspace!.assets).toHaveLength(1)
})

it('fills an existing draft without changing authored rows, is idempotent and snapshots the original', async () => {
  const { project } = await fixture()
  const filled = await addProjectDescriptionCandidates(project.id, project.workflow!.revision)
  expect(filled.rows[0]).toEqual(project.rows[0])
  expect(filled.rows[1]).toMatchObject({ kind: 'descriptionGap', startMs: 1000, endMs: 10000, subtitleGapCandidate: true })
  const again = await addProjectDescriptionCandidates(project.id, filled.workflow!.revision)
  expect(again.rows).toEqual(filled.rows)
  const snapshots = (await store.listSnapshots(project.id)).filter(s => s.reason === '해설 후보 추가 전')
  expect(snapshots).toHaveLength(1)
  const restored = await store.restoreSnapshot(project.id, snapshots[0].id, again.workflow!.revision)
  expect(restored.rows).toEqual(project.rows)
})

it('keeps automatic markers server controlled and protects an edited candidate during a subtitle shift', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  let draft = await applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)
  const unchanged = await store.saveRows(draft.id, draft.rows, draft.workflow!.revision)
  expect(unchanged.rows[2].subtitleGapCandidate).toBe(true)
  draft = await store.saveRows(draft.id, unchanged.rows.map((row, i) => i === 2 ? { ...row, content: '작가가 새로 쓴 해설' } : { ...row, subtitleGapCandidate: true }), unchanged.workflow!.revision)
  expect(draft.rows.every(row => row.subtitleGapCandidate !== true)).toBe(true)
  await expect(shiftSubtitleRows(draft.id, [draft.rows[1].id], 100, draft.workflow!.revision)).rejects.toThrow(/겹/)
  expect((await store.loadProject(draft.id)).rows).toEqual(draft.rows)
})

it('rebuilds untouched candidates around shifted dialogue and restores the entire prior timeline', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  const draft = await applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)
  const shifted = await shiftSubtitleRows(draft.id, draft.rows.filter(r => r.kind === 'dialogue').map(r => r.id), 100, draft.workflow!.revision)
  expect(shifted.rows.map(r => [r.startMs, r.endMs])).toEqual([[1350, 2975], [3150, 3700], [3700, 10000]])
  expect(shifted.rows[2].subtitleGapCandidate).toBe(true)
  expect(shifted.workflow!.events.at(-1)!.changes!.some(c => c.before?.subtitleGapCandidate)).toBe(true)
  const snapshot = (await store.listSnapshots(draft.id)).find(s => s.reason === '자막 시간 이동 전')!
  const restored = await store.restoreSnapshot(draft.id, snapshot.id, shifted.workflow!.revision)
  expect(restored.rows).toEqual(draft.rows)
})

it('keeps a confirmed candidate fixed even if the writer later clears its approval', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  let draft = await applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)
  const candidateId = draft.rows[2].id
  draft = await store.reviewRows(draft.id, [candidateId], true, draft.workflow!.revision)
  expect(draft.rows[2].subtitleGapCandidate).toBeUndefined()
  draft = await store.reviewRows(draft.id, [candidateId], false, draft.workflow!.revision)
  await expect(shiftSubtitleRows(draft.id, [draft.rows[1].id], 100, draft.workflow!.revision)).rejects.toThrow(/겹/)
  expect((await store.loadProject(draft.id)).rows).toEqual(draft.rows)
})

it('blocks missing rights, stale revisions, changed subtitles and changed source media without replacing existing work', async () => {
  const denied = await fixture(false)
  await expect(previewSubtitleFile(denied.project.id, denied.subtitlePath, denied.project.workflow!.revision)).rejects.toThrow(/권한/)
  const { project, subtitlePath, mediaPath } = await fixture()
  await expect(previewSubtitleFile(project.id, subtitlePath, 0)).rejects.toThrow(/변경|revision/)
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  await writeFile(subtitlePath, 'different')
  await expect(applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)).rejects.toThrow(/변경/)
  expect((await store.loadProject(project.id)).rows[0].content).toBe('작가가 쓴 해설')
  await writeFile(subtitlePath, '1\n00:00:01,000 --> 00:00:02,000\n대사\n')
  const again = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  await writeFile(mediaPath, 'changed cut')
  await expect(applySubtitleImport(project.id, again.previewId, 0, [], project.workflow!.revision)).rejects.toThrow(/원본|영상.*변경/)
  expect((await store.loadProject(project.id)).workflow!.revision).toBe(project.workflow!.revision)
})

it('applies hour-origin offset once, can shift current rows atomically and restores source references', async () => {
  const { project, subtitlePath } = await fixture()
  await writeFile(subtitlePath, '1\n01:00:01,250 --> 01:00:02,875\n대사\n')
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  let imported = await applySubtitleImport(project.id, preview.previewId, -3600000, [], project.workflow!.revision)
  imported = await store.reviewRows(imported.id, [imported.rows[0].id], true, imported.workflow!.revision)
  const original = await store.snapshotProject(imported, '원래 자막')
  const shifted = await shiftSubtitleRows(imported.id, [imported.rows[0].id], 100, imported.workflow!.revision)
  expect(shifted.rows[0]).toMatchObject({ startMs: 1350, endMs: 2975, reviewStatus: 'unreviewed' })
  expect((await store.loadProject(shifted.id)).rows[0].startMs).toBe(1350)
  await expect(shiftSubtitleRows(shifted.id, [shifted.rows[0].id], -5000, shifted.workflow!.revision)).rejects.toThrow()
  const restored = await store.restoreSnapshot(shifted.id, original.id, shifted.workflow!.revision)
  expect(restored.rows[0].startMs).toBe(1250)
  expect(restored.rows[0].sourceCueIds).toEqual([preview.cues[0].id])
  expect(restored.subtitleWorkspace!.cues[0].startMs).toBe(3601250)
})

it('discarded previews cannot be applied and preview is bound to its project', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  const another = await fixture()
  await expect(applySubtitleImport(another.project.id, preview.previewId, 0, [], another.project.workflow!.revision)).rejects.toThrow()
  discardSubtitlePreview(project.id, preview.previewId)
  await expect(applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)).rejects.toThrow()
})

it('refuses unsupported future schema without rewriting its contents', async () => {
  const { project } = await fixture()
  const path = join(await store.projectDirectory(project.id), 'project.json')
  const content = JSON.stringify({ ...project, schemaVersion: 999 })
  await writeFile(path, content)
  await expect(store.loadProject(project.id)).rejects.toThrow(/버전/)
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('rejects fractional milliseconds and out-of-video edits without changing the saved draft', async () => {
  const { project, subtitlePath } = await fixture()
  const preview = await previewSubtitleFile(project.id, subtitlePath, project.workflow!.revision)
  const imported = await applySubtitleImport(project.id, preview.previewId, 0, [], project.workflow!.revision)
  await expect(store.saveRows(imported.id, [{ ...imported.rows[0], startMs: 1250.5 }, imported.rows[1]], imported.workflow!.revision)).rejects.toThrow()
  await expect(store.saveRows(imported.id, [imported.rows[0], { ...imported.rows[1], endMs: 10001 }], imported.workflow!.revision)).rejects.toThrow()
  expect((await store.loadProject(imported.id)).rows).toEqual(imported.rows)
})
