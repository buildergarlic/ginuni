import type { UpdateStatus } from '@shared/types'

export interface UpdateAdapter {
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

interface UpdateControllerOptions {
  enabled: boolean
  currentVersion: string
  updater: UpdateAdapter
  emit: (status: UpdateStatus) => void
  now?: () => string
}

function versionFrom(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('version' in value)) return undefined
  return typeof value.version === 'string' ? value.version : undefined
}

function percentFrom(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('percent' in value) || typeof value.percent !== 'number') return undefined
  return Math.max(0, Math.min(100, Math.round(value.percent * 10) / 10))
}

export class UpdateController {
  private readonly enabled: boolean
  private readonly currentVersion: string
  private readonly updater: UpdateAdapter
  private readonly emit: (status: UpdateStatus) => void
  private readonly now: () => string
  private status: UpdateStatus

  constructor(options: UpdateControllerOptions) {
    this.enabled = options.enabled
    this.currentVersion = options.currentVersion
    this.updater = options.updater
    this.emit = options.emit
    this.now = options.now ?? (() => new Date().toISOString())
    this.status = this.enabled
      ? { state: 'idle', currentVersion: this.currentVersion, message: '새 버전을 자동으로 확인합니다.' }
      : { state: 'disabled', currentVersion: this.currentVersion, message: '자동 업데이트는 설치형 앱에서 사용할 수 있습니다.' }
    this.bindEvents()
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  async check(): Promise<UpdateStatus> {
    if (!this.enabled) return this.getStatus()
    if (['checking', 'available', 'downloading', 'downloaded'].includes(this.status.state)) return this.getStatus()
    this.setStatus({ state: 'checking', message: '새 버전을 확인하고 있습니다.' })
    try {
      await this.updater.checkForUpdates()
    } catch {
      if (this.status.state !== 'error') this.updateFailed()
    }
    return this.getStatus()
  }

  install(): void {
    if (this.status.state !== 'downloaded') throw new Error('설치할 업데이트가 아직 준비되지 않았습니다.')
    this.updater.quitAndInstall(false, true)
  }

  private bindEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.setStatus({ state: 'checking', message: '새 버전을 확인하고 있습니다.' })
    })
    this.updater.on('update-available', (info) => {
      const availableVersion = versionFrom(info)
      this.setStatus({
        state: 'available',
        availableVersion,
        message: availableVersion ? `새 버전 v${availableVersion}을 내려받습니다.` : '새 버전을 내려받습니다.',
        checkedAt: this.now()
      })
    })
    this.updater.on('download-progress', (progress) => {
      const percent = percentFrom(progress)
      this.setStatus({
        state: 'downloading',
        availableVersion: this.status.availableVersion,
        percent,
        message: percent === undefined ? '업데이트를 내려받고 있습니다.' : `업데이트를 내려받고 있습니다. (${percent}%)`
      })
    })
    this.updater.on('update-downloaded', (info) => {
      const availableVersion = versionFrom(info) ?? this.status.availableVersion
      this.setStatus({
        state: 'downloaded',
        availableVersion,
        percent: 100,
        message: availableVersion ? `v${availableVersion} 업데이트가 준비되었습니다.` : '업데이트 설치 준비가 완료되었습니다.',
        checkedAt: this.now()
      })
    })
    this.updater.on('update-not-available', () => {
      this.setStatus({
        state: 'not-available',
        message: '현재 최신 버전을 사용하고 있습니다.',
        checkedAt: this.now()
      })
    })
    this.updater.on('error', () => this.updateFailed())
  }

  private updateFailed(): void {
    this.setStatus({
      state: 'error',
      message: '업데이트 확인에 실패했습니다. 인터넷 연결과 GitHub Releases 공개 상태를 확인하세요.',
      checkedAt: this.now()
    })
  }

  private setStatus(next: Omit<UpdateStatus, 'currentVersion'>): void {
    this.status = { currentVersion: this.currentVersion, ...next }
    this.emit(this.getStatus())
  }
}
