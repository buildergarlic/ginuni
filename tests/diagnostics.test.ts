import { describe, expect, it, vi } from 'vitest'

const runtimeState = vi.hoisted(() => ({
  model: { installed: false, integrity: 'invalid' as const, sizeBytes: 10, expectedBytes: 20, modelName: 'test' },
  runtimes: [{ name: 'whisper-cli' as const, available: false, runnable: false, detail: 'C:\\Users\\sample\\blocked.exe' }]
}))
vi.mock('electron', () => ({ app: { getVersion: () => '0.4.0-test' } }))
vi.mock('@main/services/local-model', () => ({ localModelStatus: () => Promise.resolve(runtimeState.model) }))
vi.mock('@main/services/runtime', () => ({ runtimeDiagnostics: () => Promise.resolve(runtimeState.runtimes) }))
vi.mock('@main/services/diarization-bundle', () => ({ diarizationBundleStatus: () => Promise.resolve({
  available: false,
  integrity: 'missing',
  engineVersion: 'test',
  installedBytes: 0,
  expectedBytes: 1,
  components: []
}) }))

import { buildLocalDiagnosticReport } from '@main/services/diagnostics'

describe('로컬 진단 보고서', () => {
  it('원본 전체 경로·대사·음성 없이 안전한 정보만 기록한다', async () => {
    const report = await buildLocalDiagnosticReport({
      schemaVersion: 2,
      id: 'project-id',
      title: '민감한 제목',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'error',
      transcriptionEngine: 'local',
      localDiarization: { mode: 'none', speakerCount: null },
      source: { kind: 'local', uri: 'C:\\Users\\sample\\secret\\video.mp4', displayName: 'video.mp4', localMediaPath: 'C:\\Users\\sample\\secret\\video.mp4' },
      media: { durationMs: 1000 },
      segments: [{ id: 'segment', startMs: 0, endMs: 1000, speakerId: '', text: '대사 비공개' }],
      rows: [{ id: 'row', kind: 'dialogue', startMs: 0, endMs: 1000, speakers: [], content: '대사 비공개', sourceSegmentIds: ['segment'], reviewed: false }],
      runs: [{
        id: 'run',
        startedAt: '2026-01-01T00:00:00.000Z',
        provider: 'local',
        model: 'test',
        errorCode: 'WHISPER_FAILED',
        stderrSummary: 'C:\\Users\\sample\\secret',
        diarization: {
          engine: 'sherpa-onnx', engineVersion: 'test', segmentationModel: 'test', embeddingModel: 'test',
          requestedSpeakerCount: 2, status: 'fallback'
        },
        warnings: [{
          code: 'DIARIZATION_FAILED', message: '화자 분리 실패',
          detail: 'C:\\Users\\sample\\secret\\audio.wav sk-proj-abcdefghijklmnop', exitCode: 7
        }]
      }],
      exports: [],
      lastError: 'C:\\Users\\sample\\secret\\video.mp4 대사 비공개'
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('C:\\Users\\sample')
    expect(serialized).not.toContain('대사 비공개')
    expect(serialized).toContain('WHISPER_FAILED')
    expect(report.latestRun?.warnings?.[0]).toMatchObject({ code: 'DIARIZATION_FAILED', exitCode: 7 })
  })

  it('OpenAI 오류의 안전한 필드와 업로드 음성 메타데이터를 기록한다', async () => {
    const report = await buildLocalDiagnosticReport({
      schemaVersion: 2,
      id: 'openai-project',
      title: '제목',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'error',
      transcriptionEngine: 'openai',
      localDiarization: { mode: 'none', speakerCount: null },
      source: { kind: 'local', uri: 'C:\\Users\\sample\\video.mp4', displayName: 'video.mp4', localMediaPath: 'C:\\Users\\sample\\video.mp4' },
      media: { durationMs: 60_000 },
      segments: [],
      rows: [],
      runs: [{
        id: 'run',
        startedAt: '2026-01-01T00:00:00.000Z',
        provider: 'openai',
        model: 'gpt-4o-transcribe-diarize',
        errorCode: 'OPENAI_UNPROCESSABLE_AUDIO',
        httpStatus: 400,
        requestId: 'req_safe_test',
        apiCode: 'invalid_audio',
        apiType: 'invalid_request_error',
        apiParam: 'file',
        apiDetail: 'cannot decode C:\\Users\\sample\\video.webm sk-proj-abcdefghijklmnop',
        openaiRequest: { model: 'gpt-4o-transcribe-diarize', responseFormat: 'diarized_json', chunkingStrategy: 'auto', language: 'ko' },
        openaiAudio: { extension: '.webm', bytes: 100, durationMs: 60_000, codec: 'opus', sampleRate: 48_000, channels: 1 }
      }],
      exports: []
    })
    const serialized = JSON.stringify(report)
    expect(report.latestRun).toMatchObject({
      httpStatus: 400,
      requestId: 'req_safe_test',
      apiCode: 'invalid_audio',
      apiParam: 'file',
      openaiAudio: { extension: '.webm', codec: 'opus' }
    })
    expect(serialized).not.toContain('C:\\Users\\sample')
    expect(serialized).not.toContain('sk-proj-')
    expect(serialized).not.toContain('video.webm')
    expect(serialized).toContain('diarized_json')
  })
})
