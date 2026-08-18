import { spawn } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
}

export function runProcess(
  executable: string,
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (value: string) => void; onStderr?: (value: string) => void } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    const abort = (): void => {
      child.kill('SIGTERM')
      reject(new DOMException('작업이 취소되었습니다.', 'AbortError'))
    }
    if (options.signal?.aborted) return abort()
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
    child.on('error', reject)
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${executable} 실행에 실패했습니다. (종료 코드 ${code})`))
    })
  })
}
