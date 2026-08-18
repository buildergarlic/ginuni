import { app } from 'electron'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

async function existingPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // 다음 후보를 확인한다.
    }
  }
  return candidates.at(-1)!
}

export async function runtimeExecutable(name: 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'deno' | 'whisper-cli'): Promise<string> {
  const executable = name === 'whisper-cli' ? join('whisper', 'whisper-cli.exe') : `${name}.exe`
  return existingPath([
    join(process.resourcesPath, 'bin', executable),
    resolve('resources', 'bin', executable),
    name === 'whisper-cli' ? 'whisper-cli.exe' : executable
  ])
}

export async function whisperVadModelPath(): Promise<string> {
  const relativePath = join('whisper', 'ggml-silero-v6.2.0.bin')
  return existingPath([
    join(process.resourcesPath, 'bin', relativePath),
    resolve('resources', 'bin', relativePath)
  ])
}

export async function templatePath(): Promise<string> {
  return existingPath([
    join(process.resourcesPath, 'templates', 'screen-description-template.hwpx'),
    resolve('resources', 'templates', 'screen-description-template.hwpx')
  ])
}

export function appVersion(): string {
  return app.getVersion()
}
