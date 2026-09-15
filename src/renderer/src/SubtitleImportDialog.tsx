import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimecode } from '@shared/timecode'
import type { SubtitlePreview, SubtitlePreviewOptions, SubtitleResolution } from '@shared/subtitle-types'
import { buildSubtitlePreviewState, resolutionForOverlap } from './subtitle-ui'

const sourceLabels = {
  'provided-srt': '제공받은 자막',
  'ocr-srt': '영상에서 추출한 자막'
} as const

function issueLabel(code: string): string {
  return ({ encoding: '인코딩', syntax: '파일 형식', range: '시간 범위', overlap: '겹침', style: '서식 변환' } as Record<string, string>)[code] ?? '확인'
}

function formatPreviewTime(ms: number): string {
  return ms < 0 ? `-${formatTimecode(Math.abs(ms))}` : formatTimecode(ms)
}

export function SubtitleImportDialog({ open, preview, busy, error, hasExistingRows, onPreview, onApply, onClose }: {
  open: boolean
  preview: SubtitlePreview | null
  busy: boolean
  error: string
  hasExistingRows: boolean
  onPreview: (options: SubtitlePreviewOptions) => Promise<void>
  onApply: (offsetMs: number, resolutions: SubtitleResolution[]) => Promise<void>
  onClose: () => Promise<void>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [encoding, setEncoding] = useState<'auto' | NonNullable<SubtitlePreviewOptions['encoding']>>('auto')
  const [sourceKind, setSourceKind] = useState<NonNullable<SubtitlePreviewOptions['sourceKind']>>('provided-srt')
  const [declaredAuthority, setDeclaredAuthority] = useState<NonNullable<SubtitlePreviewOptions['declaredAuthority']>>('unknown')
  const [offsetText, setOffsetText] = useState('0')
  const [resolutions, setResolutions] = useState<SubtitleResolution[]>([])

  useEffect(() => {
    if (!preview) return
    setOffsetText('0')
    setResolutions([])
    setEncoding(['utf-8', 'utf-16le', 'utf-16be', 'euc-kr'].includes(preview.asset.encoding) ? preview.asset.encoding as NonNullable<SubtitlePreviewOptions['encoding']> : 'auto')
    setSourceKind(preview.asset.sourceKind)
    setDeclaredAuthority(preview.asset.declaredAuthority)
  }, [preview?.previewId])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const parsedOffset = /^-?\d+$/.test(offsetText.trim()) ? Number(offsetText) : Number.NaN
  const validOffset = Number.isSafeInteger(parsedOffset)
  const state = useMemo(() => preview && validOffset ? buildSubtitlePreviewState(preview, parsedOffset, resolutions) : null, [preview, parsedOffset, resolutions, validOffset])
  const displayedIssues = preview ? [...preview.issues.filter((issue) => issue.code !== 'overlap' || (state?.overlapGroups.length ?? 0) > 0), ...(state?.effectiveIssues ?? [])] : []
  const errorCount = displayedIssues.filter((issue) => issue.severity === 'error').length
  const warningCount = displayedIssues.length - errorCount
  const visibleRows = state?.rows.slice(0, 50) ?? []
  const dialogueRows = state?.rows.filter((row) => row.kind === 'dialogue') ?? []
  const candidateCount = state?.rows.filter((row) => row.kind === 'descriptionGap').length ?? 0
  const checkpoints = dialogueRows.length ? [...new Set([0, Math.floor(dialogueRows.length / 2), dialogueRows.length - 1])].map((index) => ({
    row: dialogueRows[index],
    label: index === 0 ? '초반' : index === dialogueRows.length - 1 ? '후반' : '중간'
  })) : []

  return (
    <dialog ref={dialogRef} className="subtitle-import-dialog" aria-labelledby="subtitle-import-title" onCancel={(event) => { event.preventDefault(); void onClose() }}>
      <header className="subtitle-dialog-heading">
        <div><h2 id="subtitle-import-title">자막 파일로 시작</h2><p>로컬 SRT의 대사와 빈 시간의 해설 후보를 새 초안으로 준비합니다.</p></div>
        <button className="icon-button" aria-label="자막 가져오기 닫기" disabled={busy} onClick={() => void onClose()}>×</button>
      </header>

      <div className="subtitle-option-grid">
        <label className="field-label">자료 출처<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}><option value="provided-srt">제공받은 자막</option><option value="ocr-srt">영상에서 추출한 자막</option></select></label>
        <label className="field-label">처리 권한 기록<select value={declaredAuthority} onChange={(event) => setDeclaredAuthority(event.target.value as typeof declaredAuthority)}><option value="unknown">확인되지 않음</option><option value="festival-provided">영화제 제공</option><option value="support-produced">지원 담당자 제작</option></select></label>
        <label className="field-label">문자 인코딩<select value={encoding} onChange={(event) => setEncoding(event.target.value as typeof encoding)}><option value="auto">자동 감지</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="euc-kr">EUC-KR / CP949</option></select></label>
      </div>
      <button className="primary-button" disabled={busy} onClick={() => void onPreview({ encoding: encoding === 'auto' ? undefined : encoding, sourceKind, declaredAuthority })}>{preview ? '다른 SRT 선택 및 미리보기' : 'SRT 선택 및 미리보기'}</button>
      {error && <p className="error-text subtitle-dialog-error" role="alert">{error}</p>}

      {preview && state && (
        <>
          <section className="subtitle-summary" aria-label="자막 요약">
            <div><strong>{preview.asset.fileName}</strong><span>{sourceLabels[preview.asset.sourceKind]} · {preview.asset.encoding.toUpperCase()}</span></div>
            <dl><div><dt>자막 원문</dt><dd>{preview.cues.length.toLocaleString()}개</dd></div><div><dt>대사</dt><dd>{dialogueRows.length.toLocaleString()}행</dd></div><div><dt>해설 후보</dt><dd>{candidateCount.toLocaleString()}행</dd></div><div><dt>처음</dt><dd>{preview.cues.length ? formatTimecode(preview.cues[0].startMs) : '—'}</dd></div><div><dt>마지막</dt><dd>{preview.cues.length ? formatTimecode(preview.cues.at(-1)!.endMs) : '—'}</dd></div><div><dt>확인 항목</dt><dd>{errorCount} 오류 · {warningCount} 주의</dd></div></dl>
          </section>

          <section className="subtitle-offset" aria-labelledby="subtitle-offset-title">
            <div><h3 id="subtitle-offset-title">영상과 시간 맞추기</h3><p>모든 자막에 한 번 적용할 시간차입니다. 초반·중간·후반을 영상과 비교하세요.</p></div>
            <label className="field-label">전체 시간차 (ms)<input inputMode="numeric" value={offsetText} onChange={(event) => { setOffsetText(event.target.value); setResolutions([]) }} aria-invalid={!validOffset} /></label>
            {!validOffset && <p className="error-text">시간차는 유한한 정수 밀리초로 입력하세요. 예: -3600000, 1500</p>}
            <div className="sync-checkpoints">{checkpoints.map(({ row, label }) => <div key={`${row.id}:${label}`}><strong>{label}</strong><span>{formatPreviewTime(row.startMs)}–{formatPreviewTime(row.endMs)}</span><p>{row.content}</p></div>)}</div>
          </section>

          {state.overlapGroups.length > 0 && (
            <section className="subtitle-overlaps" aria-labelledby="subtitle-overlap-title"><h3 id="subtitle-overlap-title">겹치는 자막 {state.overlapGroups.length}그룹</h3><p>원문은 그대로 보존됩니다. 아래 버튼은 선택한 그룹만 시작 최솟값·종료 최댓값으로 합칩니다.</p>{state.overlapGroups.map((group) => <article key={group.cueIds.join(':')}><strong>{formatPreviewTime(group.startMs)}–{formatPreviewTime(group.endMs)}</strong>{group.rows.map((row) => <p key={row.id}>{row.content}</p>)}<button className="secondary-button" disabled={group.startMs < 0 || group.endMs > preview.durationMs} title={group.startMs < 0 || group.endMs > preview.durationMs ? '먼저 전체 시간차를 조정해 영상 범위 안으로 옮기세요.' : ''} onClick={() => setResolutions((value) => [...value, resolutionForOverlap(group)])}>이 그룹 합치기</button></article>)}</section>
          )}

          {displayedIssues.length > 0 && <details className="subtitle-issues" open={state.blockingIssues.length > 0 || undefined}><summary>오류와 주의 {displayedIssues.length}개</summary><ul>{displayedIssues.slice(0, 100).map((issue, index) => <li key={`${issue.code}:${issue.ordinal ?? 'all'}:${index}`}><strong>{issue.severity === 'error' ? '오류' : '주의'} · {issueLabel(issue.code)}</strong>{issue.ordinal && <span>{issue.ordinal}번 자막</span>}<p>{issue.message}</p></li>)}</ul>{displayedIssues.length > 100 && <p>나머지 {displayedIssues.length - 100}개 항목은 적용 전 모두 검사됩니다.</p>}</details>}

          <section className="subtitle-preview-list" aria-labelledby="subtitle-preview-list-title"><h3 id="subtitle-preview-list-title">대사와 해설 후보 미리보기</h3><p>대사 {dialogueRows.length.toLocaleString()}행 · 해설 후보 {candidateCount.toLocaleString()}행. 전체 {state.rows.length.toLocaleString()}행 중 처음 {visibleRows.length.toLocaleString()}행을 표시합니다.</p><p>영상의 시작·끝과 자막 사이에서 2초 이상 비는 시간에 해설 후보를 넣습니다. 자막이 없는 시간에도 대사와 소리가 있을 수 있으니, 실제 해설 위치는 영상을 들으며 정하세요.</p><ol>{visibleRows.map((row) => <li key={row.id}><time>{formatPreviewTime(row.startMs)}–{formatPreviewTime(row.endMs)}</time><span><strong>{row.kind === 'dialogue' ? '대사' : '해설 후보'}</strong> · {row.content}</span></li>)}</ol></section>

          <footer className="subtitle-dialog-actions">
            <p>{hasExistingRows ? '새 초안을 적용하면 현재 대본은 적용 직전 저장본으로 보관됩니다.' : '적용 후 각 대사를 영상과 대조해 확인하세요.'}</p>
            <div><button className="secondary-button" disabled={busy} onClick={() => void onClose()}>취소</button><button className="primary-button" disabled={busy || !validOffset || state.blockingIssues.length > 0 || state.overlapGroups.length > 0 || state.rows.length === 0} onClick={() => void onApply(parsedOffset, resolutions)}>새 초안 적용</button></div>
          </footer>
        </>
      )}
    </dialog>
  )
}
