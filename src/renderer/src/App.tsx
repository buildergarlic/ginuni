import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DESCRIPTION_TEXT } from '@shared/constants'
import { formatTimecode, parseTimecode } from '@shared/timecode'
import { validateRows } from '@shared/rows'
import type {
  BootstrapData,
  CreateProjectInput,
  ModelDownloadProgress,
  ProcessingProgress,
  ProjectSummary,
  ScriptProject,
  ScriptRow,
  TranscriptionEngine,
  UpdateStatus
} from '@shared/types'

type Screen = 'home' | 'review' | 'settings' | 'about' | 'support'
type SourceTab = 'local' | 'youtube'

interface MediaHandle {
  seek(seconds: number): void
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function statusLabel(status: ProjectSummary['status']): string {
  return ({ draft: '준비', processing: '처리 중', review: '검수', exported: '내보냄', error: '오류' } as const)[status]
}

function videoIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null
    return url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1] || null
  } catch {
    return null
  }
}

function youtubeEmbedUrl(videoId: string): string {
  const parameters = new URLSearchParams({
    enablejsapi: '1',
    playsinline: '1',
    rel: '0'
  })
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${parameters}`
}

const MediaPlayer = forwardRef<MediaHandle, {
  project: ScriptProject
  onTime: (seconds: number) => void
  onError: (message: string) => void
  onReady: () => void
}>(
  function MediaPlayer({ project, onTime, onError, onReady }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const pendingSeekRef = useRef<number | null>(null)
    const youtubeId = project.source.youtubeVideoId ?? videoIdFromUrl(project.source.uri)

    const seekLocalVideo = (seconds: number): void => {
      const video = videoRef.current
      if (!video) return
      if (video.readyState < 1 || !Number.isFinite(video.duration)) {
        pendingSeekRef.current = seconds
        return
      }
      try {
        video.currentTime = Math.min(seconds, Math.max(0, video.duration))
        pendingSeekRef.current = null
      } catch {
        pendingSeekRef.current = seconds
        onError('영상 탐색을 완료하지 못했습니다. 잠시 후 행을 다시 눌러 보세요.')
      }
    }

    useImperativeHandle(ref, () => ({
      seek(seconds: number) {
        const safeSeconds = Math.max(0, seconds)
        onTime(safeSeconds)
        seekLocalVideo(safeSeconds)
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'seekTo', args: [safeSeconds, true] }),
          'https://www.youtube-nocookie.com'
        )
      }
    }), [onTime])

    const handleLoadedMetadata = (): void => {
      onReady()
      const pending = pendingSeekRef.current
      if (pending !== null) seekLocalVideo(pending)
      else if (videoRef.current) onTime(videoRef.current.currentTime)
    }

    const handleMediaError = (): void => {
      const code = videoRef.current?.error?.code
      const detail = code === 4 ? '이 영상의 코덱을 지원하지 않거나 원본 파일을 열 수 없습니다.' : '원본 영상을 읽는 중 오류가 발생했습니다.'
      onError(`${detail} 원본 파일이 이동·삭제되지 않았는지 확인하세요.`)
    }

    useEffect(() => {
      const receive = (event: MessageEvent): void => {
        if (event.origin !== 'https://www.youtube-nocookie.com') return
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          if (typeof data?.info?.currentTime === 'number') onTime(data.info.currentTime)
        } catch {
          // YouTube의 다른 메시지는 무시한다.
        }
      }
      window.addEventListener('message', receive)
      const timer = window.setInterval(() => {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'listening', id: 'screen-description-player', channel: 'info' }),
          'https://www.youtube-nocookie.com'
        )
      }, 500)
      return () => {
        window.removeEventListener('message', receive)
        window.clearInterval(timer)
      }
    }, [onTime])

    if (project.source.kind === 'youtube' && youtubeId) {
      return (
        <iframe
          ref={iframeRef}
          className="media-frame"
          title="유튜브 검수 플레이어"
          src={youtubeEmbedUrl(youtubeId)}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )
    }

    return (
      <video
        ref={videoRef}
        className="media-frame"
        src={`media://project/${project.id}`}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
        onSeeked={(event) => onTime(event.currentTarget.currentTime)}
        onError={handleMediaError}
      />
    )
  }
)

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-illustration"><span>00:03</span><i /><span>대사</span></div>
      <h2>첫 화면해설 대본을 만들어 보세요</h2>
      <p>영상 파일이나 유튜브 링크를 넣으면 화자와 대사 구간을 분석하고 HWPX로 정리합니다.</p>
      <button className="primary-button" onClick={onNew}>새 프로젝트 만들기</button>
    </div>
  )
}

function NewProjectPanel({ bootstrap, onCreated, onOpenSettings }: {
  bootstrap: BootstrapData
  onCreated: (project: ScriptProject) => void
  onOpenSettings: () => void
}) {
  const [tab, setTab] = useState<SourceTab>('local')
  const [localPath, setLocalPath] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [title, setTitle] = useState('')
  const [engine, setEngine] = useState<TranscriptionEngine>('local')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const chooseFile = async (): Promise<void> => {
    const value = await window.screenScript.chooseLocalMedia()
    if (value) setLocalPath(value)
  }

  const create = async (): Promise<void> => {
    setError('')
    const input: CreateProjectInput = {
      kind: tab,
      title: title.trim() || undefined,
      localPath: tab === 'local' ? localPath : undefined,
      youtubeUrl: tab === 'youtube' ? youtubeUrl.trim() : undefined,
      transcriptionEngine: engine
    }
    try {
      setBusy(true)
      onCreated(await window.screenScript.createProject(input))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="new-project-card">
      <div className="section-heading">
        <div><span className="eyebrow">NEW PROJECT</span><h2>새 대본 만들기</h2></div>
        <p>최대 3시간 · 한국어 우선</p>
      </div>
      <label className="field-label">음성 분석 방식</label>
      <div className="engine-options">
        <button className={engine === 'local' ? 'active' : ''} onClick={() => setEngine('local')}>
          <strong>내 PC에서 분석</strong><span>API 키·사용료 없음 · 음성 외부 전송 없음</span>
        </button>
        <button className={engine === 'openai' ? 'active' : ''} onClick={() => setEngine('openai')}>
          <strong>OpenAI로 분석</strong><span>화자 분리 지원 · API 사용료 발생</span>
        </button>
      </div>
      {engine === 'local' && !bootstrap.localModel.installed && (
        <button className="model-notice" onClick={onOpenSettings}>
          <strong>첫 사용 시 로컬 모델 다운로드</strong><span>약 181MB · 설정에서 미리 받을 수 있습니다 →</span>
        </button>
      )}
      {engine === 'openai' && !bootstrap.hasApiKey && (
        <button className="key-warning" onClick={onOpenSettings}>
          <strong>OpenAI 모드는 API 키가 필요합니다</strong><span>처리를 시작하기 전에 설정에서 등록하세요 →</span>
        </button>
      )}
      <div className="source-tabs">
        <button className={tab === 'local' ? 'active' : ''} onClick={() => setTab('local')}>내 컴퓨터 파일</button>
        <button className={tab === 'youtube' ? 'active' : ''} onClick={() => setTab('youtube')}>유튜브 링크</button>
      </div>
      <label className="field-label">프로젝트 제목 <span>선택</span></label>
      <input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="비워두면 영상 제목을 사용합니다" />
      {tab === 'local' ? (
        <button className={`drop-zone ${localPath ? 'selected' : ''}`} onClick={chooseFile}>
          <span className="drop-icon">＋</span>
          <strong>{localPath ? localPath.split(/[\\/]/).pop() : '동영상 또는 음성 파일 선택'}</strong>
          <small>{localPath || 'MP4, MKV, MOV, WEBM, MP3, WAV 등'}</small>
        </button>
      ) : (
        <>
          <label className="field-label">유튜브 주소</label>
          <input className="text-input" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          <p className="helper-text">사용 권한이 있는 공개·일부공개 영상만 입력하세요. 로그인 또는 DRM 영상은 지원하지 않습니다.</p>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
      <button className="primary-button wide" disabled={busy} onClick={create}>{busy ? '만드는 중…' : '프로젝트 만들기'}</button>
    </section>
  )
}

function SettingsScreen({ bootstrap, onChanged, onBack }: {
  bootstrap: BootstrapData
  onChanged: (bootstrap: BootstrapData) => void
  onBack: () => void
}) {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [modelProgress, setModelProgress] = useState<ModelDownloadProgress | null>(null)
  const [modelBusy, setModelBusy] = useState(false)

  useEffect(() => window.screenScript.onModelProgress(setModelProgress), [])

  const save = async (): Promise<void> => {
    try {
      setError('')
      await window.screenScript.saveApiKey(key)
      setKey('')
      setSaved('API 키를 Windows 보안 저장소에 저장했습니다.')
      onChanged({ ...bootstrap, hasApiKey: true })
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const clear = async (): Promise<void> => {
    await window.screenScript.clearApiKey()
    setSaved('저장된 API 키를 삭제했습니다.')
    onChanged({ ...bootstrap, hasApiKey: false })
  }
  const downloadModel = async (): Promise<void> => {
    try {
      setError('')
      setModelBusy(true)
      const localModel = await window.screenScript.downloadLocalModel()
      onChanged({ ...bootstrap, localModel })
      setSaved('로컬 음성인식 모델 설치가 완료되었습니다.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setModelBusy(false) }
  }
  const removeModel = async (): Promise<void> => {
    if (!window.confirm('내려받은 로컬 음성인식 모델을 삭제할까요? 필요할 때 다시 받을 수 있습니다.')) return
    try {
      const localModel = await window.screenScript.deleteLocalModel()
      onChanged({ ...bootstrap, localModel })
      setSaved('로컬 음성인식 모델을 삭제했습니다.')
      setModelProgress(null)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  return (
    <main className="settings-page">
      <button className="back-button" onClick={onBack}>← 돌아가기</button>
      <div className="settings-card">
        <span className="eyebrow">SETTINGS</span>
        <h1>설정</h1>
        <h2>API 없이 내 PC에서 분석</h2>
        <div className="settings-status">
          <span className={`status-dot ${bootstrap.localModel.installed ? 'ok' : ''}`} />
          {bootstrap.localModel.installed ? `${bootstrap.localModel.modelName} 모델이 설치되어 있습니다.` : '로컬 모델을 받으면 API 키 없이 사용할 수 있습니다.'}
        </div>
        <p className="helper-text">영상 음성은 이 PC 안에서만 처리됩니다. 로컬 첫 버전은 자동 화자 분리를 하지 않으며 대사에는 화자명을 임의로 표시하지 않습니다.</p>
        {modelProgress && modelBusy && (
          <div className="model-progress"><div className="progress-track"><i style={{ width: `${modelProgress.percent}%` }} /></div><span>{modelProgress.percent}% · {Math.round(modelProgress.downloadedBytes / 1024 / 1024)}MB / {Math.round(modelProgress.totalBytes / 1024 / 1024)}MB</span></div>
        )}
        <div className="button-row">
          {!bootstrap.localModel.installed && <button className="primary-button" disabled={modelBusy} onClick={downloadModel}>{modelBusy ? '모델 받는 중…' : '로컬 모델 다운로드 (약 181MB)'}</button>}
          {bootstrap.localModel.installed && <button className="danger-button" onClick={removeModel}>로컬 모델 삭제</button>}
        </div>
        <hr />
        <h2>OpenAI로 분석 <small>선택 사항</small></h2>
        <div className="settings-status">
          <span className={`status-dot ${bootstrap.hasApiKey ? 'ok' : ''}`} />
          {bootstrap.hasApiKey ? 'OpenAI API 키가 안전하게 저장되어 있습니다.' : '저장된 OpenAI API 키가 없습니다.'}
        </div>
        <label className="field-label">OpenAI API 키</label>
        <input type="password" autoComplete="off" className="text-input" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-… 또는 sk-proj-…" />
        <p className="helper-text">키는 이 PC의 Windows 암호화 기능으로 저장되며 프로젝트 파일이나 로그에는 포함되지 않습니다.</p>
        <p className="helper-text">OpenAI 화자 분리 모델은 무료 API 등급을 지원하지 않습니다. ChatGPT 구독과는 별도로 OpenAI API 결제·크레딧 설정이 필요합니다.</p>
        <div className="button-row">
          <button className="primary-button" disabled={!key.trim()} onClick={save}>키 저장</button>
          {bootstrap.hasApiKey && <button className="danger-button" onClick={clear}>저장된 키 삭제</button>}
        </div>
        {saved && <p className="success-text">{saved}</p>}
        {error && <p className="error-text">{error}</p>}
        <hr />
        <h3>프로젝트 저장 위치</h3>
        <code className="path-box">{bootstrap.projectsRoot}</code>
        <p className="helper-text">모든 작업은 이 폴더에 자동 저장됩니다. 폴더를 옮기지 않아도 최근 프로젝트에서 다시 열 수 있습니다.</p>
        <hr />
        <p className="version-text">화면해설 대본 도구 v{bootstrap.appVersion}</p>
      </div>
    </main>
  )
}

function UpdateBanner({ status, onInstall }: { status: UpdateStatus; onInstall: () => void }) {
  if (!['available', 'downloading', 'downloaded'].includes(status.state)) return null
  return (
    <aside className={`update-banner ${status.state}`} role="status">
      <div>
        <strong>{status.state === 'downloaded' ? '새 버전 설치 준비 완료' : '새 버전 자동 업데이트'}</strong>
        <span>{status.message}</span>
        {status.state === 'downloading' && (
          <div className="progress-track"><i style={{ width: `${status.percent ?? 0}%` }} /></div>
        )}
      </div>
      {status.state === 'downloaded' && <button onClick={onInstall}>재시작하여 업데이트</button>}
    </aside>
  )
}

function AboutScreen({ bootstrap, updateStatus, onBack, onSupport, onCheckUpdate, onInstallUpdate }: {
  bootstrap: BootstrapData
  updateStatus: UpdateStatus
  onBack: () => void
  onSupport: () => void
  onCheckUpdate: () => void
  onInstallUpdate: () => void
}) {
  const checking = ['checking', 'available', 'downloading'].includes(updateStatus.state)
  return (
    <main className="info-page">
      <button className="back-button" onClick={onBack}>← 돌아가기</button>
      <div className="info-card">
        <span className="eyebrow">ABOUT</span>
        <h1>화면해설 대본 도구</h1>
        <p className="info-lead">영상의 대사와 타임코드를 초안으로 정리해, 화면해설작가가 본업인 화면해설에 집중하도록 돕는 Windows 앱입니다.</p>
        <div className="info-grid">
          <section>
            <h2>현재 버전</h2>
            <strong>v{bootstrap.appVersion}</strong>
            <p>{updateStatus.message}</p>
            {updateStatus.state === 'downloaded'
              ? <button className="secondary-button compact-action" onClick={onInstallUpdate}>재시작하여 업데이트</button>
              : <button className="secondary-button compact-action" disabled={checking} onClick={onCheckUpdate}>{checking ? '확인 중…' : '업데이트 확인'}</button>}
          </section>
          <section>
            <h2>개인정보 원칙</h2>
            <p>로컬 모드에서는 영상과 음성이 이 PC 밖으로 전송되지 않습니다. OpenAI 모드를 선택한 경우에만 압축된 음성이 API로 전송됩니다.</p>
          </section>
          <section>
            <h2>개발 작업 저장 위치</h2>
            <code>https://github.com/buildergarlic/ginuni</code>
            <p>소스와 버전, 변경 기록, Windows 설치본을 관리합니다.</p>
          </section>
          <section>
            <h2>개발자</h2>
            <strong>BuilderGarlic</strong>
            <p>Threads @builder.garlic에서 개발 과정과 활용 사례를 공유합니다.</p>
          </section>
          <section>
            <h2>프로그램 문의</h2>
            <strong>contact@ax4u.kr</strong>
            <p>기능 문의, 오류 제보, 도입 상담을 받습니다.</p>
          </section>
          <section>
            <h2>강의·개발 협업·커피챗 문의</h2>
            <p>AI 실무 활용 교육, 바이브 코딩, Hermes Agent 구축 등 실무 중심의 교육과 협업을 이야기합니다.</p>
          </section>
        </div>
        <div className="button-row info-actions">
          <button className="primary-button" onClick={() => void window.screenScript.openExternal('repository')}>GitHub 저장소 열기</button>
          <button className="secondary-button" onClick={() => void window.screenScript.openExternal('threads')}>Threads</button>
          <button className="secondary-button" onClick={() => void window.screenScript.openExternal('email')}>이메일 문의</button>
          <button className="secondary-button" onClick={() => void window.screenScript.openExternal('kakao')}>카카오 오픈채팅</button>
          <button className="secondary-button" onClick={onSupport}>개발자 후원</button>
        </div>
        <p className="version-text">AI 분석 결과는 검수가 필요한 초안입니다. 중요한 납품 전에는 반드시 원본 영상과 대조하세요.</p>
      </div>
    </main>
  )
}

function SupportScreen({ bootstrap, onBack, onAbout }: {
  bootstrap: BootstrapData
  onBack: () => void
  onAbout: () => void
}) {
  return (
    <main className="info-page support-page">
      <button className="back-button" onClick={onBack}>← 돌아가기</button>
      <div className="info-card support-card">
        <span className="eyebrow">SUPPORT THE DEVELOPER</span>
        <h1>개발자 후원</h1>
        <p className="info-lead">후원금은 한국어 음성인식 품질 개선, 한컴오피스 호환성 테스트, Windows 코드 서명과 배포 유지에 사용됩니다.</p>
        <div className="support-highlight">
          <span>후원 채널 준비 중</span>
          <h2>GitHub Sponsors 등록 진행 중</h2>
          <p>현재는 결제 가능한 후원 페이지가 아직 열리지 않았습니다. GitHub Sponsors 승인이 끝나는 즉시 이 메뉴에서 후원할 수 있도록 연결하겠습니다.</p>
          <button className="sponsor-button" disabled>♥ GitHub Sponsors 준비 중</button>
        </div>
        <div className="support-note">
          <strong>비금전 후원도 큰 힘이 됩니다.</strong>
          <p>저장소에 오류 사례를 남겨 주거나, 실제 화면해설 작업에서 불편한 점을 제안해 주세요.</p>
          <button className="secondary-button" onClick={() => void window.screenScript.openExternal('repository')}>GitHub에서 참여하기</button>
        </div>
        <div className="button-row info-actions">
          <button className="secondary-button" onClick={onAbout}>About GiNuNi 보기</button>
        </div>
        <p className="version-text">화면해설 대본 도구 v{bootstrap.appVersion}</p>
      </div>
    </main>
  )
}

function ReviewScreen({ project, onProject, onBack, onSettings, onAbout, onSupport, notify, closeSaveRef }: {
  project: ScriptProject
  onProject: (value: ScriptProject) => void
  onBack: () => void
  onSettings: () => void
  onAbout: () => void
  onSupport: () => void
  notify: (value: string) => void
  closeSaveRef: { current: (() => Promise<void>) | null }
}) {
  const [rows, setRows] = useState(project.rows)
  const [selectedId, setSelectedId] = useState(project.rows[0]?.id ?? '')
  const [playhead, setPlayhead] = useState(0)
  const [history, setHistory] = useState<ScriptRow[][]>([])
  const [dirty, setDirty] = useState(false)
  const [speakerFrom, setSpeakerFrom] = useState('')
  const [speakerTo, setSpeakerTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const mediaRef = useRef<MediaHandle>(null)
  const rowsRef = useRef(project.rows)
  const editVersionRef = useRef(0)
  const savedVersionRef = useRef(0)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const errors = useMemo(() => validateRows(rows), [rows])
  const selectedIndex = rows.findIndex((row) => row.id === selectedId)
  const selected = rows[selectedIndex]
  const latestRun = project.runs.at(-1)
  const latestSuccessfulProvider = project.runs.filter((run) => run.completedAt && !run.errorCode).at(-1)?.provider
  const supportsSpeakerLabels = (latestSuccessfulProvider ?? project.transcriptionEngine) === 'openai'

  useEffect(() => {
    rowsRef.current = project.rows
    editVersionRef.current = 0
    savedVersionRef.current = 0
    savePromiseRef.current = null
    setRows(project.rows)
    setSelectedId(project.rows[0]?.id ?? '')
    setHistory([])
    setDirty(false)
    setMediaError('')
  }, [project.id])

  const flushSave = useCallback(async (): Promise<void> => {
    if (savePromiseRef.current) {
      await savePromiseRef.current
      if (savedVersionRef.current < editVersionRef.current) await flushSave()
      return
    }

    const saveAllPendingEdits = async (): Promise<void> => {
      setSaving(true)
      try {
        while (savedVersionRef.current < editVersionRef.current) {
          const version = editVersionRef.current
          const savedProject = await window.screenScript.saveRows(project.id, rowsRef.current)
          savedVersionRef.current = version
          onProject(savedProject)
        }
        setDirty(false)
      } finally {
        setSaving(false)
      }
    }

    const pending = saveAllPendingEdits()
    savePromiseRef.current = pending
    try {
      await pending
    } finally {
      if (savePromiseRef.current === pending) savePromiseRef.current = null
    }
  }, [onProject, project.id])

  useEffect(() => {
    closeSaveRef.current = flushSave
    return () => {
      if (closeSaveRef.current === flushSave) closeSaveRef.current = null
    }
  }, [closeSaveRef, flushSave])

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => {
      void flushSave().catch((cause) => notify(errorMessage(cause)))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [dirty, flushSave, notify, rows])

  const applyRows = (next: ScriptRow[]): void => {
    setHistory((value) => [...value.slice(-29), rows])
    rowsRef.current = next
    editVersionRef.current += 1
    setRows(next)
    setDirty(true)
  }
  const updateRow = (id: string, patch: Partial<ScriptRow>): void => applyRows(rows.map((row) => row.id === id ? { ...row, ...patch, reviewed: true } : row))
  const undo = (): void => {
    const previous = history.at(-1)
    if (!previous) return
    rowsRef.current = previous
    editVersionRef.current += 1
    setRows(previous)
    setHistory((value) => value.slice(0, -1))
    setDirty(true)
  }
  const split = (): void => {
    if (!selected) return
    const midpoint = Math.round(((selected.startMs + selected.endMs) / 2) / 1000) * 1000
    const requested = Math.round(playhead * 1000 / 1000) * 1000
    const point = requested > selected.startMs && requested < selected.endMs ? requested : midpoint
    if (point <= selected.startMs || point >= selected.endMs) return
    const next = [...rows]
    next.splice(selectedIndex, 1,
      { ...selected, id: crypto.randomUUID(), endMs: point, reviewed: true },
      { ...selected, id: crypto.randomUUID(), startMs: point, reviewed: true }
    )
    applyRows(next)
  }
  const mergeNext = (): void => {
    if (!selected || selectedIndex < 0 || selectedIndex >= rows.length - 1) return
    const following = rows[selectedIndex + 1]
    const merged: ScriptRow = {
      ...selected,
      id: crypto.randomUUID(),
      endMs: following.endMs,
      kind: selected.kind === 'dialogue' || following.kind === 'dialogue' ? 'dialogue' : 'descriptionGap',
      speakers: [...new Set([...selected.speakers, ...following.speakers])],
      content: selected.kind === 'descriptionGap' && following.kind === 'descriptionGap' ? DESCRIPTION_TEXT : `${selected.content} ${following.content}`.trim(),
      sourceSegmentIds: [...selected.sourceSegmentIds, ...following.sourceSegmentIds],
      reviewed: true
    }
    const next = [...rows]
    next.splice(selectedIndex, 2, merged)
    applyRows(next)
    setSelectedId(merged.id)
  }
  const renameSpeaker = (): void => {
    const from = speakerFrom.trim()
    const to = speakerTo.trim()
    if (!from || !to) return
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    applyRows(rows.map((row) => ({
      ...row,
      speakers: row.speakers.map((speaker) => speaker === from ? to : speaker),
      content: row.content.replace(new RegExp(`\\[${escaped}\\]`, 'g'), `[${to}]`),
      reviewed: true
    })))
    setSpeakerFrom('')
    setSpeakerTo('')
  }
  const exportDocument = async (): Promise<void> => {
    try {
      await flushSave()
      const result = await window.screenScript.exportHwpx(project.id)
      if (result) notify(`HWPX를 저장했습니다: ${result.path}`)
    } catch (cause) { notify(errorMessage(cause)) }
  }
  const leaveReview = (navigate: () => void): void => {
    void (async () => {
      try {
        await flushSave()
        navigate()
      } catch (cause) {
        notify(`수정 내용을 저장하지 못해 화면을 이동하지 않았습니다. ${errorMessage(cause)}`)
      }
    })()
  }

  return (
    <div className="review-page">
      <header className="review-header">
        <div className="review-title"><button className="icon-button" onClick={() => leaveReview(onBack)}>←</button><div><span>검수 프로젝트</span><h1>{project.title}</h1></div></div>
        <div className="review-actions">
          <button className="header-link" onClick={() => leaveReview(onAbout)}>About GiNuNi</button>
          <button className="header-link sponsor-link" onClick={() => leaveReview(onSupport)}>♥ 개발자 후원</button>
          <button className="header-link" onClick={() => leaveReview(onSettings)}>설정</button>
          <span className="autosave">{saving ? '저장 중…' : dirty ? '수정됨' : '자동 저장됨'}</span>
          <button className="secondary-button" disabled={!history.length} onClick={undo}>실행 취소</button>
          <button className="primary-button" disabled={errors.length > 0 || rows.length === 0} onClick={exportDocument}>HWPX 내보내기</button>
        </div>
      </header>

      <div className="review-grid">
        <aside className="media-panel">
          <MediaPlayer ref={mediaRef} project={project} onTime={setPlayhead} onError={setMediaError} onReady={() => setMediaError('')} />
          {mediaError && <p className="media-error">{mediaError}</p>}
          <div className="playhead-card"><span>현재 재생 위치</span><strong>{formatTimecode(playhead * 1000)}</strong></div>
          {selected && (
            <div className="edit-card">
              <div className="edit-card-heading"><h3>선택한 행 편집</h3><span>{selected.kind === 'dialogue' ? '대사' : '해설'}</span></div>
              <div className="time-edit-grid">
                <label>시작<input value={formatTimecode(selected.startMs)} onChange={(event) => { const value = parseTimecode(event.target.value); if (value !== null) updateRow(selected.id, { startMs: value }) }} /></label>
                <label>종료<input value={formatTimecode(selected.endMs)} onChange={(event) => { const value = parseTimecode(event.target.value); if (value !== null) updateRow(selected.id, { endMs: value }) }} /></label>
              </div>
              <div className="button-row compact">
                <button onClick={() => updateRow(selected.id, { startMs: Math.floor(playhead) * 1000 })}>현재 위치를 시작으로</button>
                <button onClick={() => updateRow(selected.id, { endMs: Math.ceil(playhead) * 1000 })}>현재 위치를 종료로</button>
              </div>
              <label className="field-label">분류</label>
              <div className="segmented-control">
                <button className={selected.kind === 'dialogue' ? 'active' : ''} onClick={() => updateRow(selected.id, {
                  kind: 'dialogue',
                  content: selected.kind === 'descriptionGap' ? (supportsSpeakerLabels ? '[화자1] [화자1] 대사' : '대사') : selected.content,
                  speakers: supportsSpeakerLabels ? (selected.speakers.length ? selected.speakers : ['화자1']) : []
                })}>대사</button>
                <button className={selected.kind === 'descriptionGap' ? 'active' : ''} onClick={() => updateRow(selected.id, { kind: 'descriptionGap', content: DESCRIPTION_TEXT, speakers: [] })}>해설</button>
              </div>
              <label className="field-label">화자/내용</label>
              <textarea value={selected.content} onChange={(event) => updateRow(selected.id, { content: event.target.value })} rows={7} />
              <div className="button-row compact">
                <button onClick={split}>현재 위치에서 분할</button>
                <button disabled={selectedIndex === rows.length - 1} onClick={mergeNext}>다음 행과 병합</button>
                <button className="delete-link" onClick={() => applyRows(rows.filter((row) => row.id !== selected.id))}>행 삭제</button>
              </div>
            </div>
          )}
          {supportsSpeakerLabels && (
            <div className="edit-card">
              <h3>화자 전체 이름 변경</h3>
              <div className="speaker-rename"><input value={speakerFrom} onChange={(event) => setSpeakerFrom(event.target.value)} placeholder="화자1" /><span>→</span><input value={speakerTo} onChange={(event) => setSpeakerTo(event.target.value)} placeholder="선생님" /></div>
              <button className="secondary-button wide" onClick={renameSpeaker}>모든 행에 적용</button>
            </div>
          )}
        </aside>

        <main className="script-panel">
          {project.lastError && (
            <div className="project-error-banner">
              <div><strong>마지막 분석 오류</strong><span>{project.lastError}</span></div>
              <small>{latestRun?.errorCode ? `오류 코드: ${latestRun.errorCode}` : ''}{latestRun?.requestId ? ` · 요청 ID: ${latestRun.requestId}` : ''}</small>
            </div>
          )}
          <div className="script-toolbar">
            <div><h2>대본 검수</h2><p>{rows.length}개 행 · 행을 누르면 해당 시점으로 이동합니다.</p></div>
            {errors.length > 0 && <span className="validation-pill">{errors.length}개 시간 오류</span>}
          </div>
          <div className="table-wrap">
            <table className="script-table">
              <thead><tr><th>분류</th><th>시작</th><th>종료</th><th>간격</th><th>화자/내용</th><th>검수</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={`${row.kind === 'descriptionGap' ? 'gap-row' : ''} ${selectedId === row.id ? 'selected-row' : ''}`} onClick={() => { setSelectedId(row.id); mediaRef.current?.seek(row.startMs / 1000) }}>
                    <td><span className={`kind-badge ${row.kind}`}>{row.kind === 'dialogue' ? '대사' : '해설'}</span></td>
                    <td>{formatTimecode(row.startMs)}</td><td>{formatTimecode(row.endMs)}</td><td>{Math.max(0, Math.round((row.endMs - row.startMs) / 1000))}</td>
                    <td className="content-cell">{row.content}</td><td>{row.reviewed ? <span className="reviewed-mark">✓</span> : <span className="unreviewed-mark">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="empty-table">아직 분석된 대본이 없습니다. 상단의 처리 시작 버튼으로 음성을 분석하세요.</div>}
          </div>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [returnScreen, setReturnScreen] = useState<'home' | 'review'>('home')
  const [showNew, setShowNew] = useState(true)
  const [project, setProject] = useState<ScriptProject | null>(null)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [notice, setNotice] = useState('')
  const [fatal, setFatal] = useState('')
  const closeSaveRef = useRef<(() => Promise<void>) | null>(null)

  const refresh = async (): Promise<void> => {
    const next = await window.screenScript.bootstrap()
    setBootstrap(next)
    setUpdateStatus(next.updateStatus)
  }

  useEffect(() => {
    refresh().catch((cause) => setFatal(errorMessage(cause)))
    const removeProgressListener = window.screenScript.onProgress(setProgress)
    const removeUpdateListener = window.screenScript.onUpdateStatus(setUpdateStatus)
    return () => {
      removeProgressListener()
      removeUpdateListener()
    }
  }, [])
  useEffect(() => window.screenScript.onCloseRequested(() => {
    void (async () => {
      try {
        await closeSaveRef.current?.()
        await window.screenScript.respondToClose(true)
      } catch (cause) {
        setNotice(`수정 내용을 저장하지 못해 앱을 닫지 않았습니다. ${errorMessage(cause)}`)
        await window.screenScript.respondToClose(false)
      }
    })()
  }), [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const openProject = async (id: string): Promise<void> => {
    try {
      const value = await window.screenScript.loadProject(id)
      setProject(value)
      setScreen('review')
    } catch (cause) { setNotice(errorMessage(cause)) }
  }
  const startProcessing = async (): Promise<void> => {
    if (!project) return
    try {
      setProgress({ projectId: project.id, stage: 'preparing', percent: 1, message: '처리를 시작합니다.' })
      const processed = await window.screenScript.processProject(project.id)
      setProject(processed)
      await refresh()
    } catch (cause) { setNotice(errorMessage(cause)); setProject(await window.screenScript.loadProject(project.id)) }
    finally { window.setTimeout(() => setProgress(null), 800) }
  }
  const changeEngine = async (engine: TranscriptionEngine): Promise<void> => {
    if (!project) return
    try { setProject(await window.screenScript.setTranscriptionEngine(project.id, engine)) }
    catch (cause) { setNotice(errorMessage(cause)) }
  }
  const removeProject = async (summary: ProjectSummary): Promise<void> => {
    if (!window.confirm(`“${summary.title}” 프로젝트와 내려받은 음성을 삭제할까요?`)) return
    try { await window.screenScript.deleteProject(summary.id); await refresh() } catch (cause) { setNotice(errorMessage(cause)) }
  }
  const openAuxiliary = (target: 'settings' | 'about' | 'support'): void => {
    setReturnScreen(screen === 'review' && project ? 'review' : 'home')
    setScreen(target)
  }
  const closeAuxiliary = (): void => setScreen(returnScreen === 'review' && project ? 'review' : 'home')
  const checkUpdates = async (): Promise<void> => {
    try { setUpdateStatus(await window.screenScript.checkForUpdates()) }
    catch (cause) { setNotice(errorMessage(cause)) }
  }
  const applyUpdate = async (): Promise<void> => {
    try {
      await closeSaveRef.current?.()
      await window.screenScript.installUpdate()
    } catch (cause) { setNotice(errorMessage(cause)) }
  }

  if (fatal) return <div className="fatal-error"><h1>앱을 시작할 수 없습니다</h1><p>{fatal}</p></div>
  if (!bootstrap) return <div className="loading-screen"><div className="spinner" /><p>프로젝트를 불러오는 중…</p></div>
  const currentUpdateStatus = updateStatus ?? bootstrap.updateStatus
  const updateBanner = <UpdateBanner status={currentUpdateStatus} onInstall={() => void applyUpdate()} />
  if (screen === 'settings') return <><SettingsScreen bootstrap={bootstrap} onChanged={setBootstrap} onBack={closeAuxiliary} />{updateBanner}</>
  if (screen === 'about') return <><AboutScreen bootstrap={bootstrap} updateStatus={currentUpdateStatus} onBack={closeAuxiliary} onSupport={() => setScreen('support')} onCheckUpdate={() => void checkUpdates()} onInstallUpdate={() => void applyUpdate()} />{updateBanner}</>
  if (screen === 'support') return <><SupportScreen bootstrap={bootstrap} onBack={closeAuxiliary} onAbout={() => setScreen('about')} />{updateBanner}</>
  if (screen === 'review' && project) {
    return (
      <>
        <ReviewScreen
          key={`${project.id}:${project.runs.length}`}
          project={project}
          onProject={setProject}
          notify={setNotice}
          onBack={() => { setScreen('home'); refresh().catch(() => undefined) }}
          onSettings={() => openAuxiliary('settings')}
          onAbout={() => openAuxiliary('about')}
          onSupport={() => openAuxiliary('support')}
          closeSaveRef={closeSaveRef}
        />
        {project.status !== 'review' && project.status !== 'exported' && (
          <>
            <select className="floating-engine" value={project.transcriptionEngine ?? 'openai'} onChange={(event) => changeEngine(event.target.value as TranscriptionEngine)}>
              <option value="local">내 PC에서 분석 (API 없음)</option>
              <option value="openai">OpenAI로 분석 (화자 분리)</option>
            </select>
            <button className="floating-process" onClick={startProcessing}>{(project.transcriptionEngine ?? 'openai') === 'local' ? '로컬 음성 분석 시작' : 'OpenAI 음성 분석 시작'}</button>
          </>
        )}
        <button className="floating-settings" onClick={() => openAuxiliary('settings')}>설정</button>
        {notice && <div className="toast">{notice}</div>}
        {progress && progress.percent < 100 && (
          <div className="processing-overlay"><div className="processing-card"><span className="eyebrow">VOICE PROCESSING</span><h2>{progress.message}</h2><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><p>{progress.percent}%</p><button className="secondary-button" onClick={() => window.screenScript.cancelProcessing(progress.projectId)}>취소</button></div></div>
        )}
        {updateBanner}
      </>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">해</div><div><strong>화면해설</strong><span>대본 도구</span></div></div>
        <nav>
          <button className="active">프로젝트</button>
          <button onClick={() => openAuxiliary('settings')}>설정</button>
          <button onClick={() => openAuxiliary('about')}>About GiNuNi</button>
          <button className="nav-sponsor" onClick={() => openAuxiliary('support')}>♥ 개발자 후원</button>
        </nav>
        <div className="sidebar-bottom"><span className="status-dot ok" />{bootstrap.localModel.installed ? '로컬 분석 준비됨' : 'API 없이 사용 가능'}<small>v{bootstrap.appVersion}</small></div>
      </aside>
      <main className="home-page">
        <header className="home-header"><div><span className="eyebrow">SCREEN DESCRIPTION WORKSPACE</span><h1>작가의 시간을 대사 정리가 아닌<br /><em>화면해설</em>에 쓰세요.</h1><p>영상 속 음성과 화자를 분석해, 검수 가능한 타임스탬프 대본으로 정리합니다.</p></div><button className="settings-link" onClick={() => openAuxiliary('settings')}>설정</button></header>
        <div className="home-columns">
          <div>{showNew ? <NewProjectPanel bootstrap={bootstrap} onOpenSettings={() => openAuxiliary('settings')} onCreated={(value) => { setProject(value); setScreen('review') }} /> : <EmptyState onNew={() => setShowNew(true)} />}</div>
          <section className="recent-card">
            <div className="section-heading"><div><span className="eyebrow">RECENT</span><h2>최근 프로젝트</h2></div><span>{bootstrap.projects.length}개</span></div>
            <div className="recent-list">
              {bootstrap.projects.map((item) => (
                <div className="recent-item" key={item.id}>
                  <button className="recent-main" onClick={() => openProject(item.id)}><span className={`source-icon ${item.sourceKind}`}>{item.sourceKind === 'youtube' ? '▶' : '▣'}</span><span className="recent-copy"><strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleString('ko-KR')} · {item.durationMs ? formatTimecode(item.durationMs) : '미분석'}</small></span><span className={`status-chip ${item.status}`}>{statusLabel(item.status)}</span></button>
                  <button className="recent-delete" title="프로젝트 삭제" onClick={() => removeProject(item)}>×</button>
                </div>
              ))}
              {bootstrap.projects.length === 0 && <div className="recent-empty"><strong>아직 프로젝트가 없습니다</strong><span>왼쪽에서 첫 프로젝트를 만들어 보세요.</span></div>}
            </div>
            <div className="storage-note"><span>자동 저장 위치</span><code>{bootstrap.projectsRoot}</code></div>
          </section>
        </div>
      </main>
      {notice && <div className="toast">{notice}</div>}
      {updateBanner}
    </div>
  )
}
