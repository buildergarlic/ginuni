import type { TranscriptSegment } from '../shared/types'
import type { SpeechLanguage } from './languages'

export const MAX_MEDIA_DURATION_MS = 3 * 60 * 60 * 1000
export const FALLBACK_MAX_MEDIA_BYTES = 100 * 1024 * 1024
export const FALLBACK_MAX_MEDIA_DURATION_MS = 5 * 60 * 1000
export const TRANSCRIPTION_CHUNK_MS = 60_000
export const TRANSCRIPTION_CONTEXT_MS = 2_000
export const TRANSCRIPTION_MAX_CHUNK_MS = TRANSCRIPTION_CHUNK_MS + 2 * TRANSCRIPTION_CONTEXT_MS
export const TRANSCRIPTION_SAMPLE_RATE = 16_000
export const TRANSCRIPTION_MODEL = 'Xenova/whisper-tiny'
// Pin the public model so a Hub update cannot silently change submitted results.
export const TRANSCRIPTION_MODEL_REVISION =
  '5332fcc35e32a33b86612b9a57a89be7906102b1'
export const TRANSCRIPTION_ENGLISH_MODEL = 'Xenova/whisper-base.en'
export const TRANSCRIPTION_ENGLISH_MODEL_REVISION = '95bf40a508535962c6483ead40270b2e32267508'

export type TranscriptionLanguage = SpeechLanguage

export interface TranscriptionProgress {
  percent: number
  message: string
}

export interface BrowserTranscriptionResult {
  segments: TranscriptSegment[]
  durationMs: number
}

export type TranscriptionWorkerRequest =
  | { type: 'transcribe'; chunkId: number; audio: Float32Array; durationMs: number; language?: TranscriptionLanguage }
  | { type: 'dispose' }

export type TranscriptionWorkerResponse =
  | { type: 'progress'; chunkId: number; progress: TranscriptionProgress }
  | { type: 'chunk'; chunkId: number; segments: TranscriptSegment[] }
  | { type: 'disposed' }
  | { type: 'error'; chunkId?: number; message: string }

export function validateMediaSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error('비어 있는 파일은 분석할 수 없습니다.')
}

export function validateMediaDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(
      '파일 길이를 확인할 수 없습니다. WAV 또는 MP3로 변환한 뒤 다시 선택해 주세요.'
    )
  }
  if (durationMs > MAX_MEDIA_DURATION_MS) {
    throw new Error(
      '웹 작업실은 최대 3시간 길이의 영상을 지원합니다.'
    )
  }
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Convert Whisper's seconds to project milliseconds without inventing speaker labels. */
export function normalizeTranscript(
  output: unknown,
  durationMs: number
): TranscriptSegment[] {
  validateMediaDuration(durationMs)
  if (!output || typeof output !== 'object' || Array.isArray(output)) return []
  const result = output as { chunks?: unknown; text?: unknown }
  const chunks = Array.isArray(result.chunks) ? result.chunks : []
  const segments: TranscriptSegment[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (
      !chunk ||
      typeof chunk !== 'object' ||
      typeof chunk.text !== 'string' ||
      !Array.isArray(chunk.timestamp)
    )
      continue
    const text = chunk.text.replace(/\s+/g, ' ').trim()
    const [start, end] = chunk.timestamp
    // Missing start timestamps are ambiguous; do not turn them into false silence boundaries.
    if (
      !text ||
      !finiteTimestamp(start) ||
      (end !== null && !finiteTimestamp(end))
    )
      continue
    const startMs = Math.max(0, Math.round(start * 1000))
    let endMs: number
    if (end === null) {
      // Whisper can leave the final timestamp open, especially for very short clips.
      const nextStart = chunks[index + 1]?.timestamp?.[0]
      endMs =
        finiteTimestamp(nextStart) && nextStart > start
          ? Math.round(nextStart * 1000)
          : durationMs
    } else {
      endMs = Math.round(end * 1000)
    }
    endMs = Math.min(durationMs, endMs)
    if (startMs >= endMs) continue
    segments.push({
      id: `web-segment-${index + 1}`,
      startMs,
      endMs,
      speakerId: '',
      text
    })
  }

  // A plain-text result has no timing evidence. Keep it as one full-length segment.
  if (!chunks.length && typeof result.text === 'string' && result.text.trim()) {
    segments.push({
      id: 'web-segment-1',
      startMs: 0,
      endMs: durationMs,
      speakerId: '',
      text: result.text.replace(/\s+/g, ' ').trim()
    })
  }
  return segments.sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs
  )
}
