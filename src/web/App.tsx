import { useEffect, useRef, useState } from 'react'
import type { ScriptRow } from '../shared/types'
import { validateRows } from '../shared/rows'
import { addDescriptionCandidates } from '../shared/description-candidates'
import { buildSrtContent } from '../shared/srt'
import {
  createProject,
  createSampleProject,
  loadProjects,
  saveProject,
  deleteProject,
  parseProject,
  serializeProject,
  importSubtitle,
  MAX_MEDIA_DURATION_MS,
  type WebProject
} from './project'
import { createHwpxBlob, downloadBlob, safeFileName } from './export'
import { transcribeFile } from './transcription'
import Workspace from './Workspace'
import logo from '../renderer/src/assets/branding/ginuni-logo.png'
import icon from '../renderer/src/assets/branding/ginuni-icon.png'

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : '작업을 완료하지 못했습니다. 다시 시도해 주세요.'

export default function App() {
  const [project, setProject] = useState<WebProject | null>(null)
  const [projects, setProjects] = useState<WebProject[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '' })
  const [help, setHelp] = useState(false)
  const history = useRef<Array<{ project: WebProject; file: File | null }>>([])
  const currentProject = useRef(project)
  currentProject.current = project
  const cancellation = useRef<AbortController | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      setProjects(loadProjects())
    } catch (e) {
      setError(messageOf(e))
    }
  }, [])
  useEffect(() => {
    if (!project) return
    try {
      saveProject(project)
      setProjects(loadProjects())
      setSaveError('')
    } catch (e) {
      setSaveError(messageOf(e))
    }
  }, [project])
  useEffect(() => {
    if (!file) {
      setMediaUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setMediaUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy || saveError) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy, saveError])
  useEffect(() => () => cancellation.current?.abort(), [])

  function open(next: WebProject | null) {
    if (
      saveError &&
      !window.confirm(
        '브라우저에 저장하지 못한 변경이 있습니다. JSON 백업을 받지 않았다면 취소해 주세요. 계속 이동할까요?'
      )
    )
      return
    history.current = []
    setFile(null)
    setProject(next)
    setError('')
    setNotice('')
    setSaveError('')
  }
  function update(next: WebProject) {
    if (!project) return
    history.current = [...history.current.slice(-19), { project, file }]
    setProject({ ...next, updatedAt: new Date().toISOString() })
  }
  function rowsChanged(rows: ScriptRow[]) {
    if (project) update({ ...project, rows })
  }
  function replaceRows(
    rows: ScriptRow[],
    source: WebProject['source'],
    durationMs?: number
  ): boolean {
    if (!project) return false
    if (
      project.rows.length &&
      !window.confirm(
        '현재 대본을 새 초안으로 바꿀까요? 바로 이전 상태는 ‘되돌리기’로 복원할 수 있습니다.'
      )
    )
      return false
    update({
      ...project,
      source,
      rows,
      durationMs: durationMs ?? project.durationMs
    })
    return true
  }
  async function attachMedia(selected: File) {
    if (!project) return
    setError('')
    const url = URL.createObjectURL(selected)
    const media = document.createElement('video')
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const timeout = window.setTimeout(
          () =>
            reject(
              new Error(
                '영상 정보를 읽지 못했습니다. MP4(H.264/AAC) 또는 MP3/WAV 파일을 선택해 주세요.'
              )
            ),
          15000
        )
        media.onloadedmetadata = () => {
          clearTimeout(timeout)
          resolve(Math.round(media.duration * 1000))
        }
        media.onerror = () => {
          clearTimeout(timeout)
          reject(
            new Error(
              '이 브라우저가 지원하지 않는 파일입니다. MP4(H.264/AAC) 또는 MP3/WAV를 사용해 주세요.'
            )
          )
        }
        media.preload = 'metadata'
        media.src = url
      })
      if (currentProject.current !== project)
        throw new Error(
          '파일을 읽는 동안 작업이 변경되었습니다. 변경한 대본을 보존했습니다. 파일을 다시 선택해 주세요.'
        )
      if (
        !Number.isSafeInteger(duration) ||
        duration <= 0 ||
        duration > MAX_MEDIA_DURATION_MS
      )
        throw new Error('영상 길이는 0초 초과, 3시간 이하여야 합니다.')
      if (project.rows.some((row) => row.endMs > duration))
        throw new Error(
          '선택한 영상이 대본의 종료 시간보다 짧습니다. 새 작업을 만들거나 행 시간을 먼저 수정해 주세요.'
        )
      setFile(selected)
      update({
        ...project,
        mediaName: selected.name,
        durationMs: duration,
        sample: false
      })
      setNotice('파일을 연결했습니다. 영상·음성은 이 기기에서만 처리됩니다.')
    } catch (e) {
      setError(messageOf(e))
    } finally {
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
    }
  }
  async function importSrt(selected: File, offsetMs: number) {
    if (!project) return
    setError('')
    try {
      if (selected.size > 5 * 1024 * 1024)
        throw new Error('자막 파일은 5MB 이하로 선택해 주세요.')
      const bytes = new Uint8Array(await selected.arrayBuffer())
      if (currentProject.current !== project)
        throw new Error(
          '자막을 읽는 동안 작업이 변경되었습니다. 변경한 대본을 보존했습니다. 자막을 다시 선택해 주세요.'
        )
      const hasDuration = Boolean(project.mediaName || project.sample)
      const result = importSubtitle(
        bytes,
        hasDuration ? project.durationMs : 0,
        offsetMs
      )
      const duration = hasDuration
        ? project.durationMs
        : Math.max(project.durationMs, ...result.rows.map((row) => row.endMs))
      if (
        replaceRows(
          addDescriptionCandidates(result.rows, duration),
          'subtitle',
          duration
        )
      )
        setNotice(`자막을 가져왔습니다. ${result.warnings.join(' ')}`)
    } catch (e) {
      setError(messageOf(e))
    }
  }
  async function analyze() {
    if (!file || !project || busy) return
    if (
      project.rows.length &&
      !window.confirm(
        '분석 완료 후 현재 대본을 AI 초안으로 바꿉니다. 계속할까요? 실패하거나 취소하면 기존 대본은 유지됩니다.'
      )
    )
      return
    const controller = new AbortController()
    cancellation.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    setProgress({ percent: 0, message: '음성 분석을 준비합니다.' })
    try {
      const result = await transcribeFile(file, {
        signal: controller.signal,
        onProgress: setProgress
      })
      if (controller.signal.aborted) return
      const rows: ScriptRow[] = result.segments.map((segment) => ({
        id: crypto.randomUUID(),
        kind: 'dialogue',
        startMs: segment.startMs,
        endMs: segment.endMs,
        content: segment.text,
        speakers: [],
        sourceSegmentIds: [segment.id],
        reviewed: false
      }))
      if (!rows.length)
        throw new Error(
          '인식된 대사가 없습니다. 음성 유무를 확인하거나 SRT 자막으로 시작해 주세요.'
        )
      update({
        ...project,
        source: 'transcription',
        rows: addDescriptionCandidates(rows, result.durationMs),
        durationMs: result.durationMs
      })
      setNotice(
        'AI 초안을 만들었습니다. 인식 오류와 타임코드를 확인해 주세요. 화자는 자동으로 분리하지 않습니다.'
      )
    } catch (e) {
      if (controller.signal.aborted)
        setNotice('음성 분석을 취소했습니다. 기존 대본은 유지됩니다.')
      else setError(messageOf(e))
    } finally {
      setBusy(false)
      cancellation.current = null
    }
  }
  async function exportProject(format: 'hwpx' | 'srt' | 'json') {
    if (!project) return
    setError('')
    try {
      if (format !== 'json') {
        if (!project.rows.length) throw new Error('먼저 대본을 작성해 주세요.')
        const issues = validateRows(project.rows)
        if (issues.length)
          throw new Error(
            `내보내기 전에 확인해 주세요: ${issues.slice(0, 3).join(' ')}`
          )
        if (
          format === 'srt' &&
          !project.rows.some((row) => row.kind === 'dialogue')
        )
          throw new Error(
            'SRT로 저장할 대사 행이 없습니다. 해설을 포함한 대본은 HWPX로 저장해 주세요.'
          )
        const pending = project.rows.filter((row) => !row.reviewed).length
        if (
          pending &&
          !window.confirm(
            `아직 확인하지 않은 행이 ${pending}개입니다. 검수 전 초안으로 내보낼까요?`
          )
        )
          return
      }
      const blob =
        format === 'hwpx'
          ? await createHwpxBlob(project.title, project.rows)
          : new Blob(
              [
                format === 'srt'
                  ? buildSrtContent(project.rows, true)
                  : serializeProject(project)
              ],
              {
                type:
                  format === 'srt'
                    ? 'application/x-subrip;charset=utf-8'
                    : 'application/json'
              }
            )
      downloadBlob(blob, `${safeFileName(project.title)}.${format}`)
      setNotice(
        `${format.toUpperCase()} 파일을 저장했습니다.${format === 'srt' ? ' SRT에는 대사 행만 포함됩니다.' : ''}`
      )
    } catch (e) {
      setError(messageOf(e))
    }
  }
  async function restore(selected: File) {
    try {
      if (selected.size > 20 * 1024 * 1024)
        throw new Error('백업 파일은 20MB 이하여야 합니다.')
      const before = currentProject.current
      const restored = parseProject(await selected.text())
      if (currentProject.current !== before)
        throw new Error(
          '백업을 읽는 동안 다른 작업으로 이동했습니다. 백업 파일을 다시 선택해 주세요.'
        )
      open({
        ...restored,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString()
      })
      setNotice(
        '백업 대본을 새 작업으로 복원했습니다. 원본 영상은 다시 선택해 주세요.'
      )
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand"
          aria-label="기누니 홈"
          onClick={() => open(null)}
          disabled={busy}
        >
          <img src={logo} alt="기누니 GiNuNi" />
          <span>
            웹 작업실 <i>BETA</i>
          </span>
        </button>
        <nav aria-label="주 메뉴">
          <span className="privacy-badge">
            <span />내 기기에서 안전하게
          </span>
          <button
            className="quiet"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
          >
            사용 안내
          </button>
          <a
            className="quiet"
            href="https://github.com/buildergarlic/ginuni"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>
      <main id="main">
        {help && (
          <section className="help-panel" aria-label="사용 안내">
            <div>
              <h2>화면해설 대본, 이렇게 만드세요.</h2>
              <p>
                ① 샘플 또는 새 작업 시작 → ② 영상·자막을 보며 대사와 해설 수정 →
                ③ 한 줄씩 확인 후 HWPX로 저장.
              </p>
              <p>
                AI는 대사를 전사합니다. 해설 후보는 대사가 없는 시간 구간이며,
                실제 무음 여부와 화면 내용은 작가가 확인합니다. 영상의 장면을
                자동으로 묘사하거나 화자를 자동 분리하지 않습니다.
              </p>
              <p>
                AI 분석: 최대 5분·100MB, 최초 모델 다운로드 필요. Chrome·Edge
                최신 버전을 권장하며 기기 성능에 따라 수 분 걸릴 수 있습니다. 긴
                영상은 SRT로 시작하세요.
              </p>
              <p>
                대본은 현재 브라우저에 최대 10개 저장됩니다. 브라우저 데이터
                삭제 시 사라지므로 JSON 백업을 보관하세요. 영상은 저장하지
                않으며 새로고침 후 다시 선택합니다. 영상·대본은 서버로 전송하지
                않습니다. AI 모델 다운로드 시 Hugging Face에 접속합니다.
              </p>
            </div>
            <button className="quiet" onClick={() => setHelp(false)}>
              닫기 ×
            </button>
          </section>
        )}
        {(error || saveError) && (
          <div className="banner error" role="alert">
            {error || saveError}
            {saveError && project && (
              <button onClick={() => void exportProject('json')}>
                JSON 백업 저장
              </button>
            )}
            <button aria-label="오류 메시지 닫기" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
            <button aria-label="안내 메시지 닫기" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {project ? (
          <Workspace
            key={project.id}
            project={project}
            file={file}
            mediaUrl={mediaUrl}
            busy={busy}
            progress={progress}
            saveError={saveError}
            onBack={() => open(null)}
            onChange={update}
            onRowsChange={rowsChanged}
            onMedia={attachMedia}
            onSubtitle={importSrt}
            onAnalyze={analyze}
            onCancel={() => cancellation.current?.abort()}
            onExport={exportProject}
            onUndo={() => {
              const previous = history.current.pop()
              if (previous) {
                setProject(previous.project)
                setFile(previous.file)
              }
            }}
            canUndo={history.current.length > 0}
          />
        ) : (
          <>
            <section className="home-hero">
              <div className="hero-copy">
                <span className="eyebrow">
                  더 많은 사람이, 같은 장면을 만나도록
                </span>
                <h1>
                  보이는 장면을
                  <br />
                  <em>들리는 이야기로.</em>
                </h1>
                <p>
                  영상 속 대사를 정리하고, 그 사이에 해설을 더하세요.
                  <br />
                  기누니가 준비한 작업실에서 작가의 이야기가 시작됩니다.
                </p>
                <div className="hero-actions">
                  <button
                    className="primary large"
                    onClick={() => open(createSampleProject())}
                  >
                    샘플로 바로 체험하기 <span>→</span>
                  </button>
                  <button
                    className="secondary large"
                    onClick={() => open(createProject())}
                  >
                    내 영상으로 시작
                  </button>
                </div>
                <span className="hero-note">
                  설치 없이 · 회원가입 없이 · 무료로 시작
                </span>
              </div>
              <div
                className="hero-preview"
                aria-label="대사 사이에 화면해설을 작성하는 예시"
              >
                <div className="preview-top">
                  <span className="window-dots">● ● ●</span>
                  <span>GiNuNi Atelier</span>
                  <span>✦</span>
                </div>
                <div className="preview-landscape">
                  <div className="sun" />
                  <div className="hill hill-back" />
                  <div className="hill" />
                  <div className="trail" />
                  <span className="landscape-caption">
                    모든 장면에는
                    <br />
                    전하고 싶은 이야기가 있어요.
                  </span>
                </div>
                <div className="preview-line">
                  <span>00:04</span>
                  <b>대사</b>
                  <p>벤치까지 천천히 같이 걸을까?</p>
                  <span>✓</span>
                </div>
                <div className="preview-line description">
                  <span>00:09</span>
                  <b>해설</b>
                  <p>
                    초록빛 산책로를 따라 두 사람이 걷는다.
                    <i />
                  </p>
                </div>
                <div className="preview-bottom">
                  <span className="dot" /> 당신의 문장으로 채워지는 대본
                </div>
              </div>
            </section>
            <section className="feature-strip" aria-label="작업 순서">
              <article>
                <span className="step-number">01</span>
                <div>
                  <h2>대사를 준비하고</h2>
                  <p>브라우저 AI 분석 · SRT 불러오기</p>
                </div>
              </article>
              <article>
                <span className="step-number">02</span>
                <div>
                  <h2>장면에 해설을 더하고</h2>
                  <p>영상과 대본을 나란히 보며 검수</p>
                </div>
              </article>
              <article>
                <span className="step-number">03</span>
                <div>
                  <h2>완성한 대본을 담아요</h2>
                  <p>한글 HWPX · SRT · JSON 백업</p>
                </div>
              </article>
            </section>
            <section className="recent-section">
              <div className="section-title">
                <div>
                  <span className="eyebrow">MY WORKSPACE</span>
                  <h2>이어서 작업하기</h2>
                </div>
                <button
                  className="secondary"
                  onClick={() => backupInput.current?.click()}
                >
                  JSON 백업 불러오기
                </button>
              </div>
              {projects.length ? (
                <div className="project-grid">
                  {projects.map((item) => (
                    <article className="project-card" key={item.id}>
                      <button
                        className="project-open"
                        onClick={() => open(item)}
                      >
                        <span className="project-icon">▤</span>
                        <span className="project-kind">
                          {item.sample ? '연습용 샘플' : '내 대본'}
                        </span>
                        <h3>{item.title}</h3>
                        <p>
                          {item.rows.length}개 행 ·{' '}
                          {new Date(item.updatedAt).toLocaleDateString('ko-KR')}
                        </p>
                        <span className="project-arrow">↗</span>
                      </button>
                      <button
                        className="delete-project"
                        aria-label={`${item.title} 삭제`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `‘${item.title}’ 대본을 이 브라우저에서 삭제할까요?`
                            )
                          ) {
                            try {
                              deleteProject(item.id)
                              setProjects(loadProjects())
                            } catch (e) {
                              setError(messageOf(e))
                            }
                          }
                        }}
                      >
                        삭제
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-projects">
                  <img src={icon} alt="" />
                  <div>
                    <strong>첫 이야기를 시작해 보세요.</strong>
                    <p>작성한 대본은 이 브라우저에 자동으로 저장됩니다.</p>
                  </div>
                  <button
                    className="quiet"
                    onClick={() => open(createProject())}
                  >
                    새 작업 만들기 +
                  </button>
                </div>
              )}
            </section>
            <footer className="site-footer">
              <span>
                GiNuNi · 기누니 <small>by BuilderGarlic</small>
              </span>
              <p>눈으로 보는 세상, 함께 듣는 이야기.</p>
              <a
                href={`${import.meta.env.BASE_URL}licenses.txt`}
                target="_blank"
                rel="noreferrer"
              >
                오픈소스 라이선스 · Web Beta ↗
              </a>
            </footer>
          </>
        )}
        <input
          ref={backupInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="JSON 백업 파일"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) void restore(selected)
            event.target.value = ''
          }}
        />
      </main>
    </div>
  )
}
