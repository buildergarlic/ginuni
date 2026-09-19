import {
  env,
  pipeline,
  TextStreamer,
  type AutomaticSpeechRecognitionPipeline
} from '@huggingface/transformers'
import {
  normalizeTranscript,
  TRANSCRIPTION_MAX_CHUNK_MS,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_ENGLISH_MODEL,
  TRANSCRIPTION_ENGLISH_MODEL_REVISION,
  TRANSCRIPTION_SAMPLE_RATE,
  validateMediaDuration,
  type TranscriptionLanguage,
  type TranscriptionWorkerRequest,
  type TranscriptionWorkerResponse
} from './transcription-types'
import { SPEECH_LANGUAGES } from './languages'

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

async function disposeTranscriber(): Promise<void> {
  const loaded = transcriber
  transcriber = undefined
  transcriberLanguage = undefined
  await loaded?.dispose()
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
    const windows = findSoundWindows(data.audio)
    // Never pass long digital-silence stretches to Whisper, including within a voiced chunk.
    if (!windows.length) {
      report(100, '무음 구간을 확인했습니다. 다음 구간을 분석합니다.')
      scope.postMessage({ type: 'chunk', chunkId: data.chunkId, segments: [] })
      return
    }

    if (transcriber && transcriberLanguage !== language) await disposeTranscriber()
    if (!transcriber) {
      stage = 'loading'
      const files = new Map<string, number>()
      transcriber = await pipeline<'automatic-speech-recognition'>(
        'automatic-speech-recognition',
        language === 'english' ? TRANSCRIPTION_ENGLISH_MODEL : TRANSCRIPTION_MODEL,
        {
          device: 'wasm',
          dtype: 'q8',
          revision: language === 'english' ? TRANSCRIPTION_ENGLISH_MODEL_REVISION : TRANSCRIPTION_MODEL_REVISION,
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
              '음성 AI 모델을 불러오고 있습니다. 첫 실행에는 모델 다운로드가 필요합니다.'
            )
          }
        }
      )
      transcriberLanguage = language
    }

    stage = 'transcribing'
    const countInferences = (sampleCount: number): number => Math.max(1,
      Math.ceil((sampleCount / TRANSCRIPTION_SAMPLE_RATE - 30) / 20) + 1)
    const inferenceCounts = windows.map(window => countInferences(window.end - window.start))
    // Reserve progress for a possible prefix recovery so completion never precedes that pass.
    const inferenceBudgets = windows.map((window, index) => inferenceCounts[index] * (
      language === 'english' && window.end - window.start >= 8 * TRANSCRIPTION_SAMPLE_RATE ? 2 : 1
    ))
    const totalInferences = inferenceBudgets.reduce((sum, count) => sum + count, 0)
    let completedInferences = 0
    const segments: ReturnType<typeof normalizeTranscript> = []
    const activeTranscriber = transcriber
    report(42, `기기에서 ${SPEECH_LANGUAGES.find(item => item.speech === language)?.label ?? '선택한 언어'} 음성을 분석하고 있습니다.`)
    for (const [pieceIndex, window] of windows.entries()) {
      const inferenceCount = inferenceCounts[pieceIndex]
      const progressMessage = `기기에서 음성을 분석하고 있습니다. 음성 조각 ${pieceIndex + 1}/${windows.length}`
      const infer = async (audio: Float32Array, passOffset: number, message: string) => {
        const passInferences = countInferences(audio.length)
        let streamedInferences = 0
        class ChunkProgressStreamer extends TextStreamer {
          override end(): void {
            super.end()
            streamedInferences = Math.min(passInferences, streamedInferences + 1)
            report(42 + (completedInferences + passOffset + streamedInferences) / totalInferences * 55, message)
          }
        }
        return activeTranscriber(audio, {
          ...(language === 'english' ? {} : { language, task: 'transcribe' as const }),
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
          streamer: new ChunkProgressStreamer(activeTranscriber.tokenizer, {
            skip_prompt: true,
            callback_function: () => undefined
          })
        })
      }
      // A view, not a copy: PCM memory remains bounded by the original <=64-second window.
      const audio = data.audio.subarray(window.start, window.end)
      const output = await infer(audio, 0, progressMessage)
      const pieceDurationMs = audio.length / TRANSCRIPTION_SAMPLE_RATE * 1000
      const offsetMs = window.start / TRANSCRIPTION_SAMPLE_RATE * 1000
      const original = normalizeTranscript(Array.isArray(output) ? output[0] : output, pieceDurationMs)
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
        const retryOutput = await infer(retryAudio, inferenceCount, recoveryMessage)
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
      for (const segment of pieceSegments) {
        segments.push({
          ...segment,
          id: windows.length === 1 ? segment.id : `piece-${pieceIndex + 1}-${segment.id}`,
          startMs: Math.round(offsetMs + segment.startMs),
          endMs: Math.min(data.durationMs, Math.round(offsetMs + segment.endMs))
        })
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
