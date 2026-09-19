import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSCRIPTION_MAX_CHUNK_MS,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_SAMPLE_RATE,
  type TranscriptionWorkerRequest,
  type TranscriptionWorkerResponse
} from '../src/web/transcription-types'

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
  transcribe: vi.fn(),
  dispose: vi.fn()
}))

vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, useBrowserCache: false, backends: { onnx: { wasm: {} } } },
  pipeline: mocks.pipeline,
  TextStreamer: class {
    end(): void {}
  }
}))

describe('persistent browser transcription worker', () => {
  let replies: TranscriptionWorkerResponse[]
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<TranscriptionWorkerRequest>) => void) | null
  }

  function send(data: TranscriptionWorkerRequest): void {
    scope.onmessage?.({ data } as MessageEvent<TranscriptionWorkerRequest>)
  }

  function voicedChunk(chunkId: number): TranscriptionWorkerRequest {
    return {
      type: 'transcribe',
      chunkId,
      audio: new Float32Array(TRANSCRIPTION_SAMPLE_RATE).fill(0.25),
      durationMs: 1000
    }
  }

  async function waitForChunk(chunkId: number): Promise<void> {
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({ type: 'chunk', chunkId })))
  }

  function splitAudio(): Float32Array {
    const audio = new Float32Array(4 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    audio.fill(0, TRANSCRIPTION_SAMPLE_RATE, 2.5 * TRANSCRIPTION_SAMPLE_RATE)
    return audio
  }

  function progressValues(): number[] {
    return replies.flatMap((reply) => reply.type === 'progress' ? [reply.progress.percent] : [])
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    replies = []
    mocks.transcribe.mockResolvedValue({ chunks: [{ text: ' 안녕하세요. ', timestamp: [0.1, 0.8] }] })
    mocks.dispose.mockResolvedValue(undefined)
    mocks.pipeline.mockResolvedValue(Object.assign(mocks.transcribe, { tokenizer: {}, dispose: mocks.dispose }))
    vi.stubGlobal('onmessage', null)
    vi.stubGlobal('postMessage', (message: TranscriptionWorkerResponse) => { replies.push(message) })
    await import('../src/web/transcription.worker')
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('loads the pinned quantized WASM model once and reuses it for two chunks', async () => {
    send(voicedChunk(10))
    await waitForChunk(10)
    send(voicedChunk(11))
    await waitForChunk(11)

    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', TRANSCRIPTION_MODEL, expect.objectContaining({
      device: 'wasm', dtype: 'q8', revision: TRANSCRIPTION_MODEL_REVISION
    }))
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    expect(mocks.transcribe).toHaveBeenLastCalledWith(expect.any(Float32Array), expect.objectContaining({
      language: 'korean', task: 'transcribe', return_timestamps: true
    }))
    expect(replies).toContainEqual({
      type: 'chunk', chunkId: 11,
      segments: [{ id: 'web-segment-1', startMs: 100, endMs: 800, speakerId: '', text: '안녕하세요.' }]
    })
    expect(replies.filter((reply) => reply.type === 'progress').every((reply) => reply.chunkId === 10 || reply.chunkId === 11)).toBe(true)
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('returns silent chunks without model loading and continues through silence between voiced chunks', async () => {
    send({ type: 'transcribe', chunkId: 0, audio: new Float32Array(16000).fill(0.00001), durationMs: 1000 })
    await waitForChunk(0)
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 0, segments: [] })

    send(voicedChunk(1))
    await waitForChunk(1)
    send({ type: 'transcribe', chunkId: 2, audio: new Float32Array(16000), durationMs: 1000 })
    await waitForChunk(2)
    send(voicedChunk(3))
    await waitForChunk(3)
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(replies.some((reply) => reply.type === 'error')).toBe(false)
  })

  it('accepts an empty model result and retains the model for the next chunk', async () => {
    mocks.transcribe.mockResolvedValueOnce({ text: '', chunks: [] })
    send(voicedChunk(4))
    await waitForChunk(4)
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 4, segments: [] })
    send(voicedChunk(5))
    await waitForChunk(5)
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('trims sustained leading and trailing silence with context and offsets local timestamps', async () => {
    const audio = new Float32Array(10 * TRANSCRIPTION_SAMPLE_RATE)
    audio.fill(0.25, 3 * TRANSCRIPTION_SAMPLE_RATE, 5 * TRANSCRIPTION_SAMPLE_RATE)
    mocks.transcribe.mockResolvedValueOnce({ chunks: [
      { text: '첫 문장', timestamp: [0.25, 1.25] },
      { text: '열린 끝', timestamp: [1.5, null] }
    ] })
    send({ type: 'transcribe', chunkId: 20, audio, durationMs: 10_000 })
    await waitForChunk(20)

    expect(mocks.transcribe).toHaveBeenCalledOnce()
    const piece = mocks.transcribe.mock.calls[0][0] as Float32Array
    expect(piece.buffer).toBe(audio.buffer)
    expect(piece.byteOffset).toBe(2.75 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(piece.length).toBe(2.5 * TRANSCRIPTION_SAMPLE_RATE)
    expect(replies).toContainEqual({
      type: 'chunk', chunkId: 20,
      segments: [
        { id: 'web-segment-1', startMs: 3000, endMs: 4000, speakerId: '', text: '첫 문장' },
        { id: 'web-segment-2', startMs: 4250, endMs: 5250, speakerId: '', text: '열린 끝' }
      ]
    })
  })

  it('splits exactly 1.5 seconds of interior silence into unchanged PCM views with unique offset segments', async () => {
    const audio = splitAudio()
    const original = audio.slice()
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: '앞 문장', timestamp: [0.25, 1] }] })
      .mockResolvedValueOnce({ chunks: [{ text: '뒷 문장', timestamp: [0.25, null] }] })
    send({ type: 'transcribe', chunkId: 21, audio, durationMs: 4000 })
    await waitForChunk(21)

    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    const first = mocks.transcribe.mock.calls[0][0] as Float32Array
    const second = mocks.transcribe.mock.calls[1][0] as Float32Array
    expect(first.buffer).toBe(audio.buffer)
    expect(second.buffer).toBe(audio.buffer)
    expect(first.byteOffset).toBe(0)
    expect(first.length).toBe(1.25 * TRANSCRIPTION_SAMPLE_RATE)
    expect(second.byteOffset).toBe(2.25 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(second.length).toBe(1.75 * TRANSCRIPTION_SAMPLE_RATE)
    expect(audio).toEqual(original)
    const result = replies.find((reply) => reply.type === 'chunk' && reply.chunkId === 21)
    if (result?.type !== 'chunk') throw new Error('Expected a complete chunk result')
    expect(result.segments).toEqual([
      { id: expect.any(String), startMs: 250, endMs: 1000, speakerId: '', text: '앞 문장' },
      { id: expect.any(String), startMs: 2500, endMs: 4000, speakerId: '', text: '뒷 문장' }
    ])
    expect(new Set(result.segments.map((segment) => segment.id)).size).toBe(2)
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it.each([0.00011, -0.00011])('retains quiet %s audio and a one-second interior pause', async (amplitude) => {
    const audio = new Float32Array(4 * TRANSCRIPTION_SAMPLE_RATE).fill(amplitude)
    audio.fill(0, TRANSCRIPTION_SAMPLE_RATE, 2 * TRANSCRIPTION_SAMPLE_RATE)
    send({ type: 'transcribe', chunkId: 22, audio, durationMs: 4000 })
    await waitForChunk(22)
    expect(mocks.transcribe).toHaveBeenCalledOnce()
    const piece = mocks.transcribe.mock.calls[0][0] as Float32Array
    expect(piece.buffer).toBe(audio.buffer)
    expect(piece.byteOffset).toBe(audio.byteOffset)
    expect(piece.length).toBe(audio.length)
    expect(piece[0]).toBe(Math.fround(amplitude))
    expect(piece[TRANSCRIPTION_SAMPLE_RATE]).toBe(0)
  })

  it('retains leading and trailing silence shorter than the split threshold', async () => {
    const audio = new Float32Array(4 * TRANSCRIPTION_SAMPLE_RATE)
    audio.fill(0.25, TRANSCRIPTION_SAMPLE_RATE, 3 * TRANSCRIPTION_SAMPLE_RATE)
    send({ type: 'transcribe', chunkId: 23, audio, durationMs: 4000 })
    await waitForChunk(23)
    expect(mocks.transcribe).toHaveBeenCalledOnce()
    const piece = mocks.transcribe.mock.calls[0][0] as Float32Array
    expect(piece.buffer).toBe(audio.buffer)
    expect(piece.byteOffset).toBe(0)
    expect(piece.length).toBe(audio.length)
  })

  it('keeps progress monotonic below completion and publishes no partial chunk while a later piece is pending', async () => {
    let finishSecond!: (output: unknown) => void
    mocks.transcribe
      .mockImplementationOnce(async (_audio, options) => {
        options.streamer.end()
        return { chunks: [{ text: '앞 문장', timestamp: [0.25, 1] }] }
      })
      .mockImplementationOnce((_audio, options) => {
        options.streamer.end()
        return new Promise((resolve) => { finishSecond = resolve })
      })
    send({ type: 'transcribe', chunkId: 24, audio: splitAudio(), durationMs: 4000 })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2))
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    expect(progressValues().length).toBeGreaterThan(1)
    expect(progressValues().every((percent) => percent < 100)).toBe(true)
    expect(progressValues()).toEqual([...progressValues()].sort((left, right) => left - right))

    finishSecond({ chunks: [{ text: '뒷 문장', timestamp: [0.25, 1] }] })
    await waitForChunk(24)
    const percentages = progressValues()
    expect(percentages.at(-1)).toBe(100)
    expect(percentages.slice(0, -1).every((percent) => percent < 100)).toBe(true)
    expect(percentages).toEqual([...percentages].sort((left, right) => left - right))
    const chunks = replies.filter((reply) => reply.type === 'chunk')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].segments).toHaveLength(2)
  })

  it('discards partial results and releases the pipeline when a later piece fails', async () => {
    let failSecond!: (error: Error) => void
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: '앞 문장', timestamp: [0.25, 1] }] })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failSecond = reject }))
    send({ type: 'transcribe', chunkId: 25, audio: splitAudio(), durationMs: 4000 })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2))
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    failSecond(new Error('second inference failed'))
    await vi.waitFor(() => expect(replies).toContainEqual({
      type: 'error', chunkId: 25, message: expect.stringContaining('음성 분석을 완료하지 못했습니다')
    }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    expect(progressValues().every((percent) => percent < 100)).toBe(true)
  })

  it('acknowledges disposal only after the loaded pipeline has released its resources', async () => {
    send(voicedChunk(0))
    await waitForChunk(0)
    let finishDispose!: () => void
    mocks.dispose.mockImplementation(() => new Promise<void>((resolve) => { finishDispose = resolve }))
    send({ type: 'dispose' })
    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce())
    expect(replies).not.toContainEqual({ type: 'disposed' })
    finishDispose()
    await vi.waitFor(() => expect(replies).toContainEqual({ type: 'disposed' }))
  })

  it('disposes safely when no chunk needed a model', async () => {
    send({ type: 'dispose' })
    await vi.waitFor(() => expect(replies).toContainEqual({ type: 'disposed' }))
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('finishes an in-flight chunk before processing a queued disposal request', async () => {
    let finishInference!: (output: unknown) => void
    mocks.transcribe.mockImplementationOnce(() => new Promise((resolve) => { finishInference = resolve }))
    send(voicedChunk(6))
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce())
    send({ type: 'dispose' })
    await Promise.resolve()
    expect(mocks.dispose).not.toHaveBeenCalled()
    finishInference({ chunks: [] })
    await vi.waitFor(() => expect(replies).toContainEqual({ type: 'disposed' }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(replies.findIndex((reply) => reply.type === 'chunk')).toBeLessThan(
      replies.findIndex((reply) => reply.type === 'disposed')
    )
  })

  it.each(['pcm', 'declared duration'] as const)('refuses oversized %s before loading the model', async (source) => {
    const audio = new Float32Array(source === 'pcm'
      ? (TRANSCRIPTION_MAX_CHUNK_MS / 1000) * TRANSCRIPTION_SAMPLE_RATE + 1
      : TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    send({ type: 'transcribe', chunkId: 7, audio, durationMs: source === 'pcm' ? 1000 : TRANSCRIPTION_MAX_CHUNK_MS + 1 })
    await vi.waitFor(() => expect(replies).toContainEqual({
      type: 'error', chunkId: 7, message: expect.stringContaining('구간이 너무 깁니다')
    }))
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
  })

  it('releases the model and returns a friendly chunk error when inference fails', async () => {
    mocks.transcribe.mockRejectedValueOnce(new Error('low-level runtime detail'))
    send(voicedChunk(8))
    await vi.waitFor(() => expect(replies).toContainEqual({
      type: 'error', chunkId: 8, message: expect.stringContaining('음성 분석을 완료하지 못했습니다')
    }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
  })
})
