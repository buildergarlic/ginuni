export const TRANSLATION_LANGUAGE_CODES = ['en', 'ja', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const
export type TranslationSourceLanguage = typeof TRANSLATION_LANGUAGE_CODES[number]

export const TRANSLATION_LANGUAGES = [
  { code: 'en', speech: 'english', label: '영어' },
  { code: 'ja', speech: 'japanese', label: '일본어' },
  { code: 'zh', speech: 'chinese', label: '중국어' },
  { code: 'es', speech: 'spanish', label: '스페인어' },
  { code: 'fr', speech: 'french', label: '프랑스어' },
  { code: 'de', speech: 'german', label: '독일어' },
  { code: 'it', speech: 'italian', label: '이탈리아어' },
  { code: 'pt', speech: 'portuguese', label: '포르투갈어' },
  { code: 'ru', speech: 'russian', label: '러시아어' }
] as const satisfies ReadonlyArray<{ code: TranslationSourceLanguage; speech: string; label: string }>

export type SpeechLanguage = 'korean' | typeof TRANSLATION_LANGUAGES[number]['speech']
export const SPEECH_LANGUAGES = [
  { speech: 'korean', label: '한국어' }, ...TRANSLATION_LANGUAGES
] as const

export function translationLanguageForSpeech(language?: SpeechLanguage): TranslationSourceLanguage | undefined {
  return TRANSLATION_LANGUAGES.find(item => item.speech === language)?.code
}
