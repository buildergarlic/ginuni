export interface EvaluationManifest {
  datasetId: string
  version: string
  candidate: { provider: string; model: string; version: string; configuration: Record<string, unknown> }
  separation?: { tuningGroupIds: string[]; validationGroupIds: string[] }
  split: 'validation' | 'test'
  rightsConfirmed: boolean
  referenceReviewed: boolean
  normalization: {
    unicode: 'NFC'
    trim: true
    spaces: 'collapse'
    cerWhitespace: 'exclude'
    punctuation: 'retain'
    werTokens: 'whitespace'
  }
  clips: Array<{
    clipId: string
    groupId: string
    reference: string
    hypothesis: string
    hotwords: string[]
    durationMs?: number
    processingMs?: number
    reviewMs?: number
    cost?: number
  }>
  acceptance: {
    maxCer: number
    maxWer: number
    minHotwordRecall: number
    minHumanReviewedTestSamples: number
  }
  externalMetrics?: Partial<Record<'der' | 'suber', {
    value: number
    provenance: { tool: string; version: string; annotation: string }
  }>>
}

interface CountMetric { edits: number; referenceUnits: number; rate: number | null }
interface RecallMetric { matched: number; referenceOccurrences: number; rate: number | null }

export interface EvaluationReport {
  candidate: EvaluationManifest['candidate']
  normalization: EvaluationManifest['normalization']
  declarations: { rightsConfirmed: true; referenceReviewed: true; independentlyVerified: false }
  separation: { status: 'unknown' | 'overlap' | 'declared-disjoint'; testGroupIds: string[]; tuningGroupIds: string[] | null; validationGroupIds: string[] | null; overlappingGroupIds: string[] }
  dataset: { datasetId: string; version: string; split: 'validation' | 'test'; sampleCount: number }
  metrics: { cer: CountMetric; wer: CountMetric; hotwordRecall: RecallMetric; der: EvaluationManifest['externalMetrics'] extends infer _T ? number | null : never; suber: number | null }
  externalMetricProvenance: EvaluationManifest['externalMetrics'] | null
  timing: { durationMs: number | null; processingMs: number | null; reviewMs: number | null; realTimeFactor: number | null }
  cost: { total: number | null; perDurationHour: number | null }
  acceptance: EvaluationManifest['acceptance'] & { thresholdsPassed: boolean; humanReviewedTestSetGate: boolean }
  candidateForReview: boolean
  recommendedModelChanged: false
  limitations: string[]
}

const requiredNormalization = {
  unicode: 'NFC', trim: true, spaces: 'collapse', cerWhitespace: 'exclude', punctuation: 'retain', werTokens: 'whitespace'
} as const

function assertFiniteNonnegative(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and nonnegative`)
}

function validate(input: unknown): asserts input is EvaluationManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest must be an object')
  const value = input as Record<string, unknown>
  for (const field of ['datasetId', 'version'] as const) if (typeof value[field] !== 'string' || !value[field]) throw new Error(`${field} is required`)
  if (value.split !== 'validation' && value.split !== 'test') throw new Error('split must be validation or test')
  const candidate = value.candidate as Record<string, unknown> | undefined
  for (const field of ['provider', 'model', 'version']) if (typeof candidate?.[field] !== 'string' || !(candidate[field] as string).trim()) throw new Error(`candidate.${field} is required`)
  if (!candidate?.configuration || typeof candidate.configuration !== 'object' || Array.isArray(candidate.configuration)) throw new Error('candidate.configuration must be an object')
  if (value.separation !== undefined) {
    const separation = value.separation as Record<string, unknown> | null
    for (const field of ['tuningGroupIds', 'validationGroupIds']) {
      const groups = separation?.[field]
      if (!Array.isArray(groups) || groups.some(group => typeof group !== 'string' || !group.trim() || group !== group.trim())) throw new Error(`separation.${field} must declare group IDs (empty array means none)`)
    }
  }
  if (value.rightsConfirmed !== true) throw new Error('evaluation data rights must be confirmed')
  if (value.referenceReviewed !== true) throw new Error('references must be human reviewed')
  const normalization = value.normalization as Record<string, unknown> | undefined
  for (const [key, expected] of Object.entries(requiredNormalization)) if (normalization?.[key] !== expected) throw new Error(`normalization.${key} must be documented as ${expected}`)
  if (!Array.isArray(value.clips) || value.clips.length === 0) throw new Error('clips must be a non-empty array')
  const ids = new Set<string>()
  for (const raw of value.clips) {
    if (!raw || typeof raw !== 'object') throw new Error('clip must be an object')
    const clip = raw as Record<string, unknown>
    for (const field of ['clipId', 'groupId', 'reference', 'hypothesis'] as const) if (typeof clip[field] !== 'string' || (field !== 'reference' && field !== 'hypothesis' && !clip[field])) throw new Error(`clip.${field} is invalid`)
    if (ids.has(clip.clipId as string)) throw new Error('clipId must be unique')
    ids.add(clip.clipId as string)
    if (!Array.isArray(clip.hotwords) || clip.hotwords.some((word) => typeof word !== 'string' || !word.trim())) throw new Error('clip.hotwords must contain nonblank strings')
    for (const field of ['durationMs', 'processingMs', 'reviewMs', 'cost'] as const) if (clip[field] !== undefined) assertFiniteNonnegative(clip[field], `clip.${field}`)
  }
  const acceptance = value.acceptance as Record<string, unknown> | undefined
  for (const field of ['maxCer', 'maxWer', 'minHotwordRecall'] as const) assertFiniteNonnegative(acceptance?.[field], `acceptance.${field}`)
  assertFiniteNonnegative(acceptance?.minHumanReviewedTestSamples, 'acceptance.minHumanReviewedTestSamples')
  if (!Number.isInteger(acceptance!.minHumanReviewedTestSamples) || acceptance!.minHumanReviewedTestSamples === 0) throw new Error('minimum sample count must be a positive integer')
  if ((acceptance!.minHotwordRecall as number) > 1) throw new Error('minimum hotword recall cannot exceed 1')
  if (value.externalMetrics !== undefined) validateExternal(value.externalMetrics)
}

function validateExternal(raw: unknown): void {
  if (!raw || typeof raw !== 'object') throw new Error('externalMetrics must be an object')
  for (const name of ['der', 'suber'] as const) {
    const item = (raw as Record<string, unknown>)[name]
    if (item === undefined) continue
    if (!item || typeof item !== 'object') throw new Error(`${name} requires a verified result`)
    const metric = item as Record<string, unknown>
    assertFiniteNonnegative(metric.value, name)
    const provenance = metric.provenance as Record<string, unknown> | undefined
    for (const field of ['tool', 'version', 'annotation']) if (typeof provenance?.[field] !== 'string' || !provenance[field]) throw new Error(`${name} requires tool, version, and annotation provenance`)
  }
}

function normalize(text: string): string { return text.normalize('NFC').trim().replace(/\s+/gu, ' ') }
function distance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]
}
function occurrences(text: string, term: string): number {
  if (!term) return 0
  let count = 0, position = 0
  while ((position = text.indexOf(term, position)) !== -1) { count++; position += term.length }
  return count
}
function completeTotal(clips: EvaluationManifest['clips'], field: 'durationMs' | 'processingMs' | 'reviewMs' | 'cost'): number | null {
  return clips.every((clip) => clip[field] !== undefined) ? clips.reduce((sum, clip) => sum + clip[field]!, 0) : null
}

export function evaluateWorkflow(input: unknown): EvaluationReport {
  validate(input)
  let charEdits = 0, chars = 0, wordEdits = 0, words = 0, matched = 0, referenceOccurrences = 0
  for (const clip of input.clips) {
    const reference = normalize(clip.reference), hypothesis = normalize(clip.hypothesis)
    const referenceChars = Array.from(reference.replace(/\s/gu, '')), hypothesisChars = Array.from(hypothesis.replace(/\s/gu, ''))
    const referenceWords = reference ? reference.split(' ') : [], hypothesisWords = hypothesis ? hypothesis.split(' ') : []
    charEdits += distance(referenceChars, hypothesisChars); chars += referenceChars.length
    wordEdits += distance(referenceWords, hypothesisWords); words += referenceWords.length
    for (const rawHotword of clip.hotwords) {
      const hotword = normalize(rawHotword)
      const inReference = occurrences(reference, hotword)
      referenceOccurrences += inReference
      matched += Math.min(inReference, occurrences(hypothesis, hotword))
    }
  }
  const rate = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator
  const cer = { edits: charEdits, referenceUnits: chars, rate: rate(charEdits, chars) }
  const wer = { edits: wordEdits, referenceUnits: words, rate: rate(wordEdits, words) }
  const hotwordRecall = { matched, referenceOccurrences, rate: rate(matched, referenceOccurrences) }
  const durationMs = completeTotal(input.clips, 'durationMs'), processingMs = completeTotal(input.clips, 'processingMs'), reviewMs = completeTotal(input.clips, 'reviewMs'), totalCost = completeTotal(input.clips, 'cost')
  const thresholdsPassed = cer.rate !== null && wer.rate !== null && hotwordRecall.rate !== null && cer.rate <= input.acceptance.maxCer && wer.rate <= input.acceptance.maxWer && hotwordRecall.rate >= input.acceptance.minHotwordRecall
  const testGroupIds = input.split === 'test' ? [...new Set(input.clips.map(clip => clip.groupId))] : []
  const nonTestGroups = new Set([...(input.separation?.tuningGroupIds ?? []), ...(input.separation?.validationGroupIds ?? [])])
  const overlappingGroupIds = testGroupIds.filter(group => nonTestGroups.has(group))
  const separation: EvaluationReport['separation'] = {
    status: !input.separation || input.split !== 'test' ? 'unknown' : overlappingGroupIds.length ? 'overlap' : 'declared-disjoint',
    testGroupIds, tuningGroupIds: input.separation?.tuningGroupIds ?? null, validationGroupIds: input.separation?.validationGroupIds ?? null, overlappingGroupIds
  }
  const humanReviewedTestSetGate = input.referenceReviewed && input.split === 'test' && input.clips.length >= input.acceptance.minHumanReviewedTestSamples && separation.status === 'declared-disjoint'
  return {
    candidate: structuredClone(input.candidate), normalization: { ...input.normalization },
    declarations: { rightsConfirmed: true, referenceReviewed: true, independentlyVerified: false }, separation,
    dataset: { datasetId: input.datasetId, version: input.version, split: input.split, sampleCount: input.clips.length },
    metrics: { cer, wer, hotwordRecall, der: input.externalMetrics?.der?.value ?? null, suber: input.externalMetrics?.suber?.value ?? null },
    externalMetricProvenance: input.externalMetrics ?? null,
    timing: { durationMs, processingMs, reviewMs, realTimeFactor: durationMs && processingMs !== null ? processingMs / durationMs : null },
    cost: { total: totalCost, perDurationHour: totalCost !== null && durationMs ? totalCost / (durationMs / 3_600_000) : null },
    acceptance: { ...input.acceptance, thresholdsPassed, humanReviewedTestSetGate },
    candidateForReview: thresholdsPassed && humanReviewedTestSetGate,
    recommendedModelChanged: false,
    limitations: ['This offline report is not a claim of runtime accuracy.', 'Rights, reference review, model identity, and group inventories are submitter declarations, not independently verified facts.', 'Candidate status requires declared disjoint tuning/validation and test groups, developer review, and never changes the recommended model.']
  }
}
