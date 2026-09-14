import type { SubtitleWorkspace } from '@shared/subtitle-types'

const text = (value: unknown): value is string => typeof value === 'string'
const uniqueIds = (items: Array<{ id: string }>): boolean => items.every(item => item && text(item.id) && item.id.length > 0) && new Set(items.map(item => item.id)).size === items.length
const MAX_RESOLUTIONS = 100000
const MAX_RESOLUTION_CUE_IDS = 100000
const MAX_TEXT_LENGTH = 10000

export function validateSubtitleWorkspace(value: unknown): asserts value is SubtitleWorkspace | undefined {
  if (value === undefined) return
  const w = value as SubtitleWorkspace
  const invalid = (): never => { throw new Error('자막 원본 데이터가 올바르지 않습니다.') }
  if (!w || w.version !== 1 || !Array.isArray(w.assets) || !Array.isArray(w.cues) || !Array.isArray(w.imports)
    || w.assets.length > 1000 || w.cues.length > 100000 || w.imports.length > 10000
    || !uniqueIds(w.assets) || !uniqueIds(w.cues) || !uniqueIds(w.imports)) invalid()
  const assetIds = new Set(w.assets.map(a => a.id))
  if (w.activeAssetId !== undefined && !assetIds.has(w.activeAssetId)) invalid()
  for (const a of w.assets) {
    if (!text(a.fileName) || !text(a.encoding) || !text(a.language) || !text(a.importedAt)
      || !/^[a-f0-9]{64}$/.test(a.sha256) || !['provided-srt', 'ocr-srt'].includes(a.sourceKind)
      || !['festival-provided', 'support-produced', 'unknown'].includes(a.declaredAuthority)
      || !/^subtitles\/[a-zA-Z0-9_-]+\.srt$/.test(a.originalRelativePath)) invalid()
  }
  const cues = new Map(w.cues.map(c => [c.id, c]))
  const ordinalsByAsset = new Map<string, Set<number>>()
  for (const c of w.cues) {
    const ordinals = ordinalsByAsset.get(c.assetId) ?? new Set<number>()
    if (!assetIds.has(c.assetId) || !Number.isSafeInteger(c.ordinal) || c.ordinal <= 0 || ordinals.has(c.ordinal)
      || !Number.isSafeInteger(c.startMs) || !Number.isSafeInteger(c.endMs) || c.startMs < 0 || c.endMs <= c.startMs
      || !text(c.text) || !c.text.trim() || c.text.length > MAX_TEXT_LENGTH) invalid()
    ordinals.add(c.ordinal)
    ordinalsByAsset.set(c.assetId, ordinals)
  }
  for (const r of w.imports) {
    if (!assetIds.has(r.assetId) || !text(r.at) || !Number.isSafeInteger(r.offsetMs)
      || !Number.isSafeInteger(r.cueCount) || r.cueCount < 0 || !Number.isSafeInteger(r.appliedRowCount) || r.appliedRowCount < 0
      || !Array.isArray(r.resolutions) || r.resolutions.length > MAX_RESOLUTIONS) invalid()
    const resolvedCueIds = new Set<string>()
    for (const resolution of r.resolutions) {
      if (!resolution || !Array.isArray(resolution.cueIds) || !resolution.cueIds.length
        || resolution.cueIds.length > MAX_RESOLUTION_CUE_IDS
        || !Number.isSafeInteger(resolution.startMs) || !Number.isSafeInteger(resolution.endMs)
        || resolution.startMs < 0 || resolution.endMs <= resolution.startMs || !text(resolution.reason) || !resolution.reason.trim()
        || (resolution.text !== undefined && (!text(resolution.text) || !resolution.text.trim() || resolution.text.length > MAX_TEXT_LENGTH))) invalid()
      const cueIds = Array.from(resolution.cueIds)
      if (cueIds.some(id => !text(id) || cues.get(id)?.assetId !== r.assetId || resolvedCueIds.has(id))
        || new Set(cueIds).size !== cueIds.length) invalid()
      cueIds.forEach(id => resolvedCueIds.add(id))
    }
  }
}

/** Keep newer evidence while restoring the snapshot's active input selection. */
export function restoreSubtitleEvidence(current: SubtitleWorkspace | undefined, snapshot: SubtitleWorkspace | undefined): SubtitleWorkspace | undefined {
  if (!current && !snapshot) return undefined
  const union = <T extends { id: string }>(old: T[] = [], live: T[] = []): T[] => [...new Map([...old, ...live].map(v => [v.id, v])).values()]
  return {
    version: 1,
    assets: union(snapshot?.assets, current?.assets), cues: union(snapshot?.cues, current?.cues), imports: union(snapshot?.imports, current?.imports),
    activeAssetId: snapshot?.activeAssetId
  }
}
