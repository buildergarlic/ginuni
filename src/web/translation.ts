import { TRANSLATION_LANGUAGE_CODES, type TranslationSourceLanguage } from './languages'
import {
  TRANSLATION_MAX_ROW_CHARACTERS,
  TRANSLATION_MAX_ROWS,
  type TranslatedDialogue,
  type TranslationInput,
  type TranslationProgress,
  type TranslationWorkerRequest,
  type TranslationWorkerResponse
} from './translation-types'

export type { TranslationInput, TranslatedDialogue, TranslationProgress } from './translation-types'

const cancelled = (): DOMException => new DOMException('번역을 취소했습니다.', 'AbortError')
const invalidResult = (): Error => new Error('번역 결과를 확인하지 못했습니다. 원문을 보존했으니 다시 시도해 주세요.')

function copyInputs(rows: TranslationInput[]): TranslationInput[] {
  if (!Array.isArray(rows) || !rows.length || rows.length > TRANSLATION_MAX_ROWS)
    throw new Error('번역할 대사 행을 확인해 주세요.')
  const seen = new Set<string>()
  return rows.map(row => {
    if (!row || typeof row.rowId !== 'string' || !row.rowId.trim() || seen.has(row.rowId) ||
      typeof row.sourceContent !== 'string' || !row.sourceContent.trim() || row.sourceContent.length > TRANSLATION_MAX_ROW_CHARACTERS)
      throw new Error('대사 내용과 행 구분을 확인해 주세요. 한 행은 10,000자까지 번역할 수 있습니다.')
    seen.add(row.rowId)
    return { rowId: row.rowId, sourceContent: row.sourceContent }
  })
}

function checkedResults(value: unknown, inputs: TranslationInput[]): TranslatedDialogue[] {
  if (!Array.isArray(value) || value.length !== inputs.length) throw invalidResult()
  return inputs.map((input, index) => {
    const row = value[index]
    if (!row || row.rowId !== input.rowId || row.sourceContent !== input.sourceContent ||
      typeof row.content !== 'string' || !row.content.trim() || row.content.length > TRANSLATION_MAX_ROW_CHARACTERS)
      throw invalidResult()
    return { ...input, content: row.content }
  })
}

/** Translate an immutable snapshot; cancellation or failure never returns a partial draft. */
export async function translateDialogue(
  rows: TranslationInput[],
  options: {
    sourceLanguage: TranslationSourceLanguage
    signal: AbortSignal
    onProgress?: (progress: TranslationProgress) => void
  }
): Promise<TranslatedDialogue[]> {
  const { sourceLanguage, signal, onProgress } = options
  if (signal.aborted) throw cancelled()
  if (!TRANSLATION_LANGUAGE_CODES.includes(sourceLanguage))
    throw new Error('번역할 원문의 언어를 선택해 주세요.')
  const inputs = copyInputs(rows)
  if (typeof Worker === 'undefined')
    throw new Error('이 브라우저는 기기 내 번역을 지원하지 않습니다. 최신 Chrome·Edge에서 다시 시도해 주세요.')

  return new Promise<TranslatedDialogue[]>((resolve, reject) => {
    let worker: Worker | undefined
    let finished = false
    let result: TranslatedDialogue[] | undefined
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    let percent = 0
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      clearTimeout(cleanupTimer)
      signal.removeEventListener('abort', onAbort)
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
      if (error) reject(error)
      else if (signal.aborted) reject(cancelled())
      else if (result) resolve(result)
      else reject(invalidResult())
    }
    const onAbort = (): void => finish(cancelled())
    const report = (progress: TranslationProgress): void => {
      if (!Number.isFinite(progress.percent) || typeof progress.message !== 'string') return
      percent = Math.max(percent, Math.max(0, Math.min(100, Math.round(progress.percent))))
      onProgress?.({ percent, message: progress.message })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) { onAbort(); return }
      worker = new Worker(new URL('./translation.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = () => finish(new Error('기기 내 번역을 실행하지 못했습니다. 다른 탭을 닫고 최신 Chrome·Edge에서 다시 시도해 주세요.'))
      worker.onmessageerror = () => finish(invalidResult())
      worker.onmessage = (event: MessageEvent<TranslationWorkerResponse>) => {
        if (finished || signal.aborted) return
        try {
          const message = event.data
          if (message.type === 'progress' && !result) report(message.progress)
          if (message.type === 'error') finish(new Error(message.message))
          if (message.type === 'complete' && !result) {
            result = checkedResults(message.rows, inputs)
            // Explicitly release model sessions, with termination as a bounded fallback.
            cleanupTimer = setTimeout(() => finish(), 2000)
            worker?.postMessage({ type: 'dispose' } satisfies TranslationWorkerRequest)
          }
          if (message.type === 'disposed' && result) finish()
        } catch { finish(invalidResult()) }
      }
      report({ percent: 1, message: '기기에서 한국어 번역을 준비하고 있습니다.' })
      if (finished || signal.aborted) { onAbort(); return }
      worker.postMessage({ type: 'translate', rows: inputs, sourceLanguage } satisfies TranslationWorkerRequest)
    } catch {
      finish(new Error('기기 내 번역을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.'))
    }
  })
}
