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

export async function runtimeExecutable(name: 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'deno' | 'whisper-cli' | 'sherpa-diarizer'): Promise<string> {
  const executable = name === 'whisper-cli'
    ? join('whisper', 'whisper-cli.exe')
    : name === 'sherpa-diarizer'
      ? join('sherpa', 'sherpa-onnx-offline-speaker-diarization.exe')
      : `${name}.exe`
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', executable) : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'bin', executable),
    name === 'whisper-cli' ? 'whisper-cli.exe' : executable
  ])
}

export async function diarizationModelPath(name: 'segmentation' | 'embedding'): Promise<string> {
  const fileName = name === 'segmentation' ? 'pyannote-segmentation-3.0.int8.onnx' : '3dspeaker-eres2net-base-16k.onnx'
  const relativePath = join('sherpa', 'models', fileName)
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', relativePath) : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'bin', relativePath)
  ])
}

export async function diarizationRuntimeLibraryPath(name: 'onnxruntime' | 'providers'): Promise<string> {
  const fileName = name === 'onnxruntime' ? 'onnxruntime.dll' : 'onnxruntime_providers_shared.dll'
  const relativePath = join('sherpa', fileName)
  const packagedPath = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', relativePath) : null
  return existingPath([
    ...(packagedPath ? [packagedPath] : []),
    resolve('resources', 'bin', relativePath)
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
    { name: 'vad-model' },
    { name: 'sherpa-diarizer', executable: 'sherpa-diarizer', args: ['--help'] },
    { name: 'diarization-segmentation-model' },
    { name: 'diarization-embedding-model' }
  ]
  const result: RuntimeDiagnostic[] = []
  for (const check of checks) {
    if (!check.executable) {
      try {
        if (check.name === 'vad-model') await access(await whisperVadModelPath())
        else if (check.name === 'diarization-segmentation-model') await access(await diarizationModelPath('segmentation'))
        else await access(await diarizationModelPath('embedding'))
        result.push({ name: check.name, available: true, runnable: true })
      } catch (error) {
        result.push({ name: check.name, available: false, runnable: false, detail: sanitizeDiagnosticText(error) })
      }
      continue
    }
    try {
      const executable = await runtimeExecutable(check.executable as 'ffmpeg' | 'ffprobe' | 'whisper-cli' | 'sherpa-diarizer')
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
