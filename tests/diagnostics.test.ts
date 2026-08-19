import { describe, expect, it, vi } from 'vitest'

const runtimeState = vi.hoisted(() => ({
  model: { installed: false, integrity: 'invalid' as const, sizeBytes: 10, expectedBytes: 20, modelName: 'test' },
  runtimes: [{ name: 'whisper-cli' as const, available: false, runnable: false, detail: 'C:\\Users\\sample\\blocked.exe' }]
}))
vi.mock('electron', () => ({ app: { getVersion: () => '0.4.0-test' } }))
vi.mock('@main/services/local-model', () => ({ localModelStatus: () => Promise.resolve(runtimeState.model) }))
vi.mock('@main/services/runtime', () => ({ runtimeDiagnostics: () => Promise.resolve(runtimeState.runtimes) }))

import { buildLocalDiagnosticReport } from '@main/services/diagnostics'

describe('로컬 진단 보고서', () => {
  it('원본 전체 경로·대사·음성 없이 안전한 정보만 기록한다', async () => {
    const report = await buildLocalDiagnosticReport({
      schemaVersion: 1,
      id: 'project-id',
      title: '민감한 제목',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'error',
      transcriptionEngine: 'local',
      source: { kind: 'local', uri: 'C:\\Users\\sample\\secret\\video.mp4', displayName: 'video.mp4', localMediaPath: 'C:\\Users\\sample\\secret\\video.mp4' },
      media: { durationMs: 1000 },
      segments: [{ id: 'segment', startMs: 0, endMs: 1000, speakerId: '', text: '대사 비공개' }],
      rows: [{ id: 'row', kind: 'dialogue', startMs: 0, endMs: 1000, speakers: [], content: '대사 비공개', sourceSegmentIds: ['segment'], reviewed: false }],
      runs: [{ id: 'run', startedAt: '2026-01-01T00:00:00.000Z', provider: 'local', model: 'test', errorCode: 'WHISPER_FAILED', stderrSummary: 'C:\\Users\\sample\\secret' }],
      exports: [],
      lastError: 'C:\\Users\\sample\\secret\\video.mp4 대사 비공개'
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sample')
    expect(serialized).not.toContain('대사 비공개')
    expect(serialized).toContain('WHISPER_FAILED')
  })
})
