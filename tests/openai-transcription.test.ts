import { describe, expect, it } from 'vitest'
import OpenAI from 'openai'
import {
  TranscriptionFailure,
  classifyOpenAiError,
  normalizeDiarizedResponse
} from '@main/services/openai-transcription'

function headers(): Headers {
  return new Headers({ 'x-request-id': 'req_safe_test' })
}

function apiBody(code: string | null, type = 'invalid_request_error'): Record<string, unknown> {
  return { code, type, message: '원문 서버 오류는 사용자 메시지에 포함되면 안 됩니다.' }
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
