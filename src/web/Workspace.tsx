import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScriptRow } from '../shared/types'
import { formatTimecode, parseTimecode } from '../shared/timecode'
import { addDescriptionCandidates } from '../shared/description-candidates'
import { validateRows } from '../shared/rows'
import type { WebProject } from './project'
import { SAMPLE_MEDIA } from './sample-media'
import { buildWebVttContent } from './vtt'
import SampleComparison from './SampleComparison'
import { displayRows } from './translation-project'
import TranslationPanel from './TranslationPanel'
import { SPEECH_LANGUAGES, translationLanguageForSpeech, type SpeechLanguage } from './languages'
import { ASR_PROFILES, type KoreanAsrMode } from './asr-models'

interface Props {
  project: WebProject
  file: File | null
  mediaUrl: string
  busy: boolean
  busyOperation: 'transcription' | 'translation'
  mediaLoading: boolean
  progress: { percent: number; message: string }
  saveError: string
  canUndo: boolean
  onBack: () => void
  onChange: (project: WebProject) => void
  onRowsChange: (rows: ScriptRow[]) => void
  onMedia: (file: File) => Promise<void>
  onSubtitle: (file: File, offsetMs: number) => Promise<void>
  onAnalyze: () => Promise<void>
  onTranslate: () => Promise<void>
  onRestoreTranslation: (rowId?: string) => void
  onCancel: () => void
  onUndo: () => void
  onExport: (format: 'hwpx' | 'srt' | 'json') => Promise<void>
}

export default function Workspace(props: Props) {
  const { project: originalProject, busy } = props
  const project = useMemo(() => ({ ...originalProject, rows: displayRows(originalProject) }), [originalProject])
  const originalsById = useMemo(() => new Map(originalProject.rows.map(row => [row.id, row])), [originalProject.rows])
  const publicSample =
    project.sample === true && project.sampleId === SAMPLE_MEDIA.id
  const mediaSource = props.mediaUrl || (publicSample ? SAMPLE_MEDIA.url : '')
  const [selected, setSelected] = useState(project.rows[0]?.id ?? '')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [filter, setFilter] = useState<'all' | 'descriptionGap' | 'pending'>(
    'all'
  )
  const [rights, setRights] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(!project.rows.length)
  const [localError, setLocalError] = useState('')
  const [offset, setOffset] = useState('0')
  const video = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)
  const rangeFrame = useRef<number | null>(null)
  const rangeVersion = useRef(0)
  const [captionUrl, setCaptionUrl] = useState('')
  const mediaInput = useRef<HTMLInputElement>(null)
  const srtInput = useRef<HTMLInputElement>(null)
  const selectedRow = project.rows.find((row) => row.id === selected)
  const approved = project.rows.filter((row) => row.reviewed).length
  const asrAttention = originalProject.rows.filter(row => row.asrWarnings?.length && !row.reviewed)
  const visibleRows = project.rows.filter(
    (row) =>
      filter === 'all' ||
      (filter === 'pending' ? !row.reviewed : row.kind === filter)
  )
  const issues = validateRows(project.rows)

  useEffect(() => {
    if (selected && project.rows.some((row) => row.id === selected)) return
    setSelected(project.rows[0]?.id ?? '')
  }, [project.rows, selected])
  useEffect(() => {
    setTime(0)
    setPlaying(false)
    cancelRange()
    return cancelRange
  }, [mediaSource])
  useEffect(() => {
    const subtitle = buildWebVttContent(project.rows)
    if (!subtitle) { setCaptionUrl(''); return }
    const url = URL.createObjectURL(new Blob([subtitle], { type: 'text/vtt' }))
    setCaptionUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [project.rows])

  function cancelRange() {
    rangeVersion.current += 1
    stopAt.current = null
    if (rangeFrame.current !== null) cancelAnimationFrame(rangeFrame.current)
    rangeFrame.current = null
  }
  function seek(ms: number) {
    cancelRange()
    setTime(ms)
    if (video.current && video.current.readyState > 0)
      video.current.currentTime = ms / 1000
  }
  async function playRange(startMs: number, endMs: number) {
    seek(startMs)
    const version = rangeVersion.current
    stopAt.current = endMs
    const checkEnd = () => {
      if (rangeVersion.current !== version) return
      const player = video.current
      const end = stopAt.current
      if (!player || end === null) return
      if (player.currentTime * 1000 >= end) {
        cancelRange()
        player.pause()
        player.currentTime = end / 1000
        setTime(end)
      } else rangeFrame.current = requestAnimationFrame(checkEnd)
    }
    try {
      await video.current?.play()
      if (rangeVersion.current === version && stopAt.current !== null)
        rangeFrame.current = requestAnimationFrame(checkEnd)
    } catch {
      if (rangeVersion.current !== version) return
      cancelRange()
      setLocalError('영상 재생 버튼을 누른 뒤 다시 시도해 주세요.')
    }
  }
  function select(row: ScriptRow) {
    setSelected(row.id)
    seek(row.startMs)
    setLocalError('')
  }
  function patch(row: ScriptRow, patchValue: Partial<ScriptRow>) {
    props.onRowsChange(
      project.rows
        .map((item) =>
          item.id === row.id
            ? {
                ...item,
                ...patchValue,
                reviewed: false,
                reviewStatus: 'unreviewed' as const
              }
            : item
        )
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    )
  }
  function addRow(kind: ScriptRow['kind']) {
    const startMs = Math.min(
      Math.floor(time / 1000) * 1000,
      Math.max(0, project.durationMs - 1000)
    )
    const row: ScriptRow = {
      id: crypto.randomUUID(),
      kind,
      startMs,
      endMs: Math.min(project.durationMs, startMs + 3000),
      speakers: [],
      content: '',
      sourceSegmentIds: [],
      reviewed: false
    }
    props.onRowsChange(
      [...project.rows, row].sort((a, b) => a.startMs - b.startMs)
    )
    setSelected(row.id)
    setFilter('all')
  }
  function approveNext(row: ScriptRow) {
    if (!row.content.trim()) {
      setLocalError('내용을 입력한 뒤 확인 완료를 눌러 주세요.')
      return
    }
    const rowIndex = project.rows.findIndex((item) => item.id === row.id)
    props.onRowsChange(
      project.rows.map((item) =>
        item.id === row.id
          ? {
              ...item,
              reviewed: true,
              reviewStatus: 'approved',
              approvedAt: new Date().toISOString()
            }
          : item
      )
    )
    const pending = [
      ...project.rows.slice(rowIndex + 1),
      ...project.rows.slice(0, rowIndex)
    ].find(
      (item) =>
        !item.reviewed &&
        (filter !== 'descriptionGap' || item.kind === 'descriptionGap')
    )
    if (pending) {
      setSelected(pending.id)
      seek(pending.startMs)
    }
    setLocalError('')
    window.requestAnimationFrame(() => {
      const next = pending
        ? document.getElementById(`row-${pending.id}`)
        : document.querySelector('.script-filters button.active')
      next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      ;(
        (next?.querySelector('textarea') as HTMLElement | null) ??
        (next as HTMLElement | null)
      )?.focus({ preventScroll: true })
    })
  }

  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div className="work-title">
          <button
            className="back-button"
            onClick={props.onBack}
            disabled={busy}
            aria-label="작업 목록으로"
          >
            ←
          </button>
          <div>
            <label className="sr-only" htmlFor="project-title">
              대본 제목
            </label>
            <input
              id="project-title"
              value={project.title}
              maxLength={150}
              disabled={busy}
              onChange={(event) =>
                props.onChange({ ...originalProject, title: event.target.value })
              }
              onBlur={() => {
                if (!project.title.trim())
                  props.onChange({ ...originalProject, title: '새 화면해설 대본' })
              }}
            />
            <span
              className={props.saveError ? 'save-status failed' : 'save-status'}
            >
              {props.saveError
                ? '저장 실패 · JSON 백업 필요'
                : '✓ 이 브라우저에 자동 저장'}
            </span>
          </div>
        </div>
        <div className="work-actions">
          <button
            className="quiet"
            onClick={() => setToolsOpen(!toolsOpen)}
            aria-expanded={toolsOpen}
          >
            작업 도구 {toolsOpen ? '−' : '+'}
          </button>
          <details className="export-menu">
            <summary aria-disabled={busy}>대본 내보내기 ↓</summary>
            <div>
              <button
                disabled={busy}
                onClick={() => void props.onExport('hwpx')}
              >
                <strong>HWPX 한글 대본</strong>
                <small>대사와 해설을 5열 문서로</small>
              </button>
              <button
                disabled={busy}
                onClick={() => void props.onExport('srt')}
              >
                <strong>SRT 자막</strong>
                <small>대사 행의 시간과 내용</small>
              </button>
              <button onClick={() => void props.onExport('json')}>
                <strong>JSON 작업 백업</strong>
                <small>계속 편집할 수 있는 원본 대본</small>
              </button>
            </div>
          </details>
        </div>
      </div>
      {toolsOpen && (
        <section className="tools-panel" aria-label="작업 도구">
          <div className="tools-intro">
            <span className="eyebrow">작업 시작하기</span>
            <h2>나에게 맞는 방법으로</h2>
            <label className="rights-check">
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
                disabled={busy}
              />
              선택할 영상·음성·자막을 사용할 권리가 있습니다.
            </label>
          </div>
          <div className="tool-option">
            <b>01. 원본 파일</b>
            <p>
              MP4 · WebM · MP3 · WAV
              <br />
              영상은 서버에 업로드하지 않습니다.
            </p>
            <button
              className="secondary"
              disabled={!rights || busy}
              onClick={() => mediaInput.current?.click()}
            >
              {props.mediaLoading ? '파일 확인 중 · 다른 파일 선택' : '영상·음성 선택'}
            </button>
            {project.mediaName && (
              <small className="file-name">
                {props.file ? '연결됨: ' : '다시 선택 필요: '}
                {project.mediaName}
              </small>
            )}
          </div>
          <div className="tool-option">
            <b>02. 대사 준비</b>
            <p>
              자막이 있다면 바로 불러오세요.
              <br />
              자막이 없어도 직접 쓸 수 있어요.
            </p>
            <div className="inline">
              <button
                className="secondary"
                disabled={!rights || busy}
                onClick={() => {
                  if (
                    !Number.isFinite(Number(offset)) ||
                    !Number.isSafeInteger(Math.round(Number(offset) * 1000))
                  )
                    setLocalError('자막 시간차를 올바른 숫자로 입력해 주세요.')
                  else srtInput.current?.click()
                }}
              >
                SRT 불러오기
              </button>
              <label className="offset-label">
                시간차(초)
                <input
                  type="number"
                  step="0.1"
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>
          </div>
          <div className="tool-option ai-option">
            <b>✦ 무료 AI 음성 분석</b>
            <p>
              긴 영상·큰 파일 자동 분할 · 최대 3시간
              <br />약 1분씩 순차 분석 · 원본 시간으로 자동 합치기
            </p>
            <label>
              음성 언어
              <select aria-label="음성 언어" value={publicSample ? 'english' : project.transcriptionLanguage ?? 'korean'} disabled={busy || props.mediaLoading || publicSample} onChange={event => props.onChange({ ...originalProject, transcriptionLanguage: event.target.value as SpeechLanguage })}>
                {SPEECH_LANGUAGES.map(item => <option key={item.speech} value={item.speech}>{item.label}</option>)}
              </select>
            </label>
            {!publicSample && (project.transcriptionLanguage ?? 'korean') === 'korean' && <label>
              한국어 분석 품질
              <select aria-label="한국어 분석 품질" value={project.koreanAsrMode ?? 'auto'} disabled={busy || props.mediaLoading}
                onChange={event => props.onChange({ ...originalProject, koreanAsrMode: event.target.value as KoreanAsrMode })}>
                <option value="auto">자동 · GPU 정밀 / CPU 호환</option>
                <option value="precision">정밀 · large-v3-turbo · GPU 필요</option>
                <option value="compatible">호환 · small · CPU</option>
              </select>
            </label>}
            <button
              className="primary"
              disabled={(!publicSample && (!props.file || !rights)) || busy || props.mediaLoading}
              onClick={() => void props.onAnalyze()}
            >
              AI로 대사 만들기
            </button>
            <small>첫 실행 시 모델 다운로드 · 원어로 전사 · 초안 검수 필요</small>
            {!publicSample && (project.transcriptionLanguage ?? 'korean') === 'korean' &&
              <small className="asr-model-note">한국어 정밀 약 1.6GB / 호환 약 255MB. 발화 검출 후 분석하고 반복 의심 구간은 짧게 다시 듣습니다. 사투리·고유명사·겹친 대사는 검수가 필요합니다.</small>}
          </div>
        </section>
      )}
      {project.lastAsrProfile && <div className="asr-status" aria-label="사용한 음성 인식 모델">
        <span>{ASR_PROFILES[project.lastAsrProfile].label}</span>
        <button className="quiet" disabled={busy} onClick={() => setToolsOpen(true)}>분석 설정 · 다시 분석</button>
      </div>}
      {asrAttention.length > 0 && <div className="asr-attention" role="status">
        <strong>음성 인식 확인 필요 · {asrAttention.length}행</strong>
        <span>반복하거나 잘렸을 수 있는 대사를 표시했습니다. 원음을 듣고 수정·확인한 뒤 내보내 주세요.</span>
        <button className="secondary" disabled={busy} onClick={() => {
          if (originalProject.dialogueLanguage === 'korean') props.onChange({ ...originalProject, dialogueLanguage: 'original' })
          setFilter('pending'); select(asrAttention[0])
        }}>첫 확인 필요 대사로</button>
      </div>}
      <TranslationPanel project={originalProject} busy={busy || props.mediaLoading} onTranslate={props.onTranslate} onChange={props.onChange} onRestore={() => props.onRestoreTranslation()} />
      {busy && (
        <section className="analysis-progress" aria-live="polite">
          <div>
            <strong>{props.progress.message}</strong>
            <p>
              이 창을 열어 두세요. 첫 실행에는 모델 다운로드가 필요하며,
              긴 영상이나 많은 대사는 처리에 시간이 걸립니다.
            </p>
            <progress max="100" value={props.progress.percent} />
          </div>
          <button className="secondary" onClick={props.onCancel}>
            {props.busyOperation === 'translation' ? '번역 취소' : '분석 취소'}
          </button>
        </section>
      )}
      {localError && (
        <div className="banner error" role="alert">
          {localError}
          <button onClick={() => setLocalError('')} aria-label="작업 오류 닫기">
            ×
          </button>
        </div>
      )}
      <div className="editor-grid">
        <section className="media-pane" aria-label="영상 미리보기">
          <div className="pane-heading">
            <span>장면 보기</span>
            <span>
              {publicSample ? '실제 영어 대화 · 퍼블릭도메인' : '내 기기 영상'}
            </span>
          </div>
          {mediaSource ? (
            <video
              ref={video}
              className={`video-player${publicSample ? ' public-domain' : ''}`}
              controls
              playsInline
              preload="metadata"
              src={mediaSource}
              poster={publicSample ? SAMPLE_MEDIA.poster : undefined}
              onPlay={() => setPlaying(true)}
              onPause={() => { setPlaying(false); cancelRange() }}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = Math.min(
                  time / 1000,
                  e.currentTarget.duration
                )
              }}
              onTimeUpdate={(e) => {
                const currentMs = Math.round(e.currentTarget.currentTime * 1000)
                setTime(currentMs)
                if (stopAt.current !== null && currentMs >= stopAt.current) {
                  const end = stopAt.current
                  cancelRange()
                  e.currentTarget.pause()
                  e.currentTarget.currentTime = end / 1000
                  setTime(end)
                }
              }}
              onError={() =>
                setLocalError(
                  publicSample
                    ? '샘플 영상을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 열어 주세요.'
                    : '영상 재생 중 오류가 발생했습니다. 브라우저가 지원하는 MP4(H.264/AAC)로 변환해 주세요.'
                )
              }
            >
              {captionUrl && <track key={captionUrl} src={captionUrl} kind="subtitles" srcLang={project.dialogueLanguage === 'korean' ? 'ko' : project.translationSourceLanguage ?? translationLanguageForSpeech(project.transcriptionLanguage) ?? 'ko'} label="대본 자막" default onLoad={event => { event.currentTarget.track.mode = 'showing' }} />}
            </video>
          ) : (
            <div className="media-empty">
              <span className="media-empty-icon">▷</span>
              <h2>
                {project.sample
                  ? '이전 버전의 연습 대본'
                  : project.mediaName
                    ? '영상을 다시 연결해 주세요'
                    : '어떤 이야기를 들려줄까요?'}
              </h2>
              <p>
                {project.sample
                  ? '작성한 대본은 보존되어 있습니다. 실제 기록영상은 홈에서 새 샘플을 열어 확인하세요.'
                  : project.mediaName
                    ? '대본은 저장되어 있습니다. 원본 영상은 이 기기에서 다시 선택하세요.'
                    : '작업 도구에서 영상과 자막을 선택하거나 대사를 직접 입력해 보세요.'}
              </p>
              <button className="secondary" onClick={() => setToolsOpen(true)}>
                작업 도구 열기
              </button>
            </div>
          )}
          {publicSample && (
            <div className="sample-credit">
              <strong>{SAMPLE_MEDIA.title}</strong>
              <p>{SAMPLE_MEDIA.credit} · 원본 01:10–02:10 발췌</p>
              <p>
                배우 두 사람의 실제 영어 대화입니다. {project.source === 'sample' ? '오른쪽은 이 영상으로 미리 실행한 AI 초안입니다.' : '오른쪽 대본과 원음을 대조하세요.'} 대사 행의 구간 재생 버튼으로 시작·끝을 확인하고 틀린 말과 시간을 수정하세요.
              </p>
              <button className="primary" disabled={busy || props.mediaLoading} onClick={() => void props.onAnalyze()}>샘플 음성 AI 다시 분석</button>
              <a href={SAMPLE_MEDIA.sourceUrl} target="_blank" rel="noreferrer">
                원본 영상·퍼블릭도메인 출처 확인 ↗
              </a>
            </div>
          )}
          <div className="timeline-control">
            <div>
              <button
                className="play-button"
                aria-label={playing ? '영상 일시 정지' : '영상 재생'}
                disabled={!mediaSource}
                onClick={async () => {
                  if (!video.current) return
                  if (playing) video.current.pause()
                  else {
                    try {
                      if (video.current.ended) video.current.currentTime = 0
                      await video.current.play()
                    } catch {
                      setLocalError(
                        '영상을 재생하지 못했습니다. 플레이어의 재생 버튼을 눌러 주세요.'
                      )
                    }
                  }
                }}
              >
                {playing ? 'Ⅱ' : '▶'}
              </button>
              <span>
                <strong>{formatTimecode(time)}</strong> /{' '}
                {formatTimecode(project.durationMs)}
              </span>
              <span className="sample-only">
                행을 누르면 해당 시간으로 이동
              </span>
            </div>
            <input
              type="range"
              aria-label="재생 위치"
              min="0"
              max={project.durationMs}
              step="100"
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
          {publicSample && <SampleComparison rows={originalProject.rows} onPlay={(start, end) => void playRange(start, end)} />}
          <div className="writer-note">
            <span className="eyebrow">작가의 시선으로</span>
            <h2>대사 사이, 이야기가 머무는 곳.</h2>
            <p>
              해설 후보를 골라 화면에 보이는 행동과 표정을 적어 보세요. 짧고
              선명한 한 문장이 장면을 전합니다.
            </p>
            <div>
              해설 후보는 대사 시간 사이의 빈 구간입니다.
              <br />
              음악·효과음·실제 무음은 영상을 보며 확인하세요.
            </div>
          </div>
          <div className="media-meta">
            <span>개인정보</span>
            <p>
              원본 영상과 대본은 외부로 전송되지 않습니다. 대본은 이 브라우저에
              저장됩니다. 중요한 작업은 JSON으로 백업하세요.
            </p>
          </div>
        </section>
        <section className="script-pane" aria-label="대본 편집">
          <div className="script-heading">
            <div>
              <h2>
                나의 대본 <span>{project.rows.length}</span>
              </h2>
              <p>
                {approved}개 확인 완료 · {project.rows.length - approved}개 남음
              </p>
            </div>
            <button
              className="quiet"
              disabled={!props.canUndo || busy}
              onClick={props.onUndo}
            >
              ↶ 되돌리기
            </button>
          </div>
          <div className="review-progress" aria-label="검수 진행률">
            <span
              style={{
                width: `${project.rows.length ? (approved / project.rows.length) * 100 : 0}%`
              }}
            />
          </div>
          <div className="script-filters">
            <div role="group" aria-label="행 필터">
              <button
                className={filter === 'all' ? 'active' : ''}
                onClick={() => setFilter('all')}
              >
                전체
              </button>
              <button
                className={filter === 'descriptionGap' ? 'active' : ''}
                onClick={() => setFilter('descriptionGap')}
              >
                해설
              </button>
              <button
                className={filter === 'pending' ? 'active' : ''}
                onClick={() => setFilter('pending')}
              >
                미확인
              </button>
            </div>
            <span>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => addRow('dialogue')}
              >
                대사 +
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => addRow('descriptionGap')}
              >
                해설 +
              </button>
            </span>
          </div>
          <div className="script-list">
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <article
                  id={`row-${row.id}`}
                  key={row.id}
                  className={`script-row ${row.kind === 'descriptionGap' ? 'gap' : ''} ${row.id === selected ? 'selected' : ''} ${row.reviewed ? 'reviewed' : ''} ${originalsById.get(row.id)?.asrWarnings?.length && !row.reviewed ? 'asr-flagged' : ''}`}
                >
                  <button
                    className="row-select"
                    disabled={busy}
                    onClick={() => select(row)}
                    aria-label={`${formatTimecode(row.startMs)} ${row.kind === 'dialogue' ? '대사' : '해설'} 선택`}
                    aria-pressed={selected === row.id}
                  >
                    <span className="row-number">
                      {String(project.rows.indexOf(row) + 1).padStart(2, '0')}
                    </span>
                    <div className="row-main">
                      <div className="row-meta">
                        <span className="row-kind">
                          {row.kind === 'dialogue' ? '대사' : '해설'}
                        </span>
                        <time>
                          {formatTimecode(row.startMs)} —{' '}
                          {formatTimecode(row.endMs)}
                        </time>
                        <span className="row-review">
                          {row.reviewed ? '✓ 확인 완료' : originalsById.get(row.id)?.asrWarnings?.length ? '⚠ 음성 확인 필요' : '확인 전'}
                        </span>
                      </div>
                      <p>
                        {row.content ||
                          (row.kind === 'dialogue'
                            ? '대사를 입력해 주세요.'
                            : '화면에 보이는 장면을 적어 주세요.')}
                      </p>
                    </div>
                  </button>
                  {selectedRow?.id === row.id && (
                    <div className="row-editor">
                      {originalsById.get(row.id)?.asrWarnings?.length &&
                        <div className="asr-row-warning">
                          반복 인식 또는 문장 잘림이 의심되는 구간입니다. 원음을 들으며 대사와 시작·종료 시간을 확인해 주세요.
                          {originalsById.get(row.id)?.asrOriginalText && <details>
                            <summary>재분석 전 인식 결과 보기</summary>
                            <p>{originalsById.get(row.id)?.asrOriginalText}</p>
                          </details>}
                        </div>}
                      {mediaSource && <button className="secondary row-play" onClick={() => void playRange(row.startMs, row.endMs)} aria-label="선택한 대사 구간 재생">▶ 이 구간 듣기</button>}
                      <div className="time-fields">
                        <TimeField
                          key={`${row.id}-start-${row.startMs}`}
                          label="시작"
                          value={row.startMs}
                          disabled={busy}
                          onCommit={(value) => {
                            if (value >= row.endMs)
                              return '시작은 종료보다 앞이어야 합니다.'
                            patch(row, { startMs: value })
                            return null
                          }}
                          onError={setLocalError}
                        />
                        <span>→</span>
                        <TimeField
                          key={`${row.id}-end-${row.endMs}`}
                          label="종료"
                          value={row.endMs}
                          disabled={busy}
                          onCommit={(value) => {
                            if (
                              value <= row.startMs ||
                              value > project.durationMs
                            )
                              return '종료는 시작보다 뒤이며 영상 길이 이내여야 합니다.'
                            patch(row, { endMs: value })
                            return null
                          }}
                          onError={setLocalError}
                        />
                        <label>
                          구분
                          <select
                            disabled={busy}
                            value={row.kind}
                            onChange={(e) =>
                              patch(row, {
                                kind: e.target.value as ScriptRow['kind']
                              })
                            }
                          >
                            <option value="dialogue">대사</option>
                            <option value="descriptionGap">해설</option>
                          </select>
                        </label>
                      </div>
                      <label
                        className="editor-label"
                        htmlFor={`content-${row.id}`}
                      >
                        {row.kind === 'dialogue'
                          ? project.dialogueLanguage === 'korean' ? '한국어 대사 내용' : '대사 내용'
                          : '화면해설 내용'}
                      </label>
                      <textarea
                        id={`content-${row.id}`}
                        rows={4}
                        maxLength={10000}
                        value={row.content}
                        disabled={busy}
                        onChange={(e) =>
                          patch(row, { content: e.target.value })
                        }
                        placeholder={
                          row.kind === 'dialogue'
                            ? '들리는 대사를 입력하세요.'
                            : '보이는 장면을 짧고 선명하게 적어 보세요.'
                        }
                      />
                      {project.dialogueLanguage === 'korean' && row.kind === 'dialogue' && <div className="translation-original">
                        <strong>원문</strong>
                        <p>{originalsById.get(row.id)?.content}</p>
                        {originalsById.get(row.id)?.translation?.draft.trim() &&
                          <button className="quiet" disabled={busy} onClick={() => props.onRestoreTranslation(row.id)}>이 대사 처음 번역으로 복원</button>}
                      </div>}
                      <div className="editor-actions">
                        <button
                          className="quiet danger-text"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                '이 행을 삭제할까요? 되돌리기로 복원할 수 있습니다.'
                              )
                            )
                              props.onRowsChange(
                                project.rows.filter(
                                  (item) => item.id !== row.id
                                )
                              )
                          }}
                        >
                          행 삭제
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => approveNext(row)}
                        >
                          확인 완료 · 다음 →
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <div className="empty-rows">
                <span>✎</span>
                <h3>
                  {project.rows.length
                    ? '이 조건에 맞는 행이 없어요.'
                    : '첫 문장을 기다리고 있어요.'}
                </h3>
                <p>
                  {project.rows.length
                    ? '다른 필터를 선택해 보세요.'
                    : 'SRT를 가져오거나 AI 분석을 실행하세요. 대사 + 버튼으로 직접 시작해도 좋습니다.'}
                </p>
              </div>
            )}
          </div>
          <div className="script-bottom">
            <span>
              {issues.length
                ? `${issues.length}개 항목 확인 필요 · 빈 내용 또는 시간 겹침`
                : '시간과 내용을 확인하며 나만의 대본을 완성하세요.'}
            </span>
            <button
              className="quiet"
              disabled={busy || !project.rows.length}
              onClick={() => {
                try {
                  props.onRowsChange(
                    addDescriptionCandidates(project.rows, project.durationMs)
                  )
                } catch (e) {
                  setLocalError(
                    e instanceof Error
                      ? e.message
                      : '해설 후보를 만들지 못했습니다.'
                  )
                }
              }}
            >
              해설 후보 채우기
            </button>
          </div>
        </section>
      </div>
      <input
        ref={mediaInput}
        type="file"
        accept="video/*,audio/*,.mp4,.webm,.mp3,.wav,.m4a"
        hidden
        aria-label="영상·음성 파일"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void props.onMedia(file)
          e.target.value = ''
        }}
      />
      <input
        ref={srtInput}
        type="file"
        accept=".srt"
        hidden
        aria-label="SRT 자막 파일"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file)
            void props.onSubtitle(file, Math.round(Number(offset) * 1000))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function TimeField({
  label,
  value,
  disabled,
  onCommit,
  onError
}: {
  label: string
  value: number
  disabled: boolean
  onCommit: (ms: number) => string | null
  onError: (message: string) => void
}) {
  const [text, setText] = useState(formatTimecode(value))
  return (
    <label>
      {label}
      <input
        aria-label={`${label} 시간`}
        disabled={disabled}
        value={text}
        placeholder="00:00.000"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const ms = parseTimecode(text)
          if (ms === value) return
          const error =
            ms === null
              ? '시간은 분:초 또는 분:초.밀리초 형식으로 입력해 주세요.'
              : onCommit(ms)
          if (error) {
            onError(error)
            setText(formatTimecode(value))
          }
        }}
      />
    </label>
  )
}
