import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScriptProject } from '@shared/types'
import { getExportGate, resolveExportProvenance, validateExportArtifact } from '@main/services/export-workflow'
import { buildHwpx } from '@main/services/hwpx'
import { buildSrtContent } from '@main/services/srt'
import { readZipEntries } from '@main/services/zip'
const electronState = vi.hoisted(() => ({ documentsPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.documentsPath } }))
import { createProject, loadProject, restoreSnapshot, snapshotProject, updateProject } from '@main/services/project-store'
import { executeVerifiedAnalysis } from '@main/services/analysis-workflow'

const temporary: string[] = []
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }) })
function project(): ScriptProject {
  return { schemaVersion: 2, id: 'p', title: '검증', createdAt: '', updatedAt: '', status: 'review',
    transcriptionEngine: 'local', localDiarization: { mode: 'none', speakerCount: null },
    source: { kind: 'local', uri: 'sample.wav', displayName: 'sample' }, media: { durationMs: 3000 },
    segments: [{ id: 's', startMs: 0, endMs: 1000, speakerId: '', text: '안녕하세요' }],
    rows: [
      { id: 'r', kind: 'dialogue', startMs: 0, endMs: 1000, content: '안녕하세요', speakers: [], sourceSegmentIds: ['s'], reviewed: false, reviewStatus: 'unreviewed' },
      { id: 'a', kind: 'descriptionGap', startMs: 1000, endMs: 3000, content: '창밖으로 눈이 내린다.', speakers: [], sourceSegmentIds: [], reviewed: false, reviewStatus: 'unreviewed' }
    ], runs: [], exports: [] }
}
describe('export gates and actual artifact checks', () => {
  it('persists provenance for A after real analysis A, analysis B, snapshot restore A, and SRT export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginuni-restored-export-')); temporary.push(directory)
    electronState.documentsPath = directory
    const created = await createProject({ kind: 'local', localPath: join(directory, 'fixture.wav'), rightsConfirmed: true })
    const analyze = (sourceId: string) => executeVerifiedAnalysis(created.id, {
      store: { update: updateProject, snapshot: snapshotProject }, model: sourceId, signal: new AbortController().signal,
      analyze: async draft => { draft.media.durationMs = 1000; draft.segments = [{ id: sourceId, startMs: 0, endMs: 1000, text: sourceId, speakerId: '' }] }
    })
    const a = await analyze('source-a')
    const snapshot = await snapshotProject(a, 'A')
    const b = await analyze('source-b')
    const restored = await restoreSnapshot(created.id, snapshot.id, b.workflow!.revision)
    expect(restored.rows[0].content).toBe('source-a')
    expect(restored.segments[0].id).toBe('source-b')
    const path = join(directory, 'restored.srt')
    await writeFile(path, buildSrtContent(restored.rows, false), 'utf8')
    const sha256 = await validateExportArtifact(path, 'srt', restored)
    await updateProject(created.id, live => {
      live.exports.push({ path, sha256, exportedAt: '2026-09-09', appVersion: 'test', format: 'srt', ...resolveExportProvenance(restored, 'srt') })
    })
    const saved = await loadProject(created.id)
    expect(saved.exports[0]).toMatchObject({ runId: a.runs[0].id, sourceRunIds: [a.runs[0].id], sourceProvenance: 'resolved' })
    expect(saved.exports[0].sourceRunIds).not.toContain(b.runs[1].id)
  })
  it('rejects positive numeric intervals that collapse at output millisecond precision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginuni-collapse-')); temporary.push(directory)
    const path = join(directory, 'collapsed.hwpx')
    const p = project()
    p.rows = [{ ...p.rows[0], startMs: 100.1, endMs: 100.4 }]
    await buildHwpx({ outputPath: path, templatePath: resolve('resources/templates/screen-description-template.hwpx'), title: p.title, rows: p.rows })
    expect(getExportGate(p, 'hwpx').errors.length).toBeGreaterThan(0)
    await expect(validateExportArtifact(path, 'hwpx', p)).rejects.toThrow(/검사/)
  })
  it('resolves archived row sources instead of the latest successful analysis', () => {
    const p = project()
    p.runs = [
      { id: 'A', startedAt: '', provider: 'local', model: 'a', outcome: 'succeeded', sourceSegments: p.segments },
      { id: 'B', startedAt: '', provider: 'local', model: 'b', outcome: 'succeeded', sourceSegments: [{ ...p.segments[0], id: 'b' }] }
    ]
    p.segments = p.runs[1].sourceSegments!
    expect(resolveExportProvenance(p, 'srt')).toMatchObject({ runId: 'A', sourceRunIds: ['A'], sourceProvenance: 'resolved' })
    expect(resolveExportProvenance(p, 'hwpx')).toMatchObject({ sourceProvenance: 'partial', sourceRunIds: ['A'], unattributedRowIds: ['a'] })
    expect(resolveExportProvenance(p, 'hwpx').runId).toBeUndefined()
    p.rows[1].sourceSegmentIds = ['b']
    expect(resolveExportProvenance(p, 'hwpx')).toMatchObject({ sourceProvenance: 'multiple', sourceRunIds: ['A', 'B'] })
    p.rows[0].sourceSegmentIds = ['missing']
    expect(resolveExportProvenance(p, 'srt')).toMatchObject({ sourceProvenance: 'unavailable', sourceRunIds: [], unresolvedSourceSegmentIds: ['missing'] })
  })

  it.each([[10_000, 10_500, '00:10', '00:10.500'], [0, 400, '00:00', '00:00.400']])('preserves short row endpoints in actual HWPX: %s–%s', async (startMs, endMs, startText, endText) => {
    const directory = await mkdtemp(join(tmpdir(), 'ginuni-fractional-')); temporary.push(directory)
    const path = join(directory, 'short.hwpx')
    const p = project()
    p.media.durationMs = endMs
    p.rows = [{ ...p.rows[0], startMs, endMs }]
    await buildHwpx({ outputPath: path, templatePath: resolve('resources/templates/screen-description-template.hwpx'), title: p.title, rows: p.rows })
    const xml = (await readZipEntries(path)).get('Contents/section0.xml')!.toString('utf8')
    expect(xml).toContain(`>${startText}<`)
    expect(xml).toContain(`>${endText}<`)
    expect(await validateExportArtifact(path, 'hwpx', p)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('warns for unapproved rows but blocks broken times', () => {
    const p = project()
    expect(getExportGate(p, 'hwpx').unreviewedCount).toBe(2)
    expect(getExportGate(p, 'hwpx').errors).toEqual([])
    p.rows[1].endMs = Number.NaN
    expect(getExportGate(p, 'hwpx').errors.length).toBeGreaterThan(0)
  })
  it('does not count an excluded description row as unreviewed in a dialogue-only SRT', () => {
    const p = project()
    p.rows[0].reviewed = true
    p.rows[0].reviewStatus = 'approved'
    p.rows[0].approvedAt = '2026-09-09T00:00:00.000Z'
    expect(getExportGate(p, 'srt').unreviewedCount).toBe(0)
  })
  it('verifies the exported SRT content, not only the filename extension', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginuni-export-gate-')); temporary.push(directory)
    const path = join(directory, 'result.srt')
    const p = project()
    await writeFile(path, buildSrtContent(p.rows, false), 'utf8')
    expect(await validateExportArtifact(path, 'srt', p)).toMatch(/^[a-f0-9]{64}$/)
    await writeFile(path, 'broken', 'utf8')
    await expect(validateExportArtifact(path, 'srt', p)).rejects.toThrow(/검사/)
  })
  it('verifies HWPX XML rows and preserves authored descriptions in the real output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginuni-export-gate-')); temporary.push(directory)
    const path = join(directory, 'result.hwpx')
    const p = project()
    await buildHwpx({ outputPath: path, templatePath: resolve('resources/templates/screen-description-template.hwpx'), title: p.title, rows: p.rows })
    expect(await validateExportArtifact(path, 'hwpx', p)).toMatch(/^[a-f0-9]{64}$/)
    p.rows[1].content = '완전히 다른 해설'
    await expect(validateExportArtifact(path, 'hwpx', p)).rejects.toThrow(/검사/)
  })
})
