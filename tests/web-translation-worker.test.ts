import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRANSLATION_MAX_OUTPUT_TOKENS,
  TRANSLATION_MAX_ROW_CHARACTERS,
  TRANSLATION_MAX_ROWS,
  TRANSLATION_MODEL,
  TRANSLATION_MODEL_REVISION,
  type TranslationWorkerRequest,
  type TranslationWorkerResponse
} from '../src/web/translation-types'

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), translate: vi.fn(), encode: vi.fn(), dispose: vi.fn() }))

interface StreamOptions {
  skip_prompt?: boolean
  token_callback_function?: (tokens: bigint[]) => void
}
interface InferenceOptions {
  streamer: { put(value: bigint[][]): void; end(): void }
}

vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, useBrowserCache: false, backends: { onnx: { wasm: {} } } },
  pipeline: mocks.pipeline,
  TextStreamer: class {
    private first = true
    constructor(_tokenizer: unknown, private options: StreamOptions) {}
    put(value: bigint[][]): void {
      if (this.first) {
        this.first = false
        if (this.options.skip_prompt) return
      }
      this.options.token_callback_function?.(value[0])
    }
    end(): void {}
  }
}))

function emitTokens(options: InferenceOptions, tokens: number[] = [128, 77, 2]): void {
  options.streamer.put([[2n]]) // Decoder start token is the prompt, not generated output.
  for (const token of tokens) options.streamer.put([[BigInt(token)]])
  options.streamer.end()
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('browser translation worker', () => {
  let replies: TranslationWorkerResponse[]
  let modelConfig: { eos_token_id: number | number[] }
  const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<TranslationWorkerRequest>) => void) | null }
  const request = (sourceContent = 'Hello.', rowId = 'row-1'): TranslationWorkerRequest => ({
    type: 'translate', sourceLanguage: 'en', rows: [{ rowId, sourceContent }]
  })
  function send(data: TranslationWorkerRequest): void {
    scope.onmessage?.({ data } as MessageEvent<TranslationWorkerRequest>)
  }
  async function waitFor(type: TranslationWorkerResponse['type']): Promise<void> {
    await vi.waitFor(() => expect(replies.some(reply => reply.type === type)).toBe(true))
  }
  const progressValues = (): number[] => replies.flatMap(reply => reply.type === 'progress' ? [reply.progress.percent] : [])

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    replies = []
    modelConfig = { eos_token_id: 2 }
    mocks.encode.mockImplementation((text: string) => new Array(Array.from(text).length + 2).fill(1))
    mocks.translate.mockImplementation(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: ' 번역 초안 ' }]
    })
    mocks.dispose.mockResolvedValue(undefined)
    mocks.pipeline.mockResolvedValue(Object.assign(mocks.translate, {
      tokenizer: { encode: mocks.encode }, model: { config: modelConfig }, dispose: mocks.dispose
    }))
    vi.stubGlobal('onmessage', null)
    vi.stubGlobal('postMessage', (message: TranslationWorkerResponse) => { replies.push(message) })
    await import('../src/web/translation.worker')
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('loads one pinned q8 WASM pipeline, translates each sentence and row in order, and retains original text', async () => {
    const rows = [{ rowId: 'r1', sourceContent: ' Hello.\nSecond! ' }, { rowId: 'r2', sourceContent: 'Last?' }]
    send({ type: 'translate', rows, sourceLanguage: 'en' })
    await waitFor('complete')
    expect(mocks.pipeline).toHaveBeenCalledOnce()
    expect(mocks.pipeline).toHaveBeenCalledWith('translation', TRANSLATION_MODEL, expect.objectContaining({
      device: 'wasm', dtype: 'q8', revision: TRANSLATION_MODEL_REVISION
    }))
    expect(mocks.translate.mock.calls.map(call => call[0])).toEqual([' Hello.\n', 'Second! ', 'Last?'])
    expect(mocks.translate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      src_lang: 'en', tgt_lang: 'ko', max_new_tokens: TRANSLATION_MAX_OUTPUT_TOKENS
    }))
    expect(mocks.encode).toHaveBeenCalledWith(expect.any(String), { add_special_tokens: true })
    expect(replies).toContainEqual({ type: 'complete', rows: [
      { ...rows[0], content: '번역 초안 번역 초안' }, { ...rows[1], content: '번역 초안' }
    ] })
    expect(mocks.dispose).not.toHaveBeenCalled()
    const { env } = await import('@huggingface/transformers')
    expect(env.allowLocalModels).toBe(false)
    expect(env.useBrowserCache).toBe(true)
    expect(env.backends.onnx.wasm).toMatchObject({ numThreads: 1, proxy: false })
  })

  it('uses the selected supported source language with Korean target', async () => {
    send({ type: 'translate', sourceLanguage: 'ja', rows: [{ rowId: 'r', sourceContent: 'こんにちは。' }] })
    await waitFor('complete')
    expect(mocks.translate).toHaveBeenCalledWith('こんにちは。', expect.objectContaining({ src_lang: 'ja', tgt_lang: 'ko' }))
  })

  it('verifies actual tokenizer counts before inference instead of relying on model truncation', async () => {
    const source = '😀'.repeat(255)
    send(request(source))
    await waitFor('complete')
    const inputs = mocks.translate.mock.calls.map(call => call[0] as string)
    expect(inputs).toEqual(['😀'.repeat(254), '😀'])
    expect(inputs.join('')).toBe(source)
    expect(inputs.every(text => Array.from(text).length + 2 <= 256)).toBe(true)
  })

  it('does not infer blank-line pieces and still retains exact original source', async () => {
    const source = '\n\nHello.\n\n'
    send(request(source))
    await waitFor('complete')
    expect(mocks.translate.mock.calls.map(call => call[0])).toEqual(['Hello.\n'])
    expect(replies).toContainEqual({ type: 'complete', rows: [{ rowId: 'row-1', sourceContent: source, content: '번역 초안' }] })
  })

  it('keeps progress monotonic below 100 and sends no partial result while a later sentence is pending', async () => {
    const gate = deferred<{ translation_text: string }[]>()
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: '첫 문장' }]
    }).mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options, [128, 78])
      const output = await gate.promise
      options.streamer.put([[2n]])
      return output
    })
    send(request('First. Second.'))
    await vi.waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(2))
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(progressValues().every(value => value >= 0 && value < 100)).toBe(true)
    gate.resolve([{ translation_text: '둘째 문장' }])
    await waitFor('complete')
    const percentages = progressValues()
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b))
    expect(percentages.at(-1)).toBe(100)
    expect(replies.filter(reply => reply.type === 'complete')).toHaveLength(1)
  })

  it('keeps loading progress monotonic when more model files appear', async () => {
    mocks.pipeline.mockImplementationOnce(async (_task, _model, options) => {
      options.progress_callback({ status: 'progress', file: 'encoder', progress: 90 })
      options.progress_callback({ status: 'initiate', file: 'decoder' })
      options.progress_callback({ status: 'progress', file: 'decoder', progress: 10 })
      options.progress_callback({ status: 'done', file: 'decoder' })
      return Object.assign(mocks.translate, { tokenizer: { encode: mocks.encode }, model: { config: modelConfig }, dispose: mocks.dispose })
    })
    send(request())
    await waitFor('complete')
    expect(progressValues()).toEqual([...progressValues()].sort((a, b) => a - b))
  })

  it.each([false, true])('rejects output at the token cap even when it ends with forced EOS (%s)', async eos => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      const tokens = new Array<number>(TRANSLATION_MAX_OUTPUT_TOKENS).fill(77)
      if (eos) tokens[tokens.length - 1] = 2
      emitTokens(options, tokens)
      return [{ translation_text: '잘린 번역' }]
    })
    send(request())
    await waitFor('error')
    expect(replies).toContainEqual({ type: 'error', message: expect.stringContaining('끝까지') })
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(progressValues()).not.toContain(100)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('accepts EOS one generated token below the cap without counting the decoder prompt', async () => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      const tokens = new Array<number>(TRANSLATION_MAX_OUTPUT_TOKENS - 1).fill(77)
      tokens[tokens.length - 1] = 2
      emitTokens(options, tokens)
      return [{ translation_text: '완성 번역' }]
    })
    send(request())
    await waitFor('complete')
  })

  it('rejects a non-EOS end below the token cap', async () => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options, [128, 77])
      return [{ translation_text: '중단된 번역' }]
    })
    send(request())
    await waitFor('error')
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('reads valid EOS IDs from model configuration', async () => {
    modelConfig.eos_token_id = [3, 4]
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options, [77, 4])
      return [{ translation_text: '완성 번역' }]
    })
    send(request())
    await waitFor('complete')
  })

  it('rejects empty translation output and releases the model', async () => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: ' \n ' }]
    })
    send(request())
    await waitFor('error')
    expect(replies).toContainEqual({ type: 'error', message: expect.stringContaining('비어') })
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a row whose accumulated sentence translations exceed the character limit', async () => {
    mocks.translate.mockImplementation(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: '가'.repeat(TRANSLATION_MAX_ROW_CHARACTERS / 2) }]
    })
    send(request('First. Second.'))
    await waitFor('error')
    expect(mocks.translate).toHaveBeenCalledTimes(2)
    expect(replies).toContainEqual({ type: 'error', message: expect.stringContaining('너무 깁니다') })
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('accepts a translated row exactly at the character limit', async () => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: '가'.repeat(TRANSLATION_MAX_ROW_CHARACTERS) }]
    })
    send(request())
    await waitFor('complete')
  })

  it('never returns earlier rows when a later inference fails, even if disposal also fails', async () => {
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return [{ translation_text: '성공' }]
    }).mockRejectedValueOnce(new Error('private internal failure'))
    mocks.dispose.mockRejectedValueOnce(new Error('dispose failure'))
    send({ type: 'translate', sourceLanguage: 'en', rows: [
      { rowId: '1', sourceContent: 'First' }, { rowId: '2', sourceContent: 'Second' }
    ] })
    await waitFor('error')
    expect(replies.filter(reply => reply.type === 'error')).toHaveLength(1)
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
    expect(JSON.stringify(replies)).not.toContain('private internal failure')
    expect(progressValues()).not.toContain(100)
  })

  it('waits for an active inference before disposing and emits disposed after completion', async () => {
    const gate = deferred<{ translation_text: string }[]>()
    mocks.translate.mockImplementationOnce(async (_text: string, options: InferenceOptions) => {
      emitTokens(options)
      return gate.promise
    })
    send(request())
    send({ type: 'dispose' })
    await vi.waitFor(() => expect(mocks.translate).toHaveBeenCalledOnce())
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(replies.some(reply => reply.type === 'disposed')).toBe(false)
    gate.resolve([{ translation_text: '완료' }])
    await waitFor('disposed')
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(replies.findIndex(reply => reply.type === 'complete')).toBeLessThan(replies.findIndex(reply => reply.type === 'disposed'))
  })

  it('allows disposal before initialization without loading the model', async () => {
    send({ type: 'dispose' })
    await waitFor('disposed')
    expect(mocks.pipeline).not.toHaveBeenCalled()
  })

  it('reports a friendly model loading failure', async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error('fetch private details'))
    send(request())
    await waitFor('error')
    expect(replies).toContainEqual({ type: 'error', message: expect.stringContaining('모델을 불러오지 못했습니다') })
    expect(mocks.translate).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'translate', sourceLanguage: 'unsupported', rows: [{ rowId: '1', sourceContent: 'Text' }] },
    { type: 'translate', sourceLanguage: 'en', rows: [] },
    { type: 'translate', sourceLanguage: 'en', rows: [{ rowId: '1', sourceContent: '  ' }] },
    { type: 'translate', sourceLanguage: 'en', rows: [{ rowId: '1', sourceContent: 'x'.repeat(TRANSLATION_MAX_ROW_CHARACTERS + 1) }] },
    { type: 'translate', sourceLanguage: 'en', rows: [{ rowId: 'same', sourceContent: 'A' }, { rowId: 'same', sourceContent: 'B' }] },
    { type: 'translate', sourceLanguage: 'en', rows: new Array(TRANSLATION_MAX_ROWS + 1).fill({ rowId: '1', sourceContent: 'A' }) }
  ])('rejects invalid requests before loading the model: %#', async invalid => {
    send(invalid as TranslationWorkerRequest)
    await waitFor('error')
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(replies.some(reply => reply.type === 'complete')).toBe(false)
  })
})
