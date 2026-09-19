import { openAsBlob } from 'node:fs'
import { mkdtemp, open, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendChunkTranscript, fallbackAudioOffset, openMediaChunks, planMediaChunks, renderAudioWindow } from '../src/web/media-chunks'
import { TRANSCRIPTION_MAX_CHUNK_MS, TRANSCRIPTION_SAMPLE_RATE } from '../src/web/transcription-types'
import type { TranscriptSegment } from '../src/shared/types'

describe('automatic media chunk planning and recombination', () => {
  it('covers a three-hour movie without gaps using bounded windows and context', () => {
    const duration = 3 * 60 * 60_000
    const ranges = planMediaChunks(duration)
    expect(ranges).toHaveLength(180)
    expect(ranges[0]).toMatchObject({ startMs: 0, endMs: 62_000, contentStartMs: 0, contentEndMs: 60_000 })
    expect(ranges.at(-1)?.endMs).toBe(duration)
    for (const [index, range] of ranges.entries()) {
      expect(range.endMs - range.startMs).toBeLessThanOrEqual(TRANSCRIPTION_MAX_CHUNK_MS)
      if (index) expect(range.contentStartMs).toBe(ranges[index - 1].contentEndMs)
    }
    expect(planMediaChunks(60_001).at(-1)).toMatchObject({ startMs: 58_000, contentStartMs: 60_000, endMs: 60_001 })
  })

  const line = (startMs: number, endMs: number, text = '경계 문장'): TranscriptSegment => ({ id: 'same-local-id', startMs, endMs, text, speakerId: '' })

  it('keeps a sentence straddling the minute boundary exactly once at its original timestamp', () => {
    const [first, second] = planMediaChunks(125_000)
    const initial = appendChunkTranscript([], [line(58_000, 62_000)], first)
    expect(initial).toEqual([])
    const merged = appendChunkTranscript(initial, [line(0, 4000)], second)
    expect(merged).toEqual([{ ...line(58_000, 62_000), id: 'web-chunk-2-same-local-id' }])
  })

  it('deduplicates overlapping boundary estimates and retains both different utterances without overlapping times', () => {
    const [first, second] = planMediaChunks(125_000)
    const initial = appendChunkTranscript([], [line(58_000, 61_500)], first)
    expect(initial).toHaveLength(1)
    const deduplicated = appendChunkTranscript(initial, [line(500, 4000, '경계 문장.')], second)
    expect(deduplicated).toHaveLength(1)
    expect(deduplicated[0].endMs).toBe(62_000)
    const different = appendChunkTranscript(initial, [line(1000, 5000, '다른 문장')], second)
    expect(different.map(item => item.text)).toEqual(['경계 문장', '다른 문장'])
    expect(different[0].endMs).toBe(different[1].startMs)
    expect(initial[0].endMs).toBe(61_500) // Caller state remains untouched.
  })

  it('does not collapse repeated words at separate times or shift a delayed soundtrack to zero', () => {
    const range = planMediaChunks(370_000).at(-1)!
    const merged = appendChunkTranscript([], [line(2500, 3000, '네'), { ...line(4500, 5000, '네'), id: 'two' }], range)
    expect(merged.map(item => item.startMs)).toEqual([360_500, 362_500])
    expect(new Set(merged.map(item => item.id)).size).toBe(2)
  })

  it('preserves known delayed or shorter soundtracks in the legacy fallback, including already-padded audio', () => {
    expect(fallbackAudioOffset(8000, 20_000, { startMs: 5000, endMs: 13_000 })).toBe(5000)
    expect(fallbackAudioOffset(13_000, 20_000, { startMs: 5000, endMs: 13_000 })).toBe(0)
    expect(fallbackAudioOffset(8015, 20_000, { startMs: 5000, endMs: 13_000 })).toBe(5000)
    expect(fallbackAudioOffset(8000, 20_000, { startMs: 0, endMs: 8000 })).toBe(0)
    expect(() => fallbackAudioOffset(8000, 20_000)).toThrow('시작 시간을 확인')
    expect(() => fallbackAudioOffset(2000, 20_000, { startMs: 5000, endMs: 13_000 })).toThrow('시간 정보가 맞지')
  })
})

describe('bounded media decode', () => {
  const contexts: FakeOfflineContext[] = []
  let directory: string | undefined
  let mediaPath: string | undefined

  class FakeAudioBuffer {
    readonly data: Float32Array[]
    readonly numberOfChannels: number
    readonly length: number
    readonly sampleRate: number
    constructor(options: AudioBufferOptions) {
      this.numberOfChannels = options.numberOfChannels ?? 1
      this.length = options.length
      this.sampleRate = options.sampleRate
      this.data = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length))
    }
    get duration(): number { return this.length / this.sampleRate }
    getChannelData(channel: number): Float32Array { return this.data[channel] }
    copyToChannel(data: Float32Array, channel: number): void { this.data[channel].set(data) }
  }

  class FakeOfflineContext {
    destination = {}
    sources: { buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
    longestInputSeconds = 0
    nonzeroInput = false
    constructor(readonly channels: number, readonly frames: number, readonly rate: number) { contexts.push(this) }
    createBufferSource() {
      const source = {
        buffer: null as AudioBuffer | null, connect: vi.fn(), disconnect: vi.fn(),
        start: vi.fn(() => {
          this.longestInputSeconds = Math.max(this.longestInputSeconds, source.buffer?.duration ?? 0)
          this.nonzeroInput ||= source.buffer?.getChannelData(0).some(value => Math.abs(value) > 0.5) ?? false
        })
      }
      this.sources.push(source)
      return source
    }
    async startRendering() { return new FakeAudioBuffer({ length: this.frames, sampleRate: this.rate }) }
  }

  beforeEach(() => {
    contexts.length = 0
    vi.stubGlobal('AudioBuffer', FakeAudioBuffer)
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext)
  })
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals()
    if (mediaPath) await rm(mediaPath)
    if (directory) await rmdir(directory)
    mediaPath = directory = undefined
  })

  it('uses real ranged WAV demux/decode for a >100MB six-minute file without ever reading the whole file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'ginuni-range-audio-'))
    mediaPath = join(directory, 'large.wav')
    const duration = 366
    const rate = 96_000
    const dataBytes = duration * rate * 2 * 2
    const header = Buffer.alloc(44)
    header.write('RIFF'); header.writeUInt32LE(dataBytes + 36, 4); header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28)
    header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(dataBytes, 40)
    const handle = await open(mediaPath, 'w')
    try {
      await handle.write(header)
      await handle.truncate(44 + dataBytes) // Sparse on supported filesystems; no huge JS allocation.
      await handle.write(Buffer.from([255, 127, 255, 127]), 0, 4, 44 + 361 * rate * 4)
    } finally { await handle.close() }
    const file = await openAsBlob(mediaPath, { type: 'audio/wav' })
    const wholeRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole-file read forbidden'))
    const media = await openMediaChunks(file as File)
    try {
      expect(file.size).toBeGreaterThan(100 * 1024 ** 2)
      expect(media.durationMs).toBe(366_000)
      expect(media.ranges).toHaveLength(7)
      expect(contexts).toHaveLength(0) // Opening metadata does not allocate a PCM movie.
      const first = await media.readChunk(media.ranges[0])
      expect(first.length).toBe(62 * TRANSCRIPTION_SAMPLE_RATE)
      expect(contexts[0].nonzeroInput).toBe(false)
      const last = await media.readChunk(media.ranges.at(-1)!)
      expect(last.length).toBe(8 * TRANSCRIPTION_SAMPLE_RATE)
      expect(contexts[1].nonzeroInput).toBe(true) // PCM marker at original second 361 really decoded.
      expect(wholeRead).not.toHaveBeenCalled()
      for (const context of contexts) {
        expect(context.frames).toBeLessThanOrEqual(TRANSCRIPTION_MAX_CHUNK_MS * 16)
        expect(context.longestInputSeconds).toBeLessThan(64)
        for (const source of context.sources) {
          expect(source.disconnect).toHaveBeenCalledOnce()
          expect(source.buffer).toBeNull()
        }
      }
    } finally { media.dispose() }
  }, 20_000)

  it('pads a delayed source with silence and crops the decoder packet preceding the window', async () => {
    const range = planMediaChunks(125_000)[1] // Window 58-122.
    const buffer = new FakeAudioBuffer({ length: 4 * 48_000, sampleRate: 48_000 }) as unknown as AudioBuffer
    await renderAudioWindow(range, (async function* () {
      yield { buffer, timestamp: 57 }
      yield { buffer, timestamp: 70 }
    })())
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(0, 1, 3)
    expect(contexts[0].sources[1].start).toHaveBeenCalledWith(12, 0, 4)
    expect(contexts[0].frames).toBe(64 * TRANSCRIPTION_SAMPLE_RATE)
  })

  it('aborts an in-flight packet read promptly without allocating a second window', async () => {
    const controller = new AbortController()
    let finish!: (value: IteratorResult<{ buffer: AudioBuffer; timestamp: number }>) => void
    const iterator = { next: vi.fn(() => new Promise<IteratorResult<{ buffer: AudioBuffer; timestamp: number }>>(resolve => { finish = resolve })), return: vi.fn(async () => ({ done: true as const, value: undefined })) }
    const pending = renderAudioWindow(planMediaChunks(1000)[0], { [Symbol.asyncIterator]: () => iterator }, controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    finish({ done: true, value: undefined })
    expect(iterator.return).toHaveBeenCalledOnce()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].sources).toHaveLength(0)
  })

  it('never falls back to a whole-file read for a large unsupported container', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'unsupported.bin')
    Object.defineProperty(file, 'size', { value: 101 * 1024 ** 2 })
    const read = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole-file read forbidden'))
    await expect(openMediaChunks(file)).rejects.toThrow('분할해서 읽을 수 없습니다')
    expect(read).not.toHaveBeenCalled()
    expect(contexts).toHaveLength(0)
  })

  function installFallback(metadataSeconds: number, decoding: Promise<AudioBuffer>) {
    const close = vi.fn(async () => undefined)
    const decodeAudioData = vi.fn(() => decoding)
    class LegacyContext { state = 'running'; close = close; decodeAudioData = decodeAudioData }
    class LegacyMedia {
      duration = metadataSeconds
      src = ''
      onloadedmetadata: (() => void) | null = null
      onerror: (() => void) | null = null
      removeAttribute(): void { this.src = '' }
      load(): void { if (this.src) queueMicrotask(() => this.onloadedmetadata?.()) }
    }
    vi.stubGlobal('AudioContext', LegacyContext)
    vi.stubGlobal('document', { createElement: () => new LegacyMedia() })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    return { close, decodeAudioData }
  }

  it('retains the small-file codec fallback with decoder and local URL cleanup', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'legacy.audio')
    const decoded = new FakeAudioBuffer({ length: 32_000, sampleRate: 16_000 }) as unknown as AudioBuffer
    const { close, decodeAudioData } = installFallback(2, Promise.resolve(decoded))
    const read = vi.spyOn(file, 'arrayBuffer')
    const media = await openMediaChunks(file)
    try {
      expect(media.durationMs).toBe(2000)
      expect(await media.readChunk(media.ranges[0])).toHaveLength(32_000)
      expect(read).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(decodeAudioData).toHaveBeenCalledOnce()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fallback')
    } finally { media.dispose() }
  })

  it('refuses legacy whole-file decoding above five minutes before reading or decoding', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'legacy.audio')
    const { decodeAudioData } = installFallback(301, Promise.resolve({ duration: 301 } as AudioBuffer))
    const read = vi.spyOn(file, 'arrayBuffer')
    await expect(openMediaChunks(file)).rejects.toThrow('분할해서 읽을 수 없습니다')
    expect(read).not.toHaveBeenCalled()
    expect(decodeAudioData).not.toHaveBeenCalled()
  })

  it('cancels a pending legacy decode promptly, closes its context and ignores later completion', async () => {
    let complete!: (buffer: AudioBuffer) => void
    const decoding = new Promise<AudioBuffer>(resolve => { complete = resolve })
    const { close, decodeAudioData } = installFallback(2, decoding)
    const controller = new AbortController()
    const pending = openMediaChunks(new File([new Uint8Array([1, 2, 3])], 'legacy.audio'), controller.signal)
    await vi.waitFor(() => expect(decodeAudioData).toHaveBeenCalledOnce())
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(close).toHaveBeenCalledOnce()
    complete({ duration: 2 } as AudioBuffer)
    await Promise.resolve()
    expect(contexts).toHaveLength(0)
  })
})
