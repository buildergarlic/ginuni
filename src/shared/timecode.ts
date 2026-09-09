export function floorToSecond(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000) * 1000)
}

export function ceilToSecond(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000) * 1000)
}

export function formatTimecode(ms: number): string {
  const totalMilliseconds = Math.max(0, Math.floor(ms))
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const fraction = totalMilliseconds % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`
}

export function parseTimecode(value: string): number | null {
  const match = /^\s*(\d+):([0-5]\d)(?:\.(\d{1,3}))?\s*$/.exec(value)
  if (!match) return null
  const ms = (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? '').padEnd(3, '0'))
  return Number.isSafeInteger(ms) ? ms : null
}

export function intervalSeconds(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / 1000))
}
