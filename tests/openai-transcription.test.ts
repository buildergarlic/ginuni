import { describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import {
  TranscriptionFailure,
  classifyOpenAiError,
  normalizeDiarizedResponse,
  shouldRetryWithAudioFallback,
  shouldRetryWithoutLanguage
} from '@main/services/openai-transcription'

function headers(): Headers {
  return new Headers({ 'x-request-id': 'req_safe_test' })
}

function apiBody(code: string | null, type = 'invalid_request_error', param?: string, message = '원문 서버 오류는 사용자 메시지에 포함되면 안 됩니다.'): Record<string, unknown> {
  return { code, type, param, message }
}

describe('classifyOpenAiError', () => {
  it.each([
    [new OpenAI.AuthenticationError(401, apiBody('invalid_api_key'), undefined, headers()), 'OPENAI_AUTHENTICATION', 401],
    [new OpenAI.PermissionDeniedError(403, apiBody('permission_denied'), undefined, headers()), 'OPENAI_PERMISSION_DENIED', 403],
    [new OpenAI.NotFoundError(404, apiBody('model_not_found'), undefined, headers()), 'OPENAI_MODEL_UNAVAILABLE', 404],
    [new OpenAI.BadRequestError(400, apiBody('invalid_request'), undefined, headers()), 'OPENAI_BAD_REQUEST', 400],
    [new OpenAI.UnprocessableEntityError(422, apiBody('unprocessable_entity'), undefined, headers()), 'OPENAI_UNPROCESSABLE_AUDIO', 422]
  ])('HTTP API 오류를 안전하게 분류한다', (source, code, status) => {
    const result = classifyOpenAiError(source)

    expect(result).toMatchObject({ code, status, requestId: 'req_safe_test', retryable: false })
    expect(result.message).not.toContain('원문 서버 오류')
  })

  it('400 오류의 코드·유형·파라미터·정제된 상세를 보존한다', () => {
    const source = new OpenAI.BadRequestError(
      400,
      apiBody('invalid_audio', 'invalid_request_error', 'file', 'cannot decode C:\\Users\\sample\\secret\\transcription.webm sk-proj-abcdefghijklmnop'),
      undefined,
      headers()
    )
    const result = classifyOpenAiError(source)

    expect(result).toMatchObject({
      code: 'OPENAI_UNPROCESSABLE_AUDIO',
      apiCode: 'invalid_audio',
      apiType: 'invalid_request_error',
      apiParam: 'file',
      status: 400,
      requestId: 'req_safe_test'
    })
    expect(result.apiDetail).not.toContain('sample')
    expect(result.apiDetail).not.toContain('sk-proj-')
  })

  it.each([
    ['file_too_large', 'OPENAI_AUDIO_TOO_LARGE', 'file', 'file exceeds 25 MB'],
    ['model_not_available', 'OPENAI_MODEL_UNAVAILABLE', 'model', 'model unavailable'],
    ['invalid_parameter', 'OPENAI_BAD_REQUEST', 'response_format', 'unsupported response format']
  ])('400 오류를 %s 유형으로 분류한다', (sourceCode, expectedCode, param, message) => {
    const source = new OpenAI.BadRequestError(400, apiBody(sourceCode, 'invalid_request_error', param, message), undefined, headers())
    expect(classifyOpenAiError(source)).toMatchObject({ code: expectedCode, apiParam: param, apiCode: sourceCode })
  })

  it.each([
    ['credit_balance_exhausted', 'OPENAI_CREDIT_BALANCE_EXHAUSTED'],
    ['organization_spend_limit_exceeded', 'OPENAI_ORGANIZATION_SPEND_LIMIT'],
    ['project_spend_limit_exceeded', 'OPENAI_PROJECT_SPEND_LIMIT'],
    ['organization_usage_limit_exceeded', 'OPENAI_ORGANIZATION_USAGE_LIMIT'],
    ['insufficient_quota', 'OPENAI_QUOTA_EXCEEDED']
  ])('결제·사용량 429 코드 %s를 일반 속도 제한과 구분한다', (sourceCode, expectedCode) => {
    const source = new OpenAI.RateLimitError(429, apiBody(sourceCode, 'insufficient_quota'), undefined, headers())
    expect(classifyOpenAiError(source)).toMatchObject({ code: expectedCode, retryable: false, status: 429 })
  })

  it('코드 없는 일반 429는 재시도 가능한 속도 제한으로 분류한다', () => {
    const source = new OpenAI.RateLimitError(429, apiBody(null, 'rate_limit_error'), undefined, headers())
    expect(classifyOpenAiError(source)).toMatchObject({ code: 'OPENAI_RATE_LIMIT', retryable: true })
  })

  it('연결 시간 초과와 일반 연결 실패를 구분한다', () => {
    expect(classifyOpenAiError(new OpenAI.APIConnectionTimeoutError())).toMatchObject({
      code: 'OPENAI_CONNECTION_TIMEOUT',
      retryable: true
    })
    expect(classifyOpenAiError(new OpenAI.APIConnectionError({}))).toMatchObject({
      code: 'OPENAI_CONNECTION',
      retryable: true
    })
  })

  it('5xx 오류는 요청 ID를 보존한 재시도 가능한 서버 오류다', () => {
    const source = new OpenAI.InternalServerError(503, apiBody('server_error'), undefined, headers())
    expect(classifyOpenAiError(source)).toMatchObject({
      code: 'OPENAI_SERVER',
      status: 503,
      requestId: 'req_safe_test',
      retryable: true
    })
  })

  it('알 수 없는 API 상태도 원문 없이 상태와 요청 ID를 보존한다', () => {
    const source = new OpenAI.ConflictError(409, apiBody('conflict'), undefined, headers())
    const result = classifyOpenAiError(source)

    expect(result).toMatchObject({
      code: 'OPENAI_UNKNOWN',
      status: 409,
      requestId: 'req_safe_test',
      retryable: false
    })
    expect(result.message).not.toContain('원문 서버 오류')
  })

  it.each([
    new OpenAI.APIUserAbortError(),
    new DOMException('중단', 'AbortError')
  ])('취소 오류를 별도 코드로 분류한다', (source) => {
    expect(classifyOpenAiError(source)).toMatchObject({ code: 'OPENAI_ABORTED', retryable: false })
  })

  it('이미 안전하게 분류한 오류는 그대로 유지한다', () => {
    const source = new TranscriptionFailure('OPENAI_RESPONSE_INVALID', '안전한 메시지')
    expect(classifyOpenAiError(source)).toBe(source)
  })

  it('화자 분리를 유지한 채 language 오류만 한 번 생략할 수 있다', () => {
    const languageError = classifyOpenAiError(new OpenAI.BadRequestError(400, apiBody('unsupported_parameter', 'invalid_request_error', 'language', 'language is not supported'), undefined, headers()))
    const audioError = classifyOpenAiError(new OpenAI.BadRequestError(400, apiBody('invalid_audio', 'invalid_request_error', 'file', 'decode failed'), undefined, headers()))
    expect(shouldRetryWithoutLanguage(languageError)).toBe(true)
    expect(shouldRetryWithoutLanguage(audioError)).toBe(false)
    expect(shouldRetryWithAudioFallback(audioError, 'transcription.webm', 60_000)).toBe(true)
    expect(shouldRetryWithAudioFallback(audioError, 'transcription.mp3', 60_000)).toBe(false)
    expect(shouldRetryWithAudioFallback(audioError, 'transcription.webm')).toBe(false)
  })
})

describe('normalizeDiarizedResponse', () => {
  it('segments가 누락된 응답을 성공으로 처리하지 않는다', () => {
    expect(() => normalizeDiarizedResponse({ text: '응답' })).toThrowError(
      expect.objectContaining({ code: 'OPENAI_RESPONSE_INVALID' })
    )
  })

  it('빈 segments는 목소리가 없는 정상 결과로 허용한다', () => {
    expect(normalizeDiarizedResponse({ segments: [] })).toEqual([])
  })

  it('화자와 초 단위 경계를 내부 형식으로 정규화한다', () => {
    const result = normalizeDiarizedResponse({
      segments: [
        { start: 1.25, end: 2.5, speaker: 'B', text: ' 첫 대사 ' },
        { start: 2.5, end: 3.75, speaker: 'A', text: '두 번째 대사' },
        { start: 4, end: 4, speaker: 'A', text: '잘못된 구간' }
      ]
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ startMs: 1250, endMs: 2500, speakerId: '화자1', text: '첫 대사' })
    expect(result[1]).toMatchObject({ startMs: 2500, endMs: 3750, speakerId: '화자2', text: '두 번째 대사' })
  })
})
