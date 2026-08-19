import { describe, expect, it } from 'vitest'
import { supportsSpeakerLabels } from '@shared/speaker-labels'
import type { ProcessingRun, ScriptProject } from '@shared/types'

function project(run: ProcessingRun): ScriptProject {
  return {
    schemaVersion: 2,
    id: 'project',
    title: '테스트',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:01:00.000Z',
    status: 'review',
    transcriptionEngine: run.provider,
    localDiarization: { mode: run.provider === 'local' ? 'sherpa-onnx' : 'none', speakerCount: null },
    source: { kind: 'local', uri: 'video.mp4', displayName: 'video.mp4' },
    media: { durationMs: 1_000 },
    segments: [],
    rows: [],
    runs: [run],
    exports: []
  }
}

function completedRun(provider: 'local' | 'openai'): ProcessingRun {
  return {
    id: 'run',
    startedAt: '2026-08-20T00:00:00.000Z',
    completedAt: '2026-08-20T00:01:00.000Z',
    provider,
    model: 'test'
  }
}

describe('화자 라벨 내보내기 지원', () => {
  it('성공한 로컬 sherpa 실행은 검수와 SRT 화자 라벨을 활성화한다', () => {
    const run = completedRun('local')
    run.diarization = {
      engine: 'sherpa-onnx', engineVersion: 'test', segmentationModel: 'test', embeddingModel: 'test',
      requestedSpeakerCount: null, detectedSpeakerCount: 2, status: 'succeeded'
    }
    expect(supportsSpeakerLabels(project(run))).toBe(true)
  })

  it('화자 분리 fallback 로컬 실행은 근거 없는 라벨을 활성화하지 않는다', () => {
    const run = completedRun('local')
    run.diarization = {
      engine: 'sherpa-onnx', engineVersion: 'test', segmentationModel: 'test', embeddingModel: 'test',
      requestedSpeakerCount: null, status: 'fallback'
    }
    expect(supportsSpeakerLabels(project(run))).toBe(false)
  })

  it('기존 OpenAI 성공 실행은 계속 화자 라벨을 지원한다', () => {
    expect(supportsSpeakerLabels(project(completedRun('openai')))).toBe(true)
  })
})
