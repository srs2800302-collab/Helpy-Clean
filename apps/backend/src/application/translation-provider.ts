import type { Language } from '@helpy/contracts';

// A provider returns a separate representation; the original is never replaced.
export interface TranslationProvider {
  translate(original: string, source: Language, target: Language): Promise<string>;
}
