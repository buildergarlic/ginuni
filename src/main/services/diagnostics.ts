import { stat } from 'node:fs/promises'
import { arch, freemem, release, totalmem } from 'node:os'
import { extname } from 'node:path'
import { app } from 'electron'
import type { LocalDiagnosticReport, ScriptProject } from '@shared/types'
import { localModelStatus } from './local-model'
import { runtimeDiagnostics } from './runtime'
import { sanitizeDiagnosticText } from './processing-errors'

function safeMessageForCode(code?: string): string | undefined {
  return ({
    MEDIA_NOT_FOUND: '원본 파일을 찾을 수 없습니다.',
    MEDIA_UNREADABLE: '원본 파일을 읽을 수 없습니다.',
    FFPROBE_FAILED: '영상 정보를 확인하지 못했습니다.',
    FFMPEG_FAILED: '분석용 음성을 변환하지 못했습니다.',
    MODEL_MISSING: '로컬 음성인식 모델을 준비하지 못했습니다.',
    MODEL_CORRUPTED: '로컬 음성인식 모델 무결성 검사에 실패했습니다.',
    RUNTIME_BLOCKED: '분석 실행 파일을 실행하지 못했습니다.',
    UNSUPPORTED_ARCHITECTURE: 'PC 아키텍처가 로컬 분석 엔진과 호환되지 않습니다.',
    INSUFFICIENT_MEMORY: '메모리가 부족합니다.',
    WHISPER_FAILED: 'Whisper 음성 분석에 실패했습니다.',
    WHISPER_OUTPUT_INVALID: 'Whisper 결과를 읽지 못했습니다.',
    PROCESSING_FAILED: '처리에 실패했습니다.'
  } as Record<string, string>)[code ?? '']
}

export async function buildLocalDiagnosticReport(project: ScriptProject): Promise<LocalDiagnosticReport> {
  const sourcePath = project.source.kind === 'local' ? project.source.localMediaPath ?? project.source.uri : undefined
  let sourceExtension: string | undefined
  let sourceSizeBytes: number | undefined
  if (sourcePath) {
    sourceExtension = extname(sourcePath).toLowerCase() || undefined
    try {
      sourceSizeBytes = (await stat(sourcePath)).size
    } catch {
      sourceSizeBytes = undefined
    }
  }
  const latestRun = project.runs.at(-1)
  const system = {
    platform: process.platform,
    osVersion: release(),
    processArchitecture: process.arch,
    osArchitecture: arch(),
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem()
  }
  const runtimes = (await runtimeDiagnostics()).map((runtime) => ({
    ...runtime,
    detail: sanitizeDiagnosticText(runtime.detail)
  }))
  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    ...system,
    project: {
      id: project.id,
      sourceKind: project.source.kind,
      sourceExtension,
      sourceSizeBytes,
      durationMs: project.media.durationMs
    },
    latestRun: latestRun ? {
      id: latestRun.id,
      provider: latestRun.provider,
      model: latestRun.model,
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
      errorCode: latestRun.errorCode,
      errorStage: latestRun.errorStage,
      exitCode: latestRun.exitCode,
      stderrSummary: sanitizeDiagnosticText(latestRun.stderrSummary),
      modelIntegrity: latestRun.modelIntegrity
    } : undefined,
    lastError: safeMessageForCode(latestRun?.errorCode) ?? sanitizeDiagnosticText(project.lastError),
    localModel: await localModelStatus(),
    runtimes
  }
}
