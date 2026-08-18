import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LOCAL_ENGINE_VERSION, OPENAI_MODEL } from '@shared/constants'
import { generateScriptRows, validateRows } from '@shared/rows'
import type { CreateProjectInput, ExternalLinkTarget, ModelDownloadProgress, ProcessingProgress, ProcessingRun, ScriptProject, ScriptRow, TranscriptionEngine } from '@shared/types'
import { buildHwpx, nextVersionedHwpxPath } from './services/hwpx'
import { prepareMedia } from './services/media'
import { createMediaProtocolHandler } from './services/media-protocol'
import { LocalWhisperTranscriptionProvider } from './services/local-transcription'
import { deleteLocalModel, ensureLocalModel, localModelStatus } from './services/local-model'
import { OpenAiTranscriptionProvider, TranscriptionFailure } from './services/openai-transcription'
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  projectDirectory,
  projectsRoot,
  saveProject,
  saveRows,
  setTranscriptionEngine
} from './services/project-store'
import { appVersion, templatePath } from './services/runtime'
import { clearApiKey, getApiKey, hasApiKey, saveApiKey } from './services/settings-store'
import { installYouTubeClientIdentity } from './services/youtube-client-identity'
import { checkForAppUpdates, configureAppUpdater, getAppUpdateStatus, installAppUpdate } from './services/app-updater'

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
    }
    progress({
      stage: 'transcribing',
      percent: 55,
      message: engine === 'local' ? '이 PC에서 음성을 분석하고 있습니다. 영상 길이에 따라 시간이 걸릴 수 있습니다.' : '음성과 화자를 분석하고 있습니다.'
    })
    const provider = engine === 'local'
      ? new LocalWhisperTranscriptionProvider(modelPath!)
      : new OpenAiTranscriptionProvider(apiKey!)
    project.segments = await provider.transcribe({
      audioPath: project.media.audioPath!,
      language: 'ko',
      signal: controller.signal,
      onProgress: engine === 'local'
        ? (percent) => progress({ stage: 'transcribing', percent: 55 + Math.round(percent * 0.3), message: `이 PC에서 음성을 분석하고 있습니다. (${percent}%)` })
        : undefined
    })
    progress({ stage: 'building', percent: 88, message: '대사와 해설 구간을 구성하고 있습니다.' })
    project.rows = generateScriptRows(project.segments, project.media.durationMs)
    project.status = 'review'
    run.completedAt = new Date().toISOString()
    await saveProject(project)
    progress({ stage: 'complete', percent: 100, message: '검수할 준비가 되었습니다.' })
    return project
  } catch (error) {
    const transcriptionFailure = error instanceof TranscriptionFailure ? error : null
    const aborted = controller.signal.aborted || transcriptionFailure?.code === 'OPENAI_ABORTED' || (error instanceof DOMException && error.name === 'AbortError')
    project.status = aborted ? 'draft' : 'error'
    project.lastError = aborted ? '작업이 취소되었습니다.' : error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
    run.completedAt = new Date().toISOString()
    run.errorCode = aborted ? 'ABORTED' : transcriptionFailure?.code ?? 'PROCESSING_FAILED'
    run.httpStatus = transcriptionFailure?.status
    run.requestId = transcriptionFailure?.requestId
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
    updateStatus: getAppUpdateStatus()
  }))
  ipcMain.handle('app:open-external', async (_event, target: ExternalLinkTarget) => {
    const url = EXTERNAL_URLS[target]
    if (!url) throw new Error('지원하지 않는 외부 링크입니다.')
    await shell.openExternal(url)
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

  ipcMain.handle('settings:save-api-key', (_event, key: string) => saveApiKey(key))
  ipcMain.handle('settings:clear-api-key', () => clearApiKey())
  ipcMain.handle('model:download', async () => {
    await ensureLocalModel({ onProgress: sendModelProgress })
    return localModelStatus()
  })
  ipcMain.handle('model:delete', () => deleteLocalModel())
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
