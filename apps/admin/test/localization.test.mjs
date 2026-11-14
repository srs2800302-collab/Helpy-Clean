import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { languages, text } from '@helpy/contracts';
import { LanguageSettings } from '../src/application/language-settings.ts';
import { browserLanguagePreference } from '../src/infrastructure/browser-language-preference.ts';
import { mountAdmin } from '../src/presentation/mount-admin.ts';

for (const source of languages) {
  for (const target of languages.filter((language) => language !== source)) {
    test(`Admin switches ${source} -> ${target} immediately and restores the preference`, () => {
      const dom = new JSDOM('<div id="app"></div>', { url: 'https://helpy.invalid' });
      try {
        const { document, Event } = dom.window;
        const store = browserLanguagePreference(dom.window);
        store.write(source);
        const root = document.getElementById('app');
        const dispose = mountAdmin(root, new LanguageSettings(store));
        const select = root.querySelector('select');
        assert.equal(document.documentElement.lang, source);
        select.value = target;
        select.dispatchEvent(new Event('change'));
        assert.equal(document.documentElement.lang, target);
        assert.equal(document.title, text(target, 'adminTitle'));
        assert.equal(root.querySelector('h1').textContent, text(target, 'foundation'));
        assert.equal(root.querySelector('label').textContent, text(target, 'language'));
        assert.equal(new LanguageSettings(store).language, target);
        assert.equal(root.querySelector('select'), select);
        dispose();
        assert.equal(root.childElementCount, 0);
      } finally { dom.window.close(); }
    });
  }
}

test('unavailable browser storage does not prevent localized UI or language switching', () => {
  const dom = new JSDOM('<div id="app"></div>');
  try {
    const settings = new LanguageSettings(browserLanguagePreference(dom.window));
    assert.equal(settings.storageUnavailable, true);
    settings.select('th');
    mountAdmin(dom.window.document.getElementById('app'), settings);
    assert.equal(dom.window.document.querySelector('[role="status"]').textContent,
      text('th', 'preferenceUnavailable'));
    assert.equal(settings.language, 'th');
  } finally { dom.window.close(); }
});

test('invalid persisted language is rejected rather than injected into UI', () => {
  const settings = new LanguageSettings({ read: () => '<script>', write: () => {} });
  assert.equal(settings.language, 'en');
  assert.equal(settings.storageUnavailable, true);
  settings.select('ru');
  assert.equal(settings.storageUnavailable, false);
});
