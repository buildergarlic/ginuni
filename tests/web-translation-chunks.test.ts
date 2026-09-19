import { describe, expect, it } from 'vitest'
import { splitTranslationText } from '../src/web/translation-chunks'

const countWithSpecialTokens = (text: string): number => Array.from(text).length + 2

describe('translation sentence and token boundaries', () => {
  it('keeps short sentences separate and retains punctuation, quotes, spaces and line endings', () => {
    const source = 'Hello?!  “Next.”\r\n日本語です。中文！ Really?\nLast line'
    const pieces = splitTranslationText(source, countWithSpecialTokens)
    expect(pieces).toEqual(['Hello?!  ', '“Next.”\r\n', '日本語です。', '中文！ ', 'Really?\n', 'Last line'])
    expect(pieces.join('')).toBe(source)
  })

  it('retains standalone blank lines and all leading/trailing whitespace', () => {
    const source = ' \tFirst\n\n\r\nSecond.   '
    const pieces = splitTranslationText(source, countWithSpecialTokens)
    expect(pieces).toEqual([' \tFirst\n', '\n', '\r\n', 'Second.   '])
    expect(pieces.join('')).toBe(source)
  })

  it('keeps mixed punctuation runs together instead of creating punctuation-only inference pieces', () => {
    expect(splitTranslationText('Why!?!... Next。！？ Done.', countWithSpecialTokens)).toEqual([
      'Why!?!... ', 'Next。！？ ', 'Done.'
    ])
  })

  it('keeps decimal numbers, domains, URLs and common titles within their sentence', () => {
    const source = 'Mr. Phil paid 3.14 at example.com. Dr. Lee visited https://example.com/page. Next!'
    expect(splitTranslationText(source, countWithSpecialTokens)).toEqual([
      'Mr. Phil paid 3.14 at example.com. ', 'Dr. Lee visited https://example.com/page. ', 'Next!'
    ])
  })

  it.each(['Mrs', 'Ms', 'Prof', 'St'])('keeps the %s abbreviation with its following name', title => {
    expect(splitTranslationText(`${title}. Smith came. Next.`, countWithSpecialTokens)).toEqual([
      `${title}. Smith came. `, 'Next.'
    ])
  })

  it('allows an exact token bound including special tokens', () => {
    const source = 'x'.repeat(254)
    expect(splitTranslationText(source, countWithSpecialTokens)).toEqual([source])
    const pieces = splitTranslationText(`${source}x`, countWithSpecialTokens)
    expect(pieces).toEqual([source, 'x'])
    expect(pieces.every(piece => countWithSpecialTokens(piece) <= 256)).toBe(true)
  })

  it('prefers whitespace over splitting a word inside the token budget', () => {
    const source = 'Alpha beta gamma delta'
    const pieces = splitTranslationText(source, countWithSpecialTokens, 14)
    expect(pieces).toEqual(['Alpha beta ', 'gamma delta'])
    expect(pieces.join('')).toBe(source)
  })

  it('splits oversized words on Unicode code points without losing astral characters', () => {
    const source = '𠮷😀🧑‍💻'.repeat(6)
    const pieces = splitTranslationText(source, countWithSpecialTokens, 7)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(source)
    for (const piece of pieces) {
      expect(countWithSpecialTokens(piece)).toBeLessThanOrEqual(7)
      expect(piece).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u)
      expect(Array.from(piece).every(character => character.length === 2 || !/[\uD800-\uDFFF]/u.test(character))).toBe(true)
    }
  })

  it('rechecks whitespace prefixes whose token count increases when a suffix is removed', () => {
    const counts = (text: string): number => text === 'ab ' ? 20 : text.length + 2
    const source = 'ab cdefgh'
    const pieces = splitTranslationText(source, counts, 6)
    expect(pieces[0]).toBe('ab c')
    expect(pieces.join('')).toBe(source)
    expect(pieces.every(piece => counts(piece) <= 6)).toBe(true)
  })

  it('preserves mixed scripts and exact source order over many bounded sentences', () => {
    const source = 'English 日本語 中文 😀 '.repeat(30) + '!\n' + 'Без пробелов'.repeat(25) + '。'
    const pieces = splitTranslationText(source, countWithSpecialTokens, 32)
    expect(pieces.join('')).toBe(source)
    expect(pieces.every(piece => countWithSpecialTokens(piece) <= 32)).toBe(true)
    expect(pieces.every(piece => piece.length > 0)).toBe(true)
  })

  it('returns no pieces for an empty input and preserves whitespace-only input', () => {
    expect(splitTranslationText('', countWithSpecialTokens)).toEqual([])
    expect(splitTranslationText(' \t\n ', countWithSpecialTokens).join('')).toBe(' \t\n ')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid token budget %s', limit => {
    expect(() => splitTranslationText('Text', countWithSpecialTokens, limit)).toThrow()
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid tokenizer count %s', count => {
    expect(() => splitTranslationText('Text', () => count)).toThrow()
  })

  it('fails instead of discarding a character that cannot fit with special tokens', () => {
    expect(() => splitTranslationText('😀', countWithSpecialTokens, 2)).toThrow(/한 글자/)
  })
})
