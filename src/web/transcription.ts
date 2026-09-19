import type { TranscriptSegment } from '../shared/types'
import {
  type BrowserTranscriptionResult, type TranscriptionProgress, type TranscriptionLanguage,
  type TranscriptionWorkerRequest, type TranscriptionWorkerResponse
} from './transcription-types'
import { abortError, checkAborted, openMediaChunks, appendChunkTranscript } from './media-chunks'

export { MAX_MEDIA_DURATION_MS } from './transcription-types'
export type { TranscriptionLanguage } from './transcription-types'

/** One worker/model per job; only one PCM window may be in flight at a time. */
function createWorkerSession(signal: AbortSignal | undefined, onProgress: (progress: TranscriptionProgress) => void, language: TranscriptionLanguage) {
  const worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' })
  let closed = false
  let failure: Error | undefined
  let pending: { id: number; resolve: (segments: TranscriptSegment[]) => void; reject: (error: Error) => void } | undefined
  let disposed: (() => void) | undefined
  const terminate = (): void => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', onAbort)
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
    worker.terminate()
    disposed?.()
  }
  const fail = (error: Error): void => {
    failure = error
    const active = pending; pending = undefined
    active?.reject(error)
    terminate()
  }
  const onAbort = (): void => fail(abortError())
  worker.onmessage = (event: MessageEvent<TranscriptionWorkerResponse>) => {
    if (closed || signal?.aborted) return
    const message = event.data
    if (message.type === 'disposed') { terminate(); return }
    if (message.type === 'error') { fail(new Error(message.message)); return }
    if (!pending || message.chunkId !== pending.id) return
    if (message.type === 'progress') onProgress(message.progress)
    if (message.type === 'chunk') {
      const active = pending; pending = undefined
      active.resolve(message.segments)
    }
  }
  worker.onerror = () => fail(new Error('음성 AI를 실행하지 못했습니다. 인터넷 연결을 확인하고 최신 Chrome·Edge에서 다시 시도해 주세요.'))
  worker.onmessageerror = () => fail(new Error('음성 AI 결과를 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.'))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  return {
    async transcribe(chunkId: number, audio: Float32Array, durationMs: number): Promise<TranscriptSegment[]> {
      checkAborted(signal)
      if (failure) throw failure
      if (closed || pending) throw new Error('음성 분석 구간을 순서대로 처리해야 합니다.')
      return new Promise((resolve, reject) => {
        pending = { id: chunkId, resolve, reject }
        const request: TranscriptionWorkerRequest = { type: 'transcribe', chunkId, audio, durationMs, language }
        try { worker.postMessage(request, [audio.buffer]) } catch (error) {
          fail(error instanceof Error ? error : new Error('음성 AI를 시작하지 못했습니다.'))
        }
      })
    },
    async dispose(): Promise<void> {
      if (closed) return
      await new Promise<void>(resolve => {
        const timer = setTimeout(terminate, 2000)
        disposed = () => { clearTimeout(timer); resolve() }
        try { worker.postMessage({ type: 'dispose' } satisfies TranscriptionWorkerRequest) } catch { terminate() }
      })
    }
  }
}

export async function transcribeFile(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: TranscriptionProgress) => void; language?: TranscriptionLanguage } = {}
): Promise<BrowserTranscriptionResult> {
  const { signal, onProgress, language = 'korean' } = options
  checkAborted(signal)
  if (typeof Worker === 'undefined') throw new Error('이 브라우저는 웹 음성 분석을 지원하지 않습니다. 최신 Chrome·Edge에서 열어 주세요.')
  onProgress?.({ percent: 1, message: '파일에서 음성 트랙과 전체 영상 길이를 확인하고 있습니다.' })
  const media = await openMediaChunks(file, signal)
  let session: ReturnType<typeof createWorkerSession> | undefined
  let segments: TranscriptSegment[] = []
  let index = 0
  let percent = 1
  const report = (progress: TranscriptionProgress): void => {
    checkAborted(signal)
    percent = Math.max(percent, Math.min(99, 3 + 95 * (index + progress.percent / 100) / media.ranges.length))
    onProgress?.({ percent: Math.round(percent), message: `${index + 1}/${media.ranges.length} 구간 · ${progress.message}` })
  }
  try {
    checkAborted(signal)
    session = createWorkerSession(signal, report, language)
    for (const range of media.ranges) {
      index = range.id
      checkAborted(signal)
      report({ percent: 0, message: '필요한 음성 구간만 읽고 있습니다.' })
      // No prefetch: the previous worker result must finish before decoding the next window.
      const audio = await media.readChunk(range)
      checkAborted(signal)
      const local = await session.transcribe(range.id, audio, range.endMs - range.startMs)
      checkAborted(signal)
      segments = appendChunkTranscript(segments, local, range)
      report({ percent: 100, message: '분석 결과를 원본 영상의 시간에 맞춰 연결했습니다.' })
    }
    if (!segments.length) throw new Error('인식된 음성이 없습니다. 음성이 선명하게 들리는 파일로 다시 시도해 주세요.')
  } finally {
    media.dispose()
    await session?.dispose()
  }
  checkAborted(signal)
  onProgress?.({ percent: 100, message: `${media.ranges.length}개 구간의 음성 분석을 완료했습니다. 이어 붙인 대사와 시간을 확인해 주세요.` })
  return { segments, durationMs: media.durationMs }
}
