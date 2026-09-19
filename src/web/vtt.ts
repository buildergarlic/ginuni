import type { ScriptRow } from '../shared/types'
import { formatSrtTimestamp } from '../shared/srt'

function cuePayload(row: ScriptRow, includeSpeakerLabels: boolean): string {
  let content = row.content
  if (includeSpeakerLabels && row.speakers.length) {
    const label = `[${row.speakers.join(', ')}]`
    if (!content.startsWith(label)) content = `${label} ${content}`
  }
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    // An empty payload line terminates a WebVTT cue. NBSP keeps its visual spacing.
    .map(line => /^[ \t]*$/.test(line) ? '\u00a0' : line)
    .join('\n')
}

/** Serialize display subtitles independently from SRT; never rewrite dialogue text as timestamps. */
export function buildWebVttContent(rows: ScriptRow[], includeSpeakerLabels = true): string {
  const dialogue = rows.filter(row => row.kind === 'dialogue')
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  if (!dialogue.length) return ''
  const cues = dialogue.map((row, index) => {
    // Reuse only the numeric time formatter, not the SRT document or its payload.
    const start = formatSrtTimestamp(row.startMs).replace(',', '.')
    const end = formatSrtTimestamp(row.endMs).replace(',', '.')
    return `${index + 1}\n${start} --> ${end}\n${cuePayload(row, includeSpeakerLabels)}`
  })
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}
