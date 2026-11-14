import type { LanguagePreference } from '../application/language-settings.ts';

export function browserLanguagePreference(browser: Window): LanguagePreference {
  const key = 'helpy.admin.language';
  return {
    read: () => browser.localStorage.getItem(key),
    write: (language) => browser.localStorage.setItem(key, language),
  };
}
