import { app } from 'electron'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RuntimeDiagnostic } from '@shared/types'
import { ProcessExecutionError, runProcess } from './process-runner'
import { sanitizeDiagnosticText } from './processing-errors'

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
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', executable) : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'bin', executable),
    name === 'whisper-cli' ? 'whisper-cli.exe' : executable
  ])
}

export async function whisperVadModelPath(): Promise<string> {
  const relativePath = join('whisper', 'ggml-silero-v6.2.0.bin')
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', relativePath) : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'bin', relativePath)
  ])
}

export async function templatePath(): Promise<string> {
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'templates', 'screen-description-template.hwpx') : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'templates', 'screen-description-template.hwpx')
  ])
}

export function appVersion(): string {
  return app.getVersion()
}

export async function runtimeDiagnostics(): Promise<RuntimeDiagnostic[]> {
  const checks: Array<{ name: RuntimeDiagnostic['name']; executable?: string; args?: string[] }> = [
    { name: 'ffmpeg', executable: 'ffmpeg', args: ['-version'] },
    { name: 'ffprobe', executable: 'ffprobe', args: ['-version'] },
    { name: 'whisper-cli', executable: 'whisper-cli', args: ['--help'] },
    { name: 'vad-model' }
  ]
  const result: RuntimeDiagnostic[] = []
  for (const check of checks) {
    if (!check.executable) {
      try {
        await whisperVadModelPath()
        result.push({ name: check.name, available: true, runnable: true })
      } catch (error) {
        result.push({ name: check.name, available: false, runnable: false, detail: sanitizeDiagnosticText(error) })
      }
      continue
    }
    try {
      const executable = await runtimeExecutable(check.executable as 'ffmpeg' | 'ffprobe' | 'whisper-cli')
      const run = await runProcess(executable, check.args ?? [])
      result.push({ name: check.name, available: true, runnable: run.exitCode === 0 })
    } catch (error) {
      const detail = error instanceof ProcessExecutionError
        ? sanitizeDiagnosticText(`${error.spawnError ?? ''} ${error.result.stderr}`)
        : sanitizeDiagnosticText(error)
      result.push({ name: check.name, available: false, runnable: false, detail })
    }
  }
  return result
}
