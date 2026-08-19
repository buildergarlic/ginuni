import { DESCRIPTION_GAP_MS, DESCRIPTION_TEXT, MAX_DIALOGUE_ROW_MS } from './constants'
import type { ScriptProject, ScriptRow, TranscriptSegment } from './types'
import { ceilToSecond, floorToSecond } from './timecode'

interface DialogueBlock {
  startMs: number
  endMs: number
  segments: TranscriptSegment[]
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function buildDialogueContent(segments: TranscriptSegment[]): { speakers: string[]; content: string } {
  const speakers = [...new Set(segments.map((segment) => segment.speakerId.trim()).filter(Boolean))]
  const parts: string[] = []
  let lastSpeaker = ''

  for (const segment of segments) {
    const speaker = segment.speakerId.trim()
    if (speaker && speaker !== lastSpeaker) {
      parts.push(`[${speaker}]`)
      lastSpeaker = speaker
    } else if (!speaker) {
      lastSpeaker = ''
    }
    parts.push(normalizeText(segment.text))
  }

  const dialogue = parts.join(' ').trim()
  return {
    speakers,
    content: speakers.length > 0 ? `[${speakers.join(', ')}] ${dialogue}`.trim() : dialogue
  }
}

/**
 * 이전 로컬 분석은 실제 화자 분리를 하지 않으면서 모든 구간을 `화자1`로
 * 기록했다. 저장된 로컬 프로젝트를 열 때 자동 생성된 표기만 제거한다.
 * 사용자가 직접 바꾼 화자명이나 OpenAI 화자 분리 결과는 그대로 둔다.
 */
export function removeLegacyLocalSpeakerLabels(project: ScriptProject): ScriptProject {
  if (project.schemaVersion >= 2) return project
  const successfulRuns = project.runs.filter((run) => run.completedAt && !run.errorCode)
  const lastSuccessfulProvider = successfulRuns.at(-1)?.provider
  const rowsWereGeneratedLocally = lastSuccessfulProvider === 'local'
    || (lastSuccessfulProvider === undefined && project.transcriptionEngine === 'local')

  if (!rowsWereGeneratedLocally) return project

  let changed = false
  const segments = project.segments.map((segment) => {
    if (segment.speakerId !== '화자1') return segment
    changed = true
    return { ...segment, speakerId: '' }
  })
  const rows = project.rows.map((row) => {
    if (row.kind !== 'dialogue' || row.speakers.length !== 1 || row.speakers[0] !== '화자1') return row
    changed = true
    return {
      ...row,
      speakers: [],
      content: row.content.replace(/^(?:\[화자1\]\s*)+/, '').trim()
    }
  })

  return changed ? { ...project, segments, rows } : project
}

function blockToRow(block: DialogueBlock): ScriptRow {
  const { speakers, content } = buildDialogueContent(block.segments)
  return {
    id: globalThis.crypto.randomUUID(),
    kind: 'dialogue',
    startMs: floorToSecond(block.startMs),
    endMs: ceilToSecond(block.endMs),
    speakers,
    content,
    sourceSegmentIds: block.segments.map((segment) => segment.id),
    reviewed: false
  }
}

export function generateScriptRows(segments: TranscriptSegment[], durationMs: number): ScriptRow[] {
  const valid = segments
    .filter((segment) => segment.endMs > segment.startMs && normalizeText(segment.text))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

  const blocks: DialogueBlock[] = []
  let current: DialogueBlock | undefined

  for (const segment of valid) {
    if (!current) {
      current = { startMs: segment.startMs, endMs: segment.endMs, segments: [segment] }
      continue
    }

    const gap = floorToSecond(segment.startMs) - ceilToSecond(current.endMs)
    const projectedDuration = ceilToSecond(segment.endMs) - floorToSecond(current.startMs)
    const shouldSplitForLength = projectedDuration > MAX_DIALOGUE_ROW_MS && current.segments.length > 0

    if (gap >= DESCRIPTION_GAP_MS || shouldSplitForLength) {
      blocks.push(current)
      current = { startMs: segment.startMs, endMs: segment.endMs, segments: [segment] }
    } else {
      current.endMs = Math.max(current.endMs, segment.endMs)
      current.segments.push(segment)
    }
  }
  if (current) blocks.push(current)

  const dialogueRows = blocks.map(blockToRow)
  const rows: ScriptRow[] = []
  let cursorMs = 0

  for (const dialogue of dialogueRows) {
    if (dialogue.startMs - cursorMs >= DESCRIPTION_GAP_MS) {
      rows.push({
        id: globalThis.crypto.randomUUID(),
        kind: 'descriptionGap',
        startMs: cursorMs,
        endMs: dialogue.startMs,
        speakers: [],
        content: DESCRIPTION_TEXT,
        sourceSegmentIds: [],
        reviewed: false
      })
    }
    rows.push(dialogue)
    cursorMs = Math.max(cursorMs, dialogue.endMs)
  }

  const roundedDuration = ceilToSecond(durationMs)
  if (roundedDuration - cursorMs >= DESCRIPTION_GAP_MS) {
    rows.push({
      id: globalThis.crypto.randomUUID(),
      kind: 'descriptionGap',
      startMs: cursorMs,
      endMs: roundedDuration,
      speakers: [],
      content: DESCRIPTION_TEXT,
      sourceSegmentIds: [],
      reviewed: false
    })
  }

  if (rows.length === 0 && roundedDuration >= DESCRIPTION_GAP_MS) {
    rows.push({
      id: globalThis.crypto.randomUUID(),
      kind: 'descriptionGap',
      startMs: 0,
      endMs: roundedDuration,
      speakers: [],
      content: DESCRIPTION_TEXT,
      sourceSegmentIds: [],
      reviewed: false
    })
  }

  return rows
}

export function validateRows(rows: ScriptRow[]): string[] {
  const errors: string[] = []
  const ordered = [...rows].sort((a, b) => a.startMs - b.startMs)
  ordered.forEach((row, index) => {
    if (row.startMs < 0 || row.endMs <= row.startMs) errors.push(`${index + 1}행의 시간 범위가 올바르지 않습니다.`)
    if (!row.content.trim()) errors.push(`${index + 1}행의 내용이 비어 있습니다.`)
    if (index > 0 && row.startMs < ordered[index - 1].endMs) errors.push(`${index}행과 ${index + 1}행의 시간이 겹칩니다.`)
  })
  return errors
}
