import { randomUUID } from 'node:crypto'
import { cpus, freemem } from 'node:os'
import { mkdtemp, copyFile, rm as removeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DIARIZATION_EMBEDDING_MODEL,
  DIARIZATION_ENGINE_VERSION,
  DIARIZATION_SEGMENTATION_MODEL
} from '@shared/constants'
import type {
  DiarizationSegment,
  DiarizationWarningCode,
  LocalDiarizationConfig,
  TranscriptSegment
} from '@shared/types'
import type { WhisperWord } from './local-transcription'
import { ProcessExecutionError, runProcess } from './process-runner'
import { diarizationModelPath, runtimeExecutable } from './runtime'

export class DiarizationExecutionError extends Error {
  constructor(
    readonly code: DiarizationWarningCode,
    message: string,
    readonly detail?: string,
    readonly exitCode?: number
  ) {
    super(message)
    this.name = 'DiarizationExecutionError'
  }
}

function classifyDiarizationFailure(error: ProcessExecutionError, detail?: string): DiarizationExecutionError {
  const exitCode = error.result.exitCode
  const source = (detail ?? '').toLowerCase()

  if (exitCode === 0xC000007B || exitCode === 0xC0000135 || exitCode === 0xC0000142 || exitCode === 0xC000001D) {
    return new DiarizationExecutionError(
      'DIARIZATION_RUNTIME_BLOCKED',
      '화자 분리 엔진이 현재 PC에서 실행되지 않습니다. Windows 보안 설정 또는 실행권한을 확인하세요.',
      detail,
      exitCode
    )
  }

  if (source.includes('enoent') || source.includes('eacces') || source.includes('access is denied') || source.includes('permission denied')) {
    return new DiarizationExecutionError(
      'DIARIZATION_RUNTIME_BLOCKED',
      '로컬 화자 분리 실행 파일 접근이 차단되었습니다. 보안 프로그램 예외 등록 후 다시 시도하세요.',
      detail,
      exitCode
    )
  }

  if (source.includes('out of memory') || source.includes('not enough memory') || source.includes('memory allocation')) {
    return new DiarizationExecutionError(
      'DIARIZATION_INSUFFICIENT_MEMORY',
      '화자 분리에 필요한 메모리가 부족합니다. 다른 프로그램을 종료하고 다시 시도하세요.',
      detail,
      exitCode
    )
  }

  if (
    source.includes('onnxruntime') ||
    source.includes('3dspeaker') ||
    source.includes('pyannote') ||
    source.includes('no such file') ||
    source.includes('not found') ||
    source.includes('cannot load') ||
    source.includes('loadlibrary') ||
    source.includes('dll')
  ) {
    return new DiarizationExecutionError(
      'DIARIZATION_MODEL_INVALID',
      '화자 분리 구성 요소(모델/런타임)가 손상되었거나 누락되었습니다. 앱을 재설치하고 다시 시도하세요.',
      detail,
      exitCode
    )
  }

  return new DiarizationExecutionError('DIARIZATION_FAILED', '화자 분리 엔진 실행에 실패했습니다.', detail, exitCode)
}

export function validateDiarizationConfig(config: LocalDiarizationConfig): LocalDiarizationConfig {
  if (config.mode !== 'none' && config.mode !== 'sherpa-onnx') throw new Error('지원하지 않는 로컬 화자 분리 방식입니다.')
  if (config.speakerCount !== null && (!Number.isInteger(config.speakerCount) || config.speakerCount < 2 || config.speakerCount > 10)) {
    throw new Error('화자 수는 자동 또는 2명에서 10명 사이로 지정하세요.')
  }
  return { mode: config.mode, speakerCount: config.mode === 'none' ? null : config.speakerCount }
}

export function requiredDiarizationMemoryBytes(durationMs: number): number {
  const durationSeconds = Math.max(0, durationMs / 1000)
  const floatAudioBytes = durationSeconds * 16_000 * 4
  return Math.ceil(Math.max(768 * 1024 * 1024, floatAudioBytes * 2 + 512 * 1024 * 1024))
}

export function parseDiarizationProgress(value: string): number[] {
  return [...value.matchAll(/progress\s+(\d+(?:\.\d+)?)%/g)]
    .map((match) => Math.min(100, Math.max(0, Number(match[1]))))
    .filter(Number.isFinite)
}

export function parseDiarizationSegments(value: string): DiarizationSegment[] {
  const raw = [...value.matchAll(/^\s*(\d+(?:\.\d+)?)\s+--\s+(\d+(?:\.\d+)?)\s+speaker_(\d+)\s*$/gm)]
    .map((match) => ({
      startMs: Math.max(0, Math.round(Number(match[1]) * 1000)),
      endMs: Math.max(0, Math.round(Number(match[2]) * 1000)),
      rawSpeaker: Number(match[3])
    }))
    .filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.rawSpeaker - b.rawSpeaker)

  const normalized = new Map<number, string>()
  for (const segment of raw) {
    if (!normalized.has(segment.rawSpeaker)) normalized.set(segment.rawSpeaker, `화자${normalized.size + 1}`)
  }
  return raw.map(({ rawSpeaker, ...segment }) => ({ ...segment, speakerId: normalized.get(rawSpeaker)! }))
}

export class SherpaOnnxDiarizationProvider {
  async diarize(options: {
    audioPath: string
    durationMs: number
    speakerCount: number | null
    signal?: AbortSignal
    onProgress?: (percent: number) => void
  }): Promise<DiarizationSegment[]> {
    if (process.arch !== 'x64') {
      throw new DiarizationExecutionError('DIARIZATION_RUNTIME_BLOCKED', '로컬 화자 분리는 현재 Windows x64에서만 지원합니다.')
    }
    if (freemem() < requiredDiarizationMemoryBytes(options.durationMs)) {
      throw new DiarizationExecutionError('DIARIZATION_INSUFFICIENT_MEMORY', '화자 분리에 필요한 여유 메모리가 부족합니다.')
    }

    const executable = await runtimeExecutable('sherpa-diarizer')
    const segmentationModel = await diarizationModelPath('segmentation')
    const embeddingModel = await diarizationModelPath('embedding')
    const threads = Math.max(1, Math.min(4, cpus().length - 1))
    const args = [
      `--segmentation.pyannote-model=${segmentationModel}`,
      `--embedding.model=${embeddingModel}`,
      `--segmentation.num-threads=${threads}`,
      `--embedding.num-threads=${threads}`,
      '--segmentation.pyannote-window-shift-ratio=0.1',
      '--min-duration-on=0.3',
      '--min-duration-off=0.5',
      '--print-args=false',
      options.speakerCount === null ? '--clustering.cluster-threshold=0.5' : `--clustering.num-clusters=${options.speakerCount}`
    ]

    let progressBuffer = ''
    let lastProgress = -1
    let stagingDir: string | undefined
    try {
      stagingDir = await mkdtemp(join(tmpdir(), 'ginuni-diarization-'))
      const stagedAudioPath = join(stagingDir, 'transcription-local.wav')
      await copyFile(options.audioPath, stagedAudioPath)
      const result = await runProcess(executable, [...args, stagedAudioPath], {
        signal: options.signal,
        onStderr: (value) => {
          progressBuffer = `${progressBuffer}${value}`.slice(-2_000)
          for (const percent of parseDiarizationProgress(progressBuffer)) {
            if (percent <= lastProgress) continue
            lastProgress = percent
            options.onProgress?.(percent)
          }
        }
      })
      return parseDiarizationSegments(`${result.stdout}\n${result.stderr}`)
    } catch (error) {
      const copyMessage = error instanceof Error ? error.message : undefined
      if (copyMessage && /(enoent|no such file|does not exist|not found)/i.test(copyMessage)) {
        throw new DiarizationExecutionError(
          'DIARIZATION_OUTPUT_INVALID',
          '화자 분리에 필요한 입력 음성 파일을 찾을 수 없습니다.',
          copyMessage
        )
      }
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (error instanceof ProcessExecutionError) {
        throw classifyDiarizationFailure(error, error.spawnError ?? error.result.stderr)
      }
      const result = error && typeof error === 'object' && 'result' in error
        ? (error as { result?: { stderr?: string; exitCode?: number } }).result
        : undefined
      throw new DiarizationExecutionError(
        'DIARIZATION_FAILED',
        '화자 분리 엔진 실행에 실패했습니다.',
        result?.stderr ?? (error instanceof Error ? error.message : undefined),
        result?.exitCode
      )
    } finally {
      if (stagingDir) await removeFile(stagingDir, { recursive: true, force: true })
    }
  }
}

function overlapMs(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))
}

function speakerForRange(
  range: { startMs: number; endMs: number },
  diarization: DiarizationSegment[]
): { speakerId: string; ambiguous: boolean } {
  const totals = new Map<string, number>()
  for (const segment of diarization) {
    const overlap = overlapMs(range, segment)
    if (overlap > 0) totals.set(segment.speakerId, (totals.get(segment.speakerId) ?? 0) + overlap)
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  if (ordered.length === 0) return { speakerId: '', ambiguous: false }
  if (ordered.length > 1 && ordered[0][1] === ordered[1][1]) return { speakerId: '', ambiguous: true }
  return { speakerId: ordered[0][0], ambiguous: false }
}

function comparableText(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function cleanJoinedText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\s+([,.!?。！？…])/g, '$1').trim()
}

export interface AppliedDiarizationResult {
  segments: TranscriptSegment[]
  detectedSpeakerCount: number
  unassignedWordCount: number
  ambiguousWordCount: number
  usedWordTimestamps: boolean
}

function assignWholeSegments(segments: TranscriptSegment[], diarization: DiarizationSegment[]): AppliedDiarizationResult {
  let unassignedWordCount = 0
  let ambiguousWordCount = 0
  const assigned = segments.map((segment) => {
    const speaker = speakerForRange(segment, diarization)
    if (!speaker.speakerId) unassignedWordCount += 1
    if (speaker.ambiguous) ambiguousWordCount += 1
    return { ...segment, speakerId: speaker.speakerId }
  })
  return {
    segments: assigned,
    detectedSpeakerCount: new Set(diarization.map((segment) => segment.speakerId)).size,
    unassignedWordCount,
    ambiguousWordCount,
    usedWordTimestamps: false
  }
}

export function applyDiarization(
  plainSegments: TranscriptSegment[],
  words: WhisperWord[],
  diarization: DiarizationSegment[]
): AppliedDiarizationResult {
  const plainText = comparableText(plainSegments.map((segment) => segment.text).join(''))
  const wordText = comparableText(words.map((word) => word.text).join(''))
  if (words.length === 0 || !plainText || plainText !== wordText) return assignWholeSegments(plainSegments, diarization)

  const groups: Array<{ startMs: number; endMs: number; speakerId: string; text: string; mappingIndex?: number }> = []
  let unassignedWordCount = 0
  let ambiguousWordCount = 0
  for (const word of words) {
    const punctuationOnly = !word.text.replace(/[\s\p{P}\p{S}]/gu, '')
    if (punctuationOnly && groups.length > 0) {
      const previous = groups.at(-1)!
      previous.text += word.text
      previous.endMs = Math.max(previous.endMs, word.endMs)
      continue
    }
    const speaker = speakerForRange(word, diarization)
    if (!speaker.speakerId) unassignedWordCount += 1
    if (speaker.ambiguous) ambiguousWordCount += 1
    const previous = groups.at(-1)
    if (previous && previous.speakerId === speaker.speakerId && previous.mappingIndex === word.mappingIndex && word.startMs - previous.endMs < 2_000) {
      previous.endMs = Math.max(previous.endMs, word.endMs)
      previous.text += word.text
    } else {
      groups.push({
        startMs: word.startMs,
        endMs: Math.max(word.endMs, word.startMs + 1),
        speakerId: speaker.speakerId,
        text: word.text,
        mappingIndex: word.mappingIndex
      })
    }
  }

  return {
    segments: groups
      .map((group) => ({
        id: randomUUID(),
        startMs: group.startMs,
        endMs: group.endMs,
        speakerId: group.speakerId,
        text: cleanJoinedText(group.text)
      }))
      .filter((segment) => segment.text && segment.endMs > segment.startMs),
    detectedSpeakerCount: new Set(diarization.map((segment) => segment.speakerId)).size,
    unassignedWordCount,
    ambiguousWordCount,
    usedWordTimestamps: true
  }
}

export const DIARIZATION_METADATA = {
  engineVersion: DIARIZATION_ENGINE_VERSION,
  segmentationModel: DIARIZATION_SEGMENTATION_MODEL,
  embeddingModel: DIARIZATION_EMBEDDING_MODEL
} as const
