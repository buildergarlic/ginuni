import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, CreateProjectInput, ExternalLinkTarget, ModelDownloadProgress, ProcessingProgress, ScriptRow, TranscriptionEngine, UpdateStatus } from '@shared/types'

const api: AppApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  chooseLocalMedia: () => ipcRenderer.invoke('dialog:choose-local-media'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  loadProject: (id: string) => ipcRenderer.invoke('project:load', id),
  saveRows: (id: string, rows: ScriptRow[]) => ipcRenderer.invoke('project:save-rows', id, rows),
  exportSrt: (id: string) => ipcRenderer.invoke('project:export-srt', id),
  setTranscriptionEngine: (id: string, engine: TranscriptionEngine) => ipcRenderer.invoke('project:set-engine', id, engine),
  processProject: (id: string) => ipcRenderer.invoke('project:process', id),
  cancelProcessing: (id: string) => ipcRenderer.invoke('project:cancel', id),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  exportHwpx: (id: string) => ipcRenderer.invoke('project:export-hwpx', id),
  saveApiKey: (key: string) => ipcRenderer.invoke('settings:save-api-key', key),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-api-key'),
  downloadLocalModel: () => ipcRenderer.invoke('model:download'),
  deleteLocalModel: () => ipcRenderer.invoke('model:delete'),
  openExternal: (target: ExternalLinkTarget) => ipcRenderer.invoke('app:open-external', target),
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
