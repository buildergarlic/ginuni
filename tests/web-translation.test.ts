import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateDialogue } from '../src/web/translation'
import type { TranslationInput, TranslationWorkerRequest, TranslationWorkerResponse } from '../src/web/translation-types'
import type { TranslationSourceLanguage } from '../src/web/languages'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<TranslationWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn<(message: TranslationWorkerRequest) => void>()
  terminate = vi.fn()
  constructor(public url: URL, public options: WorkerOptions) { FakeWorker.instances.push(this) }
  send(message: TranslationWorkerResponse): void { this.onmessage?.({ data: message } as MessageEvent<TranslationWorkerResponse>) }
}

const inputs = (): TranslationInput[] => [
  { rowId: 'first', sourceContent: ' Hello, Phil. ' },
  { rowId: 'second', sourceContent: 'How is everything?' }
]
const translated = () => inputs().map((row, index) => ({ ...row, content: index ? '잘 지내니?' : '안녕, 필.' }))
const worker = (): FakeWorker => FakeWorker.instances.at(-1)!

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('browser translation lifecycle', () => {
  it('sends an immutable row snapshot to one module worker and waits for model disposal before returning all results', async () => {
    const rows = inputs()
    const progress = vi.fn()
    const controller = new AbortController()
    const promise = translateDialogue(rows, { sourceLanguage: 'en', signal: controller.signal, onProgress: progress })
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker().url.href).toContain('translation.worker.ts')
    expect(worker().options).toEqual({ type: 'module' })
    expect(worker().postMessage).toHaveBeenCalledWith({ type: 'translate', rows: inputs(), sourceLanguage: 'en' })
    rows[0].sourceContent = 'Changed while translation runs.'
    expect((worker().postMessage.mock.calls[0][0] as { rows: TranslationInput[] }).rows[0].sourceContent).toBe(' Hello, Phil. ')
    worker().send({ type: 'complete', rows: translated() })
    expect(worker().postMessage).toHaveBeenLastCalledWith({ type: 'dispose' })
    let resolved = false
    void promise.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    worker().send({ type: 'disposed' })
    await expect(promise).resolves.toEqual(translated())
    expect(worker().terminate).toHaveBeenCalledOnce()
    expect(worker().onmessage).toBeNull()
    expect(progress).toHaveBeenCalledWith({ percent: 1, message: expect.stringContaining('한국어 번역') })
  })

  it('passes the selected supported language and keeps progress monotonic', async () => {
    const onProgress = vi.fn()
    const promise = translateDialogue(inputs(), { sourceLanguage: 'ja', signal: new AbortController().signal, onProgress })
    expect(worker().postMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'ja' }))
    for (const percent of [12, 10, Number.NaN, 65, 100]) worker().send({ type: 'progress', progress: { percent, message: '번역 중' } })
    worker().send({ type: 'complete', rows: translated() })
    worker().send({ type: 'disposed' })
    await promise
    expect(onProgress.mock.calls.map(([value]) => value.percent)).toEqual([1, 12, 12, 65, 100])
  })

  it('does not start a worker when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(translateDialogue(inputs(), { sourceLanguage: 'en', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('terminates model loading or inference immediately on cancellation and ignores stale completion', async () => {
    const controller = new AbortController()
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: controller.signal })
    const staleCallback = worker().onmessage!
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    staleCallback({ data: { type: 'complete', rows: translated() } } as MessageEvent<TranslationWorkerResponse>)
    await rejection
    expect(worker().terminate).toHaveBeenCalledOnce()
    expect(worker().postMessage).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation even after complete while disposal is pending', async () => {
    const controller = new AbortController()
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: controller.signal })
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    worker().send({ type: 'complete', rows: translated() })
    controller.abort()
    await rejection
    expect(worker().terminate).toHaveBeenCalledOnce()
  })

  it('uses bounded termination if a completed worker cannot acknowledge disposal', async () => {
    vi.useFakeTimers()
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: new AbortController().signal })
    worker().send({ type: 'complete', rows: translated() })
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).resolves.toEqual(translated())
    expect(worker().terminate).toHaveBeenCalledOnce()
  })

  it.each(['missing-row', 'changed-id', 'changed-source', 'empty-output', 'oversized-output'] as const)('rejects %s results without returning partial or mismatched translations', async (reason) => {
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: new AbortController().signal })
    const rows = translated()
    if (reason === 'missing-row') rows.pop()
    if (reason === 'changed-id') rows[0].rowId = 'other'
    if (reason === 'changed-source') rows[0].sourceContent = 'Changed source'
    if (reason === 'empty-output') rows[0].content = '  '
    if (reason === 'oversized-output') rows[0].content = '가'.repeat(10_001)
    worker().send({ type: 'complete', rows })
    await expect(promise).rejects.toThrow('번역 결과를 확인하지 못했습니다')
    expect(worker().terminate).toHaveBeenCalledOnce()
  })

  it('returns a worker error safely and never exposes a partial result', async () => {
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: new AbortController().signal })
    worker().send({ type: 'progress', progress: { percent: 65, message: '1/2행 완료' } })
    worker().send({ type: 'error', message: '기기에서 번역을 완료하지 못했습니다.' })
    await expect(promise).rejects.toThrow('기기에서 번역을 완료하지 못했습니다')
    expect(worker().terminate).toHaveBeenCalledOnce()
  })

  it.each(['runtime', 'message'] as const)('handles worker %s errors and terminates', async (kind) => {
    const promise = translateDialogue(inputs(), { sourceLanguage: 'en', signal: new AbortController().signal })
    if (kind === 'runtime') worker().onerror?.()
    else worker().onmessageerror?.()
    await expect(promise).rejects.toThrow(kind === 'runtime' ? '번역을 실행하지 못했습니다' : '번역 결과를 확인하지 못했습니다')
    expect(worker().terminate).toHaveBeenCalledOnce()
  })

  it.each([
    { rows: [] },
    { rows: [{ rowId: 'a', sourceContent: ' ' }] },
    { rows: [{ rowId: 'a', sourceContent: 'x'.repeat(10_001) }] },
    { rows: [{ rowId: 'a', sourceContent: 'One.' }, { rowId: 'a', sourceContent: 'Two.' }] }
  ])('validates inputs before downloading a model', async ({ rows }) => {
    await expect(translateDialogue(rows, { sourceLanguage: 'en', signal: new AbortController().signal })).rejects.toThrow()
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('rejects unsupported source languages before creating the worker', async () => {
    await expect(translateDialogue(inputs(), { sourceLanguage: 'unknown' as TranslationSourceLanguage, signal: new AbortController().signal })).rejects.toThrow('원문의 언어')
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('explains missing Worker support', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(translateDialogue(inputs(), { sourceLanguage: 'en', signal: new AbortController().signal })).rejects.toThrow('기기 내 번역을 지원하지 않습니다')
  })
})
