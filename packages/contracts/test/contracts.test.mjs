import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isHealthResponse, isLanguage, languageName, languages, text } from '../dist/src/index.js';

test('health wire fixtures are accepted or rejected explicitly', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/health.json', import.meta.url), 'utf8'));
  for (const value of fixtures.valid) assert.equal(isHealthResponse(value), true);
  for (const value of fixtures.invalid) assert.equal(isHealthResponse(value), false);
});

test('one complete catalog serves all three languages without silent fallbacks', async () => {
  const catalog = JSON.parse(await readFile(new URL('../lib/src/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(catalog.languages), [...languages]);
  assert.deepEqual(Object.keys(catalog.messages), [...languages]);
  for (const language of languages) {
    assert.equal(isLanguage(language), true);
    assert.equal(languageName(language), catalog.languages[language]);
    assert.deepEqual(Object.keys(catalog.messages[language]).sort(), Object.keys(catalog.messages.en).sort());
    for (const [key, value] of Object.entries(catalog.messages[language])) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0);
      assert.equal(text(language, key), value);
    }
  }
  for (const invalid of ['TH', 'fr', '', null, 1]) assert.equal(isLanguage(invalid), false);
});
