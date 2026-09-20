import type { SpeechLanguage } from './languages'

export const KOREAN_ASR_MODES = ['auto', 'precision', 'compatible'] as const
export type KoreanAsrMode = typeof KOREAN_ASR_MODES[number]
export type AsrProfileId = 'korean-turbo' | 'korean-small' | 'english-base' | 'multilingual-tiny'

export const ASR_PROFILES = {
  'korean-turbo': {
    model: 'onnx-community/whisper-large-v3-turbo',
    revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    label: '한국어 정밀 · Whisper large-v3-turbo · GPU',
    downloadBytes: 1_620_000_000
  },
  'korean-small': {
    model: 'Xenova/whisper-small',
    revision: '2d67713f236afa48a18992566e7647f6ca848e13',
    device: 'wasm', dtype: 'q8',
    label: '한국어 호환 · Whisper small · CPU',
    downloadBytes: 255_000_000
  },
  'english-base': {
    model: 'Xenova/whisper-base.en',
    revision: '95bf40a508535962c6483ead40270b2e32267508',
    device: 'wasm', dtype: 'q8', label: '영어 · Whisper base.en', downloadBytes: 78_000_000
  },
  'multilingual-tiny': {
    model: 'Xenova/whisper-tiny',
    revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
    device: 'wasm', dtype: 'q8', label: '다국어 · Whisper tiny', downloadBytes: 42_000_000
  }
} as const

/** Only a real GPU adapter with fp16 and sufficient buffer limits can load the precision model. */
export async function supportsPrecisionAsr(): Promise<boolean> {
  try {
    const gpu = (globalThis.navigator as unknown as { gpu?: {
      requestAdapter(options: { powerPreference: string }): Promise<{
        features: { has(name: string): boolean }
        limits: { maxBufferSize: number; maxStorageBufferBindingSize: number }
        isFallbackAdapter?: boolean
      } | null>
    } } | undefined)?.gpu
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' })
    return Boolean(adapter && !adapter.isFallbackAdapter && adapter.features.has('shader-f16') &&
      adapter.limits.maxBufferSize >= 256 * 1024 ** 2 && adapter.limits.maxStorageBufferBindingSize >= 128 * 1024 ** 2)
  } catch { return false }
}

export async function selectAsrProfile(language: SpeechLanguage, mode: KoreanAsrMode = 'auto'): Promise<AsrProfileId> {
  if (language === 'english') return 'english-base'
  if (language !== 'korean') return 'multilingual-tiny'
  if (mode === 'compatible') return 'korean-small'
  if (await supportsPrecisionAsr()) return 'korean-turbo'
  if (mode === 'precision')
    throw new Error('한국어 정밀 분석에는 GPU 가속이 필요합니다. 최신 Chrome·Edge의 그래픽 가속을 켜거나 한국어 분석 품질에서 호환 모드를 선택해 주세요.')
  return 'korean-small'
}
