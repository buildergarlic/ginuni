// Browser-safe subtitle parser shared with the desktop import service.
import type { SubtitleCue, SubtitleIssue, SubtitlePreviewOptions } from './subtitle-types'
import { validateSubtitleCues } from './subtitle-rows'

const MAX_CUES = 100_000
const SRT_TIME = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})'
const SRT_RANGE = new RegExp(`^${SRT_TIME}\\s*-->\\s*${SRT_TIME}\\s*$`)
const KNOWN_FORMATTING_TAG = /<\/?(?:b|i|u|font)(?:\s+[^<>]*)?>/gi

function issue(code: SubtitleIssue['code'], severity: SubtitleIssue['severity'], message: string, ordinal?: number): SubtitleIssue {
  return ordinal === undefined ? { code, severity, message } : { code, severity, ordinal, message }
}

function timestampToMs(parts: RegExpMatchArray, offset: number): number {
  const hours = Number(parts[offset])
  const minutes = Number(parts[offset + 1])
  const seconds = Number(parts[offset + 2])
  const milliseconds = Number(parts[offset + 3])
  return (((hours * 60) + minutes) * 60 + seconds) * 1_000 + milliseconds
}

function stripKnownFormatting(value: string): { text: string; converted: boolean } {
  let converted = false
  const text = value.replace(KNOWN_FORMATTING_TAG, () => {
    converted = true
    return ''
  })
  return { text, converted }
}

export function decodeSubtitleBytes(bytes: Uint8Array, encoding?: SubtitlePreviewOptions['encoding']): { text: string; encoding: string } {
  let selected = encoding
  let content = bytes

  if (!selected) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      selected = 'utf-8'
      content = bytes.subarray(3)
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      selected = 'utf-16le'
      content = bytes.subarray(2)
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      selected = 'utf-16be'
      content = bytes.subarray(2)
    } else {
      selected = 'utf-8'
    }
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && selected === 'utf-8') {
    content = bytes.subarray(3)
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe && selected === 'utf-16le') {
    content = bytes.subarray(2)
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff && selected === 'utf-16be') {
    content = bytes.subarray(2)
  }

  try {
    const text = new TextDecoder(selected, { fatal: true }).decode(content).replace(/^\uFEFF/, '')
    return { text, encoding: selected }
  } catch {
    throw new Error('자막 인코딩을 확인할 수 없습니다. UTF-8, UTF-16 또는 EUC-KR을 명시적으로 선택해 주세요.')
  }
}

export function parseSrt(text: string, assetId: string): { cues: SubtitleCue[]; issues: SubtitleIssue[] } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n[ \t]*\n/).filter(block => block.trim().length > 0)
  const cues: SubtitleCue[] = []
  const issues: SubtitleIssue[] = []

  if (blocks.length === 0) {
    issues.push(issue('syntax', 'error', '자막 큐가 없습니다.'))
    return { cues, issues }
  }
  if (blocks.length > MAX_CUES) {
    issues.push(issue('range', 'error', `자막 큐는 ${MAX_CUES.toLocaleString()}개를 초과할 수 없습니다.`))
  }

  for (const [blockIndex, block] of blocks.slice(0, MAX_CUES).entries()) {
    const lines = block.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const ordinalText = lines[0]?.trim() ?? ''
    const ordinal = Number(ordinalText)
    const issueOrdinal = Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : blockIndex + 1

    if (!/^\d+$/.test(ordinalText) || !Number.isSafeInteger(ordinal) || ordinal <= 0) {
      issues.push(issue('syntax', 'error', '자막 번호가 올바른 양의 정수가 아닙니다.', issueOrdinal))
      continue
    }

    const timing = lines[1]?.match(SRT_RANGE)
    if (!timing) {
      issues.push(issue('syntax', 'error', 'SRT 시간 형식이 올바르지 않습니다.', ordinal))
      continue
    }

    const contentLines = lines.slice(2)
    const embeddedCueHeader = contentLines.findIndex((line, index) => /^\d+$/.test(line.trim()) && SRT_RANGE.test(contentLines[index + 1]?.trim() ?? ''))
    if (embeddedCueHeader >= 0) {
      issues.push(issue('syntax', 'error', '자막 큐 사이의 빈 줄이 없습니다. 원본 SRT 구분을 확인해 주세요.', ordinal))
      continue
    }

    const converted = stripKnownFormatting(contentLines.join('\n'))
    if (converted.converted) {
      issues.push(issue('style', 'warning', '지원하는 SRT 서식 태그를 일반 텍스트로 변환했습니다.', ordinal))
    }
    cues.push({
      id: globalThis.crypto.randomUUID(),
      assetId,
      ordinal,
      startMs: timestampToMs(timing, 1),
      endMs: timestampToMs(timing, 5),
      text: converted.text
    })
  }

  return { cues, issues: [...issues, ...validateSubtitleCues(cues)] }
}
