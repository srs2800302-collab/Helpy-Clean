import { isLanguage, type Language } from '@helpy/contracts';

export interface LanguagePreference {
  read(): unknown;
  write(language: Language): void;
}

export class LanguageSettings {
  language: Language = 'en';
  storageUnavailable = false;

  constructor(privateStore: LanguagePreference) {
    this.store = privateStore;
    try {
      const saved = this.store.read();
      if (isLanguage(saved)) this.language = saved;
      else if (saved !== null) this.storageUnavailable = true;
    } catch {
      this.storageUnavailable = true;
    }
  }

  private readonly store: LanguagePreference;

  select(language: Language): void {
    this.language = language;
    try {
      this.store.write(language);
      this.storageUnavailable = false;
    } catch {
      this.storageUnavailable = true;
    }
  }
}
