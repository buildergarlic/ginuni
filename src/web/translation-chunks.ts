import { TRANSLATION_MAX_INPUT_TOKENS } from './translation-types'

/** Split at natural sentence boundaries first, retaining every source character. */
export function splitTranslationText(
  text: string,
  tokenCount: (text: string) => number,
  maxTokens = TRANSLATION_MAX_INPUT_TOKENS
): string[] {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    throw new Error('번역 입력 토큰 제한이 올바르지 않습니다.')
  }
  const fits = (value: string): boolean => {
    const count = tokenCount(value)
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('번역 입력의 토큰 수를 확인하지 못했습니다.')
    }
    return count <= maxTokens
  }
  const pieces: string[] = []
  const splitLongSentence = (sentence: string): void => {
    let remaining = sentence
    while (remaining) {
      if (fits(remaining)) {
        pieces.push(remaining)
        break
      }

      // Search code points, not UTF-16 offsets, so an emoji/supplementary character
      // can never be separated into two invalid surrogate halves.
      const points = Array.from(remaining)
      let low = 1
      let high = points.length - 1
      let best = 0
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        if (fits(points.slice(0, middle).join(''))) {
          best = middle
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      if (!best) {
        throw new Error('한 글자도 번역 입력 제한 안에 넣을 수 없습니다.')
      }
      let prefix = points.slice(0, best).join('')
      const whitespaceEnds = [...prefix.matchAll(/\s+/gu)].map(match => match.index + match[0].length)
      // Token counts need not be monotonic under prefix removal. Verify a chosen
      // word boundary instead of assuming every shorter prefix also fits.
      for (const end of whitespaceEnds.reverse()) {
        const candidate = prefix.slice(0, end)
        if (candidate.trim() && fits(candidate)) {
          prefix = candidate
          break
        }
      }
      pieces.push(prefix)
      remaining = remaining.slice(prefix.length)
    }
  }

  // Keep punctuation runs, closing quotes and adjacent whitespace with a sentence.
  // Deliberately do not recombine short sentences: M2M100 can omit a later sentence.
  // An ASCII period inside a decimal/domain is not a sentence end. Common titles
  // stay attached to the following name, without requiring a language parser.
  const endings = /(?:[!?。！？][.!?。！？]*|\.+(?=\s|$|["'”’»）)\]}]))["'”’»）)\]}]*[^\S\r\n]*(?:\r\n|\r|\n)?|\r\n|\r|\n/gu
  let start = 0
  for (const match of text.matchAll(endings)) {
    if (match[0].startsWith('.') && /(?:^|\s|["'“‘(])(?:Mr|Mrs|Ms|Dr|Prof|St)$/iu.test(text.slice(start, match.index))) continue
    const end = match.index + match[0].length
    splitLongSentence(text.slice(start, end))
    start = end
  }
  splitLongSentence(text.slice(start))
  return pieces
}
