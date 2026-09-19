// Browser downloads preserve the desktop document format without a server upload.
import { unzipSync, zipSync, type Zippable } from 'fflate'
import templateUrl from '../../resources/templates/screen-description-template.hwpx?url'
import { renderHwpxEntries } from '../shared/hwpx-document'
import type { ScriptRow } from '../shared/types'

export async function createHwpxBlob(
  title: string,
  rows: ScriptRow[]
): Promise<Blob> {
  const response = await fetch(templateUrl)
  if (!response.ok)
    throw new Error(
      '대본 양식을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'
    )
  const template = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const entries = renderHwpxEntries(
    new Map(Object.entries(template)),
    title,
    rows
  )
  // HWPX requires the mimetype entry first, with no compression.
  const archive: Zippable = {
    mimetype: [entries.get('mimetype')!, { level: 0 }]
  }
  for (const [name, value] of [...entries].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (name === 'mimetype' || name.endsWith('/')) continue
    archive[name] = [value, { level: 6 }]
  }
  const bytes = zipSync(archive)
  return new Blob([Uint8Array.from(bytes).buffer], {
    type: 'application/hwp+zip'
  })
}

export function safeFileName(title: string): string {
  const clean = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, '')
  const name = clean || '새 프로젝트'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ? `_${name}`
    : name
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Keep the URL alive briefly so browsers can start reading the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
