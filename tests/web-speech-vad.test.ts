import { describe, expect, it } from 'vitest'
import { speechWindowsFromProbabilities } from '../src/web/speech-vad'

describe('speech detection window grouping', () => {
  it('returns no recognition windows for empty or consistently non-speech audio', () => {
    expect(speechWindowsFromProbabilities([], 0)).toEqual([])
    expect(speechWindowsFromProbabilities(Array(100).fill(0.02), 51200)).toEqual([])
  })

  it('keeps a single short affirmative syllable with context instead of deleting short speech', () => {
    const probabilities = Array(100).fill(0.01)
    probabilities[50] = 0.9
    expect(speechWindowsFromProbabilities(probabilities, 51200)).toEqual([{ start: 20480, end: 31232 }])
  })

  it('clamps speech context at both clip edges and does not include padded final-frame samples', () => {
    expect(speechWindowsFromProbabilities([0.95], 200)).toEqual([{ start: 0, end: 200 }])
    const probabilities = Array(20).fill(0.01)
    probabilities[19] = 0.9
    expect(speechWindowsFromProbabilities(probabilities, 10000)).toEqual([{ start: 4608, end: 10000 }])
  })

  it('keeps weaker ongoing speech after a confident onset while requiring a confident onset', () => {
    expect(speechWindowsFromProbabilities(Array(40).fill(0.4), 20480)).toEqual([])
    const probabilities = [0.9, ...Array(39).fill(0.4)]
    expect(speechWindowsFromProbabilities(probabilities, 20480)).toEqual([{ start: 0, end: 20480 }])
  })

  it('preserves nearby exchanges in one context window and separates long non-speech gaps', () => {
    const probabilities = Array(250).fill(0.01)
    probabilities.fill(0.9, 20, 25)
    probabilities.fill(0.9, 60, 65)
    probabilities.fill(0.9, 200, 205)
    expect(speechWindowsFromProbabilities(probabilities, 128000)).toEqual([
      { start: 5120, end: 38400 }, { start: 97280, end: 110080 }
    ])
  })

  it('retains context overlap at forced cuts without creating a window beyond 28 seconds', () => {
    expect(speechWindowsFromProbabilities(Array(2000).fill(0.95), 1024000)).toEqual([
      { start: 0, end: 448000 },
      { start: 437760, end: 885760 },
      { start: 875520, end: 1024000 }
    ])
  })

  it('bridges a brief low-confidence dip within an utterance', () => {
    const probabilities = [...Array(30).fill(0.9), ...Array(4).fill(0.02), ...Array(30).fill(0.9)]
    expect(speechWindowsFromProbabilities(probabilities, 32768)).toEqual([{ start: 0, end: 32768 }])
  })

  it('does not mutate frame probabilities', () => {
    const probabilities = Object.freeze([0.1, 0.9, 0.1])
    expect(speechWindowsFromProbabilities(probabilities, 1536)).toEqual([{ start: 0, end: 1536 }])
    expect(probabilities).toEqual([0.1, 0.9, 0.1])
  })

  it.each([NaN, Infinity, -0.1, 1.01])('rejects invalid probabilities rather than silently discarding audio: %s', value => {
    expect(() => speechWindowsFromProbabilities([value], 512)).toThrow()
  })

  it.each([-1, 1.5, Infinity, 1024001])('rejects invalid or unbounded sample counts: %s', samples => {
    expect(() => speechWindowsFromProbabilities([], samples)).toThrow()
  })

  it('rejects missing or surplus probability frames', () => {
    expect(() => speechWindowsFromProbabilities([0.9], 1024)).toThrow()
    expect(() => speechWindowsFromProbabilities([0.9, 0.1], 100)).toThrow()
  })
})
