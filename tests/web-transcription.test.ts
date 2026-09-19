import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribeFile } from '../src/web/transcription'
import { openMediaChunks, planMediaChunks } from '../src/web/media-chunks'
import {
  MAX_MEDIA_DURATION_MS, normalizeTranscript, validateMediaDuration, validateMediaSize,
  type TranscriptionWorkerRequest, type TranscriptionWorkerResponse
} from '../src/web/transcription-types'

vi.mock('../src/web/media-chunks', async importActual => ({
  ...await importActual<typeof import('../src/web/media-chunks')>(), openMediaChunks: vi.fn()
}))

describe('web speech recognition boundaries', () => {
  it('accepts large files and videos longer than five minutes; keeps the project three-hour bound', () => {
    expect(() => validateMediaSize(4 * 1024 ** 3)).not.toThrow()
    expect(() => validateMediaSize(0)).toThrow('비어 있는')
    expect(() => validateMediaDuration(6 * 60_000)).not.toThrow()
    expect(() => validateMediaDuration(MAX_MEDIA_DURATION_MS)).not.toThrow()
    expect(() => validateMediaDuration(MAX_MEDIA_DURATION_MS + 0.01)).toThrow('3시간')
    for (const duration of [NaN, Infinity, -1, 0]) expect(() => validateMediaDuration(duration)).toThrow('길이를 확인')
  })
})

describe('Whisper transcript normalization', () => {
  it('converts seconds, preserves Korean text, sorts chunks and does not invent speakers', () => {
    expect(normalizeTranscript({ chunks: [
      { text: ' 다음\n 문장 ', timestamp: [2.001, 3.5] },
      { text: ' 안녕하세요. ', timestamp: [0.25, 1.8] }
    ] }, 4_000)).toEqual([
      { id: 'web-segment-2', startMs: 250, endMs: 1800, text: '안녕하세요.', speakerId: '' },
      { id: 'web-segment-1', startMs: 2001, endMs: 3500, text: '다음 문장', speakerId: '' }
    ])
  })
  it('clamps timestamps and closes a missing end using the next chunk or media end', () => {
    const result = normalizeTranscript({ chunks: [
      { text: '첫 문장', timestamp: [-0.5, null] },
      { text: '둘째 문장', timestamp: [1.5, null] },
      { text: '마지막', timestamp: [2, 30] }
    ] }, 3_000)
    expect(result.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 1500], [1500, 2000], [2000, 3000]])
    expect(normalizeTranscript({ chunks: [{ text: '열린 끝', timestamp: [1, null] }] }, 3000)[0].endMs).toBe(3000)
  })
  it('drops corrupt chunks instead of creating false timings', () => {
    expect(normalizeTranscript({ text: 'do not silently retime corrupt chunks', chunks: [
      null, { text: ' ', timestamp: [0, 1] }, { text: 'reversed', timestamp: [2, 1] },
      { text: 'outside', timestamp: [3, 4] }, { text: 'missing start', timestamp: [null, 1] },
      { text: 'not finite', timestamp: [NaN, 1] }, { text: 'string timestamp', timestamp: ['0', 1] }
    ] }, 3000)).toEqual([])
  })
  it('retains untimed text as one segment and safely handles empty output', () => {
    expect(normalizeTranscript({ text: '한 줄\n대사' }, 1500)).toEqual([
      { id: 'web-segment-1', startMs: 0, endMs: 1500, text: '한 줄 대사', speakerId: '' }
    ])
    for (const value of [null, [], {}, { chunks: [], text: '' }]) expect(normalizeTranscript(value, 1000)).toEqual([])
  })
})

describe('sequential browser transcription lifecycle', () => {
  let workers: MockWorker[]
  let disposeMedia: ReturnType<typeof vi.fn>
  let readChunk: ReturnType<typeof vi.fn>
  const file = (): File => ({ size: 2 * 1024 ** 3, name: 'large.mp4', arrayBuffer: vi.fn(() => { throw new Error('must never read whole movie') }) } as unknown as File)
  const line = (text = '안녕하세요', startMs = 3000) => [{ id: 'web-segment-1', startMs, endMs: startMs + 1000, text, speakerId: '' }]

  class MockWorker {
    onmessage: ((event: MessageEvent<TranscriptionWorkerResponse>) => void) | null = null
    onerror: (() => void) | null = null
    onmessageerror: (() => void) | null = null
    terminate = vi.fn()
    postMessage = vi.fn((message: TranscriptionWorkerRequest) => {
      if (message.type === 'dispose') queueMicrotask(() => this.emit({ type: 'disposed' }))
    })
    constructor() { workers.push(this) }
    emit(data: TranscriptionWorkerResponse): void { this.onmessage?.(new MessageEvent('message', { data })) }
  }

  beforeEach(() => {
    workers = []
    disposeMedia = vi.fn()
    readChunk = vi.fn(async range => new Float32Array((range.endMs - range.startMs) * 16))
    vi.stubGlobal('Worker', MockWorker)
    vi.mocked(openMediaChunks).mockResolvedValue({ durationMs: 370_000, ranges: planMediaChunks(370_000), dispose: disposeMedia, readChunk })
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('runs seven windows of a >5-minute/>100MB movie through one worker without prefetch, preserving absolute times', async () => {
    const media = file()
    const progress = vi.fn()
    const pending = transcribeFile(media, { onProgress: progress })
    await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1))
    expect(readChunk).toHaveBeenCalledTimes(1)
    // No second PCM window is allocated while the first inference is pending.
    await Promise.resolve()
    expect(readChunk).toHaveBeenCalledTimes(1)
    for (let chunkId = 0; chunkId < 7; chunkId++) {
      await vi.waitFor(() => expect(workers[0].postMessage.mock.calls[chunkId]?.[0]).toMatchObject({ type: 'transcribe', chunkId }))
      const request = workers[0].postMessage.mock.calls[chunkId][0]
      if (request.type !== 'transcribe') throw new Error('Unexpected message')
      expect(request.audio.length).toBeLessThanOrEqual(64_000 * 16)
      workers[0].emit({ type: 'chunk', chunkId, segments: chunkId === 2 ? [] : line(`문장 ${chunkId}`) })
    }
    const result = await pending
    expect(result.durationMs).toBe(370_000)
    expect(result.segments.map(item => item.startMs)).toEqual([3000, 61_000, 181_000, 241_000, 301_000, 361_000])
    expect(new Set(result.segments.map(item => item.id)).size).toBe(6)
    expect(workers).toHaveLength(1)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(disposeMedia).toHaveBeenCalledOnce()
    expect(media.arrayBuffer).not.toHaveBeenCalled()
    const percentages = progress.mock.calls.map(([value]) => value.percent)
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b))
    expect(percentages.at(-1)).toBe(100)
  })

  it('ignores wrong and stale chunk replies and cancels the entire job without returning partial text', async () => {
    const controller = new AbortController()
    const pending = transcribeFile(file(), { signal: controller.signal })
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    workers[0].emit({ type: 'chunk', chunkId: 99, segments: line() })
    expect(readChunk).toHaveBeenCalledTimes(1)
    workers[0].emit({ type: 'chunk', chunkId: 0, segments: line() })
    await vi.waitFor(() => expect(readChunk).toHaveBeenCalledTimes(2))
    const stale = workers[0].onmessage!
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    stale(new MessageEvent('message', { data: { type: 'chunk', chunkId: 1, segments: line('stale') } }))
    expect(readChunk).toHaveBeenCalledTimes(2)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(disposeMedia).toHaveBeenCalledOnce()
  })

  it('rejects a failure after a successful first window instead of publishing an incomplete transcript', async () => {
    const pending = transcribeFile(file())
    const rejection = expect(pending).rejects.toThrow('model failed')
    await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1))
    workers[0].emit({ type: 'chunk', chunkId: 0, segments: line() })
    await vi.waitFor(() => expect(workers[0].postMessage).toHaveBeenCalledTimes(2))
    workers[0].emit({ type: 'error', chunkId: 1, message: 'model failed' })
    await rejection
    expect(readChunk).toHaveBeenCalledTimes(2)
    expect(disposeMedia).toHaveBeenCalledOnce()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })

  it('does not leave a model running if later media decoding fails', async () => {
    readChunk.mockResolvedValueOnce(new Float32Array(16000)).mockRejectedValueOnce(new Error('codec failed'))
    const pending = transcribeFile(file())
    const rejection = expect(pending).rejects.toThrow('codec failed')
    await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1))
    workers[0].emit({ type: 'chunk', chunkId: 0, segments: line() })
    await rejection
    expect(workers[0].postMessage).toHaveBeenLastCalledWith({ type: 'dispose' })
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(disposeMedia).toHaveBeenCalledOnce()
  })

  it('does no work for an already aborted job', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(transcribeFile(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(openMediaChunks).not.toHaveBeenCalled()
    expect(workers).toHaveLength(0)
  })
})
