import {
  env,
  pipeline,
  TextStreamer,
  type AutomaticSpeechRecognitionPipeline
} from '@huggingface/transformers'
import {
  normalizeTranscript,
  TRANSCRIPTION_MAX_CHUNK_MS,
  TRANSCRIPTION_SAMPLE_RATE,
  validateMediaDuration,
  type BrowserTranscriptSegment,
  type TranscriptionLanguage,
  type TranscriptionWarningCode,
  type TranscriptionWorkerRequest,
  type TranscriptionWorkerResponse
} from './transcription-types'
import { SPEECH_LANGUAGES } from './languages'
import { assessTranscriptQuality, planTranscriptionRetries } from './transcript-quality'
import { ASR_PROFILES, type AsrProfileId } from './asr-models'
import { createSpeechDetector, type SpeechDetector } from './speech-vad'

// Browser-only inference: remote GET requests download public model weights; no media is uploaded.
env.allowLocalModels = false
env.useBrowserCache = true
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TranscriptionWorkerRequest>) => void) | null
  postMessage: (message: TranscriptionWorkerResponse) => void
}

let transcriber: AutomaticSpeechRecognitionPipeline | undefined
let transcriberLanguage: TranscriptionLanguage | undefined
let transcriberProfile: AsrProfileId | undefined
let speechDetector: SpeechDetector | undefined

/** Keep quiet speech and ordinary pauses; remove only sustained near-digital silence. */
function findSoundWindows(audio: Float32Array): { start: number; end: number }[] {
  const minimumSilenceSamples = Math.round(1.5 * TRANSCRIPTION_SAMPLE_RATE)
  const contextSamples = Math.round(0.25 * TRANSCRIPTION_SAMPLE_RATE)
  const windows: { start: number; end: number }[] = []
  let start = 0
  let lastSound = -1
  for (let index = 0; index < audio.length; index += 1) {
    const sample = audio[index]
    if (!Number.isFinite(sample)) throw new Error('오디오 데이터 형식이 올바르지 않습니다.')
    if (Math.abs(sample) < 0.0001) continue
    if (lastSound === -1) {
      start = index >= minimumSilenceSamples ? index - contextSamples : 0
    } else if (index - lastSound - 1 >= minimumSilenceSamples) {
      windows.push({ start, end: lastSound + 1 + contextSamples })
      start = index - contextSamples
    }
    lastSound = index
  }
  if (lastSound !== -1) {
    windows.push({ start, end: audio.length - lastSound - 1 >= minimumSilenceSamples
      ? lastSound + 1 + contextSamples : audio.length })
  }
  return windows
}

function assessSegments(segments: BrowserTranscriptSegment[], tokenLimit: boolean): BrowserTranscriptSegment[] {
  const localWarnings = segments.map(segment => assessTranscriptQuality(segment.text).warningCodes)
  // A loop can be split across timestamp segments. Do not delete repeated segments.
  const wholePieceLoop = localWarnings.every(codes => !codes.length) &&
    assessTranscriptQuality(segments.map(segment => segment.text).join(' ')).warningCodes.length > 0
  return segments.map((segment, index) => {
    const warningCodes: TranscriptionWarningCode[] = [...localWarnings[index]]
    if (wholePieceLoop) warningCodes.push('repetition')
    if (tokenLimit) warningCodes.push('token-limit')
    return warningCodes.length ? { ...segment, warningCodes } : segment
  })
}

/** Keep primary passages that were not flagged; retain initial text for every replacement. */
function applyQualityRecovery(primary: BrowserTranscriptSegment[], recovered: BrowserTranscriptSegment[]): BrowserTranscriptSegment[] {
  const result: BrowserTranscriptSegment[] = []
  for (let index = 0; index < primary.length;) {
    const first = primary[index]
    if (!first.warningCodes?.length) { result.push(first); index += 1; continue }
    const group = [first]
    index += 1
    while (index < primary.length && primary[index].warningCodes?.length &&
      primary[index].startMs <= group.at(-1)!.endMs + 100) group.push(primary[index++])
    const endMs = group.at(-1)!.endMs
    // Do not crop a recognized utterance into an unrelated primary passage.
    const candidates = recovered.filter(segment => segment.startMs >= first.startMs && segment.endMs <= endMs)
    const usable = candidates.length > 0 && candidates.every(segment => !segment.warningCodes?.length) &&
      !assessTranscriptQuality(candidates.map(segment => segment.text).join(' ')).warningCodes.length
    if (!usable) {
      result.push(...group.map(segment => ({ ...segment, retryCount: 1 })))
      continue
    }
    const warningCodes = [...new Set(group.flatMap(segment => segment.warningCodes ?? []))]
    const originalText = group.map(segment => segment.text).join(' ')
    result.push(...candidates.map(segment => ({ ...segment, warningCodes, retryCount: 1, originalText })))
  }
  return result
}

async function disposeTranscriber(): Promise<void> {
  const loaded = transcriber
  transcriber = undefined
  transcriberLanguage = undefined
  transcriberProfile = undefined
  const detector = speechDetector
  speechDetector = undefined
  const released = await Promise.allSettled([loaded?.dispose(), detector?.dispose()])
  const failed = released.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
}

async function handleRequest(data: TranscriptionWorkerRequest): Promise<void> {
  let stage: 'validating' | 'loading' | 'transcribing' | 'disposing' = 'validating'
  const chunkId = data.type === 'transcribe' ? data.chunkId : undefined
  let lastPercent = 0
  const report = (percent: number, message: string): void => {
    if (chunkId === undefined) return
    lastPercent = Math.max(lastPercent, Math.min(100, Math.round(percent)))
    scope.postMessage({
      type: 'progress',
      chunkId,
      progress: { percent: lastPercent, message }
    })
  }
  try {
    if (data.type === 'dispose') {
      stage = 'disposing'
      await disposeTranscriber()
      scope.postMessage({ type: 'disposed' })
      return
    }

    validateMediaDuration(data.durationMs)
    if (!(data.audio instanceof Float32Array))
      throw new Error('오디오 데이터 형식이 올바르지 않습니다.')
    const audioDurationMs = (data.audio.length / TRANSCRIPTION_SAMPLE_RATE) * 1000
    validateMediaDuration(audioDurationMs)
    if (
      data.durationMs > TRANSCRIPTION_MAX_CHUNK_MS ||
      audioDurationMs > TRANSCRIPTION_MAX_CHUNK_MS
    ) {
      throw new Error('분석할 오디오 구간이 너무 깁니다. 파일을 다시 선택해 주세요.')
    }

    const language = data.language ?? 'korean'
    const profile = data.profile ?? (language === 'korean' ? 'korean-small' : language === 'english' ? 'english-base' : 'multilingual-tiny')
    const settings = ASR_PROFILES[profile]
    if (!settings || (language === 'korean' ? !profile.startsWith('korean-') :
      language === 'english' ? profile !== 'english-base' : profile !== 'multilingual-tiny'))
      throw new Error('음성 언어와 분석 모델 설정이 일치하지 않습니다.')
    if (transcriber && (transcriberLanguage !== language || transcriberProfile !== profile)) await disposeTranscriber()
    let windows = findSoundWindows(data.audio)
    // Never pass long digital-silence stretches to Whisper, including within a voiced chunk.
    if (!windows.length) {
      report(100, '무음 구간을 확인했습니다. 다음 구간을 분석합니다.')
      scope.postMessage({ type: 'chunk', chunkId: data.chunkId, segments: [] })
      return
    }

    if (language === 'korean') {
      stage = 'loading'
      report(5, '배경음과 말소리를 구분하고 발화 구간을 찾고 있습니다.')
      speechDetector ??= await createSpeechDetector()
      const detected: typeof windows = []
      for (const window of windows) {
        const speech = await speechDetector.findWindows(data.audio.subarray(window.start, window.end))
        detected.push(...speech.map(piece => ({ start: window.start + piece.start, end: window.start + piece.end })))
      }
      windows = detected
      if (!windows.length) {
        report(100, '말소리가 검출되지 않은 구간입니다. 다음 구간을 분석합니다.')
        scope.postMessage({ type: 'chunk', chunkId: data.chunkId, segments: [] })
        return
      }
    }
    if (!transcriber) {
      stage = 'loading'
      const files = new Map<string, number>()
      transcriber = await pipeline<'automatic-speech-recognition'>(
        'automatic-speech-recognition',
        settings.model,
        {
          device: settings.device,
          dtype: settings.dtype,
          revision: settings.revision,
          progress_callback: (info) => {
            if ('file' in info) {
              if (info.status === 'progress') files.set(info.file, info.progress)
              else if (info.status === 'done') files.set(info.file, 100)
              else if (info.status === 'initiate') files.set(info.file, 0)
            }
            const average = files.size
              ? [...files.values()].reduce((sum, value) => sum + value, 0) /
                files.size
              : 0
            report(
              8 + average * 0.32,
              `${settings.label} 모델을 불러오고 있습니다. 첫 실행에는 모델 다운로드가 필요합니다.`
            )
          }
        }
      )
      transcriberLanguage = language
      transcriberProfile = profile
    }

    stage = 'transcribing'
    const countInferences = (sampleCount: number): number => Math.max(1,
      Math.ceil((sampleCount / TRANSCRIPTION_SAMPLE_RATE - 30) / 20) + 1)
    const inferenceCounts = windows.map(window => countInferences(window.end - window.start))
    // Reserve progress for a possible prefix recovery so completion never precedes that pass.
    const inferenceBudgets = windows.map((window, index) => {
      const durationMs = (window.end - window.start) / TRANSCRIPTION_SAMPLE_RATE * 1000
      if (language === 'english') return inferenceCounts[index] * (durationMs >= 8000 ? 2 : 1)
      return inferenceCounts[index] + (language === 'korean' ? planTranscriptionRetries(durationMs).length : 0)
    })
    const totalInferences = inferenceBudgets.reduce((sum, count) => sum + count, 0)
    let completedInferences = 0
    const segments: ReturnType<typeof normalizeTranscript> = []
    const activeTranscriber = transcriber
    report(42, `기기에서 ${SPEECH_LANGUAGES.find(item => item.speech === language)?.label ?? '선택한 언어'} 음성을 분석하고 있습니다.`)
    for (const [pieceIndex, window] of windows.entries()) {
      const inferenceCount = inferenceCounts[pieceIndex]
      const progressMessage = `기기에서 음성을 분석하고 있습니다. 음성 조각 ${pieceIndex + 1}/${windows.length}`
      const infer = async (audio: Float32Array, passOffset: number, message: string, recoveringRepetition = false) => {
        const passInferences = countInferences(audio.length)
        let streamedInferences = 0
        let tokenLimit = false
        const model = activeTranscriber.model as unknown as {
          generation_config?: { max_length?: number }
          config?: { max_length?: number }
        } | undefined
        const maxTokens = model?.generation_config?.max_length ?? model?.config?.max_length ?? 448
        class ChunkProgressStreamer extends TextStreamer {
          private tokenCount = 0
          override put(value: bigint[][]): void {
            this.tokenCount += value[0]?.length ?? 0
            super.put(value)
          }
          override end(): void {
            super.end()
            if (Number.isFinite(maxTokens) && this.tokenCount >= maxTokens) tokenLimit = true
            this.tokenCount = 0
            streamedInferences = Math.min(passInferences, streamedInferences + 1)
            report(42 + (completedInferences + passOffset + streamedInferences) / totalInferences * 55, message)
          }
        }
        const output = await activeTranscriber(audio, {
          ...(language === 'english' ? {} : { language, task: 'transcribe' as const }),
          // Only a flagged Korean recovery constrains token loops. Primary speech,
          // including genuine repetitions and stuttering, is always preserved.
          ...(recoveringRepetition ? { no_repeat_ngram_size: 6 } : {}),
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
          streamer: new ChunkProgressStreamer(activeTranscriber.tokenizer, {
            skip_prompt: true,
            callback_function: () => undefined
          })
        })
        return { output, tokenLimit }
      }
      // A view, not a copy: PCM memory remains bounded by the original <=64-second window.
      const audio = data.audio.subarray(window.start, window.end)
      const { output, tokenLimit } = await infer(audio, 0, progressMessage)
      const pieceDurationMs = audio.length / TRANSCRIPTION_SAMPLE_RATE * 1000
      const offsetMs = window.start / TRANSCRIPTION_SAMPLE_RATE * 1000
      const normalized = normalizeTranscript(Array.isArray(output) ? output[0] : output, pieceDurationMs)
      // Preserve the already verified English path, including its prefix recovery.
      const original = language === 'english' ? normalized : assessSegments(normalized, tokenLimit)
      let pieceSegments = original
      const missingPrefixMs = original[0]?.startMs ?? pieceDurationMs
      if (language === 'english' && missingPrefixMs >= 8000) {
        // A noisy opening can make Whisper emit an empty first inference. Retry once
        // with shifted context, preserving all existing text and its measured times.
        const retryOffsetMs = 2000
        const retryStart = 2 * TRANSCRIPTION_SAMPLE_RATE
        // End at the missing prefix: including the already recognized next utterance
        // can make a noisy prefix decode as <|nocaptions|> again.
        const retryEnd = Math.min(audio.length, Math.ceil(missingPrefixMs / 1000 * TRANSCRIPTION_SAMPLE_RATE))
        const retryAudio = audio.subarray(retryStart, retryEnd)
        const retryDurationMs = retryAudio.length / TRANSCRIPTION_SAMPLE_RATE * 1000
        const recoveryMessage = `기기에서 누락 가능성이 있는 앞부분을 다시 분석하고 있습니다. 음성 조각 ${pieceIndex + 1}/${windows.length}`
        report(42 + (completedInferences + inferenceCount) / totalInferences * 55, recoveryMessage)
        const { output: retryOutput } = await infer(retryAudio, inferenceCount, recoveryMessage)
        const retryResult = Array.isArray(retryOutput) ? retryOutput[0] : retryOutput
        // Reject predicted ends beyond the retry input before normalization can clamp
        // them to the boundary. Existing utterances must never be pulled into recovery.
        const boundedRetry = retryResult.chunks?.length ? {
          ...retryResult,
          text: '',
          chunks: retryResult.chunks.filter(chunk => {
            const end = chunk.timestamp?.[1]
            return end === null || (typeof end === 'number' && Number.isFinite(end) && end * 1000 <= retryDurationMs)
          })
        } : retryResult
        const recovered = normalizeTranscript(boundedRetry, retryDurationMs)
          .map(segment => ({
            ...segment,
            id: `recovery-${segment.id}`,
            startMs: segment.startMs + retryOffsetMs,
            endMs: segment.endMs + retryOffsetMs
          }))
          // Do not clip an overlapping utterance or replace any primary inference.
          .filter(segment => segment.endMs <= missingPrefixMs)
        pieceSegments = [...recovered, ...original]
      }
      if (language === 'korean' && original.some(segment => segment.warningCodes?.length)) {
        const recovered: BrowserTranscriptSegment[] = []
        const retryRanges = planTranscriptionRetries(pieceDurationMs)
        for (const [retryIndex, range] of retryRanges.entries()) {
          const retryStart = Math.floor(range.startMs / 1000 * TRANSCRIPTION_SAMPLE_RATE)
          const retryEnd = Math.min(audio.length, Math.ceil(range.endMs / 1000 * TRANSCRIPTION_SAMPLE_RATE))
          const retryAudio = audio.subarray(retryStart, retryEnd)
          const retryOffsetMs = retryStart / TRANSCRIPTION_SAMPLE_RATE * 1000
          const retryDurationMs = retryAudio.length / TRANSCRIPTION_SAMPLE_RATE * 1000
          const retryMessage = `반복 인식이 의심되는 구간을 짧게 다시 분석합니다. ${retryIndex + 1}/${retryRanges.length}`
          report(42 + (completedInferences + inferenceCount + retryIndex) / totalInferences * 55, retryMessage)
          const retry = await infer(retryAudio, inferenceCount + retryIndex, retryMessage, true)
          const retryOutput = Array.isArray(retry.output) ? retry.output[0] : retry.output
          const candidates = assessSegments(normalizeTranscript(retryOutput, retryDurationMs), retry.tokenLimit)
          for (const candidate of candidates) {
            const startMs = Math.round(candidate.startMs + retryOffsetMs)
            const endMs = Math.min(pieceDurationMs, Math.round(candidate.endMs + retryOffsetMs))
            const midpoint = (startMs + endMs) / 2
            if (endMs <= startMs || midpoint < range.contentStartMs || midpoint >= range.contentEndMs) continue
            const next = { ...candidate, id: `${range.id}-${candidate.id}`, startMs, endMs }
            const previous = recovered.at(-1)
            if (previous && next.startMs < previous.endMs) {
              if (previous.text === next.text) {
                previous.endMs = Math.max(previous.endMs, next.endMs)
                if (next.warningCodes?.length) previous.warningCodes = [...new Set([...(previous.warningCodes ?? []), ...next.warningCodes])]
                continue
              }
              const boundary = Math.max(previous.startMs + 1, Math.min(next.endMs - 1, Math.round((previous.endMs + next.startMs) / 2)))
              previous.endMs = boundary
              next.startMs = boundary
            }
            if (next.endMs > next.startMs) recovered.push(next)
          }
        }
        pieceSegments = applyQualityRecovery(original, recovered)
      }
      for (const segment of pieceSegments) {
        const startMs = Math.round(offsetMs + segment.startMs)
        const endMs = Math.min(data.durationMs, Math.round(offsetMs + segment.endMs))
        // Padded VAD windows can overlap. Each owns the midpoint of its shared context.
        const previousWindow = windows[pieceIndex - 1]
        const nextWindow = windows[pieceIndex + 1]
        const ownedStart = previousWindow ? (previousWindow.end + window.start) / 2 / TRANSCRIPTION_SAMPLE_RATE * 1000 : 0
        const ownedEnd = nextWindow ? (window.end + nextWindow.start) / 2 / TRANSCRIPTION_SAMPLE_RATE * 1000 : data.durationMs
        const midpoint = (startMs + endMs) / 2
        if (endMs <= startMs || midpoint < ownedStart || midpoint >= ownedEnd) continue
        const next = {
          ...segment,
          id: windows.length === 1 ? segment.id : `piece-${pieceIndex + 1}-${segment.id}`,
          startMs, endMs
        }
        const last = segments.at(-1)
        if (last && next.startMs < last.endMs) {
          const textKey = (text: string) => text.replace(/[\s\p{P}]/gu, '').toLowerCase()
          if (textKey(last.text) === textKey(next.text)) {
            last.endMs = Math.max(last.endMs, next.endMs)
            const warnings = [...new Set([...(last.warningCodes ?? []), ...(next.warningCodes ?? [])])]
            if (warnings.length) last.warningCodes = warnings
            if (last.retryCount !== undefined || next.retryCount !== undefined)
              last.retryCount = Math.max(last.retryCount ?? 0, next.retryCount ?? 0)
            const originals = [...new Set([last.originalText, next.originalText].filter((text): text is string => text !== undefined))]
            if (originals.length) last.originalText = originals.join('\n\n')
            continue
          }
          const boundary = Math.max(last.startMs + 1, Math.min(next.endMs - 1, Math.round((last.endMs + next.startMs) / 2)))
          last.endMs = boundary
          next.startMs = boundary
        }
        if (next.endMs > next.startMs) segments.push(next)
      }
      completedInferences += inferenceBudgets[pieceIndex]
      report(42 + completedInferences / totalInferences * 55, progressMessage)
    }
    report(100, '이 구간의 음성 분석을 완료했습니다.')
    scope.postMessage({ type: 'chunk', chunkId: data.chunkId, segments })
  } catch (error) {
    await disposeTranscriber().catch(() => undefined)
    const message =
      stage === 'validating' && error instanceof Error
        ? error.message
        : stage === 'loading'
          ? '음성 AI 모델을 불러오지 못했습니다. 인터넷 연결과 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.'
          : stage === 'disposing'
            ? '음성 AI를 종료하지 못했습니다. 새로고침 후 다시 시도해 주세요.'
            : '기기에서 음성 분석을 완료하지 못했습니다. 다른 탭을 닫거나 다시 시도해 주세요.'
    scope.postMessage({ type: 'error', chunkId, message })
  }
}

// The main thread sends one PCM chunk at a time. Serialize messages so disposal cannot
// race an in-flight inference and the same model stays alive for the entire file.
let pending = Promise.resolve()
scope.onmessage = ({ data }) => {
  pending = pending.then(() => handleRequest(data))
}
