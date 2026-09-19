import type { ScriptRow } from '../shared/types'

export interface SampleReferenceCue {
  startMs: number
  endMs: number
  content: string
}

export interface WordErrorCounts {
  substitutions: number
  deletions: number
  insertions: number
  totalReferenceWords: number
  /** Ratio against the reference word count. Insertions can make this greater than 1. */
  wordErrorRate: number
}

export interface MatchedTimingCue {
  referenceStartMs: number
  referenceEndMs: number
  actualStartMs: number
  actualEndMs: number
  /** Signed errors: positive means the actual timestamp is later than the reference. */
  startErrorMs: number
  endErrorMs: number
}

export interface SampleTranscriptComparison {
  available: boolean
  wordErrors: WordErrorCounts | null
  matchedTimingCues: MatchedTimingCue[]
  unmatchedTimingCount: number
}

function words(content: string): string[] {
  const normalized = content.normalize('NFKC').toLowerCase()
    .replace(/['’]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
  return normalized ? normalized.split(/\s+/u) : []
}

type Edits = Pick<WordErrorCounts, 'substitutions' | 'deletions' | 'insertions'>
const editCount = (edits: Edits): number => edits.substitutions + edits.deletions + edits.insertions

/** Keep two dynamic-programming rows, rather than an entire transcript-sized matrix. */
function wordErrors(reference: string[], actual: string[]): WordErrorCounts {
  let previous: Edits[] = Array.from({ length: actual.length + 1 }, (_, index) => ({ substitutions: 0, deletions: 0, insertions: index }))
  for (let refIndex = 1; refIndex <= reference.length; refIndex += 1) {
    const current: Edits[] = [{ substitutions: 0, deletions: refIndex, insertions: 0 }]
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      if (reference[refIndex - 1] === actual[actualIndex - 1]) {
        current.push(previous[actualIndex - 1])
        continue
      }
      // Stable tie order: substitution, deletion, insertion. Total distance is unchanged.
      const candidates: Edits[] = [
        { ...previous[actualIndex - 1], substitutions: previous[actualIndex - 1].substitutions + 1 },
        { ...previous[actualIndex], deletions: previous[actualIndex].deletions + 1 },
        { ...current[actualIndex - 1], insertions: current[actualIndex - 1].insertions + 1 }
      ]
      current.push(candidates.reduce((best, candidate) => editCount(candidate) < editCount(best) ? candidate : best))
    }
    previous = current
  }
  const result = previous[actual.length]
  return { ...result, totalReferenceWords: reference.length, wordErrorRate: editCount(result) / reference.length }
}

const validTiming = (cue: SampleReferenceCue): boolean => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs

/**
 * Compare against reference subtitles, which may themselves contain transcription errors.
 * Timing is compared only where a complete cue matches one or more complete ASR rows.
 * A textual match inside a larger row does not provide timing evidence for that cue.
 */
export function compareSampleTranscript(referenceCues: SampleReferenceCue[], rows: ScriptRow[]): SampleTranscriptComparison {
  const reference = [...referenceCues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const actual = rows.filter(row => row.kind === 'dialogue')
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map(row => ({ ...row, words: words(row.content) }))
    .filter(row => row.words.length)
  const referenceWords = reference.flatMap(cue => words(cue.content))
  const actualWords = actual.flatMap(row => row.words)
  if (!referenceWords.length || !actualWords.length) {
    return { available: false, wordErrors: null, matchedTimingCues: [], unmatchedTimingCount: referenceCues.length }
  }

  const matchedTimingCues: MatchedTimingCue[] = []
  let firstAvailableRow = 0
  for (const cue of reference) {
    const cueWords = words(cue.content)
    if (!cueWords.length || !validTiming(cue)) continue
    let matched = false
    for (let first = firstAvailableRow; first < actual.length && !matched; first += 1) {
      let wordIndex = 0
      for (let last = first; last < actual.length; last += 1) {
        const row = actual[last]
        if (!validTiming(row) || wordIndex + row.words.length > cueWords.length) break
        if (!row.words.every((word, index) => word === cueWords[wordIndex + index])) break
        wordIndex += row.words.length
        if (wordIndex !== cueWords.length) continue
        const actualStartMs = actual[first].startMs
        const actualEndMs = row.endMs
        matchedTimingCues.push({
          referenceStartMs: cue.startMs, referenceEndMs: cue.endMs,
          actualStartMs, actualEndMs,
          startErrorMs: actualStartMs - cue.startMs,
          endErrorMs: actualEndMs - cue.endMs
        })
        firstAvailableRow = last + 1
        matched = true
        break
      }
    }
  }

  return {
    available: true,
    wordErrors: wordErrors(referenceWords, actualWords),
    matchedTimingCues,
    unmatchedTimingCount: referenceCues.length - matchedTimingCues.length
  }
}
