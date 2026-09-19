import { describe, expect, it } from 'vitest'
import type { WebProject, WebScriptRow } from '../src/web/project'
import { parseProject, serializeProject } from '../src/web/project'
import { buildSrtContent } from '../src/shared/srt'
import { applyTranslations, displayRows, mergeDisplayedRows, restoreTranslationDraft } from '../src/web/translation-project'

const approvedAt = '2026-09-19T12:00:00.000Z'
function row(id = 'a', content = 'Hello'): WebScriptRow {
  return { id, kind: 'dialogue', startMs: 1000, endMs: 2000, content, speakers: ['Alice'], sourceSegmentIds: ['segment-a'], sourceCueIds: ['cue-a'], reviewed: true, reviewStatus: 'approved', approvedAt }
}
function project(): WebProject {
  return { schemaVersion: 1, id: 'project', title: 'Test', updatedAt: approvedAt, mediaName: 'video.mp4', durationMs: 60000, rows: [row(), { ...row('gap', '장면 해설'), kind: 'descriptionGap', startMs: 2000, endMs: 4000 }], source: 'manual', transcriptionLanguage: 'english', translationSourceLanguage: 'en' }
}
const result = { rowId: 'a', sourceContent: 'Hello', content: '안녕하세요' }
function translated(): WebProject { return applyTranslations(project(), [result]) }

describe('web translation project operations', () => {
  it('applies translations atomically without changing original content, timing, IDs or provenance', () => {
    const source = project(), before = structuredClone(source)
    const next = applyTranslations(source, [result])
    expect(source).toEqual(before)
    expect(next.dialogueLanguage).toBe('korean')
    expect(next.rows[0]).toEqual({ ...source.rows[0], translation: { sourceContent: 'Hello', content: '안녕하세요', draft: '안녕하세요', reviewed: false } })
    expect(next.rows[1]).toEqual(source.rows[1])
  })

  it('projects translated content and independent review state while leaving descriptions unchanged', () => {
    const source = translated()
    expect(displayRows(source)[0]).toMatchObject({ content: '안녕하세요', reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined })
    expect(displayRows(source)[0]).not.toHaveProperty('translation')
    expect(displayRows(source)[1]).toEqual(source.rows[1])
    expect(displayRows({ ...source, dialogueLanguage: 'original' })[0]).toMatchObject({ content: 'Hello', reviewed: true, approvedAt })
  })

  it('exports the selected dialogue language with identical times while JSON keeps both versions', () => {
    const source = translated()
    const korean = buildSrtContent(displayRows(source), false)
    const original = buildSrtContent(displayRows({ ...source, dialogueLanguage: 'original' }), false)
    expect(korean).toContain('00:00:01,000 --> 00:00:02,000\r\n안녕하세요')
    expect(korean).not.toContain('Hello')
    expect(original).toContain('00:00:01,000 --> 00:00:02,000\r\nHello')
    expect(original).not.toContain('안녕하세요')
    const backup = JSON.parse(serializeProject(source))
    expect(backup.rows[0].content).toBe('Hello')
    expect(backup.rows[0].translation).toMatchObject({ content: '안녕하세요', draft: '안녕하세요', sourceContent: 'Hello' })
  })

  it('shows a stale approved translation from a backup as unreviewed without discarding it', () => {
    const source = translated()
    source.rows[0].content = 'Good morning'
    source.rows[0].translation = { ...source.rows[0].translation!, reviewed: true, approvedAt }
    const restored = parseProject(serializeProject(source))
    expect(displayRows(restored)[0]).toMatchObject({ content: '안녕하세요', reviewed: false, reviewStatus: 'unreviewed', approvedAt: undefined })
    expect(restored.rows[0]).toMatchObject({ content: 'Good morning', translation: { content: '안녕하세요', sourceContent: 'Hello', draft: '안녕하세요' } })
    expect(displayRows({ ...restored, dialogueLanguage: 'original' })[0].reviewed).toBe(true)
  })

  it('edits and approves Korean independently, preserving original approval and the machine draft', () => {
    const source = translated()
    const shown = displayRows(source)
    shown[0] = { ...shown[0], content: '반갑습니다', reviewed: true, reviewStatus: 'approved', approvedAt }
    const changed = mergeDisplayedRows(source, shown)
    expect(changed[0]).toMatchObject({ content: 'Hello', reviewed: true, approvedAt, translation: { content: '반갑습니다', draft: '안녕하세요', reviewed: false } })
    const edited = { ...source, rows: changed }
    const reviewed = displayRows(edited).map(item => ({ ...item, reviewed: true, reviewStatus: 'approved' as const, approvedAt }))
    const approved = mergeDisplayedRows(edited, reviewed)
    expect(approved[0].translation).toMatchObject({ reviewed: true, approvedAt })
    expect(approved[0].content).toBe('Hello')
    expect(source.rows[0].translation?.content).toBe('안녕하세요')
  })

  it('restores the initial translation without replacing original text or time and supports undo snapshots', () => {
    const source = translated()
    const edited = { ...source, rows: source.rows.map(item => item.translation ? { ...item, translation: { ...item.translation, content: '수정한 번역', reviewed: true, approvedAt } } : item) }
    const before = structuredClone(edited)
    const restored = restoreTranslationDraft(edited, 'a')
    expect(edited).toEqual(before)
    expect(restored.rows[0]).toMatchObject({ content: 'Hello', startMs: 1000, endMs: 2000, reviewed: true, translation: { sourceContent: 'Hello', content: '안녕하세요', draft: '안녕하세요', reviewed: false, approvedAt: undefined } })
    expect(restored.rows[1]).toEqual(edited.rows[1])
    expect(restoreTranslationDraft(edited).rows).toEqual(restored.rows)
  })

  it('marks source edits stale but preserves the Korean edit, original translation input, and draft', () => {
    const source = { ...translated(), dialogueLanguage: 'original' as const }
    source.rows[0].translation = { ...source.rows[0].translation!, reviewed: true, approvedAt }
    const shown = displayRows(source)
    shown[0] = { ...shown[0], content: 'Good morning', reviewed: true }
    const merged = mergeDisplayedRows(source, shown)
    expect(merged[0]).toMatchObject({ content: 'Good morning', reviewed: false, approvedAt: undefined, translation: { sourceContent: 'Hello', content: '안녕하세요', draft: '안녕하세요', reviewed: false, approvedAt: undefined } })
    expect(displayRows({ ...source, rows: merged, dialogueLanguage: 'korean' })[0].content).toBe('안녕하세요')
  })

  it.each(['startMs', 'endMs', 'speakers', 'kind'] as const)('invalidates both language approvals after %s changes', field => {
    const source = translated()
    source.rows[0].translation = { ...source.rows[0].translation!, reviewed: true, approvedAt }
    const shown = displayRows(source)
    const patch = field === 'speakers' ? { speakers: ['Bob'] } : field === 'kind' ? { kind: 'descriptionGap' as const } : { [field]: field === 'startMs' ? 1100 : 2100 }
    shown[0] = { ...shown[0], ...patch }
    const merged = mergeDisplayedRows(source, shown)
    expect(merged[0]).toMatchObject({ content: 'Hello', reviewed: false, approvedAt: undefined, translation: { content: '안녕하세요', reviewed: false, approvedAt: undefined } })
  })

  it('keeps description editing independent from Korean dialogue and supports deletion/addition', () => {
    const source = translated()
    const shown = displayRows(source)
    shown[1] = { ...shown[1], content: '바뀐 장면' }
    const newRow = { ...row('new', '직접 쓴 한국어'), reviewed: false }
    const merged = mergeDisplayedRows(source, [shown[1], newRow])
    expect(merged.map(item => item.id)).toEqual(['gap', 'new'])
    expect(merged[0]).toMatchObject({ content: '바뀐 장면', reviewed: false })
    expect(merged[1]).toMatchObject({ content: '', translation: { sourceContent: '', content: '직접 쓴 한국어', draft: '', reviewed: false } })
  })

  it('does not overwrite untranslated original text when manually editing in Korean mode', () => {
    const source = { ...project(), dialogueLanguage: 'korean' as const }
    const shown = displayRows(source)
    shown[0] = { ...shown[0], content: '수동 번역' }
    expect(mergeDisplayedRows(source, shown)[0]).toMatchObject({ content: 'Hello', translation: { sourceContent: 'Hello', content: '수동 번역', draft: '', reviewed: false } })
  })

  it('preserves manually written Korean with no machine draft during restore-all and retranslation', () => {
    const source = translated()
    const manual: WebScriptRow = { ...row('manual', ''), translation: { sourceContent: '', content: '직접 쓴 대사', draft: '', reviewed: true, approvedAt } }
    source.rows.push(manual)
    const restored = restoreTranslationDraft(source)
    expect(restored.rows.at(-1)).toEqual(manual)
    expect(() => restoreTranslationDraft(source, 'manual')).toThrow(/초안/)
    expect(applyTranslations(source, [result]).rows.at(-1)).toEqual(manual)
  })

  it.each([
    [],
    [result, result],
    [{ ...result, rowId: 'unknown' }],
    [{ ...result, rowId: 'gap', sourceContent: '장면 해설' }],
    [{ ...result, sourceContent: 'Outdated source' }],
    [{ ...result, content: ' ' }],
    [{ ...result, content: '가'.repeat(10001) }]
  ].map(results => ({ results })))('rejects incomplete, stale, duplicate or invalid batch results without mutating existing work (%#)', ({ results }) => {
    const source = translated(), before = structuredClone(source)
    expect(() => applyTranslations(source, results)).toThrow(/번역|원문/)
    expect(source).toEqual(before)
  })

  it('excludes blank original rows but requires every nonblank dialogue result before applying anything', () => {
    const source = project()
    source.rows.push(row('b', 'Goodbye'), row('blank', '  '))
    expect(() => applyTranslations(source, [result])).toThrow()
    expect(applyTranslations(source, [result, { rowId: 'b', sourceContent: 'Goodbye', content: '잘 가요' }]).rows[3].translation).toBeUndefined()
  })
})
