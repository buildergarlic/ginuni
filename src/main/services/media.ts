import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { MAX_DURATION_MS, MAX_UPLOAD_BYTES, TARGET_UPLOAD_BYTES } from '@shared/constants'
import type { ProcessingProgress, ScriptProject, TranscriptionEngine } from '@shared/types'
import { runProcess } from './process-runner'
import { runtimeExecutable } from './runtime'

interface ProbeResult {
  format?: { duration?: string }
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>
}

interface YouTubeMetadata {
  id: string
  title: string
  duration: number
  is_live?: boolean
}

// The default android_vr client can expose audio URLs that YouTube rejects
// without a GVS PO token. Public embedded playback uses web_embedded, which
// works without account cookies and matches the review player's support scope.
const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player_client=web_embedded'

function ensureYouTubeUrl(value: string): void {
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) throw new Error('공개 또는 일부공개 유튜브 링크만 지원합니다.')
}

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function probe(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
  const ffprobe = await runtimeExecutable('ffprobe')
  const { stdout } = await runProcess(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], { signal })
  return JSON.parse(stdout) as ProbeResult
}

function durationFromProbe(value: ProbeResult): number {
  const durationMs = Math.round(Number(value.format?.duration ?? 0) * 1000)
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('영상 길이를 확인할 수 없습니다.')
  if (durationMs > MAX_DURATION_MS) throw new Error('첫 버전은 3시간 이하 영상만 지원합니다.')
  return durationMs
}

function opusBitrate(durationMs: number): number {
  const durationSeconds = Math.max(1, durationMs / 1000)
  const safeBits = Math.floor((TARGET_UPLOAD_BYTES * 8) / durationSeconds)
  const bitrate = Math.min(24_000, Math.floor(safeBits / 1000) * 1000)
  if (bitrate < 12_000) throw new Error('25MB 제한 안에서 전사 가능한 음질을 유지할 수 없습니다.')
  return bitrate
}

async function youtubeMetadata(url: string, signal?: AbortSignal): Promise<YouTubeMetadata> {
  ensureYouTubeUrl(url)
  const ytdlp = await runtimeExecutable('yt-dlp')
  const deno = await runtimeExecutable('deno')
  const { stdout } = await runProcess(ytdlp, ['--js-runtimes', `deno:${deno}`, '--extractor-args', YOUTUBE_EXTRACTOR_ARGS, '--dump-single-json', '--no-playlist', '--no-warnings', url], { signal })
  const metadata = JSON.parse(stdout) as YouTubeMetadata
  if (metadata.is_live) throw new Error('실시간 방송은 지원하지 않습니다.')
  if (!metadata.duration || metadata.duration * 1000 > MAX_DURATION_MS) throw new Error('첫 버전은 3시간 이하 영상만 지원합니다.')
  return metadata
}

async function downloadYouTubeAudio(url: string, mediaDirectory: string, signal?: AbortSignal): Promise<string> {
  const ytdlp = await runtimeExecutable('yt-dlp')
  const deno = await runtimeExecutable('deno')
  const outputTemplate = join(mediaDirectory, 'youtube-source.%(ext)s')
  await runProcess(ytdlp, ['--js-runtimes', `deno:${deno}`, '--extractor-args', YOUTUBE_EXTRACTOR_ARGS, '-f', 'bestaudio/best', '--no-playlist', '--no-progress', '--no-warnings', '-o', outputTemplate, url], { signal })
  const candidates = (await readdir(mediaDirectory))
    .filter((file) => file.startsWith('youtube-source.'))
    .map((file) => join(mediaDirectory, file))
  if (candidates.length === 0) throw new Error('유튜브 음성을 내려받지 못했습니다.')
  return candidates[0]
}

export async function prepareMedia(options: {
  project: ScriptProject
  projectDirectory: string
  engine: TranscriptionEngine
  signal?: AbortSignal
  progress: (progress: Omit<ProcessingProgress, 'projectId'>) => void
}): Promise<ScriptProject> {
  const { project, projectDirectory, engine, signal, progress } = options
  const mediaDirectory = join(projectDirectory, 'media')
  await mkdir(mediaDirectory, { recursive: true })
  let sourcePath: string

  if (project.source.kind === 'youtube') {
    progress({ stage: 'downloading', percent: 8, message: '유튜브 영상 정보를 확인하고 있습니다.' })
    const metadata = await youtubeMetadata(project.source.uri, signal)
    project.title = metadata.title
    project.source.displayName = metadata.title
    project.source.youtubeVideoId = metadata.id
    project.media.durationMs = Math.round(metadata.duration * 1000)
    progress({ stage: 'downloading', percent: 15, message: '전사용 음성을 내려받고 있습니다.' })
    sourcePath = await downloadYouTubeAudio(project.source.uri, mediaDirectory, signal)
  } else {
    sourcePath = project.source.localMediaPath ?? project.source.uri
    progress({ stage: 'probing', percent: 8, message: '영상 정보를 확인하고 있습니다.' })
    const details = await probe(sourcePath, signal)
    project.media.durationMs = durationFromProbe(details)
    const video = details.streams?.find((stream) => stream.codec_type === 'video')
    project.media.width = video?.width
    project.media.height = video?.height
    project.source.sha256 = await sha256(sourcePath)
  }

  const local = engine === 'local'
  const audioPath = join(mediaDirectory, local ? 'transcription-local.wav' : 'transcription.webm')
  progress({ stage: 'encoding', percent: 25, message: local ? '로컬 분석용 음성을 변환하고 있습니다.' : '음성을 전사에 알맞게 변환하고 있습니다.' })
  const ffmpeg = await runtimeExecutable('ffmpeg')
  const encodingArgs = local
    ? ['-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath]
    : (() => {
        const bitrate = opusBitrate(project.media.durationMs)
        return ['-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', String(bitrate), '-vbr', 'off', '-application', 'voip', audioPath]
      })()
  await runProcess(ffmpeg, encodingArgs, { signal })

  const audioBytes = (await stat(audioPath)).size
  if (!local && audioBytes > MAX_UPLOAD_BYTES) throw new Error('전사용 음성이 24.5MB를 초과했습니다.')
  project.media.audioPath = audioPath
  project.media.audioBytes = audioBytes
  return project
}

export function localMediaDisplayName(filePath: string): string {
  return basename(filePath, extname(filePath))
}
