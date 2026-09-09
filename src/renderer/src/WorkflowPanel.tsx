import { useState } from 'react'
import { formatTimecode } from '@shared/timecode'
import { getReviewIssues, rowReviewStatus } from '@shared/workflow'
import type { ProjectSnapshot, ScriptProject, ScriptRow } from '@shared/types'

const workflowLabels: Record<string, string> = {
  'before-bulk-edit': '여러 행 수정 전', 'before-restore': '이전 상태 복구 전', 'before-correction': '교정 제안 적용 전',
  'before-processing': '음성 분석 전', 'before-analysis': '음성 분석 전',
  'rows-edited': '대본 수정', 'rows-approved': '행 확인 완료', 'approval-cleared': '확인 완료 취소',
  'consent-changed': '사용 권리·외부 전송 설정 변경', 'snapshot-restored': '이전 대본 복구',
  'correction-apply': '교정 제안 적용', 'correction-reject': '교정 제안 거절', 'correction-proposed': '교정 제안 도착',
  'workflow-migrated': '이전 프로젝트의 확인 기록 준비', 'export-completed': '대본 파일 저장',
  'processing-started': '음성 분석 시작', 'processing-completed': '음성 분석 완료', 'processing-failed': '음성 분석 실패',
  'analysis-started': '음성 분석 시작', 'analysis-completed': '음성 분석 완료', 'analysis-failed': '음성 분석 실패', 'analysis-cancelled': '음성 분석 취소',
  succeeded: '완료', failed: '실패', cancelled: '취소'
}
const workflowLabel = (value: string): string => workflowLabels[value] ?? (/[가-힣]/.test(value) ? value : '작업 기록')

export function WorkflowPanel({ project, rows, selected, busy, mutate, action, choose, seek }: {
  project: ScriptProject
  rows: ScriptRow[]
  selected?: ScriptRow
  busy: boolean
  mutate: (operation: (revision: number) => Promise<ScriptProject>) => Promise<void>
  action: (operation: () => Promise<void>) => Promise<void>
  choose: (row: ScriptRow) => void
  seek: (seconds: number) => void
}) {
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([])
  const [snapshotId, setSnapshotId] = useState('')
  const [rights, setRights] = useState(Boolean(project.workflow?.consent.rightsConfirmedAt))
  const [audio, setAudio] = useState(Boolean(project.workflow?.consent.cloudAudioConsentAt))
  const [correction, setCorrection] = useState(Boolean(project.workflow?.consent.cloudCorrectionConsentAt))
  const issues = getReviewIssues({ ...project, rows })
  const remaining = rows.filter((row) => rowReviewStatus(row) !== 'approved')
  const next = remaining.find((row) => rows.indexOf(row) > rows.findIndex((entry) => entry.id === selected?.id)) ?? remaining[0]
  const sources = [...new Map([...project.runs.flatMap((run) => run.sourceSegments ?? []), ...project.segments].map((segment) => [segment.id, segment])).values()].filter((segment) => selected?.sourceSegmentIds.includes(segment.id))
  const proposals = project.workflow?.proposals.filter((proposal) => proposal.rowId === selected?.id) ?? []
  return <section className="workflow-panel" aria-label="대본 확인과 기록">
    <h3>확인이 필요한 행 {remaining.length}개</h3>
    <p>영상을 들으며 대사를 확인하고, 화면해설은 직접 작성하세요. 자동 검사는 정확도를 보증하지 않습니다.</p>
    <fieldset disabled={busy}>
      <div className="workflow-buttons">
        <button className="secondary-button" disabled={!next} onClick={() => next && choose(next)}>다음 확인할 행</button>
        <button className="primary-button" disabled={!selected || rowReviewStatus(selected) === 'approved'} onClick={() => selected && void mutate((revision) => window.screenScript.reviewRows(project.id, [selected.id], true, revision))}>선택한 행 확인 완료</button>
        <button className="secondary-button" disabled={!selected || rowReviewStatus(selected) !== 'approved'} onClick={() => selected && void mutate((revision) => window.screenScript.reviewRows(project.id, [selected.id], false, revision))}>확인 완료 취소</button>
      </div>
      <p>수정하면 확인 완료가 해제됩니다.</p>
      {issues.length > 0 && <details><summary>자동 점검 알림 {issues.length}개</summary><ul className="workflow-issues">{issues.map((issue) => <li key={issue.id}><span>{issue.severity === 'error' ? '오류' : '주의'}: {issue.message}</span>{issue.rowId && <button onClick={() => { const row = rows.find((entry) => entry.id === issue.rowId); if (row) choose(row) }}>해당 행으로 이동</button>}</li>)}</ul></details>}
      <details><summary>선택한 행의 원래 음성 인식 결과</summary>
        <p>원래 인식 결과도 틀릴 수 있습니다. 시간을 누르면 영상에서 확인합니다.</p>
        {sources.length ? sources.map((segment) => <div className="source-segment" key={segment.id}><button onClick={() => seek(segment.startMs / 1000)}>{formatTimecode(segment.startMs)}–{formatTimecode(segment.endMs)} 재생</button><p>{segment.text}</p></div>) : <p>연결된 원본 구간이 없습니다.</p>}
      </details>
      <details open={!project.workflow?.consent.rightsConfirmedAt || undefined}><summary>사용 권리와 외부 전송 설정</summary>
        <label className="consent-check"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />이 영상·음성을 사용할 권리가 있습니다.</label>
        <label className="consent-check"><input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />외부 음성 분석 시 음성을 OpenAI에 전송하는 데 동의합니다. API 사용료가 발생하며, 일부 오류에서 같은 제공자로 최대 1회 재시도합니다 (총 최대 2회 요청).</label>
        <label className="consent-check"><input type="checkbox" checked={correction} onChange={(event) => setCorrection(event.target.checked)} />교정을 요청할 때 선택한 대사 텍스트를 OpenAI에 전송하는 데 동의합니다. API 사용료가 발생합니다.</label>
        <button className="secondary-button" onClick={() => void mutate(() => window.screenScript.setProjectConsent(project.id, { rightsConfirmed: rights, cloudAudioConsent: audio, cloudCorrectionConsent: correction }))}>동의 설정 저장</button>
      </details>
      <details><summary>선택한 대사 교정 제안 받기 · 선택 사항</summary>
        <p>선택한 대사 1행만 전송합니다. 요청당 최대 20행·12,000자입니다. 시간·화자는 바꾸지 않으며 화면해설은 생성하지 않습니다.</p>
        <p>위의 외부 교정 동의를 저장한 뒤 사용할 수 있습니다. 제안은 작가가 적용 여부를 결정합니다.</p>
        <button className="secondary-button" disabled={!selected || selected.kind !== 'dialogue' || !selected.content.trim() || selected.content.length > 12000 || !project.workflow?.consent.rightsConfirmedAt || !project.workflow?.consent.cloudCorrectionConsentAt} onClick={() => selected && void mutate((revision) => window.screenScript.requestCorrections(project.id, [selected.id], revision))}>선택한 대사 교정 요청 (유료)</button>
        {proposals.map((proposal) => <article className="correction-proposal" key={proposal.id}>
          <p className="correction-caution">주의: AI 교정으로 의미가 바뀔 수 있습니다. 원음과 대조한 뒤 적용하세요.</p>
          <p><strong>수정 전</strong> {proposal.before}</p><p><strong>제안</strong> {proposal.after}</p><p><strong>이유</strong> {proposal.reason}</p>
          <span>{({ pending: '결정 전', applied: '적용됨 · 다시 확인 필요', rejected: '거절됨', stale: '내용이 달라져 적용할 수 없음' } as const)[proposal.status]}</span>
          {proposal.status === 'pending' && <div className="workflow-buttons"><button disabled={proposal.before !== selected?.content} onClick={() => void mutate((revision) => window.screenScript.decideCorrection(project.id, proposal.id, 'apply', revision))}>제안 적용</button><button onClick={() => void mutate((revision) => window.screenScript.decideCorrection(project.id, proposal.id, 'reject', revision))}>제안 거절</button></div>}
        </article>)}
      </details>
      <details><summary>이전 상태로 복구</summary><p>현재 편집을 저장한 다음 이전 대본을 불러옵니다. 원본 음성 인식 결과와 실행 기록은 유지됩니다.</p>
        <button onClick={() => void action(async () => { const values = await window.screenScript.listSnapshots(project.id); setSnapshots(values); setSnapshotId(values[0]?.id ?? '') })}>이전 저장 목록 보기</button>
        <label className="field-label">복구할 저장본<select value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)}><option value="">저장본 선택</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString('ko-KR')} · {snapshot.rowCount}행 · {workflowLabel(snapshot.reason)}</option>)}</select></label>
        <button disabled={!snapshotId} onClick={() => { if (window.confirm('선택한 저장본으로 대본을 복구할까요? 현재 내용도 복구 전 저장본으로 남습니다.')) void mutate((revision) => window.screenScript.restoreSnapshot(project.id, snapshotId, revision)) }}>선택한 저장본으로 복구</button>
      </details>
      <details><summary>작업 기록 · 고급 정보</summary>
        <p>자료와 작업 기록은 이 PC에 저장됩니다. 기록 파일에는 대본 내용이 포함될 수 있습니다.</p>
        <p>저장 버전: {project.workflow?.revision ?? 0}</p><p className="evidence-hash">원본 SHA-256: {project.source.sha256 ?? '아직 기록되지 않음'}</p>
        {project.runs.map((run) => <div className="evidence-run" key={run.id}><strong>{run.provider === 'local' ? '내 PC' : 'OpenAI'} · {run.model}</strong><p>{run.startedAt} · {run.outcome ? workflowLabel(run.outcome) : (run.completedAt ? '완료 기록' : '미완료')}</p><p className="evidence-hash">실행 ID: {run.id}<br />입력 SHA-256: {run.inputSha256 ?? '미기록'}</p></div>)}
        <ul>{project.workflow?.events.slice(-10).reverse().map((event) => <li key={event.id}>{new Date(event.at).toLocaleString('ko-KR')} · {workflowLabel(event.action)}{event.detail && <details><summary>기록 상세</summary><code className="evidence-hash">{event.detail}</code></details>}</li>)}</ul>
        <button onClick={() => void action(async () => { const result = await window.screenScript.exportEvidence(project.id); if (result) window.alert(`작업 기록을 저장했습니다: ${result.path}`) })}>작업 기록 파일 저장</button>
      </details>
    </fieldset>
  </section>
}
