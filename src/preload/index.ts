import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, CreateProjectInput, ExternalLinkTarget, LocalDiarizationConfig, ModelDownloadProgress, ProcessingProgress, ScriptRow, TranscriptionEngine, UpdateStatus } from '@shared/types'

const api: AppApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  chooseLocalMedia: () => ipcRenderer.invoke('dialog:choose-local-media'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  loadProject: (id: string) => ipcRenderer.invoke('project:load', id),
  saveRows: (id, rows, revision) => ipcRenderer.invoke('project:save-rows', id, rows, revision),
  setProjectConsent: (id, consent) => ipcRenderer.invoke('project:set-consent', id, consent),
  reviewRows: (id, rowIds, approved, revision) => ipcRenderer.invoke('project:review-rows', id, rowIds, approved, revision),
  listSnapshots: (id) => ipcRenderer.invoke('project:list-snapshots', id),
  restoreSnapshot: (id, snapshotId, revision) => ipcRenderer.invoke('project:restore-snapshot', id, snapshotId, revision),
  requestCorrections: (id, rowIds, revision) => ipcRenderer.invoke('project:request-corrections', id, rowIds, revision),
  decideCorrection: (id, proposalId, decision, revision) => ipcRenderer.invoke('project:decide-correction', id, proposalId, decision, revision),
  exportEvidence: (id) => ipcRenderer.invoke('project:export-evidence', id),
  exportSrt: (id: string) => ipcRenderer.invoke('project:export-srt', id),
  setTranscriptionEngine: (id: string, engine: TranscriptionEngine) => ipcRenderer.invoke('project:set-engine', id, engine),
  setLocalDiarizationConfig: (id: string, config: LocalDiarizationConfig) => ipcRenderer.invoke('project:set-local-diarization', id, config),
  processProject: (id: string) => ipcRenderer.invoke('project:process', id),
  cancelProcessing: (id: string) => ipcRenderer.invoke('project:cancel', id),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  exportHwpx: (id: string) => ipcRenderer.invoke('project:export-hwpx', id),
  saveApiKey: (key: string) => ipcRenderer.invoke('settings:save-api-key', key),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-api-key'),
  downloadLocalModel: () => ipcRenderer.invoke('model:download'),
  deleteLocalModel: () => ipcRenderer.invoke('model:delete'),
  exportDiagnostics: (id: string) => ipcRenderer.invoke('project:export-diagnostics', id),
  openExternal: (target: ExternalLinkTarget) => ipcRenderer.invoke('app:open-external', target),
  openExternalUrl: (url: string) => ipcRenderer.invoke('app:open-external-url', url),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  respondToClose: (allow: boolean) => ipcRenderer.invoke('app:close-response', allow),
  onProgress: (listener: (progress: ProcessingProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ProcessingProgress): void => listener(progress)
    ipcRenderer.on('project:progress', handler)
    return () => ipcRenderer.removeListener('project:progress', handler)
  },
  onModelProgress: (listener: (progress: ModelDownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ModelDownloadProgress): void => listener(progress)
    ipcRenderer.on('model:progress', handler)
    return () => ipcRenderer.removeListener('model:progress', handler)
  },
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => listener(status)
    ipcRenderer.on('app:update-status', handler)
    return () => ipcRenderer.removeListener('app:update-status', handler)
  },
  onCloseRequested: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('app:close-requested', handler)
    return () => ipcRenderer.removeListener('app:close-requested', handler)
  }
}

contextBridge.exposeInMainWorld('screenScript', api)
