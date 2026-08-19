import { arch, freemem, release, totalmem } from 'node:os'
import type { LocalFailureCode, LocalProcessingStage } from '@shared/types'
import { ProcessExecutionError } from './process-runner'

export interface ProcessingFailureOptions {
  code: LocalFailureCode
  stage: LocalProcessingStage
  message: string
  exitCode?: number
  stderr?: string
}

export class LocalProcessingError extends Error {
  readonly code: LocalFailureCode
  readonly stage: LocalProcessingStage
  readonly exitCode?: number
  readonly stderrSummary?: string

  constructor(options: ProcessingFailureOptions) {
    super(options.message)
    this.name = 'LocalProcessingError'
    this.code = options.code
    this.stage = options.stage
    this.exitCode = options.exitCode
    this.stderrSummary = sanitizeDiagnosticText(options.stderr)
  }
}

const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n\t ]+/g
const USER_PROFILE = /(?:C:\\Users\\|Users\\)[^\\\r\n]+/gi
const API_KEY = /\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g

export function sanitizeDiagnosticText(value: unknown, maxLength = 900): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value)
    .replace(API_KEY, '[redacted-key]')
    .replace(WINDOWS_PATH, '[redacted-path]')
    .replace(USER_PROFILE, 'Users\\[redacted]\\')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(-maxLength) : undefined
}

function unsignedExitCode(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return value < 0 ? value >>> 0 : value
}

function processCode(error: ProcessExecutionError): LocalFailureCode {
  const exitCode = unsignedExitCode(error.result.exitCode)
  const stderr = `${error.spawnError ?? ''} ${error.result.stderr}`.toLowerCase()
  if (stderr.includes('enoent') || stderr.includes('eacces') || stderr.includes('access is denied')) return 'RUNTIME_BLOCKED'
  if (exitCode === 0xC000001D) return 'UNSUPPORTED_ARCHITECTURE'
  if (exitCode === 0xC000007B || exitCode === 0xC0000135 || exitCode === 0xC0000142) return 'RUNTIME_BLOCKED'
  if (/out of memory|not enough memory|메모리가 부족/.test(stderr)) return 'INSUFFICIENT_MEMORY'
  return 'WHISPER_FAILED'
}

export function classifyProcessFailure(error: unknown, stage: LocalProcessingStage, fallbackCode?: LocalFailureCode): LocalProcessingError {
  if (error instanceof LocalProcessingError) return error
  if (error instanceof ProcessExecutionError) {
    const processFailure = processCode(error)
    const code = stage === 'probe'
      ? ['RUNTIME_BLOCKED', 'UNSUPPORTED_ARCHITECTURE', 'INSUFFICIENT_MEMORY'].includes(processFailure) ? processFailure : 'FFPROBE_FAILED'
      : stage === 'encoding'
        ? ['RUNTIME_BLOCKED', 'UNSUPPORTED_ARCHITECTURE', 'INSUFFICIENT_MEMORY'].includes(processFailure) ? processFailure : 'FFMPEG_FAILED'
        : processFailure
    return new LocalProcessingError({
      code,
      stage,
      message: code === 'RUNTIME_BLOCKED'
        ? '음성 분석 실행 파일을 실행하지 못했습니다. Windows 보안 프로그램이 차단했는지 확인하세요.'
        : code === 'UNSUPPORTED_ARCHITECTURE'
          ? '이 PC의 CPU 또는 Windows 아키텍처와 로컬 음성 분석 엔진이 호환되지 않습니다.'
          : code === 'INSUFFICIENT_MEMORY'
            ? '현재 메모리가 부족해 로컬 음성 분석을 완료하지 못했습니다. 다른 프로그램을 종료한 뒤 다시 시도하세요.'
            : stage === 'probe'
              ? '영상 정보를 확인하지 못했습니다. 파일이 이동·삭제되지 않았는지 확인하세요.'
              : stage === 'encoding'
                ? '분석용 음성을 변환하지 못했습니다. 지원되는 영상 파일인지 확인하세요.'
                : '로컬 음성 분석 실행에 실패했습니다. 다시 시도하거나 로컬 모델을 복구하세요.',
      exitCode: unsignedExitCode(error.result.exitCode),
      stderr: `${error.spawnError ?? ''} ${error.result.stderr}`
    })
  }
  if (error instanceof Error && error.name === 'AbortError') throw error
  return new LocalProcessingError({
    code: fallbackCode ?? 'PROCESSING_FAILED',
    stage,
    message: error instanceof Error ? sanitizeDiagnosticText(error.message) ?? '처리 중 오류가 발생했습니다.' : '처리 중 오류가 발생했습니다.'
  })
}

export function systemDiagnosticInfo(): {
  platform: string
  osVersion: string
  processArchitecture: string
  osArchitecture: string
  totalMemoryBytes: number
  freeMemoryBytes: number
} {
  return {
    platform: process.platform,
    osVersion: release(),
    processArchitecture: process.arch,
    osArchitecture: arch(),
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem()
  }
}
