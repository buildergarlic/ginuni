import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { UpdateController, type UpdateAdapter } from '@main/services/update-controller'
import type { UpdateStatus } from '@shared/types'

class FakeUpdater extends EventEmitter implements UpdateAdapter {
  readonly checkForUpdates = vi.fn(async () => undefined)
  readonly quitAndInstall = vi.fn()
}

function create(enabled = true): { controller: UpdateController; updater: FakeUpdater; emitted: UpdateStatus[] } {
  const updater = new FakeUpdater()
  const emitted: UpdateStatus[] = []
  const controller = new UpdateController({
    enabled,
    currentVersion: '0.4.0-beta.1',
    updater,
    emit: (status) => emitted.push(status),
    now: () => '2026-08-19T00:00:00.000Z'
  })
  return { controller, updater, emitted }
}

describe('UpdateController', () => {
  it('개발 모드에서는 실제 업데이트 서버를 호출하지 않는다', async () => {
    const { controller, updater } = create(false)
    expect((await controller.check()).state).toBe('disabled')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('새 버전 다운로드와 설치 준비 상태를 안전하게 전달한다', () => {
    const { controller, updater, emitted } = create()
    updater.emit('update-available', { version: '0.4.0-beta.2' })
    updater.emit('download-progress', { percent: 41.27 })
    updater.emit('update-downloaded', { version: '0.4.0-beta.2' })

    expect(emitted.map((status) => status.state)).toEqual(['available', 'downloading', 'downloaded'])
    expect(controller.getStatus()).toMatchObject({
      state: 'downloaded', availableVersion: '0.4.0-beta.2', percent: 100
    })
    controller.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('다운로드 진행률을 0~100 범위로 제한한다', () => {
    const { controller, updater } = create()
    updater.emit('download-progress', { percent: 101.234 })
    expect(controller.getStatus().percent).toBe(100)
  })

  it('최신 버전 상태와 확인 시각을 기록한다', () => {
    const { controller, updater } = create()
    updater.emit('update-not-available', { version: '0.4.0-beta.1' })
    expect(controller.getStatus()).toMatchObject({
      state: 'not-available', checkedAt: '2026-08-19T00:00:00.000Z'
    })
  })

  it('업데이트 서버 원문 오류를 UI 상태에 노출하지 않는다', () => {
    const { controller, updater } = create()
    updater.emit('error', new Error('Authorization: secret-token C:/private/path'))
    const status = controller.getStatus()
    expect(status.state).toBe('error')
    expect(status.message).not.toContain('secret-token')
    expect(status.message).not.toContain('C:/private/path')
  })

  it('다운로드 전에는 설치를 시작하지 않는다', () => {
    const { controller, updater } = create()
    expect(() => controller.install()).toThrow('아직 준비되지 않았습니다')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
})
