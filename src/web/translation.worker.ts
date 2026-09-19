import { env, pipeline, TextStreamer, type TranslationPipeline } from '@huggingface/transformers'
import { TRANSLATION_LANGUAGE_CODES } from './languages'
import { splitTranslationText } from './translation-chunks'
import {
  TRANSLATION_MAX_INPUT_TOKENS,
  TRANSLATION_MAX_OUTPUT_TOKENS,
  TRANSLATION_MAX_ROW_CHARACTERS,
  TRANSLATION_MAX_ROWS,
  TRANSLATION_MODEL,
  TRANSLATION_MODEL_REVISION,
  type TranslatedDialogue,
  type TranslationWorkerRequest,
  type TranslationWorkerResponse
} from './translation-types'

// Public model weights are downloaded; dialogue text stays in this worker.
env.allowLocalModels = false
env.useBrowserCache = true
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TranslationWorkerRequest>) => void) | null
  postMessage: (message: TranslationWorkerResponse) => void
}

class TranslationInputError extends Error {}
let translator: TranslationPipeline | undefined

async function disposeTranslator(): Promise<void> {
  const loaded = translator
  translator = undefined
  await loaded?.dispose()
}

async function handleRequest(data: TranslationWorkerRequest): Promise<void> {
  let stage: 'validating' | 'loading' | 'translating' | 'disposing' = 'validating'
  let lastPercent = -1
  let lastMessage = ''
  const report = (percent: number, message: string, complete = false): void => {
    const next = Math.max(lastPercent, Math.min(complete ? 100 : 97, Math.round(percent)))
    if (next === lastPercent && message === lastMessage) return
    lastPercent = next
    lastMessage = message
    scope.postMessage({ type: 'progress', progress: { percent: next, message } })
  }

  try {
    if (data.type === 'dispose') {
      stage = 'disposing'
      await disposeTranslator()
      scope.postMessage({ type: 'disposed' })
      return
    }
    if (data.type !== 'translate' || !TRANSLATION_LANGUAGE_CODES.includes(data.sourceLanguage)) {
      throw new TranslationInputError('번역할 원문 언어를 다시 선택해 주세요.')
    }
    if (!Array.isArray(data.rows) || !data.rows.length || data.rows.length > TRANSLATION_MAX_ROWS) {
      throw new TranslationInputError('번역할 대사 수가 올바르지 않습니다.')
    }
    const ids = new Set<string>()
    for (const row of data.rows) {
      if (!row || typeof row.rowId !== 'string' || !row.rowId.trim() || ids.has(row.rowId) ||
          typeof row.sourceContent !== 'string' || !row.sourceContent.trim() ||
          row.sourceContent.length > TRANSLATION_MAX_ROW_CHARACTERS) {
        throw new TranslationInputError('번역할 대사 내용이 올바르지 않거나 너무 깁니다. 대사를 나누어 다시 시도해 주세요.')
      }
      ids.add(row.rowId)
    }

    if (!translator) {
      stage = 'loading'
      const files = new Map<string, number>()
      report(5, '번역 AI 모델을 불러오고 있습니다. 첫 실행에는 약 640MB를 다운로드합니다.')
      translator = await pipeline<'translation'>('translation', TRANSLATION_MODEL, {
        device: 'wasm',
        dtype: 'q8',
        revision: TRANSLATION_MODEL_REVISION,
        progress_callback: info => {
          if ('file' in info) {
            if (info.status === 'progress' && Number.isFinite(info.progress)) files.set(info.file, info.progress)
            else if (info.status === 'done') files.set(info.file, 100)
            else if (info.status === 'initiate') files.set(info.file, 0)
          }
          const average = files.size ? [...files.values()].reduce((sum, value) => sum + value, 0) / files.size : 0
          report(5 + average * 0.35, '번역 AI 모델을 불러오고 있습니다. 첫 실행에는 약 640MB를 다운로드합니다.')
        }
      })
    }

    stage = 'translating'
    const activeTranslator = translator
    const configuredEos = (activeTranslator.model.config as { eos_token_id?: number | number[] }).eos_token_id
    const eosTokens = Array.isArray(configuredEos) ? configuredEos : [configuredEos]
    if (!eosTokens.length || eosTokens.some(token => !Number.isSafeInteger(token))) {
      throw new TranslationInputError('번역 모델의 문장 종료 설정을 확인하지 못했습니다.')
    }
    const translatedRows: TranslatedDialogue[] = []
    for (const [rowIndex, row] of data.rows.entries()) {
      const pieces = splitTranslationText(row.sourceContent, text =>
        activeTranslator.tokenizer.encode(text, { add_special_tokens: true }).length,
      TRANSLATION_MAX_INPUT_TOKENS)
      const results: string[] = []
      let contentLength = 0
      for (const [pieceIndex, piece] of pieces.entries()) {
        const message = `한국어로 번역하고 있습니다. 대사 ${rowIndex + 1}/${data.rows.length}, 문장 ${pieceIndex + 1}/${pieces.length}`
        const progress = (fraction: number): void => report(
          42 + (rowIndex + (pieceIndex + fraction) / pieces.length) / data.rows.length * 55,
          message
        )
        progress(0)
        if (!piece.trim()) {
          progress(1)
          continue
        }
        let tokenCount = 0
        let lastToken: number | undefined
        const options = {
          src_lang: data.sourceLanguage,
          tgt_lang: 'ko',
          max_new_tokens: TRANSLATION_MAX_OUTPUT_TOKENS,
          streamer: new TextStreamer(activeTranslator.tokenizer, {
            skip_prompt: true,
            callback_function: () => undefined,
            token_callback_function: tokens => {
              tokenCount += tokens.length
              if (tokens.length) lastToken = Number(tokens[tokens.length - 1])
              progress(Math.min(0.95, tokenCount / TRANSLATION_MAX_OUTPUT_TOKENS))
            }
          })
        }
        // The library accepts partial generation options plus translation language
        // codes at runtime, while its declaration requires a full GenerationConfig.
        const output = await activeTranslator(piece, options as unknown as Parameters<typeof activeTranslator>[1])
        // Forced EOS at the output cap can hide a truncated translation. Require
        // a natural end before the cap and never commit an incomplete batch.
        if (tokenCount >= TRANSLATION_MAX_OUTPUT_TOKENS || lastToken === undefined || !eosTokens.includes(lastToken)) {
          throw new TranslationInputError('번역 문장이 끝까지 생성되지 않았습니다. 긴 대사를 나누어 다시 시도해 주세요.')
        }
        const result = output[0]
        const content = (!Array.isArray(result) && typeof result?.translation_text === 'string')
          ? result.translation_text.trim() : ''
        if (!content) throw new TranslationInputError('번역 결과가 비어 있습니다. 원문 언어와 대사를 확인한 뒤 다시 시도해 주세요.')
        contentLength += content.length + (results.length ? 1 : 0)
        if (contentLength > TRANSLATION_MAX_ROW_CHARACTERS) {
          throw new TranslationInputError('번역 결과가 너무 깁니다. 대사를 나누어 다시 시도해 주세요.')
        }
        results.push(content)
        progress(1)
      }
      translatedRows.push({ rowId: row.rowId, sourceContent: row.sourceContent, content: results.join(' ') })
    }
    report(100, '한국어 번역을 완료했습니다. 번역 초안을 검토해 주세요.', true)
    scope.postMessage({ type: 'complete', rows: translatedRows })
  } catch (error) {
    await disposeTranslator().catch(() => undefined)
    const message = error instanceof TranslationInputError ? error.message
      : stage === 'loading' ? '번역 AI 모델을 불러오지 못했습니다. 인터넷 연결과 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.'
        : stage === 'disposing' ? '번역 AI를 종료하지 못했습니다. 새로고침 후 다시 시도해 주세요.'
          : '기기에서 번역을 완료하지 못했습니다. 다른 탭을 닫거나 대사를 나누어 다시 시도해 주세요.'
    scope.postMessage({ type: 'error', message })
  }
}

// Serialize disposal behind any inference. Cancellation is immediate termination
// by the main thread, which also prevents committing this worker's partial result.
let pending = Promise.resolve()
scope.onmessage = ({ data }) => {
  pending = pending.then(() => handleRequest(data))
}
