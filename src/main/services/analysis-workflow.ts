import { randomUUID } from 'node:crypto'
import { generateScriptRows } from '@shared/rows'
import { validateSegments } from '@shared/workflow'
import type { ProcessingRun, ScriptProject } from '@shared/types'

export interface AnalysisStore {
  update(id: string, update: (project: ScriptProject) => void | Promise<void>): Promise<ScriptProject>
  snapshot(project: ScriptProject, reason: string): Promise<unknown>
}

export interface AnalysisOptions {
  store: AnalysisStore
  model: string
  signal: AbortSignal
  analyze(project: ScriptProject, run: ProcessingRun): Promise<void>
  describeFailure?(error: unknown, run: ProcessingRun): string
}

export async function executeVerifiedAnalysis(id: string, options: AnalysisOptions): Promise<ScriptProject> {
  const { store, signal } = options
  const run: ProcessingRun = {
    id: randomUUID(), startedAt: new Date().toISOString(), provider: 'local', model: options.model,
    pipelineVersion: 'ginuni-verified-v1', promptVersion: 'transcription-verbatim-v1'
  }
  const baseline = await store.update(id, async (live) => {
    if (!live.workflow?.consent.rightsConfirmedAt) throw new Error('이 자료를 작업에 사용할 권한을 먼저 확인해 주세요.')
    if (live.transcriptionEngine === 'openai' && !live.workflow.consent.cloudAudioConsentAt) {
      throw new Error('외부 음성 분석 전송에 동의해 주세요. 동의하지 않으면 내 PC 분석을 사용할 수 있습니다.')
    }
    if (signal.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
    if (live.rows.length) await store.snapshot(live, '다시 분석하기 전')
    // Preserve old source text even after a later analysis replaces the active segment set.
    const previousRun = [...live.runs].reverse().find((entry) => entry.completedAt && !entry.errorCode)
    if (previousRun && !previousRun.sourceSegments) previousRun.sourceSegments = structuredClone(live.segments)
    run.provider = live.transcriptionEngine ?? 'local'
    live.runs.push(structuredClone(run))
    live.status = 'processing'
    delete live.lastError
    live.workflow.events.push({ id: randomUUID(), at: run.startedAt, action: 'analysis-started', actor: 'writer', runId: run.id })
  })
  const draft = structuredClone(baseline)
  const originalRows = JSON.stringify(baseline.rows)
  try {
    await options.analyze(draft, run)
    if (signal.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
    run.inputSha256 = draft.source.sha256
    if (baseline.rows.length && baseline.source.sha256 && baseline.source.sha256 !== draft.source.sha256) {
      throw new Error('원본 파일이 변경되었습니다. 기존 대본을 보존했습니다. 새 프로젝트로 가져와 주세요.')
    }
    run.checks = validateSegments(draft.segments, draft.media.durationMs)
    if (run.checks.some((check) => check.severity === 'error')) throw new Error('분석 결과 검사에서 시간 또는 형식 오류를 발견했습니다. 기존 대본은 보존했습니다.')
    draft.rows = generateScriptRows(draft.segments, draft.media.durationMs).map((row) => ({
      ...row, endMs: Math.min(row.endMs, draft.media.durationMs), reviewed: false, reviewStatus: 'unreviewed'
    }))
    run.completedAt = new Date().toISOString()
    run.outcome = 'succeeded'
    run.sourceSegments = structuredClone(draft.segments)
    return await store.update(id, async (live) => {
      if (JSON.stringify(live.rows) !== originalRows) throw new Error('분석 중 대본이 변경되어 새 초안을 적용하지 않았습니다. 현재 작업을 보존했습니다.')
      if (signal.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
      live.source = draft.source
      live.media = draft.media
      live.title = draft.title
      live.segments = draft.segments
      live.rows = draft.rows
      live.status = 'review'
      delete live.lastError
      const index = live.runs.findIndex((entry) => entry.id === run.id)
      live.runs[index] = structuredClone(run)
      live.workflow!.proposals = live.workflow!.proposals.map((proposal) => proposal.status === 'pending' ? { ...proposal, status: 'stale' } : proposal)
      live.workflow!.events.push({ id: randomUUID(), at: run.completedAt!, action: 'analysis-completed', actor: 'system', runId: run.id })
      await store.snapshot(live, '새 초안 생성 완료')
    })
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
    run.completedAt = new Date().toISOString()
    run.outcome = cancelled ? 'cancelled' : 'failed'
    // The original provider result is kept only for valid completed drafts, never invalid unbounded data.
    delete run.sourceSegments
    const message = cancelled ? '작업이 취소되었습니다. 기존 대본은 보존했습니다.'
      : options.describeFailure?.(error, run) ?? (error instanceof Error && /검사|변경/.test(error.message) ? error.message : '분석을 완료하지 못했습니다. 기존 대본은 보존했습니다.')
    run.errorCode ??= cancelled ? 'ABORTED' : 'PROCESSING_FAILED'
    await store.update(id, (live) => {
      const index = live.runs.findIndex((entry) => entry.id === run.id)
      if (index >= 0) live.runs[index] = structuredClone(run)
      live.status = live.rows.length ? 'review' : cancelled ? 'draft' : 'error'
      live.lastError = message
      // A successfully prepared source still enables manual work after transcription fails.
      if (!live.rows.length && draft.media.durationMs > 0) {
        live.media = draft.media
        live.source = draft.source
      }
      live.workflow!.events.push({ id: randomUUID(), at: run.completedAt!, action: cancelled ? 'analysis-cancelled' : 'analysis-failed', actor: 'system', runId: run.id })
    })
    throw new Error(message)
  }
}
