import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { UpdateController, type UpdateAdapter } from './update-controller'

const { autoUpdater } = electronUpdater
let updateWindow: BrowserWindow | null = null
let controller: UpdateController | null = null
let startupCheckScheduled = false

function createController(): UpdateController {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = app.getVersion().includes('-')
  autoUpdater.fullChangelog = false
  autoUpdater.logger = null

  return new UpdateController({
    enabled: app.isPackaged,
    currentVersion: app.getVersion(),
    updater: autoUpdater as unknown as UpdateAdapter,
    emit: (status) => updateWindow?.webContents.send('app:update-status', status)
  })
}

export function configureAppUpdater(window: BrowserWindow): void {
  updateWindow = window
  controller ??= createController()
  if (!app.isPackaged || startupCheckScheduled) return
  startupCheckScheduled = true
  setTimeout(() => void controller?.check(), 5_000)
}

export function getAppUpdateStatus(): UpdateStatus {
  controller ??= createController()
  return controller.getStatus()
}

export async function checkForAppUpdates(): Promise<UpdateStatus> {
  controller ??= createController()
  return controller.check()
}

export function installAppUpdate(): void {
  if (!controller) throw new Error('업데이트 기능이 아직 준비되지 않았습니다.')
  controller.install()
}
