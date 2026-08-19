import { type MouseEvent as ReactMouseEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DESCRIPTION_TEXT } from '@shared/constants'
import { formatTimecode, parseTimecode } from '@shared/timecode'
import { validateRows } from '@shared/rows'
import { supportsSpeakerLabels as projectSupportsSpeakerLabels } from '@shared/speaker-labels'
import type {
  BootstrapData,
  CreateProjectInput,
  LocalDiarizationConfig,
  ModelDownloadProgress,
  ProcessingProgress,
  ProjectSummary,
  ScriptProject,
  ScriptRow,
  UpdateStatus
} from '@shared/types'

type Screen = 'home' | 'review' | 'settings' | 'about' | 'support'
type SourceTab = 'local' | 'youtube'
type AnalysisPreset = 'local' | 'local-diarization' | 'openai'

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

function processingStageLabel(stage?: string): string {
  return ({ media: '원본 파일 확인', probe: '영상 정보 확인', encoding: '음성 변환', model: '로컬 모델 준비', runtime: '분석 엔진 실행', transcription: 'Whisper 음성 분석', diarizing: '로컬 화자 분리', output: '분석 결과 읽기', building: '대본 구성' } as Record<string, string>)[stage ?? ''] ?? stage ?? ''
}

function projectPreset(project: ScriptProject): AnalysisPreset {
  if ((project.transcriptionEngine ?? 'local') === 'openai') return 'openai'
  return project.localDiarization?.mode === 'sherpa-onnx' ? 'local-diarization' : 'local'
}

function processingResolution(code?: string): string {
  return ({
    MEDIA_NOT_FOUND: '원본 파일이 이동·삭제되지 않았는지 확인하세요.',
    MEDIA_UNREADABLE: '파일 권한을 확인하고 바탕화면 등 짧은 경로로 옮겨 다시 시도하세요.',
    FFPROBE_FAILED: '지원되는 영상인지 확인하고 다른 영상으로 다시 시도하세요.',
    FFMPEG_FAILED: '영상 코덱 또는 저장 위치를 확인한 뒤 다시 시도하세요.',
    MODEL_MISSING: '로컬 모델 복구를 실행하거나 설정에서 모델을 다시 받으세요.',
    MODEL_CORRUPTED: '로컬 모델 복구를 실행해 모델 파일을 다시 설치하세요.',
    RUNTIME_BLOCKED: 'Windows 보안 프로그램이 분석 엔진을 차단했는지 확인하세요.',
    UNSUPPORTED_ARCHITECTURE: '현재 PC의 Windows/CPU 아키텍처에서는 로컬 엔진을 사용할 수 없습니다. OpenAI 모드를 사용해 보세요.',
    INSUFFICIENT_MEMORY: '다른 프로그램을 종료하고 다시 시도하세요.',
    WHISPER_FAILED: '다시 분석하거나 로컬 모델 복구를 실행하세요.',
    WHISPER_OUTPUT_INVALID: '다시 분석하고 계속 실패하면 진단 파일을 저장해 문의하세요.',
    OPENAI_AUDIO_TOO_LARGE: '업로드 음성이 25MB 제한을 넘었습니다. 더 짧은 영상이나 낮은 오디오 품질로 다시 시도하세요.',
    OPENAI_UNPROCESSABLE_AUDIO: 'OpenAI가 음성 형식을 읽지 못했습니다. 오디오 형식 변환 후 다시 시도하세요.',
    OPENAI_BAD_REQUEST: 'OpenAI 요청 형식이 거부되었습니다. 오류 코드와 문제 파라미터를 확인하세요.',
    OPENAI_MODEL_UNAVAILABLE: '현재 API 키 또는 프로젝트에서 OpenAI 음성 모델을 사용할 수 없습니다. API 프로젝트와 모델 권한을 확인하세요.',
    OPENAI_AUTHENTICATION: 'OpenAI API 키가 올바르지 않거나 만료되었습니다. 설정에서 키를 다시 저장하세요.',
    OPENAI_PERMISSION_DENIED: '이 API 키에는 OpenAI 음성 전사 권한이 없습니다.',
    OPENAI_CREDIT_BALANCE_EXHAUSTED: 'OpenAI API 크레딧이 없습니다. OpenAI Platform 결제 설정을 확인하세요.',
    OPENAI_ORGANIZATION_SPEND_LIMIT: 'OpenAI 조직 지출 한도에 도달했습니다.',
    OPENAI_PROJECT_SPEND_LIMIT: 'OpenAI 프로젝트 지출 한도에 도달했습니다.',
    OPENAI_ORGANIZATION_USAGE_LIMIT: 'OpenAI 조직 사용 한도에 도달했습니다.',
    OPENAI_QUOTA_EXCEEDED: 'OpenAI API 사용 가능 금액 또는 한도를 확인하세요.',
    OPENAI_RATE_LIMIT: 'OpenAI 요청 속도 제한입니다. 잠시 후 다시 시도하세요.',
    OPENAI_CONNECTION_TIMEOUT: 'OpenAI 응답 시간이 초과되었습니다. 인터넷 연결을 확인하세요.',
    OPENAI_CONNECTION: 'OpenAI 서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.',
    OPENAI_SERVER: 'OpenAI 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도하세요.'
  } as Record<string, string>)[code ?? ''] ?? '다시 분석하고 계속 실패하면 진단 파일을 저장해 문의하세요.'
}

function diarizationResolution(code?: string): string {
  return ({
    DIARIZATION_RUNTIME_BLOCKED: '보안 프로그램이 실행을 막았을 수 있습니다. 허용 후 재시도하거나 Windows 보안 예외를 추가해 주세요.',
    DIARIZATION_MODEL_INVALID: '화자 분리 구성 요소가 깨졌을 수 있습니다. 앱을 재설치하면 즉시 해결되는 경우가 많습니다.',
    DIARIZATION_INSUFFICIENT_MEMORY: '메모리가 부족할 수 있습니다. 다른 앱을 종료한 뒤 다시 시도하세요.',
    DIARIZATION_OUTPUT_INVALID: '화자 구간 품질이 낮아 화자 표기가 생략됩니다. 음성 구간과 발화량을 확인해 주세요.',
    DIARIZATION_WORD_TIMESTAMPS_UNAVAILABLE: '단어 타임스탬프가 없어 문장 단위로만 화자 구분을 시도했습니다.',
    DIARIZATION_FAILED: '화자 분리 엔진 실행 자체에 실패했습니다. 구성 요소 상태를 확인하고 앱을 재설치해 보세요.'
  } as Record<string, string>)[code ?? ''] ?? '화자 분리 실패 로그를 진단 파일로 저장해 분석하세요.'
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
  const [preset, setPreset] = useState<AnalysisPreset>('local')
  const [speakerCount, setSpeakerCount] = useState('auto')
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
      transcriptionEngine: preset === 'openai' ? 'openai' : 'local',
      localDiarization: {
        mode: preset === 'local-diarization' ? 'sherpa-onnx' : 'none',
        speakerCount: preset === 'local-diarization' && speakerCount !== 'auto' ? Number(speakerCount) : null
      }
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
        <button className={preset === 'local' ? 'active' : ''} onClick={() => setPreset('local')}>
          <strong>내 PC에서 분석</strong><span>API 키·사용료 없음 · 음성 외부 전송 없음</span>
        </button>
        <button
          className={preset === 'local-diarization' ? 'active' : ''}
          disabled={!bootstrap.diarizationBundle.available}
          title={bootstrap.diarizationBundle.available ? '' : '화자 분리 구성 요소가 손상되었습니다. 앱을 다시 설치하세요.'}
          onClick={() => setPreset('local-diarization')}
        >
          <strong>내 PC + 화자 분리</strong><span>실험 기능 · API·인터넷 없이 화자 구분</span>
        </button>
        <button className={preset === 'openai' ? 'active' : ''} onClick={() => setPreset('openai')}>
          <strong>OpenAI로 분석</strong><span>화자 분리 지원 · API 사용료 발생</span>
        </button>
      </div>
      {preset === 'local-diarization' && (
        <div className="diarization-options">
          <label className="field-label">예상 화자 수</label>
          <select value={speakerCount} onChange={(event) => setSpeakerCount(event.target.value)}>
            <option value="auto">자동 감지</option>
            {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count}명</option>)}
          </select>
          <p className="helper-text">화자 수를 알면 직접 지정하는 편이 더 안정적입니다. 결과는 검수 화면에서 수정할 수 있습니다.</p>
        </div>
      )}
      {preset !== 'openai' && !bootstrap.localModel.installed && (
        <button className="model-notice" onClick={onOpenSettings}>
          <strong>{bootstrap.localModel.integrity === 'invalid' ? '로컬 모델 복구 필요' : '첫 사용 시 로컬 모델 다운로드'}</strong><span>약 181MB · 설정에서 준비할 수 있습니다 →</span>
        </button>
      )}
      {preset === 'local-diarization' && !bootstrap.diarizationBundle.available && (
        <button className="key-warning" onClick={onOpenSettings}>
          <strong>화자 분리 구성 요소를 사용할 수 없습니다</strong><span>앱을 다시 설치한 뒤 상태를 확인하세요 →</span>
        </button>
      )}
      {preset === 'openai' && !bootstrap.hasApiKey && (
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
          {bootstrap.localModel.installed
            ? `${bootstrap.localModel.modelName} 모델이 설치되어 있습니다.`
            : bootstrap.localModel.integrity === 'invalid'
              ? '로컬 모델 파일이 손상되어 복구가 필요합니다.'
              : '로컬 모델을 받으면 API 키 없이 사용할 수 있습니다.'}
        </div>
        <p className="helper-text">영상 음성은 이 PC 안에서만 처리됩니다. 기본 로컬 분석은 화자명을 표시하지 않으며, 새 프로젝트에서 실험적 화자 분리를 별도로 선택할 수 있습니다.</p>
        {modelProgress && modelBusy && (
          <div className="model-progress"><div className="progress-track"><i style={{ width: `${modelProgress.percent}%` }} /></div><span>{modelProgress.percent}% · {Math.round(modelProgress.downloadedBytes / 1024 / 1024)}MB / {Math.round(modelProgress.totalBytes / 1024 / 1024)}MB</span></div>
        )}
        <div className="button-row">
          {!bootstrap.localModel.installed && <button className="primary-button" disabled={modelBusy} onClick={downloadModel}>{modelBusy ? '모델 받는 중…' : bootstrap.localModel.integrity === 'invalid' ? '로컬 모델 복구 (약 181MB)' : '로컬 모델 다운로드 (약 181MB)'}</button>}
          {bootstrap.localModel.installed && <button className="danger-button" onClick={removeModel}>로컬 모델 삭제</button>}
        </div>
        <hr />
        <h2>로컬 화자 분리 <small>실험 기능</small></h2>
        <div className="settings-status">
          <span className={`status-dot ${bootstrap.diarizationBundle.available ? 'ok' : ''}`} />
          {bootstrap.diarizationBundle.available
            ? `${bootstrap.diarizationBundle.engineVersion}와 화자 모델이 준비되어 있습니다.`
            : bootstrap.diarizationBundle.integrity === 'invalid'
              ? '화자 분리 실행 파일 또는 모델이 손상되었습니다. 앱을 다시 설치하세요.'
              : '화자 분리 실행 파일 또는 모델이 없습니다. 최신 설치본으로 다시 설치하세요.'}
        </div>
        <p className="helper-text">Pyannote segmentation 3.0과 3D-Speaker 모델을 사용합니다. 모델은 설치본에 포함되며 음성은 외부로 전송되지 않습니다.</p>
        <div className="component-list">
          {bootstrap.diarizationBundle.components.map((component) => (
            <div key={component.id}>
              <span className={`status-dot ${component.integrity === 'valid' ? 'ok' : ''}`} />
              <strong>{component.name}</strong>
              <small>{component.integrity === 'valid' ? '정상' : component.integrity === 'missing' ? '없음' : '손상'}</small>
            </div>
          ))}
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
          <span>GITHUB SPONSORS</span>
          <h2>GiNuNi 개발을 후원해 주세요</h2>
          <p>GitHub Sponsors에서 원하는 후원 단계를 선택할 수 있습니다. 지속적인 후원은 음성인식 품질 개선과 안정적인 Windows 배포에 큰 도움이 됩니다.</p>
          <button className="sponsor-button" onClick={() => void window.screenScript.openExternal('sponsor')}>♥ GitHub Sponsors에서 후원하기</button>
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

type InlineRowDraft = {
  rowId: string
  start: string
  end: string
  content: string
}

type RowContextMenuState = {
  rowId: string
  x: number
  y: number
}

function ReviewScreen({ project, onProject, onBack, onSettings, onAbout, onSupport, onRetry, onRepairModel, notify, closeSaveRef }: {
  project: ScriptProject
  onProject: (value: ScriptProject) => void
  onBack: () => void
  onSettings: () => void
  onAbout: () => void
  onSupport: () => void
  onRetry: () => void
  onRepairModel: () => void
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
  const [inlineDraft, setInlineDraft] = useState<InlineRowDraft | null>(null)
  const [inlineErrors, setInlineErrors] = useState<{ start?: string; end?: string; content?: string }>({})
  const [contextMenu, setContextMenu] = useState<RowContextMenuState | null>(null)
  const mediaRef = useRef<MediaHandle>(null)
  const rowsRef = useRef(project.rows)
  const editVersionRef = useRef(0)
  const savedVersionRef = useRef(0)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const errors = useMemo(() => validateRows(rows), [rows])
  const selectedIndex = rows.findIndex((row) => row.id === selectedId)
  const contextMenuIndex = contextMenu ? rows.findIndex((row) => row.id === contextMenu.rowId) : -1
  const selected = rows[selectedIndex]
  const latestRun = project.runs.at(-1)
  const supportsSpeakerLabels = projectSupportsSpeakerLabels(project)
  const loadDraftFromRow = useCallback((row: ScriptRow | undefined): InlineRowDraft | null => {
    if (!row) return null
    return { rowId: row.id, start: formatTimecode(row.startMs), end: formatTimecode(row.endMs), content: row.content }
  }, [])

  useEffect(() => {
    rowsRef.current = project.rows
    editVersionRef.current = 0
    savedVersionRef.current = 0
    savePromiseRef.current = null
    setRows(project.rows)
    setSelectedId(project.rows[0]?.id ?? '')
    setInlineDraft(loadDraftFromRow(project.rows[0]))
    setInlineErrors({})
    setHistory([])
    setDirty(false)
    setMediaError('')
    setContextMenu(null)
  }, [project.id])

  useEffect(() => {
    if (!selected) {
      setInlineDraft(null)
      setInlineErrors({})
      return
    }
    if (!inlineDraft || inlineDraft.rowId !== selected.id) {
      setInlineDraft(loadDraftFromRow(selected))
      setInlineErrors({})
    }
  }, [selected, inlineDraft, loadDraftFromRow])

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

  useEffect(() => {
    const closeMenu = (): void => setContextMenu(null)
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (target?.closest('.row-context-menu')) return
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const applyRows = (next: ScriptRow[]): void => {
    setHistory((value) => [...value.slice(-29), rows])
    rowsRef.current = next
    editVersionRef.current += 1
    setRows(next)
    setDirty(true)
  }
  const updateRow = (id: string, patch: Partial<ScriptRow>): void => applyRows(rows.map((row) => row.id === id ? { ...row, ...patch, reviewed: true } : row))
  const updateInlineDraft = (patch: Partial<Omit<InlineRowDraft, 'rowId'>>): void => {
    setInlineDraft((value) => (value ? { ...value, ...patch } : value))
    setInlineErrors((value) => {
      const next = { ...value }
      if (typeof patch.start === 'string') delete next.start
      if (typeof patch.end === 'string') delete next.end
      return next
    })
  }
  const selectRow = (row: ScriptRow): void => {
    setSelectedId(row.id)
    setInlineDraft(loadDraftFromRow(row))
    setInlineErrors({})
    mediaRef.current?.seek(row.startMs / 1000)
  }
  const applyInlineDraft = useCallback((): boolean => {
    if (!inlineDraft) return true
    const target = rows.find((row) => row.id === inlineDraft.rowId)
    if (!target) return true

    const nextErrors: { start?: string; end?: string } = {}
    const startMs = parseTimecode(inlineDraft.start)
    const endMs = parseTimecode(inlineDraft.end)

    if (startMs === null) nextErrors.start = '시작 시간은 MM:SS 형식이어야 합니다.'
    if (endMs === null) nextErrors.end = '종료 시간은 MM:SS 형식이어야 합니다.'
    if (startMs !== null && endMs !== null && endMs <= startMs) nextErrors.end = '종료 시간은 시작 시간보다 커야 합니다.'

    if (nextErrors.start || nextErrors.end) {
      setInlineErrors(nextErrors)
      return false
    }

    if (startMs === null || endMs === null) return false
    setInlineErrors({})
    updateRow(target.id, { startMs, endMs, content: inlineDraft.content })
    return true
  }, [inlineDraft, rows, updateRow])
  const chooseRow = (row: ScriptRow): boolean => {
    if (!applyInlineDraft()) {
      return false
    }
    selectRow(row)
    return true
  }
  const undo = (): void => {
    const previous = history.at(-1)
    if (!previous) return
    rowsRef.current = previous
    editVersionRef.current += 1
    setRows(previous)
    setInlineDraft(loadDraftFromRow(previous[0]))
    setHistory((value) => value.slice(0, -1))
    setDirty(true)
  }
  const splitAtIndex = (index: number): void => {
    const row = rows[index]
    if (!row) return
    const midpoint = Math.round(((row.startMs + row.endMs) / 2) / 1000) * 1000
    const requested = Math.round(playhead * 1000 / 1000) * 1000
    const point = requested > row.startMs && requested < row.endMs ? requested : midpoint
    if (point <= row.startMs || point >= row.endMs) return
    const next = [...rows]
    next.splice(index, 1,
      { ...row, id: crypto.randomUUID(), endMs: point, reviewed: true },
      { ...row, id: crypto.randomUUID(), startMs: point, reviewed: true }
    )
    applyRows(next)
    setSelectedId(next[index].id)
  }
  const split = (): void => {
    if (!applyInlineDraft()) return
    if (!selected || selectedIndex < 0) return
    splitAtIndex(selectedIndex)
  }
  const mergeNextAtIndex = (index: number): void => {
    if (index < 0 || index >= rows.length - 1) return
    const selectedRow = rows[index]
    const following = rows[index + 1]
    const merged: ScriptRow = {
      ...selectedRow,
      id: crypto.randomUUID(),
      endMs: following.endMs,
      kind: selectedRow.kind === 'dialogue' || following.kind === 'dialogue' ? 'dialogue' : 'descriptionGap',
      speakers: [...new Set([...selectedRow.speakers, ...following.speakers])],
      content: selectedRow.kind === 'descriptionGap' && following.kind === 'descriptionGap' ? DESCRIPTION_TEXT : `${selectedRow.content} ${following.content}`.trim(),
      sourceSegmentIds: [...selectedRow.sourceSegmentIds, ...following.sourceSegmentIds],
      reviewed: true
    }
    const next = [...rows]
    next.splice(index, 2, merged)
    applyRows(next)
    setSelectedId(merged.id)
  }
  const mergeNext = (): void => {
    if (!applyInlineDraft()) return
    if (!selected || selectedIndex < 0) return
    mergeNextAtIndex(selectedIndex)
  }
  const deleteRowAtIndex = (index: number): void => {
    if (index < 0) return
    const target = rows[index]
    if (!target) return
    const next = rows.filter((row) => row.id !== target.id)
    if (next.length === 0) {
      applyRows(next)
      setSelectedId('')
      setInlineDraft(null)
      return
    }
    const nextSelected = next[index] ?? next[index - 1] ?? next[0]
    applyRows(next)
    if (nextSelected) {
      setSelectedId(nextSelected.id)
      setInlineDraft(loadDraftFromRow(nextSelected))
    }
  }
  const addBlankRowAtIndex = (index: number, placement: 'before' | 'after'): void => {
    if (index < 0) return
    const minGap = 1100
    const safeDuration = Number.isFinite(project.media.durationMs) && project.media.durationMs > 0 ? project.media.durationMs : (rows.at(-1)?.endMs ?? 1000)
    const lowerBound = placement === 'before' ? (index > 0 ? rows[index - 1]?.endMs ?? 0 : 0) : rows[index]?.endMs ?? 0
    const upperBound = placement === 'before' ? rows[index]?.startMs ?? safeDuration : rows[index + 1]?.startMs ?? safeDuration
    const gap = upperBound - lowerBound

    let startMs = lowerBound
    let endMs = Math.max(lowerBound + 1000, startMs + 1000)
    let fallback = false

    if (gap >= minGap) {
      startMs = lowerBound + Math.floor((gap - 1000) / 2)
      endMs = startMs + 1000
    } else {
      const timelineEnd = Math.max(rows.at(-1)?.endMs ?? 0, safeDuration)
      startMs = Math.max(0, timelineEnd - 1000)
      endMs = Math.max(startMs + 1000, timelineEnd)
      fallback = true
    }

    const inserted: ScriptRow = {
      id: crypto.randomUUID(),
      kind: 'dialogue',
      startMs,
      endMs,
      speakers: [],
      content: '대사',
      sourceSegmentIds: [],
      reviewed: false
    }

    const next = [...rows]
    if (fallback) {
      next.push(inserted)
    } else if (placement === 'before') {
      next.splice(index, 0, inserted)
    } else {
      next.splice(index + 1, 0, inserted)
    }
    applyRows(next)
    setSelectedId(inserted.id)
    setInlineDraft(loadDraftFromRow(inserted))
    mediaRef.current?.seek(startMs / 1000)
    if (fallback) notify('시간 간격이 부족해 행을 타임라인 끝으로 배치했습니다.')
  }
  const addBlankRow = (placement: 'before' | 'after'): void => {
    if (!applyInlineDraft()) return
    if (!selected || selectedIndex < 0) return
    addBlankRowAtIndex(selectedIndex, placement)
  }
  const addRowBefore = (): void => addBlankRow('before')
  const addRowAfter = (): void => addBlankRow('after')
  const deleteSelectedRow = (): void => {
    if (!applyInlineDraft()) return
    if (!selected) return
    deleteRowAtIndex(selectedIndex)
  }
  const openContextMenu = (event: ReactMouseEvent<HTMLTableRowElement>, rowId: string): void => {
    const row = rows.find((entry) => entry.id === rowId)
    if (!row) return
    if (!chooseRow(row)) return
    event.preventDefault()
    event.stopPropagation()
    const maxWidth = 220
    const maxHeight = 250
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - maxWidth - 8))
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - maxHeight - 8))
    setContextMenu({ rowId, x, y })
  }
  const closeContextMenu = (): void => setContextMenu(null)
  const executeContextAction = (handler: (index: number) => void): void => {
    if (!contextMenu) return
    if (!applyInlineDraft()) return
    const targetIndex = rows.findIndex((row) => row.id === contextMenu.rowId)
    if (targetIndex < 0) {
      closeContextMenu()
      return
    }
    closeContextMenu()
    handler(targetIndex)
  }
  const runSplitOnContextRow = (): void => {
    executeContextAction((targetIndex) => splitAtIndex(targetIndex))
  }
  const runMergeOnContextRow = (): void => {
    executeContextAction((targetIndex) => {
      if (targetIndex >= rows.length - 1) return
      mergeNextAtIndex(targetIndex)
    })
  }
  const runDeleteOnContextRow = (): void => {
    executeContextAction((targetIndex) => {
      deleteRowAtIndex(targetIndex)
    })
  }
  const runInsertBeforeInContext = (): void => {
    executeContextAction((targetIndex) => {
      addBlankRowAtIndex(targetIndex, 'before')
    })
  }
  const runInsertAfterInContext = (): void => {
    executeContextAction((targetIndex) => {
      addBlankRowAtIndex(targetIndex, 'after')
    })
  }
  const renameSpeaker = (): void => {
    if (!applyInlineDraft()) return
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
      if (!applyInlineDraft()) {
        notify('시작/종료 시간 형식을 확인하세요.')
        return
      }
      await flushSave()
      const result = await window.screenScript.exportHwpx(project.id)
      if (result) notify(`HWPX를 저장했습니다: ${result.path}`)
    } catch (cause) { notify(errorMessage(cause)) }
  }
  const exportSubtitle = async (): Promise<void> => {
    try {
      if (!applyInlineDraft()) {
        notify('시작/종료 시간 형식을 확인하세요.')
        return
      }
      await flushSave()
      const result = await window.screenScript.exportSrt(project.id)
      if (result) notify(`SRT를 저장했습니다: ${result.path}`)
    } catch (cause) { notify(errorMessage(cause)) }
  }
  const exportDiagnostics = async (): Promise<void> => {
    try {
      const result = await window.screenScript.exportDiagnostics(project.id)
      if (result) notify(`진단 파일을 저장했습니다: ${result.path}`)
    } catch (cause) { notify(errorMessage(cause)) }
  }
  const copyRequestId = async (): Promise<void> => {
    if (!latestRun?.requestId) return
    try {
      await navigator.clipboard.writeText(latestRun.requestId)
      notify('요청 ID를 복사했습니다.')
    } catch {
      notify(`요청 ID: ${latestRun.requestId}`)
    }
  }
  const leaveReview = (navigate: () => void): void => {
    void (async () => {
      try {
        if (!applyInlineDraft()) {
          notify('시작/종료 시간 형식을 확인하세요.')
          return
        }
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
          <button className="secondary-button" disabled={errors.length > 0 || rows.length === 0} onClick={exportSubtitle}>SRT 내보내기</button>
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
              <p className="help-text" style={{ margin: 0, marginBottom: 10, color: '#596563', fontSize: 12 }}>행 편집은 표에서 직접 수정하세요.</p>
              <label className="field-label">분류</label>
              <div className="segmented-control">
                <button className={selected.kind === 'dialogue' ? 'active' : ''} onClick={() => updateRow(selected.id, {
                  kind: 'dialogue',
                  content: selected.kind === 'descriptionGap' ? (supportsSpeakerLabels ? '[화자1] [화자1] 대사' : '대사') : selected.content,
                  speakers: supportsSpeakerLabels ? (selected.speakers.length ? selected.speakers : ['화자1']) : []
                })}>대사</button>
                <button className={selected.kind === 'descriptionGap' ? 'active' : ''} onClick={() => updateRow(selected.id, { kind: 'descriptionGap', content: DESCRIPTION_TEXT, speakers: [] })}>해설</button>
              </div>
              <div className="button-row compact">
                <button onClick={() => updateRow(selected.id, { startMs: Math.floor(playhead) * 1000 })}>현재 위치를 시작으로</button>
                <button onClick={() => updateRow(selected.id, { endMs: Math.ceil(playhead) * 1000 })}>현재 위치를 종료로</button>
              </div>
              <div className="button-row compact">
                <button onClick={split}>현재 위치에서 분할</button>
                <button disabled={selectedIndex === rows.length - 1} onClick={mergeNext}>다음 행과 병합</button>
                <button className="delete-link" onClick={deleteSelectedRow}>행 삭제</button>
              </div>
              <div className="button-row compact">
                <button onClick={addRowBefore}>위에 행 추가</button>
                <button onClick={addRowAfter}>아래에 행 추가</button>
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
          {!project.lastError && (latestRun?.warnings?.length ?? 0) > 0 && (
            <div className="project-warning-banner">
              <div>
                <strong>{latestRun?.diarization?.status === 'fallback' ? '화자 분리 안내' : '분석 안내'}</strong>
                {latestRun?.warnings?.map((warning) => (
                  <span key={`${warning.code}:${warning.message}`}>
                    <div>{warning.message}</div>
                    {warning.detail && <small>원인: {warning.detail}</small>}
                    <div className="error-resolution">{diarizationResolution(warning.code)}</div>
                  </span>
                ))}
                {latestRun?.diarization?.status === 'fallback' && <p>대사 인식은 완료했으며 화자 표기 없이 검수·HWPX·SRT 작업을 계속할 수 있습니다.</p>}
                <div className="error-actions">
                  <button className="secondary-button compact-action" onClick={onRetry}>다시 분석</button>
                  <button className="secondary-button compact-action" onClick={exportDiagnostics}>진단 파일 저장</button>
                </div>
              </div>
              <small>{latestRun?.warnings?.map((warning) => warning.code).join(' · ')}</small>
            </div>
          )}
          {project.lastError && (
            <div className="project-error-banner">
              <div>
                <strong>마지막 분석 오류</strong>
                <span>{project.lastError}</span>
                {latestRun?.errorStage && <small>실패 단계: {processingStageLabel(latestRun.errorStage)}</small>}
                {latestRun?.httpStatus !== undefined && <small>HTTP 상태: {latestRun.httpStatus}</small>}
                {latestRun?.apiCode && <small>OpenAI 오류 코드: {latestRun.apiCode}</small>}
                {latestRun?.apiType && <small>오류 유형: {latestRun.apiType}</small>}
                {latestRun?.apiParam && <small>문제 파라미터: {latestRun.apiParam}</small>}
                {latestRun?.apiDetail && <small>서버 안내: {latestRun.apiDetail}</small>}
                <p className="error-resolution">{processingResolution(latestRun?.errorCode)}</p>
                <div className="error-actions">
                  <button className="secondary-button compact-action" onClick={onRetry}>{latestRun?.errorCode === 'OPENAI_UNPROCESSABLE_AUDIO' ? '오디오 형식 변환 후 재시도' : '다시 분석'}</button>
                  {(project.transcriptionEngine ?? 'local') === 'local' && <button className="secondary-button compact-action" onClick={onRepairModel}>로컬 모델 복구</button>}
                  {latestRun?.requestId && <button className="secondary-button compact-action" onClick={() => void copyRequestId()}>요청 ID 복사</button>}
                  <button className="secondary-button compact-action" onClick={exportDiagnostics}>진단 파일 저장</button>
                </div>
              </div>
              <small>{latestRun?.errorCode ? `오류 코드: ${latestRun.errorCode}` : ''}{latestRun?.exitCode !== undefined ? ` · 종료 코드: ${latestRun.exitCode}` : ''}{latestRun?.requestId ? ` · 요청 ID: ${latestRun.requestId}` : ''}</small>
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
                  (() => {
                    const isEditing = inlineDraft?.rowId === row.id
                    const draft = isEditing ? inlineDraft : null
                    return (
                      <tr
                        key={row.id}
                        className={`${row.kind === 'descriptionGap' ? 'gap-row' : ''} ${selectedId === row.id ? 'selected-row' : ''}`}
                        onClick={() => void chooseRow(row)}
                        onContextMenu={(event) => openContextMenu(event, row.id)}
                      >
                        <td><span className={`kind-badge ${row.kind}`}>{row.kind === 'dialogue' ? '대사' : '해설'}</span></td>
                        <td>
                          {isEditing ? (
                            <input
                              className={`inline-time-input ${inlineErrors.start && isEditing ? 'inline-field-error' : ''}`}
                              value={draft?.start ?? formatTimecode(row.startMs)}
                              onChange={(event) => {
                                updateInlineDraft({ start: event.target.value })
                              }}
                              onBlur={() => void applyInlineDraft()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  applyInlineDraft()
                                }
                              }}
                            />
                          ) : (
                            formatTimecode(row.startMs)
                          )}
                          {inlineErrors.start && isEditing && <small className="inline-error-hint">{inlineErrors.start}</small>}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              className={`inline-time-input ${inlineErrors.end && isEditing ? 'inline-field-error' : ''}`}
                              value={draft?.end ?? formatTimecode(row.endMs)}
                              onChange={(event) => {
                                updateInlineDraft({ end: event.target.value })
                              }}
                              onBlur={() => void applyInlineDraft()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  applyInlineDraft()
                                }
                              }}
                            />
                          ) : (
                            formatTimecode(row.endMs)
                          )}
                          {inlineErrors.end && isEditing && <small className="inline-error-hint">{inlineErrors.end}</small>}
                        </td>
                        <td>{Math.max(0, Math.round((row.endMs - row.startMs) / 1000))}</td>
                        <td className="content-cell">
                          {isEditing ? (
                            <textarea
                              className="inline-content-editor"
                              value={draft?.content ?? row.content}
                              onChange={(event) => {
                                updateInlineDraft({ content: event.target.value })
                              }}
                              onBlur={() => void applyInlineDraft()}
                              rows={3}
                            />
                          ) : (
                            <div className="content-display">{row.content}</div>
                          )}
                        </td>
                        <td>{row.reviewed ? <span className="reviewed-mark">✓</span> : <span className="unreviewed-mark">—</span>}</td>
                      </tr>
                    )
                  })()
                ))}
              </tbody>
            </table>
            {contextMenu && (
              <div className="row-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }} onMouseDown={(event) => event.stopPropagation()}>
                <button className="row-context-item" onClick={() => void runInsertBeforeInContext()}>위에 행 추가</button>
                <button className="row-context-item" onClick={() => void runInsertAfterInContext()}>아래에 행 추가</button>
                <button className="row-context-item" onClick={() => void runSplitOnContextRow()}>현재 위치에서 분할</button>
                <button className="row-context-item" onClick={() => void runMergeOnContextRow()} disabled={contextMenuIndex < 0 || contextMenuIndex >= rows.length - 1}>다음 행과 병합</button>
                <button className="row-context-item danger" onClick={() => void runDeleteOnContextRow()}>행 삭제</button>
              </div>
            )}
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
  const repairLocalModel = async (): Promise<void> => {
    try {
      setNotice('로컬 모델을 확인하고 복구하는 중입니다…')
      const localModel = await window.screenScript.downloadLocalModel()
      setBootstrap((value) => value ? { ...value, localModel } : value)
      setNotice(localModel.installed ? '로컬 모델 복구가 완료되었습니다.' : '로컬 모델을 복구하지 못했습니다. 설정에서 다시 시도하세요.')
    } catch (cause) { setNotice(errorMessage(cause)) }
  }
  const changePreset = async (preset: AnalysisPreset): Promise<void> => {
    if (!project) return
    try {
      const engine = preset === 'openai' ? 'openai' : 'local'
      let updated = await window.screenScript.setTranscriptionEngine(project.id, engine)
      if (engine === 'local') {
        const config: LocalDiarizationConfig = {
          mode: preset === 'local-diarization' ? 'sherpa-onnx' : 'none',
          speakerCount: preset === 'local-diarization' ? updated.localDiarization?.speakerCount ?? null : null
        }
        updated = await window.screenScript.setLocalDiarizationConfig(project.id, config)
      }
      setProject(updated)
    }
    catch (cause) { setNotice(errorMessage(cause)) }
  }
  const changeSpeakerCount = async (value: string): Promise<void> => {
    if (!project) return
    try {
      setProject(await window.screenScript.setLocalDiarizationConfig(project.id, {
        mode: 'sherpa-onnx',
        speakerCount: value === 'auto' ? null : Number(value)
      }))
    } catch (cause) { setNotice(errorMessage(cause)) }
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
           onRetry={() => void startProcessing()}
           onRepairModel={() => void repairLocalModel()}
           closeSaveRef={closeSaveRef}
        />
        {project.status !== 'review' && project.status !== 'exported' && (
          <>
            {projectPreset(project) === 'local-diarization' && (
              <select className="floating-speaker-count" value={project.localDiarization.speakerCount ?? 'auto'} onChange={(event) => void changeSpeakerCount(event.target.value)}>
                <option value="auto">화자 수 자동</option>
                {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>화자 {count}명</option>)}
              </select>
            )}
            <select className="floating-engine" value={projectPreset(project)} onChange={(event) => void changePreset(event.target.value as AnalysisPreset)}>
              <option value="local">내 PC에서 분석</option>
              <option value="local-diarization" disabled={!bootstrap.diarizationBundle.available}>내 PC + 화자 분리 (실험)</option>
              <option value="openai">OpenAI로 분석 (화자 분리)</option>
            </select>
            <button className="floating-process" onClick={startProcessing}>{projectPreset(project) === 'openai' ? 'OpenAI 음성 분석 시작' : projectPreset(project) === 'local-diarization' ? '로컬 화자 분석 시작' : '로컬 음성 분석 시작'}</button>
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
