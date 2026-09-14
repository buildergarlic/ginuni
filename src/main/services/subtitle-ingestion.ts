import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { ScriptProject } from '@shared/types'
import type { SubtitlePreview, SubtitlePreviewOptions, SubtitleResolution } from '@shared/subtitle-types'
import { generateSubtitleRows, validateSubtitleCues, validateSubtitleRows } from '@shared/subtitle-rows'
import { decodeSubtitleBytes, parseSrt } from './subtitle-import'
import { loadProject, projectDirectory, snapshotProject, updateProject } from './project-store'
import { fileSha256 } from './file-hash'
import { inspectLocalMedia } from './media-inspection'

interface PendingPreview { projectId: string; filePath: string; mediaHash: string; preview: SubtitlePreview; bytes: Buffer; expiresAt: number }
const pending = new Map<string, PendingPreview>()
const MAX_BYTES = 5 * 1024 * 1024
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const abort = (signal?: AbortSignal): void => { if (signal?.aborted) throw new DOMException('작업이 취소되었습니다. 기존 대본은 유지됩니다.', 'AbortError') }
const checkRevision = (project: ScriptProject, expected: number): void => {
  if (!Number.isSafeInteger(expected) || expected !== project.workflow?.revision) throw new Error('프로젝트가 변경되었습니다. 다시 불러오세요. (revision conflict)')
}
function requireRights(project: ScriptProject): void {
  if (!project.workflow?.consent.rightsConfirmedAt) throw new Error('이 자료를 작업에 사용할 권한을 먼저 확인해 주세요.')
  if (project.source.kind !== 'local') throw new Error('자막·직접 입력 작업은 로컬 영상 파일을 선택해 주세요.')
}
function requireReady(project: ScriptProject): void {
  requireRights(project)
  if (!Number.isSafeInteger(project.media.durationMs) || project.media.durationMs <= 0 || !project.source.sha256) throw new Error('영상 준비를 먼저 완료해 주세요.')
}

export async function prepareProjectMedia(id: string, signal?: AbortSignal): Promise<ScriptProject> {
  const baseline = await loadProject(id)
  requireRights(baseline)
  const inspected = await inspectLocalMedia(baseline, signal)
  abort(signal)
  return updateProject(id, project => {
    checkRevision(project, baseline.workflow!.revision)
    requireRights(project)
    abort(signal)
    project.source = inspected.source
    project.media = inspected.media
    delete project.lastError
    if (project.status === 'error') project.status = project.rows.length ? 'review' : 'draft'
  })
}

export function discardSubtitlePreview(id: string, previewId: string): void {
  if (pending.get(previewId)?.projectId === id) pending.delete(previewId)
}

export async function previewSubtitleFile(id: string, filePath: string, expectedRevision: number, options: SubtitlePreviewOptions = {}): Promise<SubtitlePreview> {
  const project = await loadProject(id)
  checkRevision(project, expectedRevision)
  requireReady(project)
  if (!options || (options.encoding !== undefined && !['utf-8', 'utf-16le', 'utf-16be', 'euc-kr'].includes(options.encoding))
    || (options.sourceKind !== undefined && !['provided-srt', 'ocr-srt'].includes(options.sourceKind))
    || (options.declaredAuthority !== undefined && !['festival-provided', 'support-produced', 'unknown'].includes(options.declaredAuthority))) throw new Error('자막 입력 설정이 올바르지 않습니다.')
  if (extname(filePath).toLowerCase() !== '.srt') throw new Error('이번 버전은 SRT 자막 파일을 지원합니다.')
  const details = await stat(filePath)
  if (!details.isFile() || details.size > MAX_BYTES) throw new Error('5MB 이하의 SRT 파일을 선택해 주세요.')
  const bytes = await readFile(filePath)
  if (bytes.length > MAX_BYTES) throw new Error('자막 파일이 너무 큽니다.')
  const decoded = decodeSubtitleBytes(bytes, options.encoding)
  const assetId = randomUUID()
  const parsed = parseSrt(decoded.text, assetId)
  const now = Date.now()
  const preview: SubtitlePreview = {
    previewId: randomUUID(), expectedRevision, durationMs: project.media.durationMs,
    asset: { id: assetId, fileName: basename(filePath), sha256: hash(bytes), encoding: decoded.encoding, language: 'ko',
      sourceKind: options.sourceKind ?? 'provided-srt', declaredAuthority: options.declaredAuthority ?? 'unknown', importedAt: new Date(now).toISOString(),
      originalRelativePath: `subtitles/${assetId}.srt` },
    cues: parsed.cues, issues: parsed.issues
  }
  for (const [key, value] of pending) if (value.expiresAt < now || value.projectId === id) pending.delete(key)
  while (pending.size >= 10) pending.delete(pending.keys().next().value!)
  pending.set(preview.previewId, { projectId: id, filePath, mediaHash: project.source.sha256!, preview: structuredClone(preview), bytes, expiresAt: now + 30 * 60 * 1000 })
  return preview
}

export async function applySubtitleImport(id: string, previewId: string, offsetMs: number, resolutions: SubtitleResolution[], expectedRevision: number, signal?: AbortSignal): Promise<ScriptProject> {
  const entry = pending.get(previewId)
  if (!entry || entry.projectId !== id || entry.expiresAt < Date.now()) throw new Error('자막 미리보기가 만료되었습니다. 다시 가져와 주세요.')
  const { preview } = entry
  if (preview.expectedRevision !== expectedRevision) throw new Error('미리보기 이후 프로젝트가 변경되었습니다.')
  const invalidRaw = (issue: { code: string; severity: string }): boolean => issue.severity === 'error' && issue.code !== 'overlap'
  if (!Array.isArray(resolutions)) throw new Error('자막 겹침 해결값을 확인해 주세요.')
  if (preview.issues.some(invalidRaw) || validateSubtitleCues(preview.cues).some(invalidRaw)) throw new Error('자막 문장과 시간 형식 오류를 먼저 수정해 주세요.')
  const baseline = await loadProject(id)
  checkRevision(baseline, expectedRevision)
  requireReady(baseline)
  const currentFile = await stat(entry.filePath)
  if (currentFile.size > MAX_BYTES || hash(await readFile(entry.filePath)) !== preview.asset.sha256) throw new Error('미리보기 이후 자막 파일이 변경되었습니다. 다시 가져와 주세요.')
  const mediaHash = await fileSha256(baseline.source.localMediaPath ?? baseline.source.uri, signal)
  if (mediaHash !== entry.mediaHash || baseline.source.sha256 !== entry.mediaHash) throw new Error('원본 영상이 변경되었습니다. 기존 대본은 보존했습니다.')
  const rows = generateSubtitleRows(preview.cues, offsetMs, resolutions)
  const errors = validateSubtitleRows(rows, baseline.media.durationMs).filter(issue => issue.severity === 'error')
  if (!rows.length || errors.length) throw new Error(errors[0]?.message ?? '적용할 자막이 없습니다.')
  abort(signal)
  const result = await updateProject(id, async project => {
    checkRevision(project, expectedRevision)
    requireReady(project)
    if (project.source.sha256 !== entry.mediaHash || project.source.uri !== baseline.source.uri) throw new Error('원본 영상이 변경되었습니다.')
    abort(signal)
    const directory = await projectDirectory(id)
    await snapshotProject(project, '자막 가져오기 전', directory)
    await mkdir(join(directory, 'subtitles'), { recursive: true })
    await writeFileAtomic(join(directory, preview.asset.originalRelativePath), entry.bytes)
    abort(signal)
    const workspace = project.subtitleWorkspace ?? { version: 1 as const, assets: [], cues: [], imports: [] }
    const importedAt = new Date().toISOString()
    const asset = { ...preview.asset, importedAt }
    workspace.assets.push(asset)
    workspace.cues.push(...structuredClone(preview.cues))
    const record = { id: randomUUID(), assetId: asset.id, at: importedAt, cueCount: preview.cues.length, appliedRowCount: rows.length, offsetMs, resolutions: structuredClone(resolutions) }
    workspace.imports.push(record)
    workspace.activeAssetId = asset.id
    project.subtitleWorkspace = workspace
    project.rows = rows
    project.status = 'review'
    delete project.lastError
    project.workflow!.proposals = project.workflow!.proposals.map(p => p.status === 'pending' ? { ...p, status: 'stale' } : p)
    project.workflow!.events.push({ id: randomUUID(), at: importedAt, action: 'subtitles-imported', actor: 'writer', rowIds: rows.map(r => r.id), detail: `${preview.cues.length}개 원본 자막 → ${rows.length}개 대사 행 · ${offsetMs}ms 보정 · ${record.id}` })
  })
  pending.delete(previewId)
  return result
}

export async function shiftSubtitleRows(id: string, rowIds: string[], deltaMs: number, expectedRevision: number): Promise<ScriptProject> {
  if (!Array.isArray(rowIds) || !rowIds.length || rowIds.length > 100000 || !rowIds.every(r => typeof r === 'string')
    || new Set(rowIds).size !== rowIds.length || !Number.isSafeInteger(deltaMs)) throw new Error('이동할 행과 밀리초 시간차를 확인해 주세요.')
  return updateProject(id, async project => {
    checkRevision(project, expectedRevision)
    requireReady(project)
    const ids = new Set(rowIds)
    const currentRows = new Map(project.rows.map(row => [row.id, row]))
    if (rowIds.some(rowId => !currentRows.has(rowId))) throw new Error('이동할 행을 찾을 수 없습니다.')
    const rows = project.rows.map(row => ids.has(row.id) ? { ...row, startMs: row.startMs + deltaMs, endMs: row.endMs + deltaMs, reviewed: false, reviewStatus: 'unreviewed' as const, approvedAt: undefined } : row)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    const errors = validateSubtitleRows(rows, project.media.durationMs).filter(issue => issue.severity === 'error')
    if (errors.length) throw new Error(errors[0].message)
    await snapshotProject(project, '자막 시간 이동 전')
    project.rows = rows
    project.workflow!.proposals = project.workflow!.proposals.map(p => p.status === 'pending' && ids.has(p.rowId) ? { ...p, status: 'stale' } : p)
    project.workflow!.events.push({ id: randomUUID(), at: new Date().toISOString(), action: 'subtitle-time-shifted', actor: 'writer', rowIds, detail: `${deltaMs}ms`,
      changes: rows.filter(r => ids.has(r.id)).map(after => ({ rowId: after.id, before: structuredClone(currentRows.get(after.id)), after: structuredClone(after) })) })
    project.status = 'review'
  })
}
