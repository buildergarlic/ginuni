import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSCRIPTION_MAX_CHUNK_MS,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_ENGLISH_MODEL,
  TRANSCRIPTION_ENGLISH_MODEL_REVISION,
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

  it('selects the pinned English model, disposes a different model, and omits unsupported language/task arguments', async () => {
    send(voicedChunk(12))
    await waitForChunk(12)
    expect(mocks.transcribe).toHaveBeenLastCalledWith(expect.any(Float32Array), expect.objectContaining({ language: 'korean' }))
    mocks.transcribe.mockResolvedValueOnce({ chunks: [{ text: ' Hello, everyone. ', timestamp: [0.1, 0.8] }] })
    send({ type: 'transcribe', chunkId: 13, audio: new Float32Array(16000).fill(0.25), durationMs: 1000, language: 'english' })
    await waitForChunk(13)
    expect(mocks.transcribe.mock.calls.at(-1)?.[1]).not.toHaveProperty('language')
    expect(mocks.transcribe.mock.calls.at(-1)?.[1]).not.toHaveProperty('task')
    expect(mocks.pipeline).toHaveBeenCalledTimes(2)
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.pipeline).toHaveBeenLastCalledWith('automatic-speech-recognition', TRANSCRIPTION_ENGLISH_MODEL, expect.objectContaining({ device: 'wasm', dtype: 'q8', revision: TRANSCRIPTION_ENGLISH_MODEL_REVISION }))
    expect(replies).toContainEqual({
      type: 'chunk', chunkId: 13,
      segments: [{ id: 'web-segment-1', startMs: 100, endMs: 800, speakerId: '', text: 'Hello, everyone.' }]
    })
    expect(replies).toContainEqual({ type: 'progress', chunkId: 13, progress: { percent: 42, message: '기기에서 영어 음성을 분석하고 있습니다.' } })
    send({ type: 'transcribe', chunkId: 14, audio: new Float32Array(16000).fill(0.25), durationMs: 1000, language: 'english' })
    await waitForChunk(14)
    expect(mocks.pipeline).toHaveBeenCalledTimes(2)
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

  it('keeps Japanese dictation in the source language using the multilingual model', async () => {
    mocks.transcribe.mockResolvedValueOnce({ chunks: [{ text: 'こんにちは。', timestamp: [0.1, 0.8] }] })
    send({ type: 'transcribe', chunkId: 40, audio: new Float32Array(16000).fill(0.25), durationMs: 1000, language: 'japanese' })
    await waitForChunk(40)
    expect(mocks.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', TRANSCRIPTION_MODEL, expect.any(Object))
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ language: 'japanese', task: 'transcribe' }))
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 40, segments: [{ id: 'web-segment-1', startMs: 100, endMs: 800, speakerId: '', text: 'こんにちは。' }] })
    expect(replies).toContainEqual({ type: 'progress', chunkId: 40, progress: { percent: 42, message: '기기에서 일본어 음성을 분석하고 있습니다.' } })
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

  it('retries a missing English prefix once with an unchanged PCM view and keeps existing segments intact', async () => {
    const audio = new Float32Array(25 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    const originalAudio = audio.slice()
    const primary = { chunks: [
      { text: 'Existing first.', timestamp: [20, 22] },
      { text: 'Existing second.', timestamp: [22, 25] }
    ] }
    const originalPrimary = structuredClone(primary)
    mocks.transcribe
      .mockResolvedValueOnce(primary)
      .mockResolvedValueOnce({ chunks: [
        { text: 'Recovered opening.', timestamp: [0.2, 1.4] },
        { text: 'Exactly meets existing start.', timestamp: [16.5, 18] },
        { text: 'Overlaps by one millisecond.', timestamp: [17, 18.001] },
        { text: 'Duplicates existing text.', timestamp: [18, 18.5] }
      ] })
    send({ type: 'transcribe', chunkId: 30, audio, durationMs: 25_000, language: 'english' })
    await waitForChunk(30)

    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    const retryAudio = mocks.transcribe.mock.calls[1][0] as Float32Array
    expect(retryAudio.buffer).toBe(audio.buffer)
    expect(retryAudio.byteOffset).toBe(2 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(retryAudio.length).toBe(18 * TRANSCRIPTION_SAMPLE_RATE)
    expect(audio).toEqual(originalAudio)
    expect(primary).toEqual(originalPrimary)
    expect(mocks.transcribe.mock.calls[1][1]).not.toHaveProperty('language')
    expect(mocks.transcribe.mock.calls[1][1]).not.toHaveProperty('task')
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 30, segments: [
      { id: 'recovery-web-segment-1', startMs: 2200, endMs: 3400, speakerId: '', text: 'Recovered opening.' },
      { id: 'recovery-web-segment-2', startMs: 18_500, endMs: 20_000, speakerId: '', text: 'Exactly meets existing start.' },
      { id: 'web-segment-1', startMs: 20_000, endMs: 22_000, speakerId: '', text: 'Existing first.' },
      { id: 'web-segment-2', startMs: 22_000, endMs: 25_000, speakerId: '', text: 'Existing second.' }
    ] })
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('combines a trimmed sound-window offset with recovery timestamps and prefixes IDs per piece', async () => {
    const audio = new Float32Array(20 * TRANSCRIPTION_SAMPLE_RATE)
    audio.fill(0.25, 3 * TRANSCRIPTION_SAMPLE_RATE, 15 * TRANSCRIPTION_SAMPLE_RATE)
    audio.fill(0.25, 17 * TRANSCRIPTION_SAMPLE_RATE, 19 * TRANSCRIPTION_SAMPLE_RATE)
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: 'Existing first piece.', timestamp: [8, 9] }] })
      .mockResolvedValueOnce({ chunks: [{ text: 'Recovered first piece.', timestamp: [0.25, 1.25] }] })
      .mockResolvedValueOnce({ chunks: [{ text: 'Second piece.', timestamp: [0.25, 1.25] }] })
    send({ type: 'transcribe', chunkId: 31, audio, durationMs: 20_000, language: 'english' })
    await waitForChunk(31)
    expect(mocks.transcribe).toHaveBeenCalledTimes(3)
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    const retryAudio = mocks.transcribe.mock.calls[1][0] as Float32Array
    expect(retryAudio.buffer).toBe(audio.buffer)
    expect(retryAudio.byteOffset).toBe(4.75 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(retryAudio.length).toBe(6 * TRANSCRIPTION_SAMPLE_RATE)
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 31, segments: [
      { id: 'piece-1-recovery-web-segment-1', startMs: 5000, endMs: 6000, speakerId: '', text: 'Recovered first piece.' },
      { id: 'piece-1-web-segment-1', startMs: 10_750, endMs: 11_750, speakerId: '', text: 'Existing first piece.' },
      { id: 'piece-2-web-segment-1', startMs: 17_000, endMs: 18_000, speakerId: '', text: 'Second piece.' }
    ] })
  })

  it('retries an empty English result at the exact eight-second threshold through the piece end', async () => {
    const audio = new Float32Array(8 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    mocks.transcribe
      .mockResolvedValueOnce({ text: '', chunks: [] })
      .mockResolvedValueOnce({ chunks: [{ text: 'Recovered tail.', timestamp: [0.25, null] }] })
    send({ type: 'transcribe', chunkId: 32, audio, durationMs: 8000, language: 'english' })
    await waitForChunk(32)
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    const retryAudio = mocks.transcribe.mock.calls[1][0] as Float32Array
    expect(retryAudio.buffer).toBe(audio.buffer)
    expect(retryAudio.byteOffset).toBe(2 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(retryAudio.length).toBe(6 * TRANSCRIPTION_SAMPLE_RATE)
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 32, segments: [
      { id: 'recovery-web-segment-1', startMs: 2250, endMs: 8000, speakerId: '', text: 'Recovered tail.' }
    ] })
  })

  it('stops after one empty English recovery attempt without recursion or invented text', async () => {
    mocks.transcribe.mockResolvedValue({ text: '', chunks: [] })
    send({ type: 'transcribe', chunkId: 33, audio: new Float32Array(12 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25), durationMs: 12_000, language: 'english' })
    await waitForChunk(33)
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 33, segments: [] })
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('ends the retry at the first known segment even when that segment starts near the piece end', async () => {
    const audio = new Float32Array(10 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: 'At the end.', timestamp: [9.9, 10] }] })
      .mockResolvedValueOnce({ text: '', chunks: [] })
    send({ type: 'transcribe', chunkId: 38, audio, durationMs: 10_000, language: 'english' })
    await waitForChunk(38)
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    const retryAudio = mocks.transcribe.mock.calls[1][0] as Float32Array
    expect(retryAudio.buffer).toBe(audio.buffer)
    expect(retryAudio.length).toBe(7.9 * TRANSCRIPTION_SAMPLE_RATE)
    expect(retryAudio.byteOffset + retryAudio.byteLength).toBe(9.9 * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT)
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 38, segments: [
      { id: 'web-segment-1', startMs: 9900, endMs: 10_000, speakerId: '', text: 'At the end.' }
    ] })
  })

  it('closes an open recovery endpoint at the exact missing-prefix end without replacing existing dialogue', async () => {
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: 'Existing dialogue.', timestamp: [8, 9] }] })
      .mockResolvedValueOnce({ chunks: [{ text: 'Recovered opening.', timestamp: [0.25, null] }] })
    send({ type: 'transcribe', chunkId: 40, audio: new Float32Array(10 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25), durationMs: 10_000, language: 'english' })
    await waitForChunk(40)
    expect(mocks.transcribe).toHaveBeenCalledTimes(2)
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 40, segments: [
      { id: 'recovery-web-segment-1', startMs: 2250, endMs: 8000, speakerId: '', text: 'Recovered opening.' },
      { id: 'web-segment-1', startMs: 8000, endMs: 9000, speakerId: '', text: 'Existing dialogue.' }
    ] })
  })

  it('allows one bounded retry for each eligible piece while reusing the same model', async () => {
    const audio = new Float32Array(22 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25)
    audio.fill(0, 10 * TRANSCRIPTION_SAMPLE_RATE, 12 * TRANSCRIPTION_SAMPLE_RATE)
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: 'First piece.', timestamp: [8, 9] }] })
      .mockResolvedValueOnce({ text: '', chunks: [] })
      .mockResolvedValueOnce({ chunks: [{ text: 'Second piece.', timestamp: [8, 9] }] })
      .mockResolvedValueOnce({ text: '', chunks: [] })
    send({ type: 'transcribe', chunkId: 39, audio, durationMs: 22_000, language: 'english' })
    await waitForChunk(39)
    expect(mocks.transcribe).toHaveBeenCalledTimes(4)
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 39, segments: [
      { id: 'piece-1-web-segment-1', startMs: 8000, endMs: 9000, speakerId: '', text: 'First piece.' },
      { id: 'piece-2-web-segment-1', startMs: 19_750, endMs: 20_750, speakerId: '', text: 'Second piece.' }
    ] })
  })

  it.each([
    { language: 'korean' as const, durationMs: 12_000, chunks: [{ text: '늦은 대사', timestamp: [8, 9] }] },
    { language: 'korean' as const, durationMs: 12_000, chunks: [] },
    { language: 'english' as const, durationMs: 8000, chunks: [{ text: 'Starts before threshold.', timestamp: [7.999, 8] }] },
    { language: 'english' as const, durationMs: 7999, chunks: [] }
  ])('does not recover Korean, short, or already covered English pieces (case %#)', async ({ language, durationMs, chunks }) => {
    mocks.transcribe.mockResolvedValue({ chunks })
    send({ type: 'transcribe', chunkId: 34, audio: new Float32Array(durationMs * TRANSCRIPTION_SAMPLE_RATE / 1000).fill(0.25), durationMs, language })
    await waitForChunk(34)
    expect(mocks.transcribe).toHaveBeenCalledOnce()
    expect(replies.some((reply) => reply.type === 'progress' && reply.progress.message.includes('앞부분'))).toBe(false)
  })

  it('does not load or retry the model for a long digitally silent English piece', async () => {
    send({ type: 'transcribe', chunkId: 35, audio: new Float32Array(12 * TRANSCRIPTION_SAMPLE_RATE), durationMs: 12_000, language: 'english' })
    await waitForChunk(35)
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(replies).toContainEqual({ type: 'chunk', chunkId: 35, segments: [] })
  })

  it('reports bounded monotonic recovery progress and defers queued disposal until the retry finishes', async () => {
    let finishRetry!: (output: unknown) => void
    mocks.transcribe
      .mockImplementationOnce(async (_audio, options) => {
        options.streamer.end()
        return { chunks: [{ text: 'Existing dialogue.', timestamp: [8, 9] }] }
      })
      .mockImplementationOnce((_audio, options) => {
        options.streamer.end()
        options.streamer.end()
        return new Promise((resolve) => { finishRetry = resolve })
      })
    send({ type: 'transcribe', chunkId: 36, audio: new Float32Array(12 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25), durationMs: 12_000, language: 'english' })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2))
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    expect(replies.some((reply) => reply.type === 'progress' && reply.progress.message.includes('앞부분'))).toBe(true)
    expect(progressValues().every((percent) => percent <= 97)).toBe(true)
    expect(progressValues()).toEqual([...progressValues()].sort((left, right) => left - right))
    send({ type: 'dispose' })
    await Promise.resolve()
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(replies).not.toContainEqual({ type: 'disposed' })
    finishRetry({ chunks: [{ text: 'Recovered dialogue.', timestamp: [0.25, 1.25] }] })
    await vi.waitFor(() => expect(replies).toContainEqual({ type: 'disposed' }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(progressValues().at(-1)).toBe(100)
    expect(progressValues().slice(0, -1).every((percent) => percent <= 97)).toBe(true)
    expect(progressValues()).toEqual([...progressValues()].sort((left, right) => left - right))
    expect(replies.filter((reply) => reply.type === 'chunk')).toHaveLength(1)
    expect(replies.findIndex((reply) => reply.type === 'chunk')).toBeLessThan(replies.findIndex((reply) => reply.type === 'disposed'))
  })

  it('discards the primary result and releases the pipeline when English recovery fails', async () => {
    let failRetry!: (error: Error) => void
    mocks.transcribe
      .mockResolvedValueOnce({ chunks: [{ text: 'Existing dialogue.', timestamp: [8, 9] }] })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failRetry = reject }))
    send({ type: 'transcribe', chunkId: 37, audio: new Float32Array(12 * TRANSCRIPTION_SAMPLE_RATE).fill(0.25), durationMs: 12_000, language: 'english' })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(2))
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    failRetry(new Error('recovery failed'))
    await vi.waitFor(() => expect(replies).toContainEqual({
      type: 'error', chunkId: 37, message: expect.stringContaining('음성 분석을 완료하지 못했습니다')
    }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(replies.some((reply) => reply.type === 'chunk')).toBe(false)
    expect(progressValues().every((percent) => percent <= 97)).toBe(true)
  })
})
