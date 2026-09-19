import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribeFile } from '../src/web/transcription'
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_DURATION_MS,
  normalizeTranscript,
  validateMediaDuration,
  validateMediaSize,
  type TranscriptionWorkerResponse
} from '../src/web/transcription-types'

describe('web speech recognition boundaries', () => {
  it('accepts exact size and duration limits, rejects invalid or excessive values', () => {
    expect(() => validateMediaSize(MAX_MEDIA_BYTES)).not.toThrow()
    expect(() => validateMediaSize(MAX_MEDIA_BYTES + 1)).toThrow('100MB')
    expect(() => validateMediaSize(0)).toThrow('비어 있는')
    expect(() => validateMediaDuration(MAX_MEDIA_DURATION_MS)).not.toThrow()
    expect(() => validateMediaDuration(MAX_MEDIA_DURATION_MS + 0.01)).toThrow('최대 5분')
    for (const duration of [NaN, Infinity, -1, 0]) {
      expect(() => validateMediaDuration(duration)).toThrow('길이를 확인')
    }
  })
})

describe('Whisper transcript normalization', () => {
  it('converts seconds, preserves Korean text, sorts chunks and assigns no invented speakers', () => {
    const result = normalizeTranscript({ chunks: [
      { text: ' 다음\n 문장 ', timestamp: [2.001, 3.5] },
      { text: ' 안녕하세요. ', timestamp: [0.25, 1.8] }
    ] }, 4_000)
    expect(result).toEqual([
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

  it('drops empty, reversed, out-of-range and malformed chunks instead of creating false timings', () => {
    expect(normalizeTranscript({ text: 'do not silently retime corrupt chunks', chunks: [
      null,
      { text: ' ', timestamp: [0, 1] },
      { text: 'reversed', timestamp: [2, 1] },
      { text: 'outside', timestamp: [3, 4] },
      { text: 'missing start', timestamp: [null, 1] },
      { text: 'not finite', timestamp: [NaN, 1] },
      { text: 'string timestamp', timestamp: ['0', 1] }
    ] }, 3000)).toEqual([])
  })

  it('retains untimed text as one full-length segment and safely handles empty output', () => {
    expect(normalizeTranscript({ text: '한 줄\n대사' }, 1500)).toEqual([
      { id: 'web-segment-1', startMs: 0, endMs: 1500, text: '한 줄 대사', speakerId: '' }
    ])
    for (const value of [null, [], {}, { chunks: [], text: '' }]) expect(normalizeTranscript(value, 1000)).toEqual([])
  })
})

describe('browser transcription lifecycle', () => {
  let metadataSeconds: number
  let decodedSeconds: number
  let mediaError: boolean
  let contexts: MockAudioContext[]
  let workers: MockWorker[]
  let sources: { buffer: AudioBuffer | null; disconnect: ReturnType<typeof vi.fn> }[]
  let pendingDecode: Promise<AudioBuffer> | undefined

  class MockMedia {
    src = ''
    preload = ''
    duration = metadataSeconds
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    removeAttribute(): void { this.src = '' }
    load(): void {
      if (this.src) queueMicrotask(() => mediaError ? this.onerror?.() : this.onloadedmetadata?.())
    }
  }

  class MockAudioContext {
    state = 'running'
    decodeAudioData = vi.fn(() => pendingDecode ?? Promise.resolve({ duration: decodedSeconds } as AudioBuffer))
    close = vi.fn(async () => { this.state = 'closed' })
    constructor() { contexts.push(this) }
  }

  class MockOfflineAudioContext {
    destination = {}
    constructor(readonly channels: number, readonly samples: number, readonly sampleRate: number) {}
    createBufferSource() {
      const source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn(), disconnect: vi.fn() }
      sources.push(source)
      return source
    }
    async startRendering() {
      return { getChannelData: () => new Float32Array(this.samples) }
    }
  }

  class MockWorker {
    onmessage: ((event: MessageEvent<TranscriptionWorkerResponse>) => void) | null = null
    onerror: (() => void) | null = null
    onmessageerror: (() => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() { workers.push(this) }
    emit(data: TranscriptionWorkerResponse): void { this.onmessage?.({ data } as MessageEvent<TranscriptionWorkerResponse>) }
  }

  const file = (): File => new File([new Uint8Array(10)], 'test.mp4', { type: 'video/mp4' })

  beforeEach(() => {
    metadataSeconds = 2
    decodedSeconds = 2
    mediaError = false
    contexts = []
    workers = []
    sources = []
    pendingDecode = undefined
    vi.stubGlobal('document', { createElement: () => new MockMedia() })
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext)
    vi.stubGlobal('Worker', MockWorker)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('returns worker results, transfers 16kHz mono samples and releases decoder resources', async () => {
    const progress = vi.fn()
    const pending = transcribeFile(file(), { onProgress: progress })
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    const [request, transfer] = workers[0].postMessage.mock.calls[0]
    expect(request.audio).toBeInstanceOf(Float32Array)
    expect(request.audio.length).toBe(32_000)
    expect(transfer).toEqual([request.audio.buffer])
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(sources[0].disconnect).toHaveBeenCalledOnce()
    expect(sources[0].buffer).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-test')
    workers[0].emit({ type: 'progress', progress: { percent: 42, message: '분석 중' } })
    const result = { segments: [{ id: 'one', startMs: 0, endMs: 1000, text: '안녕', speakerId: '' }], durationMs: 2000 }
    workers[0].emit({ type: 'complete', result })
    await expect(pending).resolves.toEqual(result)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith({ percent: 42, message: '분석 중' })
  })

  it('rejects an oversized file before reading it or starting any decoder', async () => {
    const largeFile = { size: MAX_MEDIA_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File
    await expect(transcribeFile(largeFile)).rejects.toThrow('100MB')
    expect(largeFile.arrayBuffer).not.toHaveBeenCalled()
    expect(contexts).toHaveLength(0)
    expect(workers).toHaveLength(0)
  })

  it('rejects overlong metadata before audio allocation', async () => {
    metadataSeconds = 301
    await expect(transcribeFile(file())).rejects.toThrow('최대 5분')
    expect(contexts).toHaveLength(0)
    expect(workers).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('also rejects overlong decoded audio when container metadata claims a shorter duration', async () => {
    decodedSeconds = 300.001
    await expect(transcribeFile(file())).rejects.toThrow('최대 5분')
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(workers).toHaveLength(0)
    expect(sources).toHaveLength(0)
  })

  it('reports unsupported codec errors and revokes the local preview URL', async () => {
    mediaError = true
    await expect(transcribeFile(file())).rejects.toThrow('오디오를 읽을 수 없습니다')
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    expect(contexts).toHaveLength(0)
  })

  it('cancels model download or inference by terminating the worker and ignoring a queued completion', async () => {
    const controller = new AbortController()
    const progress = vi.fn()
    const pending = transcribeFile(file(), { signal: controller.signal, onProgress: progress })
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    const staleHandler = workers[0].onmessage!
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    const count = progress.mock.calls.length
    staleHandler({ data: { type: 'progress', progress: { percent: 100, message: 'stale' } } } as MessageEvent<TranscriptionWorkerResponse>)
    staleHandler(new MessageEvent('message', { data: { type: 'complete', result: { segments: [], durationMs: 2000 } } }))
    expect(progress).toHaveBeenCalledTimes(count)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })

  it('cancels a pending decode promptly, closes its context and never starts a late worker', async () => {
    let finishDecode!: (buffer: AudioBuffer) => void
    pendingDecode = new Promise((resolve) => { finishDecode = resolve })
    const controller = new AbortController()
    const pending = transcribeFile(file(), { signal: controller.signal })
    await vi.waitFor(() => expect(contexts[0]?.decodeAudioData).toHaveBeenCalledOnce())
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(contexts[0].close).toHaveBeenCalledOnce()
    finishDecode({ duration: 2 } as AudioBuffer)
    await Promise.resolve()
    expect(workers).toHaveLength(0)
  })

  it('does no work when cancellation was already requested', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(transcribeFile(file(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(contexts).toHaveLength(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
