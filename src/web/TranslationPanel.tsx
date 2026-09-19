import type { WebProject } from './project'
import { TRANSLATION_LANGUAGES, translationLanguageForSpeech, type TranslationSourceLanguage } from './languages'

export default function TranslationPanel({ project, busy, onTranslate, onChange, onRestore }: {
  project: WebProject
  busy: boolean
  onTranslate: () => Promise<void>
  onChange: (project: WebProject) => void
  onRestore: () => void
}) {
  const dialogue = project.rows.filter(row => row.kind === 'dialogue')
  if (!dialogue.length) return null
  const sourceRows = dialogue.filter(row => row.content.trim())
  const translated = dialogue.filter(row => row.translation?.content.trim())
  const stale = translated.filter(row => row.translation?.sourceContent !== row.content)
  const missing = sourceRows.filter(row => !row.translation?.content.trim())
  const language = project.translationSourceLanguage ?? translationLanguageForSpeech(project.transcriptionLanguage) ?? 'en'
  const korean = project.dialogueLanguage === 'korean'
  return (
    <section className="translation-panel" aria-label="한국어 대사 번역">
      <div className="translation-intro">
        <strong>한국어로 대사 읽기</strong>
        <p>외국어 대사의 원문과 시간을 보존해 한국어 초안을 만듭니다. 번역은 이 기기에서 처리합니다.</p>
        <small>첫 실행 약 640MB 모델 다운로드 · PC 권장 · 번역 후 원문과 대조해 주세요.</small>
      </div>
      <div className="translation-actions">
        <label>원문 언어
          <select aria-label="번역할 원문 언어" value={language} disabled={busy}
            onChange={event => onChange({ ...project, translationSourceLanguage: event.target.value as TranslationSourceLanguage })}>
            {TRANSLATION_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <button className="primary" disabled={busy || !sourceRows.length} onClick={() => void onTranslate()}>
          {translated.length ? '한국어로 다시 번역' : '한국어로 번역'}
        </button>
        <div className="translation-view" role="group" aria-label="대본 표시 언어">
          <button className={!korean ? 'active' : ''} aria-pressed={!korean} disabled={busy}
            onClick={() => onChange({ ...project, dialogueLanguage: 'original' })}>원문 보기</button>
          <button className={korean ? 'active' : ''} aria-pressed={korean} disabled={busy || !translated.length}
            onClick={() => onChange({ ...project, dialogueLanguage: 'korean' })}>한국어 보기</button>
        </div>
      </div>
      {translated.length > 0 && <div className="translation-status">
        <span>한국어 {translated.length}행 · 원문 {sourceRows.length}행 · 영상 자막과 SRT·HWPX는 {korean ? '한국어' : '원문'}로 표시·저장됩니다.</span>
        <button className="quiet" disabled={busy || !dialogue.some(row => row.translation?.draft.trim())} onClick={onRestore}>처음 번역으로 복원</button>
      </div>}
      {(stale.length > 0 || (korean && missing.length > 0)) &&
        <p className="translation-warning" role="status">
          {stale.length > 0 ? `원문이 바뀐 번역 ${stale.length}행이 있습니다. ` : ''}
          {missing.length > 0 ? `미번역 대사 ${missing.length}행이 있습니다. ` : ''}
          다시 번역한 뒤 한국어 대본을 내보내 주세요. 원문은 계속 내보낼 수 있습니다.
        </p>}
    </section>
  )
}
