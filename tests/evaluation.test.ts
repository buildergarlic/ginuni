import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateWorkflow } from '../src/main/services/evaluation'

const manifest = () => ({
  datasetId: 'synthetic-dialogue-v1', version: '1.0.0', split: 'test', rightsConfirmed: true, referenceReviewed: true,
  candidate: { provider: 'synthetic', model: 'fixture', version: '1', configuration: { temperature: 0 } },
  separation: { tuningGroupIds: ['tuning-program'], validationGroupIds: ['validation-program'] },
  normalization: { unicode: 'NFC', trim: true, spaces: 'collapse', cerWhitespace: 'exclude', punctuation: 'retain', werTokens: 'whitespace' },
  clips: [
    { clipId: 'c1', groupId: 'program-a/speaker-a', reference: '서울 역', hypothesis: '서울역', hotwords: ['서울', '부산'], durationMs: 1000, processingMs: 500, reviewMs: 250, cost: 0.1 },
    { clipId: 'c2', groupId: 'program-b/speaker-b', reference: '안녕', hypothesis: '안녕!', hotwords: ['안녕'], durationMs: 2000, processingMs: 1000 }
  ],
  acceptance: { maxCer: 0.2, maxWer: 0.8, minHotwordRecall: 1, minHumanReviewedTestSamples: 2 }
})

describe('evaluateWorkflow', () => {
  it.each(['tuningGroupIds', 'validationGroupIds'] as const)('blocks test candidates with overlapping %s or missing separation declarations', field => {
    const input = manifest()
    input.clips = input.clips.map((clip) => ({ ...clip, hypothesis: clip.reference }))
    input.separation[field] = ['program-a/speaker-a']
    expect(evaluateWorkflow(input).candidateForReview).toBe(false)
    expect(evaluateWorkflow(input).separation).toMatchObject({ status: 'overlap', overlappingGroupIds: ['program-a/speaker-a'] })
    const { separation: _separation, ...undeclared } = input
    expect(evaluateWorkflow(undeclared).separation.status).toBe('unknown')
    expect(evaluateWorkflow(undeclared).candidateForReview).toBe(false)
  })

  it('preserves declared experiment identity and normalization without claiming independent verification', () => {
    const input = manifest()
    const report = evaluateWorkflow(input)
    expect(report.candidate).toEqual(input.candidate)
    expect(report.normalization).toEqual(input.normalization)
    expect(report.declarations).toEqual({ rightsConfirmed: true, referenceReviewed: true, independentlyVerified: false })
    const { candidate: _candidate, ...missing } = input
    expect(() => evaluateWorkflow(missing)).toThrow(/candidate/)
    expect(() => evaluateWorkflow({ ...input, candidate: { ...input.candidate, version: '' } })).toThrow(/candidate/)
    expect(() => evaluateWorkflow({ ...input, candidate: { provider: 'fixture', model: 'fixture', version: '1' } })).toThrow(/configuration/)
  })
  it('uses summed corpus counts and counts only hotwords occurring in references', () => {
    const report = evaluateWorkflow(manifest())
    expect(report.metrics.cer).toEqual({ edits: 1, referenceUnits: 5, rate: 1 / 5 })
    expect(report.metrics.wer).toEqual({ edits: 3, referenceUnits: 3, rate: 1 })
    expect(report.metrics.hotwordRecall).toEqual({ matched: 2, referenceOccurrences: 2, rate: 1 })
    expect(report.candidateForReview).toBe(false)
  })

  it('reports insertions for empty references but null rates and missing measurements as null', () => {
    const input = manifest()
    input.clips = [{ clipId: 'c1', groupId: 'program-a/speaker-a', reference: '', hypothesis: '추가', hotwords: ['없는말'] }] as typeof input.clips
    input.acceptance = { maxCer: 1, maxWer: 1, minHotwordRecall: 0, minHumanReviewedTestSamples: 1 }
    const report = evaluateWorkflow(input)
    expect(report.metrics.cer).toEqual({ edits: 2, referenceUnits: 0, rate: null })
    expect(report.metrics.wer).toEqual({ edits: 1, referenceUnits: 0, rate: null })
    expect(report.metrics.hotwordRecall).toEqual({ matched: 0, referenceOccurrences: 0, rate: null })
    expect(report.timing).toEqual({ durationMs: null, processingMs: null, reviewMs: null, realTimeFactor: null })
    expect(report.cost).toEqual({ total: null, perDurationHour: null })
  })

  it('requires a human-reviewed test split and enough samples before naming a review candidate', () => {
    const input = manifest()
    input.clips = input.clips.map((clip) => ({ ...clip, hypothesis: clip.reference }))
    input.acceptance = { maxCer: 0, maxWer: 0, minHotwordRecall: 1, minHumanReviewedTestSamples: 2 }
    expect(evaluateWorkflow(input).candidateForReview).toBe(true)
    input.split = 'validation'
    expect(evaluateWorkflow(input).candidateForReview).toBe(false)
  })

  it('keeps DER and SubER null unless annotation-backed external results declare provenance', () => {
    const report = evaluateWorkflow(manifest())
    expect(report.metrics.der).toBeNull()
    expect(report.metrics.suber).toBeNull()
    expect(report.limitations.join(' ')).toContain('runtime accuracy')
  })

  it.each([
    ['unconfirmed rights', { rightsConfirmed: false }],
    ['unreviewed reference', { referenceReviewed: false }],
    ['duplicate clip id', { clips: [manifest().clips[0], manifest().clips[0]] }],
    ['non-finite timing', { clips: [{ ...manifest().clips[0], processingMs: Number.NaN }] }]
  ])('rejects invalid manifests: %s', (_name, change) => {
    expect(() => evaluateWorkflow({ ...manifest(), ...change })).toThrow()
  })
})

describe('evaluate-workflow CLI', () => {
  const run = (value: unknown) => {
    const directory = mkdtempSync(join(tmpdir(), 'ginuni-eval-'))
    const file = join(directory, 'manifest.json')
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
    return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/evaluate-workflow.ts', file], { cwd: process.cwd(), encoding: 'utf8' })
  }

  it('prints a JSON report and exits zero when thresholds pass', () => {
    const input = manifest()
    input.clips = input.clips.map((clip) => ({ ...clip, hypothesis: clip.reference }))
    input.acceptance = { maxCer: 0, maxWer: 0, minHotwordRecall: 1, minHumanReviewedTestSamples: 2 }
    const result = run(input)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).candidateForReview).toBe(true)
  })

  it('exits nonzero for malformed JSON and failed thresholds', () => {
    expect(run('{').status).not.toBe(0)
    expect(run(manifest()).status).not.toBe(0)
  })
})
