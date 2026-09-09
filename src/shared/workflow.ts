import { DESCRIPTION_TEXT } from './constants'
import type { ReviewIssue, ScriptProject, ScriptRow, TranscriptSegment } from './types'

export function rowReviewStatus(row: ScriptRow): NonNullable<ScriptRow['reviewStatus']> {
  return row.reviewStatus === 'approved' && row.approvedAt ? 'approved' : row.reviewStatus === 'needsAttention' ? 'needsAttention' : 'unreviewed'
}

export function normalizeWorkflow(project: ScriptProject): ScriptProject {
  if (project.workflow?.version === 1) return project
  return { ...project, rows: project.rows.map(row => ({ ...row, reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined })), workflow: { version: 1, revision: 0, consent: {}, proposals: [], events: [{ id: `migration-${project.id}`, at: new Date().toISOString(), action: 'workflow-migrated', actor: 'system', detail: `Legacy reviewed rows: ${project.rows.filter(r => r.reviewed).length}; prior editing flags are not explicit approval.` }] } }
}

export function validateSegments(segments: TranscriptSegment[], durationMs: number): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const seen = new Set<string>()
  segments.forEach((s, i) => {
    const add = (code: string, message: string) => issues.push({ id: `${code}-${i}`, segmentId: s.id, code, severity: 'error', message })
    if (!s.id || seen.has(s.id)) add('SEGMENT_ID', '원본 구간 ID가 없거나 중복됩니다.')
    seen.add(s.id)
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs) || s.startMs < 0 || s.endMs <= s.startMs) add('SEGMENT_TIME', '원본 구간 시간이 올바르지 않습니다.')
    if (Number.isFinite(durationMs) && durationMs > 0 && s.endMs > durationMs) add('SEGMENT_DURATION', '원본 구간이 영상 길이를 넘습니다.')
    if (i > 0 && s.startMs < segments[i - 1].startMs) add('SEGMENT_ORDER', '원본 구간의 시간 순서를 확인하세요.')
    if (typeof s.text !== 'string' || !s.text.trim()) add('SEGMENT_TEXT', '원본 구간 대사가 비어 있습니다.')
  })
  return issues
}

export function getReviewIssues(project: ScriptProject): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const sources = new Set([...project.segments, ...project.runs.flatMap(run => run.sourceSegments ?? [])].map(s => s.id))
  const seen = new Set<string>()
  const expectsSpeakers = project.localDiarization?.mode === 'sherpa-onnx' || project.runs.some(r => r.diarization?.status === 'succeeded' || r.provider === 'openai')
  project.rows.forEach((row, i) => {
    const add = (code: string, message: string, severity: ReviewIssue['severity'] = 'error') => issues.push({ id: `${code}-${i}`, rowId: row.id, code, severity, message })
    if (!row.id || seen.has(row.id)) add('ROW_ID', '행 ID가 없거나 중복됩니다.')
    seen.add(row.id)
    if (!Number.isFinite(row.startMs) || !Number.isFinite(row.endMs) || row.startMs < 0 || row.endMs <= row.startMs) add('ROW_TIME', '행의 시작·종료 시간을 확인하세요.')
    if (project.media.durationMs > 0 && row.endMs > Math.ceil(project.media.durationMs / 1000) * 1000) add('ROW_DURATION', '행이 영상 길이를 넘습니다.')
    if (i > 0 && row.startMs < project.rows[i - 1].startMs) add('ROW_ORDER', '행의 시간 순서를 확인하세요.')
    if (i > 0 && row.startMs < project.rows[i - 1].endMs) add('ROW_OVERLAP', '앞 행과 시간이 겹칩니다.')
    if (!row.content.trim() && row.kind === 'dialogue') add('ROW_TEXT', '대사 내용이 비어 있습니다.')
    if (row.sourceSegmentIds.some(id => !sources.has(id))) add('ROW_SOURCE', '연결된 원본 구간을 확인하세요.')
    if (row.kind === 'dialogue' && row.sourceSegmentIds.length === 0) add('ROW_SOURCE_MISSING', '직접 작성한 대사를 영상과 대조하세요. 연결된 인식 원문은 없습니다.', 'warning')
    if (row.kind === 'dialogue' && expectsSpeakers && !row.speakers.some(s => s.trim())) add('ROW_SPEAKER', '화자 표기를 확인하세요.', 'warning')
    if (row.kind === 'descriptionGap' && (!row.content.trim() || row.content.trim() === DESCRIPTION_TEXT)) add('DESCRIPTION_PENDING', '작가가 화면해설을 작성할 자리입니다.', 'warning')
    if (rowReviewStatus(row) !== 'approved') add('REVIEW_PENDING', '영상과 대조하여 대사·고유명사·숫자·화자·시간을 검수한 뒤 승인하세요. 자동 검사는 정확도를 보증하지 않습니다.', 'warning')
  })
  return issues
}
