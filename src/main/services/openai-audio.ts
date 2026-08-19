import { stat } from 'node:fs/promises'
import { extname, dirname, join } from 'node:path'
import { MAX_UPLOAD_BYTES, TARGET_UPLOAD_BYTES } from '@shared/constants'
import type { OpenAiAudioInfo } from '@shared/types'
import { runtimeExecutable } from './runtime'
import { runProcess } from './process-runner'

interface ProbeResult {
  format?: { duration?: string }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    sample_rate?: string
    channels?: number
  }>
}

export type OpenAiAudioValidationCode = 'OPENAI_AUDIO_TOO_LARGE' | 'OPENAI_UNPROCESSABLE_AUDIO'

export class OpenAiAudioValidationError extends Error {
  readonly code: OpenAiAudioValidationCode
  readonly audioInfo?: OpenAiAudioInfo

  constructor(code: OpenAiAudioValidationCode, message: string, audioInfo?: OpenAiAudioInfo) {
    super(message)
    this.name = 'OpenAiAudioValidationError'
    this.code = code
    this.audioInfo = audioInfo
  }
}

function extensionFor(path: string): string | undefined {
  const extension = extname(path).toLowerCase()
  return extension || undefined
}

function audioInfoFromProbe(path: string, bytes: number, value: ProbeResult): OpenAiAudioInfo {
  const audio = value.streams?.find((stream) => stream.codec_type === 'audio')
  const durationMs = Math.round(Number(value.format?.duration ?? 0) * 1000)
  return {
    extension: extensionFor(path),
    bytes,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
    codec: audio?.codec_name,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    channels: audio?.channels
  }
}

export async function inspectOpenAiAudio(audioPath: string, signal?: AbortSignal): Promise<OpenAiAudioInfo> {
  let bytes: number
  try {
    bytes = (await stat(audioPath)).size
  } catch {
    throw new OpenAiAudioValidationError('OPENAI_UNPROCESSABLE_AUDIO', 'OpenAI로 보낼 음성 파일을 읽을 수 없습니다.')
  }

  if (bytes <= 0) {
    throw new OpenAiAudioValidationError('OPENAI_UNPROCESSABLE_AUDIO', 'OpenAI로 보낼 음성 파일이 비어 있습니다.', { extension: extensionFor(audioPath), bytes })
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new OpenAiAudioValidationError('OPENAI_AUDIO_TOO_LARGE', 'OpenAI 음성 파일이 25MB 제한을 초과했습니다.', { extension: extensionFor(audioPath), bytes })
  }

  let probe: ProbeResult
  try {
    const ffprobe = await runtimeExecutable('ffprobe')
    const result = await runProcess(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', audioPath], { signal })
    probe = JSON.parse(result.stdout) as ProbeResult
  } catch {
    throw new OpenAiAudioValidationError('OPENAI_UNPROCESSABLE_AUDIO', 'OpenAI로 보낼 음성 형식을 확인할 수 없습니다.', { extension: extensionFor(audioPath), bytes })
  }

  const info = audioInfoFromProbe(audioPath, bytes, probe)
  if (!probe.streams?.some((stream) => stream.codec_type === 'audio') || !info.durationMs) {
    throw new OpenAiAudioValidationError('OPENAI_UNPROCESSABLE_AUDIO', 'OpenAI로 보낼 음성 스트림 또는 재생 시간을 확인할 수 없습니다.', info)
  }
  return info
}

function uploadBitrate(durationMs: number): number {
  const durationSeconds = Math.max(1, durationMs / 1000)
  const safeBits = Math.floor((TARGET_UPLOAD_BYTES * 8) / durationSeconds)
  const bitrate = Math.min(24_000, Math.floor(safeBits / 1000) * 1000)
  if (bitrate < 12_000) throw new OpenAiAudioValidationError('OPENAI_AUDIO_TOO_LARGE', '영상 길이가 OpenAI 25MB 제한 안에서 처리 가능한 범위를 초과했습니다.')
  return bitrate
}

export async function reencodeOpenAiAudio(audioPath: string, durationMs: number, signal?: AbortSignal): Promise<{ path: string; info: OpenAiAudioInfo }> {
  const outputPath = join(dirname(audioPath), 'transcription-openai-fallback.mp3')
  const bitrate = uploadBitrate(durationMs)
  try {
    const ffmpeg = await runtimeExecutable('ffmpeg')
    await runProcess(ffmpeg, [
      '-y', '-i', audioPath, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', String(bitrate), '-write_xing', '0', outputPath
    ], { signal })
  } catch {
    throw new OpenAiAudioValidationError('OPENAI_UNPROCESSABLE_AUDIO', 'OpenAI용 MP3 음성으로 다시 변환하지 못했습니다.')
  }

  const info = await inspectOpenAiAudio(outputPath, signal)
  return { path: outputPath, info }
}
