import { describe, expect, it } from 'vitest'
import { classifyProcessFailure, LocalProcessingError, sanitizeDiagnosticText } from '@main/services/processing-errors'
import { ProcessExecutionError, runProcess } from '@main/services/process-runner'

describe('로컬 처리 오류 진단', () => {
  it('Windows 실행 파일 차단·CPU 비호환 종료 코드를 분류한다', () => {
    const blocked = classifyProcessFailure(new ProcessExecutionError('ffprobe.exe', { stdout: '', stderr: '', exitCode: -1073741515 }), 'runtime')
    expect(blocked.code).toBe('RUNTIME_BLOCKED')
    const illegalInstruction = classifyProcessFailure(new ProcessExecutionError('whisper-cli.exe', { stdout: '', stderr: '', exitCode: -1073741795 }), 'transcription')
    expect(illegalInstruction.code).toBe('UNSUPPORTED_ARCHITECTURE')
  })

  it('경로와 API 키가 진단 문자열에서 제거된다', () => {
    const value = sanitizeDiagnosticText('C:\\Users\\sample\\secret\\video.mp4 sk-proj-abcdefghijklmnop')
    expect(value).not.toContain('sample')
    expect(value).not.toContain('sk-proj-')
    expect(value).toContain('[redacted-path]')
  })

  it('단계별 실행 오류에 안전한 사용자 메시지를 만든다', () => {
    const error = classifyProcessFailure(new ProcessExecutionError('ffmpeg.exe', { stdout: '', stderr: 'invalid media stream', exitCode: 1 }), 'encoding')
    expect(error).toBeInstanceOf(LocalProcessingError)
    expect(error.code).toBe('FFMPEG_FAILED')
    expect(error.message).toContain('변환')
  })
})

describe('프로세스 실행 결과', () => {
  it('stdout·stderr·종료 코드를 보존한다', async () => {
    await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("ok"); process.stderr.write("bad"); process.exit(7)']))
      .rejects.toMatchObject({ result: { stdout: 'ok', stderr: 'bad', exitCode: 7 } })
  })
})
