import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import OpenAI from 'openai'

const audioState = vi.hoisted(() => {
  const state = { fallbackPath: '' }
  return {
    inspectOpenAiAudio: vi.fn(async (path: string) => ({ extension: path.endsWith('.mp3') ? '.mp3' : '.webm', bytes: 100, durationMs: 60_000, codec: 'opus', sampleRate: 48_000, channels: 1 })),
    reencodeOpenAiAudio: vi.fn(async () => ({ path: state.fallbackPath, info: { extension: '.mp3', bytes: 80, durationMs: 60_000, codec: 'mp3', sampleRate: 16_000, channels: 1 } })),
    state
  }
})
vi.mock('@main/services/openai-audio', () => audioState)

import { OpenAiTranscriptionProvider } from '@main/services/openai-transcription'

let tempDirectory = ''
let inputPath = ''

function clientReturning(responses: Response[]): { client: OpenAI; calls: number } {
  let calls = 0
  const client = new OpenAI({
    apiKey: 'sk-test-placeholder',
    maxRetries: 0,
    fetch: async () => responses[calls++] ?? responses.at(-1)!
  })
  return { client, get calls() { return calls } }
}

function badRequest(code: string, param: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, type: 'invalid_request_error', param, message } }), {
    status: 400,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_retry_test' }
  })
}

function success(): Response {
  return new Response(JSON.stringify({ segments: [{ start: 0, end: 1, speaker: 'A', text: '테스트 대사' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('OpenAI 전사 조건부 재시도', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-openai-retry-'))
    inputPath = join(tempDirectory, 'transcription.webm')
    audioState.state.fallbackPath = join(tempDirectory, 'transcription-openai-fallback.mp3')
    await writeFile(inputPath, Buffer.from('webm'))
    await writeFile(audioState.state.fallbackPath, Buffer.from('mp3'))
    audioState.inspectOpenAiAudio.mockClear()
    audioState.reencodeOpenAiAudio.mockClear()
  })

  afterEach(async () => {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
    tempDirectory = ''
  })

  it('오디오 오류에서만 MP3로 한 번 재시도하고 화자 분리를 유지한다', async () => {
    const holder = clientReturning([badRequest('invalid_audio', 'file', 'cannot decode audio'), success()])
    const provider = new OpenAiTranscriptionProvider('sk-test-placeholder', holder.client)

    await expect(provider.transcribe({ audioPath: inputPath, language: 'ko', durationMs: 60_000 })).resolves.toMatchObject([
      { startMs: 0, endMs: 1000, speakerId: '화자1', text: '테스트 대사' }
    ])
    expect(holder.calls).toBe(2)
    expect(audioState.reencodeOpenAiAudio).toHaveBeenCalledTimes(1)
  })

  it('language 오류에서는 같은 화자 분리 요청에서 language만 한 번 생략한다', async () => {
    const holder = clientReturning([badRequest('unsupported_parameter', 'language', 'language is not supported'), success()])
    const provider = new OpenAiTranscriptionProvider('sk-test-placeholder', holder.client)

    await expect(provider.transcribe({ audioPath: inputPath, language: 'ko', durationMs: 60_000 })).resolves.toHaveLength(1)
    expect(holder.calls).toBe(2)
    expect(audioState.reencodeOpenAiAudio).not.toHaveBeenCalled()
  })

  it('일반 400에서는 모델을 바꾸거나 재시도하지 않는다', async () => {
    const holder = clientReturning([badRequest('invalid_parameter', 'response_format', 'unsupported response format')])
    const provider = new OpenAiTranscriptionProvider('sk-test-placeholder', holder.client)

    await expect(provider.transcribe({ audioPath: inputPath, language: 'ko', durationMs: 60_000 })).rejects.toMatchObject({
      code: 'OPENAI_BAD_REQUEST',
      apiParam: 'response_format',
      requestId: 'req_retry_test'
    })
    expect(holder.calls).toBe(1)
    expect(audioState.reencodeOpenAiAudio).not.toHaveBeenCalled()
  })
})
