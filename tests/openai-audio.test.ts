import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES } from '@shared/constants'

const processState = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('@main/services/runtime', () => ({ runtimeExecutable: vi.fn(async (name: string) => name) }))
vi.mock('@main/services/process-runner', () => ({ runProcess: processState.runProcess }))

import { inspectOpenAiAudio, OpenAiAudioValidationError, reencodeOpenAiAudio } from '@main/services/openai-audio'

let tempDirectory = ''

const probeJson = JSON.stringify({
  format: { duration: '60.000' },
  streams: [{ codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: 1 }]
})

beforeEach(() => {
  processState.runProcess.mockImplementation(async (_executable: string, args: string[]) => {
    if (args.includes('libmp3lame')) await writeFile(args.at(-1)!, Buffer.from('mp3'))
    return { stdout: probeJson, stderr: '', exitCode: 0 }
  })
})

afterEach(async () => {
  processState.runProcess.mockReset()
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

describe('OpenAI 업로드 음성 검증', () => {
  it('오디오 스트림·코덱·길이·크기를 안전한 메타데이터로 읽는다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-openai-audio-'))
    const input = join(tempDirectory, 'transcription.webm')
    await writeFile(input, Buffer.from('webm'))

    await expect(inspectOpenAiAudio(input)).resolves.toMatchObject({
      extension: '.webm',
      bytes: 4,
      durationMs: 60_000,
      codec: 'opus',
      sampleRate: 48_000,
      channels: 1
    })
  })

  it('업로드 음성이 25MB를 넘으면 API 호출 전에 차단한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-openai-audio-'))
    const input = join(tempDirectory, 'too-large.webm')
    await writeFile(input, Buffer.alloc(MAX_UPLOAD_BYTES + 1))

    await expect(inspectOpenAiAudio(input)).rejects.toMatchObject({
      code: 'OPENAI_AUDIO_TOO_LARGE',
      audioInfo: { bytes: MAX_UPLOAD_BYTES + 1 }
    })
    expect(processState.runProcess).not.toHaveBeenCalled()
  })

  it('WebM을 16kHz 모노 MP3로 재인코딩하고 결과도 다시 검증한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-openai-audio-'))
    const input = join(tempDirectory, 'transcription.webm')
    await writeFile(input, Buffer.from('webm'))

    const result = await reencodeOpenAiAudio(input, 60_000)

    expect(result.path).toMatch(/transcription-openai-fallback\.mp3$/)
    expect(result.info).toMatchObject({ extension: '.mp3', durationMs: 60_000, codec: 'opus' })
    expect(processState.runProcess).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame']),
      expect.anything()
    )
  })

  it('오디오 스트림이 없으면 OpenAI 음성 오류로 분류한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-openai-audio-'))
    const input = join(tempDirectory, 'invalid.webm')
    await writeFile(input, Buffer.from('invalid'))
    processState.runProcess.mockResolvedValue({ stdout: JSON.stringify({ format: { duration: '60' }, streams: [] }), stderr: '', exitCode: 0 })

    await expect(inspectOpenAiAudio(input)).rejects.toBeInstanceOf(OpenAiAudioValidationError)
    await expect(inspectOpenAiAudio(input)).rejects.toMatchObject({ code: 'OPENAI_UNPROCESSABLE_AUDIO' })
  })
})
