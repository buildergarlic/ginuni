export interface SubtitleAsset {
  id: string
  fileName: string
  sha256: string
  encoding: string
  language: string
  sourceKind: 'provided-srt' | 'ocr-srt'
  declaredAuthority: 'festival-provided' | 'support-produced' | 'unknown'
  importedAt: string
  originalRelativePath: string
}

export interface SubtitleCue {
  id: string
  assetId: string
  ordinal: number
  startMs: number
  endMs: number
  text: string
}

export interface SubtitleIssue {
  code: 'encoding' | 'syntax' | 'range' | 'overlap' | 'style'
  severity: 'error' | 'warning'
  ordinal?: number
  message: string
}

export interface SubtitleResolution {
  cueIds: string[]
  startMs: number
  endMs: number
  text?: string
  reason: string
}

export interface SubtitleImportRecord {
  id: string
  assetId: string
  at: string
  cueCount: number
  appliedRowCount: number
  offsetMs: number
  resolutions: SubtitleResolution[]
}

export interface SubtitleWorkspace {
  version: 1
  assets: SubtitleAsset[]
  cues: SubtitleCue[]
  imports: SubtitleImportRecord[]
  activeAssetId?: string
}

export interface SubtitlePreviewOptions {
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be' | 'euc-kr'
  sourceKind?: SubtitleAsset['sourceKind']
  declaredAuthority?: SubtitleAsset['declaredAuthority']
}

export interface SubtitlePreview {
  previewId: string
  asset: SubtitleAsset
  cues: SubtitleCue[]
  issues: SubtitleIssue[]
  expectedRevision: number
  durationMs: number
}
