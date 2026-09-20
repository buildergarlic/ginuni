import { ALL_FORMATS, HLS, AudioBufferSink, BlobSource, Input } from 'mediabunny'
import {
  FALLBACK_MAX_MEDIA_BYTES, FALLBACK_MAX_MEDIA_DURATION_MS,
  MAX_MEDIA_DURATION_MS, TRANSCRIPTION_CHUNK_MS, TRANSCRIPTION_CONTEXT_MS,
  TRANSCRIPTION_MAX_CHUNK_MS, TRANSCRIPTION_SAMPLE_RATE,
  validateMediaDuration, validateMediaSize, type BrowserTranscriptSegment
} from './transcription-types'

export const MEDIA_SOURCE_CACHE_BYTES = 8 * 1024 * 1024
const CODEC_ERROR = '이 브라우저에서 파일의 오디오를 분할해서 읽을 수 없습니다. 최신 Chrome·Edge에서 열거나 AAC 음성이 포함된 MP4, MP3 또는 WAV로 변환해 주세요.'

export interface MediaChunkRange {
  id: number
  startMs: number
  endMs: number
  contentStartMs: number
  contentEndMs: number
}

export interface MediaChunks {
  durationMs: number
  ranges: MediaChunkRange[]
  readChunk(range: MediaChunkRange): Promise<Float32Array>
  dispose(): void
}

interface AudioTimeline { startMs: number; endMs: number }

/** WebAudio may return either trimmed samples or a buffer with the container's leading silence. */
export function fallbackAudioOffset(decodedMs: number, mediaMs: number, timeline?: AudioTimeline): number {
  const toleranceMs = 200 // Codec padding may slightly change decoded length.
  if (!timeline) {
    if (Math.abs(decodedMs - mediaMs) > toleranceMs) throw new Error('파일의 음성 시작 시간을 확인할 수 없습니다. 최신 Chrome·Edge에서 열거나 WAV로 변환해 주세요.')
    return 0
  }
  const startMs = Math.max(0, timeline.startMs)
  const trimmedDifference = Math.abs(decodedMs - (timeline.endMs - startMs))
  const paddedDifference = Math.abs(decodedMs - timeline.endMs)
  if (Math.min(trimmedDifference, paddedDifference) > toleranceMs) {
    throw new Error('파일의 음성 시간 정보가 맞지 않습니다. 최신 Chrome·Edge에서 열거나 WAV로 변환해 주세요.')
  }
  return trimmedDifference < paddedDifference ? startMs : 0
}

export function abortError(): DOMException {
  return new DOMException('음성 분석을 취소했습니다.', 'AbortError')
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value) },
      error => { signal.removeEventListener('abort', abort); if (!signal.aborted) reject(error) }
    )
    if (signal.aborted) abort()
  })
}

/** Each minute owns its midpoint timestamps; two seconds on either side supply speech context. */
export function planMediaChunks(durationMs: number): MediaChunkRange[] {
  validateMediaDuration(durationMs)
  const ranges: MediaChunkRange[] = []
  for (let offset = 0; offset < durationMs; offset += TRANSCRIPTION_CHUNK_MS) {
    ranges.push({
      id: ranges.length,
      startMs: Math.max(0, offset - TRANSCRIPTION_CONTEXT_MS),
      endMs: Math.min(durationMs, offset + TRANSCRIPTION_CHUNK_MS + TRANSCRIPTION_CONTEXT_MS),
      contentStartMs: offset,
      contentEndMs: Math.min(durationMs, offset + TRANSCRIPTION_CHUNK_MS)
    })
  }
  return ranges
}

/** Restore original media timestamps and discard only overlapping context duplicates. */
export function appendChunkTranscript(
  previous: BrowserTranscriptSegment[], local: BrowserTranscriptSegment[], range: MediaChunkRange
): BrowserTranscriptSegment[] {
  const accepted = local.flatMap(segment => {
    const startMs = Math.max(range.startMs, range.startMs + segment.startMs)
    const endMs = Math.min(range.endMs, range.startMs + segment.endMs)
    const midpoint = (startMs + endMs) / 2
    if (endMs <= startMs || midpoint < range.contentStartMs || midpoint >= range.contentEndMs) return []
    return [{ ...segment, id: `web-chunk-${range.id + 1}-${segment.id}`, startMs, endMs }]
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const merged = previous.map(segment => ({ ...segment }))
  const textKey = (text: string) => text.replace(/[\s\p{P}]/gu, '').toLowerCase()
  for (const segment of accepted) {
    const last = merged.at(-1)
    if (last && segment.startMs < last.endMs) {
      if (textKey(last.text) === textKey(segment.text)) {
        last.endMs = Math.max(last.endMs, segment.endMs)
        const warnings = [...new Set([...(last.warningCodes ?? []), ...(segment.warningCodes ?? [])])]
        if (warnings.length) last.warningCodes = warnings
        if (last.retryCount !== undefined || segment.retryCount !== undefined)
          last.retryCount = Math.max(last.retryCount ?? 0, segment.retryCount ?? 0)
        const originals = [...new Set([last.originalText, segment.originalText].filter((text): text is string => text !== undefined))]
        if (originals.length) last.originalText = originals.join('\n\n')
        continue
      }
      // Separate slightly overlapping boundary estimates without deleting either utterance.
      const boundary = Math.max(last.startMs + 1, Math.min(segment.endMs - 1, Math.round((last.endMs + segment.startMs) / 2)))
      last.endMs = boundary
      segment.startMs = boundary
    }
    if (segment.endMs > segment.startMs) merged.push(segment)
  }
  return merged
}

/** Browser metadata is used only for the small-file codec fallback, never to read a large file. */
async function readBrowserDuration(file: File, signal?: AbortSignal): Promise<number> {
  checkAborted(signal)
  return new Promise((resolve, reject) => {
    const media = document.createElement('video')
    const url = URL.createObjectURL(file)
    let finished = false
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      const durationMs = media.duration * 1000
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      media.onloadedmetadata = media.onerror = null
      media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url)
      if (error) reject(error)
      else { try { validateMediaDuration(durationMs); resolve(durationMs) } catch (cause) { reject(cause) } }
    }
    const onAbort = (): void => finish(abortError())
    const timeout = setTimeout(() => finish(new Error(CODEC_ERROR)), 15_000)
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish()
    media.onerror = () => finish(new Error(CODEC_ERROR))
    signal?.addEventListener('abort', onAbort, { once: true })
    media.src = url; media.load()
    if (signal?.aborted) onAbort()
  })
}

/** Decode at most one context window. Source nodes never outlive that window. */
export async function renderAudioWindow(
  range: MediaChunkRange,
  buffers: AsyncIterable<{ buffer: AudioBuffer; timestamp: number }>,
  signal?: AbortSignal
): Promise<Float32Array> {
  checkAborted(signal)
  const durationMs = range.endMs - range.startMs
  if (durationMs <= 0 || durationMs > TRANSCRIPTION_MAX_CHUNK_MS) throw new Error('분할 음성 구간의 길이가 올바르지 않습니다.')
  const context = new OfflineAudioContext(1, Math.ceil(durationMs * TRANSCRIPTION_SAMPLE_RATE / 1000), TRANSCRIPTION_SAMPLE_RATE)
  const sources: AudioBufferSourceNode[] = []
  const iterator = buffers[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await abortable(iterator.next(), signal)
      if (next.done) break
      checkAborted(signal)
      const { buffer, timestamp } = next.value
      const offset = Math.max(0, range.startMs / 1000 - timestamp)
      const at = Math.max(0, timestamp - range.startMs / 1000)
      const length = Math.min(buffer.duration - offset, durationMs / 1000 - at)
      if (length <= 0) continue
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start(at, offset, length)
      sources.push(source)
    }
    // Native OfflineAudioContext performs band-limited resampling and channel downmixing.
    const rendered = await abortable(context.startRendering(), signal)
    checkAborted(signal)
    return rendered.getChannelData(0).slice()
  } finally {
    for (const source of sources) { source.disconnect(); source.buffer = null }
    // The iterator releases its decoder; on abort Input.dispose also interrupts pending reads.
    void iterator.return?.().catch(() => undefined)
    // OfflineAudioContext has no close(); it closes itself after rendering.
  }
}

export async function openMediaChunks(file: File, signal?: AbortSignal): Promise<MediaChunks> {
  checkAborted(signal)
  validateMediaSize(file.size)
  if (typeof OfflineAudioContext === 'undefined') throw new Error(CODEC_ERROR)
  // Exclude network playlists: only the selected local file is read.
  const input = new Input({ formats: ALL_FORMATS.filter(format => format !== HLS), source: new BlobSource(file, { maxCacheSize: MEDIA_SOURCE_CACHE_BYTES }) })
  let disposed = false
  let durationMs: number | undefined
  let audioTimeline: AudioTimeline | undefined
  const dispose = (): void => { if (!disposed) { disposed = true; input.dispose(); signal?.removeEventListener('abort', dispose) } }
  signal?.addEventListener('abort', dispose, { once: true })
  try {
    // Use all tracks, preserving a delayed/shorter audio track's position in the full video.
    durationMs = Math.round(await abortable(input.computeDuration(), signal) * 1000)
    validateMediaDuration(durationMs)
    const track = await abortable(input.getPrimaryAudioTrack(), signal)
    if (!track) throw new Error('선택한 파일에 오디오 트랙이 없습니다.')
    audioTimeline = {
      startMs: await abortable(track.getFirstTimestamp(), signal) * 1000,
      endMs: await abortable(track.computeDuration(), signal) * 1000
    }
    if (!await abortable(track.canDecode(), signal)) throw new Error(CODEC_ERROR)
    const sink = new AudioBufferSink(track)
    let reading = false
    return {
      durationMs, ranges: planMediaChunks(durationMs), dispose,
      async readChunk(range) {
        checkAborted(signal)
        if (disposed || reading) throw new Error('음성 구간을 순서대로 읽어야 합니다.')
        reading = true
        try {
          // Include the packet preceding the window, then trim it by its original timestamp.
          return await renderAudioWindow(range, sink.buffers(Math.max(0, range.startMs / 1000 - 1), range.endMs / 1000), signal)
        } finally { reading = false }
      }
    }
  } catch (error) {
    dispose()
    checkAborted(signal)
    if ((durationMs !== undefined && durationMs > MAX_MEDIA_DURATION_MS) || (error instanceof Error && error.message.includes('오디오 트랙이 없습니다'))) throw error
    // A legacy browser decoder is safe only for a small, short clip. Large media never calls arrayBuffer().
    if (file.size > FALLBACK_MAX_MEDIA_BYTES || typeof AudioContext === 'undefined') throw new Error(CODEC_ERROR, { cause: error })
    const fallbackDuration = durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs : await readBrowserDuration(file, signal)
    if (fallbackDuration > FALLBACK_MAX_MEDIA_DURATION_MS) throw new Error(CODEC_ERROR, { cause: error })
    return openSmallMediaFallback(file, signal, fallbackDuration, audioTimeline)
  }
}

async function openSmallMediaFallback(file: File, signal: AbortSignal | undefined, mediaDurationMs: number, timeline?: AudioTimeline): Promise<MediaChunks> {
  checkAborted(signal)
  const context = new AudioContext({ sampleRate: TRANSCRIPTION_SAMPLE_RATE })
  let decoded: AudioBuffer | null = null
  try {
    decoded = await abortable(context.decodeAudioData(await abortable(file.arrayBuffer(), signal)), signal)
    checkAborted(signal)
    validateMediaDuration(decoded.duration * 1000)
    if (decoded.duration * 1000 > FALLBACK_MAX_MEDIA_DURATION_MS) throw new Error(CODEC_ERROR)
  } finally {
    if (context.state !== 'closed') await context.close().catch(() => undefined)
  }
  const offsetMs = fallbackAudioOffset(decoded.duration * 1000, mediaDurationMs, timeline)
  const durationMs = mediaDurationMs
  const dispose = (): void => { decoded = null; signal?.removeEventListener('abort', dispose) }
  signal?.addEventListener('abort', dispose, { once: true })
  return {
    durationMs, ranges: planMediaChunks(durationMs), dispose,
    async readChunk(range) {
      checkAborted(signal)
      const audio = decoded
      if (!audio) throw new Error('음성 읽기가 종료되었습니다.')
      return renderAudioWindow(range, (async function* () { yield { buffer: audio, timestamp: offsetMs / 1000 } })(), signal)
    }
  }
}
