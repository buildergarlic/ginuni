export interface SpeechWindow { start: number; end: number }
export interface SpeechDetector {
  /** 16kHz mono PCM; sample offsets are relative to this input, end exclusive. */
  findWindows(audio: Float32Array): Promise<SpeechWindow[]>
  dispose(): Promise<void>
}

const SAMPLE_RATE = 16_000
const FRAME_SAMPLES = 512
const CONTEXT_SAMPLES = 64
const MAX_INPUT_SAMPLES = SAMPLE_RATE * 64
const MAX_WINDOW_SAMPLES = SAMPLE_RATE * 28
const PAD_SAMPLES = SAMPLE_RATE * 0.32
const MIN_SILENCE_SAMPLES = SAMPLE_RATE * 0.24
const MERGE_GAP_SAMPLES = SAMPLE_RATE * 0.6

function validateSampleCount(sampleCount: number): void {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > MAX_INPUT_SAMPLES)
    throw new Error('발화 검출에는 16kHz 음성을 최대 64초씩 전달해야 합니다.')
}

/** Conservative hysteresis: retain brief speech and its context; never infer text. */
export function speechWindowsFromProbabilities(probabilities: ArrayLike<number>, sampleCount: number): SpeechWindow[] {
  validateSampleCount(sampleCount)
  if (probabilities.length !== Math.ceil(sampleCount / FRAME_SAMPLES))
    throw new Error('발화 검출 결과의 프레임 수가 일치하지 않습니다.')
  const speech: SpeechWindow[] = []
  let start = -1, possibleEnd = -1
  for (let index = 0; index < probabilities.length; index++) {
    const probability = probabilities[index]
    if (!Number.isFinite(probability) || probability < 0 || probability > 1)
      throw new Error('발화 검출 확률을 확인하지 못했습니다.')
    const position = index * FRAME_SAMPLES
    if (start < 0) {
      if (probability >= 0.5) start = position
      continue
    }
    if (probability >= 0.35) possibleEnd = -1
    else {
      if (possibleEnd < 0) possibleEnd = position
      if (position + FRAME_SAMPLES - possibleEnd >= MIN_SILENCE_SAMPLES) {
        speech.push({ start, end: possibleEnd })
        start = -1
        possibleEnd = -1
      }
    }
  }
  if (start >= 0) speech.push({ start, end: possibleEnd >= 0 ? possibleEnd : sampleCount })

  const windows: SpeechWindow[] = []
  const append = (window: SpeechWindow): void => {
    const previous = windows.at(-1)
    if (previous && window.start - previous.end <= MERGE_GAP_SAMPLES && window.end - previous.start <= MAX_WINDOW_SAMPLES)
      previous.end = window.end
    else windows.push(window)
  }
  for (const region of speech) {
    let windowStart = Math.max(0, region.start - PAD_SAMPLES)
    const windowEnd = Math.min(sampleCount, region.end + PAD_SAMPLES)
    while (windowEnd - windowStart > MAX_WINDOW_SAMPLES) {
      append({ start: windowStart, end: windowStart + MAX_WINDOW_SAMPLES })
      // Retain phoneme context across a forced cut in continuous speech.
      windowStart += MAX_WINDOW_SAMPLES - PAD_SAMPLES * 2
    }
    append({ start: windowStart, end: windowEnd })
  }
  return windows
}

// MIT, Silero Team. Official model and wrapper pinned to:
// https://github.com/snakers4/silero-vad/tree/60b7ffa243625ebdc1070275a29f18c87843786a
// silero_vad.onnx SHA256: 1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3
export async function createSpeechDetector(): Promise<SpeechDetector> {
  // Transformers.js imports this same package. Keep its shared WASM paths/runtime.
  // This pinned ORT release omits types.d.ts from its package exports. Its public
  // API types are re-exported verbatim from onnxruntime-common by types.d.ts.
  // @ts-expect-error upstream onnxruntime-web exports omit the declaration entry
  const ort: typeof import('onnxruntime-common') = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  const session = await ort.InferenceSession.create(new URL('./assets/silero-vad.onnx', import.meta.url).href, {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all'
  })
  let active: Promise<SpeechWindow[]> | undefined
  let disposal: Promise<void> | undefined

  const detect = async (audio: Float32Array): Promise<SpeechWindow[]> => {
    validateSampleCount(audio.length)
    if (!(audio instanceof Float32Array) || audio.some(value => !Number.isFinite(value)))
      throw new Error('발화 검출 음성 데이터가 올바르지 않습니다.')
    if (!audio.length) return []
    // Reset per bounded input; callers retain overlap between adjacent inputs.
    const state = new Float32Array(2 * 128)
    const context = new Float32Array(CONTEXT_SAMPLES)
    const frame = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES)
    const inputTensor = new ort.Tensor('float32', frame, [1, frame.length])
    const stateTensor = new ort.Tensor('float32', state, [2, 1, 128])
    const rateTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), [])
    const probabilities: number[] = []
    try {
      for (let offset = 0; offset < audio.length; offset += FRAME_SAMPLES) {
        frame.fill(0)
        frame.set(context)
        frame.set(audio.subarray(offset, offset + FRAME_SAMPLES), CONTEXT_SAMPLES)
        const output = await session.run({ input: inputTensor, state: stateTensor, sr: rateTensor })
        try {
          const nextState = output.stateN?.data
          const probability = Number(output.output?.data[0])
          if (!(nextState instanceof Float32Array) || nextState.length !== state.length ||
              nextState.some(value => !Number.isFinite(value)) || !Number.isFinite(probability) || probability < 0 || probability > 1)
            throw new Error('발화 검출 모델의 출력을 확인하지 못했습니다.')
          state.set(nextState)
          probabilities.push(probability)
          context.set(frame.subarray(frame.length - CONTEXT_SAMPLES))
        } finally {
          for (const tensor of Object.values(output)) tensor.dispose()
        }
      }
      return speechWindowsFromProbabilities(probabilities, audio.length)
    } finally {
      inputTensor.dispose()
      stateTensor.dispose()
      rateTensor.dispose()
    }
  }

  return {
    async findWindows(audio) {
      if (disposal) throw new Error('종료된 발화 검출기는 다시 사용할 수 없습니다.')
      if (active) throw new Error('발화 검출은 음성 구간을 하나씩 처리해야 합니다.')
      active = detect(audio)
      try { return await active } finally { active = undefined }
    },
    dispose() {
      if (!disposal) disposal = (async () => {
        // The caller still receives a detection error; release its session even on failure.
        await active?.catch(() => undefined)
        await session.release()
      })()
      return disposal
    }
  }
}
