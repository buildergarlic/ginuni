import type { ScriptRow } from './types'
import type { SubtitleCue, SubtitleIssue, SubtitleResolution } from './subtitle-types'

const MAX_ITEMS = 100_000
const MAX_TEXT_LENGTH = 10_000

type SubtitleScriptRow = ScriptRow & { sourceCueIds: string[] }

function issue(code: SubtitleIssue['code'], message: string, ordinal?: number): SubtitleIssue {
  return ordinal === undefined
    ? { code, severity: 'error', message }
    : { code, severity: 'error', ordinal, message }
}

function isIntegerTime(value: number): boolean {
  return Number.isSafeInteger(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertCueCollection(cues: SubtitleCue[]): void {
  if (!Array.isArray(cues)) throw new Error('자막 큐 배열이 올바르지 않습니다.')
  for (const cue of cues) {
    if (!isObject(cue)
      || typeof cue.id !== 'string'
      || typeof cue.assetId !== 'string'
      || typeof cue.ordinal !== 'number'
      || typeof cue.startMs !== 'number'
      || typeof cue.endMs !== 'number'
      || typeof cue.text !== 'string') {
      throw new Error('자막 큐 입력 형식이 올바르지 않습니다.')
    }
  }
}

export function validateSubtitleCues(cues: SubtitleCue[]): SubtitleIssue[] {
  assertCueCollection(cues)
  const issues: SubtitleIssue[] = []
  const ids = new Set<string>()
  const ordinalsByAsset = new Map<string, Set<number>>()
  const previousStartByAsset = new Map<string, number>()

  if (cues.length > MAX_ITEMS) {
    issues.push(issue('range', `자막 큐는 ${MAX_ITEMS.toLocaleString()}개를 초과할 수 없습니다.`))
  }

  cues.forEach((cue) => {
    if (!cue.id.trim() || ids.has(cue.id)) issues.push(issue('syntax', '자막 큐 ID가 비어 있거나 중복되었습니다.', cue.ordinal))
    ids.add(cue.id)
    if (!cue.assetId.trim()) issues.push(issue('syntax', '자막 자료 ID가 비어 있습니다.', cue.ordinal))
    const assetOrdinals = ordinalsByAsset.get(cue.assetId) ?? new Set<number>()
    if (!Number.isSafeInteger(cue.ordinal) || cue.ordinal <= 0 || assetOrdinals.has(cue.ordinal)) {
      issues.push(issue('syntax', '자막 번호가 올바르지 않거나 중복되었습니다.', cue.ordinal))
    }
    assetOrdinals.add(cue.ordinal)
    ordinalsByAsset.set(cue.assetId, assetOrdinals)
    if (!cue.text.trim()) issues.push(issue('syntax', '자막 문장이 비어 있습니다.', cue.ordinal))
    else if (cue.text.length > MAX_TEXT_LENGTH) issues.push(issue('range', `자막 문장은 ${MAX_TEXT_LENGTH.toLocaleString()}자를 초과할 수 없습니다.`, cue.ordinal))
    if (!isIntegerTime(cue.startMs) || !isIntegerTime(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) {
      issues.push(issue('range', '자막 시작과 종료는 음수가 아닌 정수 밀리초이며 종료가 시작보다 뒤여야 합니다.', cue.ordinal))
    }
    const previousStart = previousStartByAsset.get(cue.assetId)
    if (previousStart !== undefined && isIntegerTime(cue.startMs) && cue.startMs < previousStart) {
      issues.push({ code: 'range', severity: 'warning', ordinal: cue.ordinal, message: '원본 자막 시간이 앞 큐보다 이르므로 적용 행은 시간순으로 정렬됩니다.' })
    }
    if (isIntegerTime(cue.startMs)) previousStartByAsset.set(cue.assetId, cue.startMs)
  })

  const cuesByAsset = new Map<string, Array<{ cue: SubtitleCue; index: number }>>()
  cues.forEach((cue, index) => {
    if (!isIntegerTime(cue.startMs) || !isIntegerTime(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) return
    const assetCues = cuesByAsset.get(cue.assetId) ?? []
    assetCues.push({ cue, index })
    cuesByAsset.set(cue.assetId, assetCues)
  })
  for (const assetCues of cuesByAsset.values()) {
    assetCues.sort((left, right) => left.cue.startMs - right.cue.startMs || left.cue.endMs - right.cue.endMs || left.index - right.index)
    let furthestEnd = -1
    for (const { cue } of assetCues) {
      if (cue.startMs < furthestEnd) issues.push(issue('overlap', '원본 자막 큐가 앞 큐와 겹칩니다. 적용 전에 명시적으로 해결해야 합니다.', cue.ordinal))
      furthestEnd = Math.max(furthestEnd, cue.endMs)
    }
  }
  return issues
}

function resolutionError(message: string): never {
  throw new Error(`자막 겹침 해결값이 올바르지 않습니다: ${message}`)
}

function validateGenerationInput(cues: SubtitleCue[], offsetMs: number, resolutions: SubtitleResolution[]): Map<string, SubtitleCue> {
  assertCueCollection(cues)
  if (!Array.isArray(resolutions)) resolutionError('해결값 배열이 올바르지 않습니다.')
  if (!isIntegerTime(offsetMs)) resolutionError('전체 시간차는 유한한 정수 밀리초여야 합니다.')
  if (cues.length > MAX_ITEMS || resolutions.length > MAX_ITEMS) resolutionError(`배열은 ${MAX_ITEMS.toLocaleString()}개를 초과할 수 없습니다.`)

  const cuesById = new Map<string, SubtitleCue>()
  for (const cue of cues) {
    if (!cue.id || cuesById.has(cue.id)) resolutionError('원본 자막 큐 ID가 비어 있거나 중복되었습니다.')
    cuesById.set(cue.id, cue)
  }

  const resolvedCueIds = new Set<string>()
  for (const resolution of resolutions) {
    if (!isObject(resolution)
      || !Array.isArray(resolution.cueIds)
      || typeof resolution.startMs !== 'number'
      || typeof resolution.endMs !== 'number'
      || typeof resolution.reason !== 'string'
      || (resolution.text !== undefined && typeof resolution.text !== 'string')) {
      resolutionError('해결값 입력 형식이 올바르지 않습니다.')
    }
    if (resolution.cueIds.length === 0 || resolution.cueIds.length > MAX_ITEMS) resolutionError('해결할 자막 큐 ID 개수가 올바르지 않습니다.')
    if (!resolution.reason.trim()) resolutionError('변경 이유가 비어 있습니다.')
    if (!isIntegerTime(resolution.startMs) || !isIntegerTime(resolution.endMs) || resolution.startMs < 0 || resolution.endMs <= resolution.startMs) {
      resolutionError('시작과 종료는 음수가 아닌 정수 밀리초이며 종료가 시작보다 뒤여야 합니다.')
    }
    if (resolution.text !== undefined && (!resolution.text.trim() || resolution.text.length > MAX_TEXT_LENGTH)) {
      resolutionError('수정 문장이 비어 있거나 너무 깁니다.')
    }

    const groupIds = new Set<string>()
    for (const cueId of resolution.cueIds) {
      if (typeof cueId !== 'string' || !cueId || groupIds.has(cueId) || resolvedCueIds.has(cueId)) resolutionError('같은 자막 큐 ID를 해결값에서 두 번 사용할 수 없습니다.')
      if (!cuesById.has(cueId)) resolutionError('미리보기에 없는 자막 큐 ID가 포함되어 있습니다.')
      groupIds.add(cueId)
      resolvedCueIds.add(cueId)
    }
  }
  return cuesById
}

function makeRow(startMs: number, endMs: number, content: string, sourceCueIds: string[]): SubtitleScriptRow {
  return {
    id: globalThis.crypto.randomUUID(),
    kind: 'dialogue',
    startMs,
    endMs,
    speakers: [],
    content,
    sourceSegmentIds: [],
    sourceCueIds,
    reviewed: false
  }
}

export function generateSubtitleRows(cues: SubtitleCue[], offsetMs: number, resolutions: SubtitleResolution[] = []): ScriptRow[] {
  const cuesById = validateGenerationInput(cues, offsetMs, resolutions)
  const resolvedCueIds = new Set(resolutions.flatMap(resolution => resolution.cueIds))
  const rows: Array<{ row: SubtitleScriptRow; ordinal: number }> = []

  for (const cue of cues) {
    if (resolvedCueIds.has(cue.id)) continue
    rows.push({ row: makeRow(cue.startMs + offsetMs, cue.endMs + offsetMs, cue.text, [cue.id]), ordinal: cue.ordinal })
  }

  for (const resolution of resolutions) {
    const sourceCues = resolution.cueIds
      .map(cueId => cuesById.get(cueId)!)
      .sort((left, right) => left.ordinal - right.ordinal)
    rows.push({
      row: makeRow(
        resolution.startMs,
        resolution.endMs,
        resolution.text ?? sourceCues.map(cue => cue.text).join('\n'),
        sourceCues.map(cue => cue.id)
      ),
      ordinal: sourceCues[0].ordinal
    })
  }

  return rows
    .sort((left, right) => left.row.startMs - right.row.startMs || left.row.endMs - right.row.endMs || left.ordinal - right.ordinal)
    .map(item => item.row)
}

export function validateSubtitleRows(rows: ScriptRow[], durationMs: number): SubtitleIssue[] {
  if (!Array.isArray(rows)) throw new Error('자막 행 배열이 올바르지 않습니다.')
  for (const row of rows) {
    if (!isObject(row) || typeof row.startMs !== 'number' || typeof row.endMs !== 'number' || typeof row.content !== 'string') {
      throw new Error('자막 행 입력 형식이 올바르지 않습니다.')
    }
  }
  if (!isIntegerTime(durationMs) || durationMs < 0) {
    throw new Error('영상 길이 durationMs는 음수가 아닌 유한한 정수 밀리초여야 합니다.')
  }

  const issues: SubtitleIssue[] = []
  if (rows.length > MAX_ITEMS) issues.push(issue('range', `자막 행은 ${MAX_ITEMS.toLocaleString()}개를 초과할 수 없습니다.`))

  const validRows: Array<{ row: ScriptRow; ordinal: number }> = []
  rows.forEach((row, index) => {
    const ordinal = index + 1
    if (!isIntegerTime(row.startMs) || !isIntegerTime(row.endMs) || row.startMs < 0 || row.endMs <= row.startMs || row.endMs > durationMs) {
      issues.push(issue('range', '자막 행 시간이 영상 범위 안의 올바른 정수 밀리초가 아닙니다.', ordinal))
      return
    }
    if (!row.content.trim()) issues.push(issue('syntax', '자막 행 문장이 비어 있습니다.', ordinal))
    validRows.push({ row, ordinal })
  })

  validRows.sort((left, right) => left.row.startMs - right.row.startMs || left.row.endMs - right.row.endMs || left.ordinal - right.ordinal)
  let furthestEnd = -1
  for (const { row, ordinal } of validRows) {
    if (row.startMs < furthestEnd) issues.push(issue('overlap', '적용된 자막 행이 앞 행과 겹칩니다.', ordinal))
    furthestEnd = Math.max(furthestEnd, row.endMs)
  }
  return issues
}
