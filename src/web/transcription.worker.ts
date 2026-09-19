import {
  env,
  pipeline,
  TextStreamer,
  type AutomaticSpeechRecognitionPipeline
} from '@huggingface/transformers'
import {
  normalizeTranscript,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_SAMPLE_RATE,
  validateMediaDuration,
  type TranscriptionWorkerRequest,
  type TranscriptionWorkerResponse
} from './transcription-types'

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

let busy = false
scope.onmessage = async ({ data }) => {
  if (busy) return
  busy = true
  let transcriber: AutomaticSpeechRecognitionPipeline | undefined
  let stage: 'loading' | 'transcribing' = 'loading'
  let lastPercent = 8
  const report = (percent: number, message: string): void => {
    lastPercent = Math.max(lastPercent, Math.min(100, Math.round(percent)))
    scope.postMessage({
      type: 'progress',
      progress: { percent: lastPercent, message }
    })
  }
  try {
    validateMediaDuration(data.durationMs)
    if (!(data.audio instanceof Float32Array))
      throw new Error('오디오 데이터 형식이 올바르지 않습니다.')
    validateMediaDuration(
      (data.audio.length / TRANSCRIPTION_SAMPLE_RATE) * 1000
    )
    const files = new Map<string, number>()
    transcriber = await pipeline<'automatic-speech-recognition'>(
      'automatic-speech-recognition',
      TRANSCRIPTION_MODEL,
      {
        device: 'wasm',
        dtype: 'q8',
        revision: TRANSCRIPTION_MODEL_REVISION,
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
    stage = 'transcribing'
    const totalChunks = Math.max(
      1,
      Math.ceil((data.audio.length / TRANSCRIPTION_SAMPLE_RATE - 30) / 20) + 1
    )
    let completedChunks = 0
    class ChunkProgressStreamer extends TextStreamer {
      override end(): void {
        super.end()
        completedChunks += 1
        report(
          42 + Math.min(1, completedChunks / totalChunks) * 55,
          `기기에서 음성을 분석하고 있습니다. ${Math.min(completedChunks, totalChunks)}/${totalChunks} 구간`
        )
      }
    }
    report(
      42,
      '기기에서 한국어 음성을 분석하고 있습니다. 기기 성능에 따라 수 분이 걸릴 수 있습니다.'
    )
    const output = await transcriber(data.audio, {
      language: 'korean',
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      streamer: new ChunkProgressStreamer(transcriber.tokenizer, {
        skip_prompt: true,
        callback_function: () => undefined
      })
    })
    const segments = normalizeTranscript(
      Array.isArray(output) ? output[0] : output,
      data.durationMs
    )
    if (!segments.length)
      throw new Error(
        '인식된 음성이 없습니다. 음성이 선명하게 들리는 파일로 다시 시도해 주세요.'
      )
    await transcriber.dispose()
    transcriber = undefined
    report(100, '음성 분석을 완료했습니다. 인식된 대사와 시간을 확인해 주세요.')
    scope.postMessage({
      type: 'complete',
      result: { segments, durationMs: data.durationMs }
    })
  } catch (error) {
    await transcriber?.dispose().catch(() => undefined)
    const message =
      error instanceof Error && error.message.startsWith('인식된 음성이')
        ? error.message
        : stage === 'loading'
          ? '음성 AI 모델을 불러오지 못했습니다. 인터넷 연결과 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.'
          : '기기에서 음성 분석을 완료하지 못했습니다. 다른 탭을 닫거나 더 짧은 음성 파일로 다시 시도해 주세요.'
    scope.postMessage({ type: 'error', message })
  }
}
