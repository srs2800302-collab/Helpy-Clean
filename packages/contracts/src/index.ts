import catalog from '../lib/src/catalog.json' with { type: 'json' };

export const languages = Object.freeze(['th', 'ru', 'en'] as const);
export type Language = (typeof languages)[number];
export type TextKey = 'title' | 'adminTitle' | 'foundation' | 'description' |
  'language' | 'preferenceUnavailable';

export function isLanguage(value: unknown): value is Language {
  return value === 'th' || value === 'ru' || value === 'en';
}

export function text(language: Language, key: TextKey): string {
  return catalog.messages[language][key];
}

export function languageName(language: Language): string {
  return catalog.languages[language];
}

export interface HealthResponse {
  readonly status: 'ok';
  readonly contractVersion: 1;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null &&
    'status' in value && value.status === 'ok' &&
    'contractVersion' in value && value.contractVersion === 1 &&
    Object.keys(value).length === 2;
}
