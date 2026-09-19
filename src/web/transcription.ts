import {
  TRANSCRIPTION_SAMPLE_RATE,
  validateMediaDuration,
  validateMediaSize,
  type BrowserTranscriptionResult,
  type TranscriptionProgress,
  type TranscriptionWorkerRequest,
  type TranscriptionWorkerResponse
} from './transcription-types'

export { MAX_MEDIA_BYTES, MAX_MEDIA_DURATION_MS } from './transcription-types'

const CODEC_ERROR =
  '이 브라우저에서 파일의 오디오를 읽을 수 없습니다. 음성이 있는 WAV, MP3 또는 AAC 오디오가 포함된 MP4로 변환한 뒤 다시 시도해 주세요.'

function abortError(): DOMException {
  return new DOMException('음성 분석을 취소했습니다.', 'AbortError')
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** Browser decoding cannot itself be aborted; reject promptly and ignore its eventual result. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(abortError())
    }
    signal.addEventListener('abort', abort, { once: true })
    // Always attach handlers even when already aborted, to consume a later decode failure.
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        if (!signal.aborted) reject(error)
      }
    )
    if (signal.aborted) abort()
  })
}

/** Check container metadata before allocating an uncompressed audio buffer. */
function readMediaDuration(file: File, signal?: AbortSignal): Promise<number> {
  checkAborted(signal)
  return new Promise((resolve, reject) => {
    const media = document.createElement('video')
    const url = URL.createObjectURL(file)
    let finished = false
    const cleanUp = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      media.onloadedmetadata = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
    }
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      const durationMs = media.duration * 1000
      cleanUp()
      if (error) {
        reject(error)
        return
      }
      try {
        validateMediaDuration(durationMs)
        resolve(durationMs)
      } catch (cause) {
        reject(cause)
      }
    }
    const onAbort = (): void => finish(abortError())
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            '파일 정보를 읽는 데 시간이 너무 오래 걸립니다. WAV 또는 MP3 파일로 다시 시도해 주세요.'
          )
        ),
      15_000
    )
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish()
    media.onerror = () => finish(new Error(CODEC_ERROR))
    signal?.addEventListener('abort', onAbort, { once: true })
    media.src = url
    media.load()
    if (signal?.aborted) onAbort()
  })
}

async function decodeMedia(
  file: File,
  signal?: AbortSignal
): Promise<{ audio: Float32Array; durationMs: number }> {
  if (
    typeof AudioContext === 'undefined' ||
    typeof OfflineAudioContext === 'undefined'
  ) {
    throw new Error(
      '이 브라우저는 웹 음성 분석을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.'
    )
  }
  await readMediaDuration(file, signal)
  checkAborted(signal)
  const context = new AudioContext({ sampleRate: TRANSCRIPTION_SAMPLE_RATE })
  let decoded: AudioBuffer
  try {
    const bytes = await abortable(file.arrayBuffer(), signal)
    checkAborted(signal)
    decoded = await abortable(context.decodeAudioData(bytes), signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error
    throw new Error(CODEC_ERROR, { cause: error })
  } finally {
    // No output is connected; the context is used solely for local decoding.
    if (context.state !== 'closed') await context.close().catch(() => undefined)
  }
  checkAborted(signal)
  // Container metadata can be inaccurate or malicious. Validate actual decoded length as well.
  validateMediaDuration(decoded.duration * 1000)
  const durationMs = Math.round(decoded.duration * 1000)
  const sampleCount = Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE)
  const offline = new OfflineAudioContext(
    1,
    sampleCount,
    TRANSCRIPTION_SAMPLE_RATE
  )
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  try {
    const mono = await abortable(offline.startRendering(), signal)
    checkAborted(signal)
    return { audio: mono.getChannelData(0).slice(), durationMs }
  } finally {
    source.disconnect()
    source.buffer = null
    // OfflineAudioContext has no close(); rendering automatically changes it to closed.
  }
}

export async function transcribeFile(
  file: File,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: TranscriptionProgress) => void
  } = {}
): Promise<BrowserTranscriptionResult> {
  const { signal, onProgress } = options
  checkAborted(signal)
  validateMediaSize(file.size)
  if (typeof Worker === 'undefined')
    throw new Error(
      '이 브라우저는 웹 음성 분석을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.'
    )
  onProgress?.({
    percent: 2,
    message: '파일의 길이와 오디오 형식을 확인하고 있습니다.'
  })
  const decoded = await decodeMedia(file, signal)
  checkAborted(signal)
  onProgress?.({
    percent: 8,
    message: '기기에서 실행할 한국어 음성 AI를 준비하고 있습니다.'
  })

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./transcription.worker.ts', import.meta.url),
      { type: 'module' }
    )
    let settled = false
    const finish = (
      error?: Error,
      result?: BrowserTranscriptionResult
    ): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      // Termination also cancels model fetches and ongoing WASM work.
      worker.terminate()
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const onAbort = (): void => finish(abortError())
    worker.onmessage = (event: MessageEvent<TranscriptionWorkerResponse>) => {
      if (settled || signal?.aborted) return
      const message = event.data
      if (message.type === 'progress') onProgress?.(message.progress)
      else if (message.type === 'error') finish(new Error(message.message))
      else if (message.type === 'complete') finish(undefined, message.result)
    }
    worker.onerror = () =>
      finish(
        new Error(
          '음성 AI를 실행하지 못했습니다. 인터넷 연결을 확인하고 최신 Chrome 또는 Edge에서 다시 시도해 주세요.'
        )
      )
    worker.onmessageerror = () =>
      finish(
        new Error(
          '음성 AI 결과를 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.'
        )
      )
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    const request: TranscriptionWorkerRequest = decoded
    try {
      worker.postMessage(request, [decoded.audio.buffer])
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error('음성 AI를 시작하지 못했습니다.')
      )
    }
  })
}
