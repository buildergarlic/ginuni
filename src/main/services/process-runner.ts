import { spawn } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  signal?: string
}

export class ProcessExecutionError extends Error {
  constructor(
    readonly executable: string,
    readonly result: RunResult,
    readonly spawnError?: string
  ) {
    super(`${executable} 실행에 실패했습니다.`)
    this.name = 'ProcessExecutionError'
  }
}

export function runProcess(
  executable: string,
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (value: string) => void; onStderr?: (value: string) => void } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new ProcessExecutionError(executable, { stdout: '', stderr: '', exitCode: -1 }, error instanceof Error ? error.message : String(error)))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (error?: Error, result?: RunResult): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result!)
    }

    const abort = (): void => {
      child.kill('SIGTERM')
      finish(new DOMException('작업이 취소되었습니다.', 'AbortError'))
    }
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      const value = chunk.toString('utf8')
      stdout += value
      options.onStdout?.(value)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const value = chunk.toString('utf8')
      stderr += value
      options.onStderr?.(value)
    })
    child.on('error', (error) => finish(new ProcessExecutionError(executable, { stdout, stderr, exitCode: -1 }, error.message)))
    child.on('close', (code, signal) => {
      const result: RunResult = { stdout, stderr, exitCode: code ?? -1, signal: signal ?? undefined }
      if (code === 0) finish(undefined, result)
      else finish(new ProcessExecutionError(executable, result))
    })
  })
}
