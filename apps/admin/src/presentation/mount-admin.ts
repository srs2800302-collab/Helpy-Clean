import { isLanguage, languageName, languages, text } from '@helpy/contracts';
import type { LanguageSettings } from '../application/language-settings.ts';

export function mountAdmin(root: HTMLElement, settings: LanguageSettings): () => void {
  const document = root.ownerDocument;
  const main = document.createElement('main');
  const brand = document.createElement('p');
  brand.className = 'brand';
  brand.textContent = 'Helpy / F1';
  const title = document.createElement('h1');
  const description = document.createElement('p');
  description.className = 'description';
  const label = document.createElement('label');
  label.htmlFor = 'interface-language';
  const select = document.createElement('select');
  select.id = label.htmlFor;
  for (const language of languages) {
    const option = document.createElement('option');
    option.value = language;
    option.lang = language;
    option.textContent = languageName(language);
    select.append(option);
  }
  const warning = document.createElement('p');
  warning.setAttribute('role', 'status');
  main.append(brand, title, description, label, select, warning);
  root.replaceChildren(main);

  function render(): void {
    const language = settings.language;
    document.documentElement.lang = language;
    document.title = text(language, 'adminTitle');
    title.textContent = text(language, 'foundation');
    description.textContent = text(language, 'description');
    label.textContent = text(language, 'language');
    select.value = language;
    warning.textContent = settings.storageUnavailable ? text(language, 'preferenceUnavailable') : '';
  }
  function change(): void {
    if (isLanguage(select.value)) {
      settings.select(select.value);
      render();
    }
  }
  select.addEventListener('change', change);
  render();
  return () => { select.removeEventListener('change', change); root.replaceChildren(); };
}
