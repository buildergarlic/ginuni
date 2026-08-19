import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import OpenAI from 'openai'
import { OPENAI_MODEL } from '@shared/constants'
import type { OpenAiAudioInfo, OpenAiRequestInfo, TranscriptSegment, TranscriptionProvider, TranscriptionRequest } from '@shared/types'
import { sanitizeDiagnosticText } from './processing-errors'
import { inspectOpenAiAudio, OpenAiAudioValidationError, reencodeOpenAiAudio } from './openai-audio'

interface DiarizedSegment {
  start?: number
  end?: number
  speaker?: string
  text?: string
}

export type TranscriptionFailureCode =
  | 'OPENAI_ABORTED'
  | 'OPENAI_API_KEY_MISSING'
  | 'OPENAI_AUTHENTICATION'
  | 'OPENAI_PERMISSION_DENIED'
  | 'OPENAI_MODEL_UNAVAILABLE'
  | 'OPENAI_BAD_REQUEST'
  | 'OPENAI_AUDIO_TOO_LARGE'
  | 'OPENAI_UNPROCESSABLE_AUDIO'
  | 'OPENAI_CREDIT_BALANCE_EXHAUSTED'
  | 'OPENAI_ORGANIZATION_SPEND_LIMIT'
  | 'OPENAI_PROJECT_SPEND_LIMIT'
  | 'OPENAI_ORGANIZATION_USAGE_LIMIT'
  | 'OPENAI_QUOTA_EXCEEDED'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_CONNECTION_TIMEOUT'
  | 'OPENAI_CONNECTION'
  | 'OPENAI_SERVER'
  | 'OPENAI_RESPONSE_INVALID'
  | 'OPENAI_UNKNOWN'

interface TranscriptionFailureOptions {
  status?: number
  requestId?: string
  retryable?: boolean
  apiCode?: string
  apiType?: string
  apiParam?: string
  apiDetail?: string
  audioInfo?: OpenAiAudioInfo
  requestInfo?: OpenAiRequestInfo
}

interface SafeApiErrorMetadata {
  status?: number
  requestID?: string | null
  code?: string | null
  type?: string | null
  param?: string | null
  message?: string | null
}

/**
 * 전사 실패를 프로젝트에 안전하게 기록하기 위한 오류입니다.
 * API 키, 파일명, 대사 또는 서버의 원문 오류 메시지는 포함하지 않습니다.
 */
export class TranscriptionFailure extends Error {
  readonly code: TranscriptionFailureCode
  readonly status?: number
  readonly requestId?: string
  readonly retryable: boolean
  readonly apiCode?: string
  readonly apiType?: string
  readonly apiParam?: string
  readonly apiDetail?: string
  readonly audioInfo?: OpenAiAudioInfo
  readonly requestInfo?: OpenAiRequestInfo

  constructor(code: TranscriptionFailureCode, message: string, options: TranscriptionFailureOptions = {}) {
    super(message)
    this.name = 'TranscriptionFailure'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
    this.retryable = options.retryable ?? false
    this.apiCode = options.apiCode
    this.apiType = options.apiType
    this.apiParam = options.apiParam
    this.apiDetail = options.apiDetail
    this.audioInfo = options.audioInfo
    this.requestInfo = options.requestInfo
  }
}

function apiFailure(
  error: SafeApiErrorMetadata,
  code: TranscriptionFailureCode,
  message: string,
  retryable = false
): TranscriptionFailure {
  return new TranscriptionFailure(code, message, {
    status: error.status,
    requestId: error.requestID || undefined,
    retryable,
    apiCode: error.code || undefined,
    apiType: error.type || undefined,
    apiParam: error.param || undefined,
    apiDetail: sanitizeDiagnosticText(error.message, 600)
  })
}

function apiMetadata(error: unknown): SafeApiErrorMetadata {
  if (!error || typeof error !== 'object') return {}
  const value = error as Partial<SafeApiErrorMetadata>
  return {
    status: typeof value.status === 'number' ? value.status : undefined,
    requestID: typeof value.requestID === 'string' ? value.requestID : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    param: typeof value.param === 'string' ? value.param : undefined,
    message: typeof value.message === 'string' ? value.message : undefined
  }
}

/** OpenAI SDK 오류를 사용자용 안전한 메시지와 진단 가능한 코드로 변환합니다. */
export function classifyOpenAiError(error: unknown): TranscriptionFailure {
  if (error instanceof TranscriptionFailure) return error

  if (
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return new TranscriptionFailure('OPENAI_ABORTED', '작업이 취소되었습니다.')
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return apiFailure(
      error,
      'OPENAI_CONNECTION_TIMEOUT',
      'OpenAI 응답 시간이 초과되었습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.',
      true
    )
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return apiFailure(
      error,
      'OPENAI_CONNECTION',
      'OpenAI 서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.',
      true
    )
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return apiFailure(
      error,
      'OPENAI_AUTHENTICATION',
      'OpenAI API 키가 올바르지 않거나 이 프로젝트에서 사용할 수 없습니다.'
    )
  }

  if (error instanceof OpenAI.PermissionDeniedError) {
    return apiFailure(
      error,
      'OPENAI_PERMISSION_DENIED',
      '이 API 키에는 OpenAI 음성 전사 권한이 없습니다.'
    )
  }

  if (error instanceof OpenAI.NotFoundError) {
    return apiFailure(
      error,
      'OPENAI_MODEL_UNAVAILABLE',
      '선택한 OpenAI 음성 전사 모델을 사용할 수 없습니다.'
    )
  }

  if (error instanceof OpenAI.BadRequestError) {
    const metadata = apiMetadata(error)
    const haystack = `${metadata.code ?? ''} ${metadata.type ?? ''} ${metadata.param ?? ''} ${metadata.message ?? ''}`.toLowerCase()
    if (metadata.code?.toLowerCase().includes('size') || /25\s*mb|too large|file size|payload too large/.test(haystack)) {
      return apiFailure(
        error,
        'OPENAI_AUDIO_TOO_LARGE',
        'OpenAI로 보낼 음성 파일이 25MB 제한을 초과했습니다.'
      )
    }
    if (metadata.param === 'model' || metadata.code?.toLowerCase().includes('model')) {
      return apiFailure(
        error,
        'OPENAI_MODEL_UNAVAILABLE',
        '현재 API 키 또는 프로젝트에서 OpenAI 음성 모델을 사용할 수 없습니다.'
      )
    }
    if (['language', 'response_format', 'chunking_strategy'].includes(metadata.param ?? '')) {
      return apiFailure(
        error,
        'OPENAI_BAD_REQUEST',
        'OpenAI 전사 요청의 파라미터가 현재 모델 요구사항과 맞지 않습니다.'
      )
    }
    if (
      metadata.code?.toLowerCase().includes('file') ||
      metadata.param === 'file' ||
      /audio|decode|codec|empty|readable|media|audio format/.test(haystack)
    ) {
      return apiFailure(
        error,
        'OPENAI_UNPROCESSABLE_AUDIO',
        'OpenAI가 업로드 음성의 형식이나 내용을 읽지 못했습니다. 오디오 형식을 바꿔 한 번 다시 시도합니다.'
      )
    }
    return apiFailure(
      error,
      'OPENAI_BAD_REQUEST',
      'OpenAI가 전사 요청을 거부했습니다. 아래 오류 코드와 문제 파라미터를 확인하세요.'
    )
  }

  if (error instanceof OpenAI.UnprocessableEntityError) {
    return apiFailure(
      error,
      'OPENAI_UNPROCESSABLE_AUDIO',
      'OpenAI가 음성 파일을 처리할 수 없습니다. 다른 형식의 영상으로 다시 시도하세요.'
    )
  }

  if (error instanceof OpenAI.RateLimitError) {
    switch (error.code) {
      case 'credit_balance_exhausted':
        return apiFailure(
          error,
          'OPENAI_CREDIT_BALANCE_EXHAUSTED',
          'OpenAI API 크레딧이 없습니다. API 결제 설정에서 크레딧을 추가하세요.'
        )
      case 'organization_spend_limit_exceeded':
        return apiFailure(
          error,
          'OPENAI_ORGANIZATION_SPEND_LIMIT',
          'OpenAI 조직의 지출 한도에 도달했습니다. 조직 결제 한도를 확인하세요.'
        )
      case 'project_spend_limit_exceeded':
        return apiFailure(
          error,
          'OPENAI_PROJECT_SPEND_LIMIT',
          'OpenAI 프로젝트의 지출 한도에 도달했습니다. 프로젝트 결제 한도를 확인하세요.'
        )
      case 'organization_usage_limit_exceeded':
        return apiFailure(
          error,
          'OPENAI_ORGANIZATION_USAGE_LIMIT',
          'OpenAI 조직의 사용 한도에 도달했습니다. 조직 사용 한도를 확인하세요.'
        )
      case 'insufficient_quota':
        return apiFailure(
          error,
          'OPENAI_QUOTA_EXCEEDED',
          'OpenAI API 사용 가능 금액 또는 한도가 없습니다. API 결제 설정을 확인하세요.'
        )
      default:
        if (error.type === 'insufficient_quota') {
          return apiFailure(
            error,
            'OPENAI_QUOTA_EXCEEDED',
            'OpenAI API 사용 가능 금액 또는 한도가 없습니다. API 결제 설정을 확인하세요.'
          )
        }
        return apiFailure(
          error,
          'OPENAI_RATE_LIMIT',
          'OpenAI 요청 속도 제한에 도달했습니다. 잠시 후 다시 시도하세요.',
          true
        )
    }
  }

  if (error instanceof OpenAI.APIError && typeof error.status === 'number' && error.status >= 500) {
    return apiFailure(
      error,
      'OPENAI_SERVER',
      'OpenAI 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도하세요.',
      true
    )
  }

  if (error instanceof OpenAI.APIError) {
    return apiFailure(
      error,
      'OPENAI_UNKNOWN',
      '음성 전사에 실패했습니다. 잠시 후 다시 시도하세요.'
    )
  }

  return new TranscriptionFailure(
    'OPENAI_UNKNOWN',
    '음성 전사에 실패했습니다. 잠시 후 다시 시도하세요.'
  )
}

export function normalizeDiarizedResponse(response: unknown): TranscriptSegment[] {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('segments' in response) ||
    !Array.isArray(response.segments)
  ) {
    throw new TranscriptionFailure(
      'OPENAI_RESPONSE_INVALID',
      'OpenAI 전사 결과의 형식을 확인할 수 없습니다. 앱을 최신 버전으로 업데이트한 뒤 다시 시도하세요.'
    )
  }

  const speakerMap = new Map<string, string>()
  const speakerName = (raw: string): string => {
    if (!speakerMap.has(raw)) speakerMap.set(raw, `화자${speakerMap.size + 1}`)
    return speakerMap.get(raw)!
  }

  return (response.segments as DiarizedSegment[])
    .filter((segment) => (
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.end! > segment.start! &&
      Boolean(segment.text?.trim())
    ))
    .map((segment) => ({
      id: randomUUID(),
      startMs: Math.max(0, Math.round(segment.start! * 1000)),
      endMs: Math.max(0, Math.round(segment.end! * 1000)),
      speakerId: speakerName(segment.speaker || 'A'),
      text: segment.text!.trim()
    }))
}

export function shouldRetryWithoutLanguage(failure: TranscriptionFailure): boolean {
  return failure.apiParam === 'language' || /(?:language|언어).*(?:unsupported|not supported|unknown|invalid|지원하지|허용되지)/i.test(failure.apiDetail ?? '')
}

export function shouldRetryWithAudioFallback(failure: TranscriptionFailure, audioPath: string, durationMs?: number): boolean {
  return failure.code === 'OPENAI_UNPROCESSABLE_AUDIO' && Boolean(durationMs) && !/\.mp3$/i.test(audioPath)
}

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string, private readonly injectedClient?: OpenAI) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptSegment[]> {
    const client = this.injectedClient ?? new OpenAI({ apiKey: this.apiKey })
    const initialRequestInfo: OpenAiRequestInfo = {
      model: OPENAI_MODEL,
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
      language: request.language
    }
    let audioInfo: OpenAiAudioInfo | undefined

    try {
      audioInfo = await inspectOpenAiAudio(request.audioPath, request.signal)
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
      if (error instanceof OpenAiAudioValidationError) {
        throw new TranscriptionFailure(
          error.code,
          error.message,
          { audioInfo: error.audioInfo, requestInfo: initialRequestInfo }
        )
      }
      throw new TranscriptionFailure(
        'OPENAI_UNPROCESSABLE_AUDIO',
        'OpenAI로 보낼 음성 형식을 확인하지 못했습니다.',
        { requestInfo: initialRequestInfo }
      )
    }

    const send = async (audioPath: string, includeLanguage: boolean, currentAudioInfo: OpenAiAudioInfo): Promise<TranscriptSegment[]> => {
      const requestInfo: OpenAiRequestInfo = {
        model: OPENAI_MODEL,
        responseFormat: 'diarized_json',
        chunkingStrategy: 'auto',
        ...(includeLanguage ? { language: request.language } : {})
      }
      try {
        const response = await client.audio.transcriptions.create(
          {
            file: createReadStream(audioPath),
            model: OPENAI_MODEL,
            response_format: 'diarized_json',
            chunking_strategy: 'auto',
            ...(includeLanguage ? { language: request.language } : {})
          },
          { signal: request.signal }
        )

        return normalizeDiarizedResponse(response)
      } catch (error) {
        if (request.signal?.aborted) {
          throw new TranscriptionFailure('OPENAI_ABORTED', '작업이 취소되었습니다.')
        }
        const failure = classifyOpenAiError(error)
        // The request context is safe metadata only; the audio itself is never recorded.
        Object.assign(failure, { audioInfo: currentAudioInfo, requestInfo })
        throw failure
      }
    }

    try {
      return await send(request.audioPath, true, audioInfo)
    } catch (error) {
      const failure = error instanceof TranscriptionFailure ? error : classifyOpenAiError(error)
      if (request.signal?.aborted || failure.code === 'OPENAI_ABORTED') throw failure

      // Some deployments reject the optional language field even though the model
      // supports it. Retry once without that field while preserving diarization.
      if (shouldRetryWithoutLanguage(failure)) {
        return await send(request.audioPath, false, audioInfo)
      }

      // Keep the diarized model. Only retry with a broadly decodable audio format
      // when the server explicitly points to the uploaded audio.
      if (
        shouldRetryWithAudioFallback(failure, request.audioPath, request.durationMs)
      ) {
        let fallback: { path: string; info: OpenAiAudioInfo }
        try {
          fallback = await reencodeOpenAiAudio(request.audioPath, request.durationMs!, request.signal)
        } catch (conversionError) {
          if (conversionError instanceof OpenAiAudioValidationError) {
            throw new TranscriptionFailure(
              conversionError.code,
              conversionError.message,
              {
                apiCode: failure.apiCode,
                apiType: failure.apiType,
                apiParam: failure.apiParam,
                apiDetail: failure.apiDetail,
                status: failure.status,
                requestId: failure.requestId,
                audioInfo: conversionError.audioInfo ?? audioInfo,
                requestInfo: failure.requestInfo
              }
            )
          }
          throw failure
        }
        return await send(fallback.path, true, fallback.info)
      }

      throw failure
    }
  }
}
