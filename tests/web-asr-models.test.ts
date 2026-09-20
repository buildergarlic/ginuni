import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASR_PROFILES, selectAsrProfile } from '../src/web/asr-models'

afterEach(() => vi.unstubAllGlobals())
const adapter = (fp16 = true, fallback = false) => ({ features: new Set(fp16 ? ['shader-f16'] : []),
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 - 4 }, isFallbackAdapter: fallback })
const gpu = (value: ReturnType<typeof adapter> | null) => vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(value) } })

describe('Korean ASR model selection', () => {
  it('uses the larger Korean model on a capable real GPU, with pinned precision encoder weights', async () => {
    gpu(adapter())
    expect(await selectAsrProfile('korean')).toBe('korean-turbo')
    expect(ASR_PROFILES['korean-turbo'].dtype.encoder_model).toBe('fp16')
    expect(ASR_PROFILES['korean-turbo'].revision).toMatch(/^[a-f0-9]{40}$/)
  })
  it.each([null, adapter(false), adapter(true, true)])('uses small rather than tiny when GPU cannot run precision inference: %j', async value => {
    gpu(value)
    expect(await selectAsrProfile('korean')).toBe('korean-small')
    expect(ASR_PROFILES['korean-small'].model).toBe('Xenova/whisper-small')
    await expect(selectAsrProfile('korean', 'precision')).rejects.toThrow('GPU 가속')
  })
  it('handles adapter rejection and missing navigator', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('GPU unavailable')) } })
    expect(await selectAsrProfile('korean')).toBe('korean-small')
    vi.stubGlobal('navigator', undefined)
    expect(await selectAsrProfile('korean')).toBe('korean-small')
  })
  it('respects an explicit compatible mode and retains existing non-Korean profiles', async () => {
    gpu(adapter())
    expect(await selectAsrProfile('korean', 'compatible')).toBe('korean-small')
    expect(await selectAsrProfile('english', 'precision')).toBe('english-base')
    expect(await selectAsrProfile('japanese', 'precision')).toBe('multilingual-tiny')
  })
})
