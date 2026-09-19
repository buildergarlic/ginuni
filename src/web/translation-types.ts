import type { TranslationSourceLanguage } from './languages'

export const TRANSLATION_MODEL = 'Xenova/m2m100_418M'
export const TRANSLATION_MODEL_REVISION = '9c374f0b7aca709787cea97b047bfbbd1559d177'
export const TRANSLATION_MODEL_BYTES = 639_976_029
export const TRANSLATION_MAX_ROW_CHARACTERS = 10_000
export const TRANSLATION_MAX_ROWS = 20_000
export const TRANSLATION_MAX_INPUT_TOKENS = 256
export const TRANSLATION_MAX_OUTPUT_TOKENS = 768

export interface TranslationInput {
  rowId: string
  sourceContent: string
}

export interface TranslatedDialogue extends TranslationInput {
  content: string
}

export interface TranslationProgress {
  percent: number
  message: string
}

export type TranslationWorkerRequest =
  | { type: 'translate'; rows: TranslationInput[]; sourceLanguage: TranslationSourceLanguage }
  | { type: 'dispose' }

export type TranslationWorkerResponse =
  | { type: 'progress'; progress: TranslationProgress }
  | { type: 'complete'; rows: TranslatedDialogue[] }
  | { type: 'error'; message: string }
  | { type: 'disposed' }
