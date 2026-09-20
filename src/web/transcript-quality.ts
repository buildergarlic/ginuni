import { TRANSCRIPTION_MAX_CHUNK_MS } from './transcription-types'

export interface TranscriptQualityAssessment {
  warningCodes: 'repetition'[]
}

/** Flag strong repetition evidence; never remove words or infer whether speech was genuine. */
export function assessTranscriptQuality(text: string): TranscriptQualityAssessment {
  const characters = Array.from(text)
  if (characters.length < 64 || !text.trim()) return { warningCodes: [] }

  for (let unitLength = 1; unitLength <= 32; unitLength += 1) {
    const minimumSpan = unitLength * Math.max(8, Math.ceil(48 / unitLength))
    if (minimumSpan > characters.length) continue
    let repeatedSpan = unitLength
    // Comparing against the character one unit earlier finds contiguous periodic
    // spans in linear time per unit length, including Korean and astral glyphs.
    for (let index = unitLength; index < characters.length; index += 1) {
      repeatedSpan = characters[index] === characters[index - unitLength]
        ? repeatedSpan + 1 : unitLength
      if (repeatedSpan >= minimumSpan &&
          characters.slice(index - unitLength + 1, index + 1).some(character => character.trim())) {
        return { warningCodes: ['repetition'] }
      }
    }
  }
  return { warningCodes: [] }
}

export interface TranscriptionRetryRange {
  id: string
  startMs: number
  endMs: number
  contentStartMs: number
  contentEndMs: number
}

/** One finite retry pass: own 13 seconds and retain at most one second of context per side. */
export function planTranscriptionRetries(durationMs: number): TranscriptionRetryRange[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > TRANSCRIPTION_MAX_CHUNK_MS) {
    throw new Error('재분석할 오디오 구간의 길이가 올바르지 않습니다.')
  }
  const ownedDurationMs = 13_000
  const contextMs = 1_000
  const ranges: TranscriptionRetryRange[] = []
  for (let contentStartMs = 0; contentStartMs < durationMs; contentStartMs += ownedDurationMs) {
    const contentEndMs = Math.min(durationMs, contentStartMs + ownedDurationMs)
    ranges.push({
      id: `quality-retry-${ranges.length + 1}`,
      startMs: Math.max(0, contentStartMs - contextMs),
      endMs: Math.min(durationMs, contentEndMs + contextMs),
      contentStartMs,
      contentEndMs
    })
  }
  return ranges
}
