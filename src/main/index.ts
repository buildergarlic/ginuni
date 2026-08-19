import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { LOCAL_ENGINE_VERSION, OPENAI_MODEL } from '@shared/constants'
import { generateScriptRows, validateRows } from '@shared/rows'
import { supportsSpeakerLabels } from '@shared/speaker-labels'
import type { CreateProjectInput, ExternalLinkTarget, LocalDiarizationConfig, LocalModelStatus, ModelDownloadProgress, ProcessingProgress, ProcessingRun, ProcessingWarning, ScriptProject, ScriptRow, TranscriptionEngine } from '@shared/types'
import { buildHwpx, nextVersionedHwpxPath } from './services/hwpx'
import { prepareMedia } from './services/media'
import { createMediaProtocolHandler } from './services/media-protocol'
import { LocalWhisperTranscriptionProvider } from './services/local-transcription'
import { deleteLocalModel, ensureLocalModel, localModelStatus } from './services/local-model'
import { OpenAiTranscriptionProvider, TranscriptionFailure } from './services/openai-transcription'
import { buildAndWriteSrt } from './services/srt'
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  projectDirectory,
  projectsRoot,
  saveProject,
  saveRows,
  setLocalDiarizationConfig,
  setTranscriptionEngine
} from './services/project-store'
import { appVersion, templatePath } from './services/runtime'
import { buildLocalDiagnosticReport } from './services/diagnostics'
import { classifyProcessFailure, LocalProcessingError, sanitizeDiagnosticText } from './services/processing-errors'
import { clearApiKey, getApiKey, hasApiKey, saveApiKey } from './services/settings-store'
import { installYouTubeClientIdentity } from './services/youtube-client-identity'
import { checkForAppUpdates, configureAppUpdater, getAppUpdateStatus, installAppUpdate } from './services/app-updater'
import { diarizationBundleStatus } from './services/diarization-bundle'
import {
  applyDiarization,
  DIARIZATION_METADATA,
  DiarizationExecutionError,
  SherpaOnnxDiarizationProvider
} from './services/speaker-diarization'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let allowWindowClose = false
let closeRequestPending = false
const activeJobs = new Map<string, AbortController>()
const EXTERNAL_URLS: Readonly<Record<ExternalLinkTarget, string>> = {
  repository: 'https://github.com/buildergarlic/ginuni',
  sponsor: 'https://github.com/sponsors/buildergarlic',
  threads: 'https://www.threads.com/@builder.garlic',
  email: 'mailto:contact@ax4u.kr',
  kakao: 'https://open.kakao.com/o/s7eFbFIi'
}

function sendProgress(progress: ProcessingProgress): void {
  mainWindow?.webContents.send('project:progress', progress)
}

function sendModelProgress(progress: ModelDownloadProgress): void {
  mainWindow?.webContents.send('model:progress', progress)
}

async function processProject(id: string): Promise<ScriptProject> {
  if (activeJobs.has(id)) throw new Error('이미 처리 중인 프로젝트입니다.')

  const controller = new AbortController()
  activeJobs.set(id, controller)
  const project = await loadProject(id)
  const engine = project.transcriptionEngine ?? 'openai'
  const localDiarization = project.localDiarization ?? { mode: 'none', speakerCount: null }
  const run: ProcessingRun = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    provider: engine,
    model: engine === 'local' ? LOCAL_ENGINE_VERSION : OPENAI_MODEL
  }
  project.runs.push(run)
  project.status = 'processing'
  delete project.lastError
  await saveProject(project)

  const progress = (value: Omit<ProcessingProgress, 'projectId'>): void => sendProgress({ projectId: id, ...value })
  let apiKey: string | null = null
  let modelIntegrity: LocalModelStatus['integrity'] | undefined

  const addWarning = (warning: ProcessingWarning): void => {
    run.warnings = [...(run.warnings ?? []), warning]
  }

  const diarizationFallback = (warning: ProcessingWarning): void => {
    run.diarization = {
      ...DIARIZATION_METADATA,
      engine: 'sherpa-onnx',
      requestedSpeakerCount: localDiarization.speakerCount,
      status: 'fallback'
    }
    addWarning(warning)
  }

  try {
    apiKey = engine === 'openai' ? await getApiKey() : null
    if (engine === 'openai' && !apiKey) {
      throw new TranscriptionFailure(
        'OPENAI_API_KEY_MISSING',
        'OpenAI 모드는 설정에서 API 키를 먼저 저장해야 합니다. 로컬 모드는 API 키 없이 사용할 수 있습니다.'
      )
    }
    progress({ stage: 'preparing', percent: 3, message: '프로젝트를 준비하고 있습니다.' })
    await prepareMedia({ project, projectDirectory: await projectDirectory(id), engine, signal: controller.signal, progress })
    await saveProject(project)
    let modelPath: string | undefined
    if (engine === 'local') {
      try {
        modelIntegrity = (await localModelStatus()).integrity
        modelPath = await ensureLocalModel({
          signal: controller.signal,
          onProgress: (modelProgress) => {
            sendModelProgress(modelProgress)
            progress({
              stage: 'downloadingModel',
              percent: 30 + Math.round(modelProgress.percent * 0.2),
              message: modelProgress.message
            })
          }
        })
      } catch (error) {
        const modelStatus = await localModelStatus()
        modelIntegrity = modelStatus.integrity
        throw new LocalProcessingError({
          code: modelStatus.integrity === 'invalid' ? 'MODEL_CORRUPTED' : 'MODEL_MISSING',
          stage: 'model',
          message: modelStatus.integrity === 'invalid'
            ? '로컬 음성인식 모델이 손상되어 복구하지 못했습니다. 설정에서 모델 복구를 다시 시도하세요.'
            : '로컬 음성인식 모델을 준비하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.',
          stderr: error instanceof Error ? error.message : undefined
          })
      }
      modelIntegrity = 'valid'
    }
    progress({
      stage: 'transcribing',
      percent: 55,
      message: engine === 'local' ? '이 PC에서 음성을 분석하고 있습니다. 영상 길이에 따라 시간이 걸릴 수 있습니다.' : '음성과 화자를 분석하고 있습니다.'
    })
    const transcriptionRequest = {
      audioPath: project.media.audioPath!,
      language: 'ko',
      durationMs: project.media.durationMs,
      signal: controller.signal
    }
    if (engine === 'local') {
      const localProvider = new LocalWhisperTranscriptionProvider(modelPath!)
      if (localDiarization.mode === 'sherpa-onnx') {
        const detailed = await localProvider.transcribeDetailed({
          ...transcriptionRequest,
          onProgress: (percent) => progress({
            stage: 'transcribing',
            percent: 50 + Math.round(percent * 0.25),
            message: `이 PC에서 대사를 분석하고 있습니다. (${percent}%)`
          })
        })
        project.segments = detailed.segments
        const bundle = await diarizationBundleStatus()
        if (!bundle.available) {
          diarizationFallback({
            code: 'DIARIZATION_MODEL_INVALID',
            message: '화자 분리 구성 요소가 없거나 손상되어 화자 표기 없이 대사를 만들었습니다.',
            detail: bundle.integrity
          })
        } else {
          progress({ stage: 'diarizing', percent: 78, message: '이 PC에서 화자를 구분하고 있습니다.' })
          try {
            const diarization = await new SherpaOnnxDiarizationProvider().diarize({
              audioPath: project.media.audioPath!,
              durationMs: project.media.durationMs,
              speakerCount: localDiarization.speakerCount,
              signal: controller.signal,
              onProgress: (percent) => progress({
                stage: 'diarizing',
                percent: 78 + Math.round(percent * 0.18),
                message: `이 PC에서 화자를 구분하고 있습니다. (${Math.round(percent)}%)`
              })
            })
            if (diarization.length === 0 && detailed.segments.length > 0) {
              diarizationFallback({
                code: 'DIARIZATION_OUTPUT_INVALID',
                message: '화자 구간을 찾지 못해 화자 표기 없이 대사를 만들었습니다.'
              })
            } else {
              const applied = applyDiarization(detailed.segments, detailed.words, diarization)
              const assignedSpeakerCount = new Set(applied.segments.map((segment) => segment.speakerId).filter(Boolean)).size
              if (assignedSpeakerCount === 0 && detailed.segments.length > 0) {
                diarizationFallback({
                  code: 'DIARIZATION_OUTPUT_INVALID',
                  message: '대사와 화자 구간을 연결하지 못해 화자 표기 없이 대사를 만들었습니다.'
                })
              } else {
                project.segments = applied.segments
                run.diarization = {
                  ...DIARIZATION_METADATA,
                  engine: 'sherpa-onnx',
                  requestedSpeakerCount: localDiarization.speakerCount,
                  detectedSpeakerCount: applied.detectedSpeakerCount,
                  status: 'succeeded',
                  unassignedWordCount: applied.unassignedWordCount,
                  ambiguousWordCount: applied.ambiguousWordCount
                }
                if (!applied.usedWordTimestamps && detailed.segments.length > 0) {
                  addWarning({
                    code: 'DIARIZATION_WORD_TIMESTAMPS_UNAVAILABLE',
                    message: '단어 타임스탬프가 없어 문장 구간 단위로 화자를 배정했습니다.'
                  })
                }
              }
            }
          } catch (error) {
            if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
            const failure = error instanceof DiarizationExecutionError
              ? error
              : new DiarizationExecutionError('DIARIZATION_FAILED', '화자 분리에 실패했습니다.', error instanceof Error ? error.message : undefined)
            diarizationFallback({
              code: failure.code,
              message: `${failure.message} 화자 표기 없이 대사를 만들었습니다.`,
              detail: sanitizeDiagnosticText(failure.detail),
              exitCode: failure.exitCode
            })
          }
        }
      } else {
        project.segments = await localProvider.transcribe({
          ...transcriptionRequest,
          onProgress: (percent) => progress({ stage: 'transcribing', percent: 55 + Math.round(percent * 0.3), message: `이 PC에서 음성을 분석하고 있습니다. (${percent}%)` })
        })
      }
    } else {
      project.segments = await new OpenAiTranscriptionProvider(apiKey!).transcribe(transcriptionRequest)
    }
    progress({ stage: 'building', percent: engine === 'local' && localDiarization.mode === 'sherpa-onnx' ? 97 : 88, message: '대사와 해설 구간을 구성하고 있습니다.' })
    project.rows = generateScriptRows(project.segments, project.media.durationMs)
    project.status = 'review'
    run.completedAt = new Date().toISOString()
    run.modelIntegrity = modelIntegrity
    await saveProject(project)
    progress({ stage: 'complete', percent: 100, message: '검수할 준비가 되었습니다.' })
    return project
  } catch (error) {
    const transcriptionFailure = error instanceof TranscriptionFailure ? error : null
    const aborted = controller.signal.aborted || transcriptionFailure?.code === 'OPENAI_ABORTED' || (error instanceof DOMException && error.name === 'AbortError')
    const localFailure = error instanceof LocalProcessingError
      ? error
      : !transcriptionFailure && engine === 'local'
        ? classifyProcessFailure(error, 'transcription')
        : null
    project.status = aborted ? 'draft' : 'error'
    project.lastError = aborted
      ? '작업이 취소되었습니다.'
      : localFailure?.message ?? transcriptionFailure?.message ?? sanitizeDiagnosticText(error instanceof Error ? error.message : undefined) ?? '알 수 없는 오류가 발생했습니다.'
    run.completedAt = new Date().toISOString()
    run.errorCode = aborted ? 'ABORTED' : transcriptionFailure?.code ?? localFailure?.code ?? 'PROCESSING_FAILED'
    run.errorStage = localFailure?.stage
    run.exitCode = localFailure?.exitCode
    run.stderrSummary = localFailure?.stderrSummary
    run.appVersion = appVersion()
    run.platform = process.platform
    run.architecture = process.arch
    run.totalMemoryBytes = totalmem()
    run.modelIntegrity = modelIntegrity
    run.httpStatus = transcriptionFailure?.status
    run.requestId = transcriptionFailure?.requestId
    run.apiCode = transcriptionFailure?.apiCode
    run.apiType = transcriptionFailure?.apiType
    run.apiParam = transcriptionFailure?.apiParam
    run.apiDetail = transcriptionFailure?.apiDetail
    run.openaiRequest = transcriptionFailure?.requestInfo
    run.openaiAudio = transcriptionFailure?.audioInfo
    await saveProject(project)
    throw new Error(project.lastError)
  } finally {
    activeJobs.delete(id)
  }
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async () => ({
    projects: await listProjects(),
    hasApiKey: await hasApiKey(),
    appVersion: appVersion(),
    projectsRoot: projectsRoot(),
    localModel: await localModelStatus(),
    diarizationBundle: await diarizationBundleStatus(),
    updateStatus: getAppUpdateStatus()
  }))
  ipcMain.handle('app:open-external', async (_event, target: ExternalLinkTarget) => {
    const url = EXTERNAL_URLS[target]
    if (!url) throw new Error('지원하지 않는 외부 링크입니다.')
    await shell.openExternal(url)
  })
  ipcMain.handle('app:open-external-url', async (_event, rawUrl: string) => {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('지원하지 않는 URL입니다.')
    }
    await shell.openExternal(parsed.toString())
  })
  ipcMain.handle('app:check-for-updates', () => checkForAppUpdates())
  ipcMain.handle('app:install-update', () => installAppUpdate())
  ipcMain.handle('app:close-response', (_event, allow: boolean) => {
    if (!closeRequestPending || typeof allow !== 'boolean') return
    closeRequestPending = false
    if (!allow) return
    allowWindowClose = true
    mainWindow?.close()
  })

  ipcMain.handle('dialog:choose-local-media', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '동영상 또는 음성 파일 선택',
      properties: ['openFile'],
      filters: [
        { name: '동영상 및 음성', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4a', 'mp3', 'wav', 'flac', 'ogg'] },
        { name: '모든 파일', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('project:create', (_event, input: CreateProjectInput) => createProject(input))
  ipcMain.handle('project:load', (_event, id: string) => loadProject(id))
  ipcMain.handle('project:save-rows', (_event, id: string, rows: ScriptRow[]) => saveRows(id, rows))
  ipcMain.handle('project:set-engine', (_event, id: string, engine: TranscriptionEngine) => setTranscriptionEngine(id, engine))
  ipcMain.handle('project:set-local-diarization', (_event, id: string, config: LocalDiarizationConfig) => setLocalDiarizationConfig(id, config))
  ipcMain.handle('project:process', (_event, id: string) => processProject(id))
  ipcMain.handle('project:cancel', (_event, id: string) => activeJobs.get(id)?.abort())
  ipcMain.handle('project:delete', (_event, id: string) => deleteProject(id))

  ipcMain.handle('project:export-hwpx', async (_event, id: string) => {
    const project = await loadProject(id)
    const errors = validateRows(project.rows)
    if (errors.length > 0) throw new Error(errors[0])
    if (project.rows.length === 0) throw new Error('내보낼 대본 행이 없습니다.')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'HWPX 저장 폴더 선택',
      defaultPath: join(projectsRoot(), '..', 'Exports'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    const outputPath = await nextVersionedHwpxPath(result.filePaths[0], project.title)
    await buildHwpx({ templatePath: await templatePath(), outputPath, title: project.title, rows: project.rows })
    project.status = 'exported'
    project.exports.push({ path: outputPath, exportedAt: new Date().toISOString(), appVersion: appVersion() })
    await saveProject(project)
    shell.showItemInFolder(outputPath)
    return { path: outputPath }
  })

  ipcMain.handle('project:export-srt', async (_event, id: string) => {
    const project = await loadProject(id)
    const errors = validateRows(project.rows)
    if (errors.length > 0) throw new Error(errors[0])
    if (!project.rows.some((row) => row.kind === 'dialogue')) throw new Error('내보낼 대사 행이 없습니다.')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'SRT 저장 폴더 선택',
      defaultPath: join(projectsRoot(), '..', 'Exports'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    const output = await buildAndWriteSrt({
      outputDirectory: result.filePaths[0],
      projectTitle: project.title,
      rows: project.rows,
      includeSpeakerLabels: supportsSpeakerLabels(project)
    })
    project.status = 'exported'
    project.exports.push({
      path: output.path,
      exportedAt: new Date().toISOString(),
      appVersion: appVersion(),
      format: 'srt'
    })
    await saveProject(project)
    shell.showItemInFolder(output.path)
    return output
  })

  ipcMain.handle('settings:save-api-key', (_event, key: string) => saveApiKey(key))
  ipcMain.handle('settings:clear-api-key', () => clearApiKey())
  ipcMain.handle('model:download', async () => {
    await ensureLocalModel({ onProgress: sendModelProgress })
    return localModelStatus()
  })
  ipcMain.handle('model:delete', () => deleteLocalModel())
  ipcMain.handle('project:export-diagnostics', async (_event, id: string) => {
    const project = await loadProject(id)
    const report = await buildLocalDiagnosticReport(project)
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '분석 진단 파일 저장',
      defaultPath: join(projectsRoot(), '..', `${project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}-diagnostic.json`),
      filters: [{ name: 'JSON 진단 파일', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    shell.showItemInFolder(result.filePath)
    return { path: result.filePath }
  })
}

async function createWindow(): Promise<void> {
  allowWindowClose = false
  closeRequestPending = false
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    useContentSize: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (allowWindowClose) return
    event.preventDefault()
    if (closeRequestPending) return
    closeRequestPending = true
    mainWindow?.webContents.send('app:close-requested')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    allowWindowClose = false
    closeRequestPending = false
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer-load] ${code} ${description} ${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer-gone] ${details.reason}`)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (Object.values(EXTERNAL_URLS).includes(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  configureAppUpdater(mainWindow)
}

app.whenReady().then(async () => {
  installYouTubeClientIdentity(session.defaultSession)
  protocol.handle('media', createMediaProtocolHandler(loadProject))
  registerIpc()
  await createWindow()
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
