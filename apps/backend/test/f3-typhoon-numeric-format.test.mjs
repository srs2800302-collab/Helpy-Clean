import assert from 'node:assert/strict';
import test from 'node:test';
import {TyphoonTranslation} from
  '../dist/infrastructure/translation/typhoon-translation.js';

const cases = [
  ['RU_TH_GROUPING', 'ru', 'Цена 1200 бат.',
    'ราคา 1,200 บาท', true],
  ['EN_TH_GROUPING', 'en', 'Price 1500 baht.',
    'ราคา 1,500 บาท', true],
  ['LARGE_GROUPING', 'en', 'Price 1500000 baht.',
    'ราคา 1,500,000 บาท', true],
  ['UNCHANGED_INTEGER', 'ru', 'Цена 1200 бат.',
    'ราคา 1200 บาท', true],
  ['NEGATIVE_GROUPING', 'ru', 'Возврат -1200 бат.',
    'คืนเงิน -1,200 บาท', true],
  ['CHANGED_AMOUNT', 'ru', 'Цена 1200 бат.',
    'ราคา 1,201 บาท', false],
  ['INVALID_GROUPING', 'ru', 'Цена 1200 бат.',
    'ราคา 1,20 บาท', false],
  ['SIGN_LOSS', 'ru', 'Возврат -1200 бат.',
    'คืนเงิน 1,200 บาท', false],
  ['DECIMAL_AMBIGUITY', 'ru', 'Цена 1200 бат.',
    'ราคา 1.200 บาท', false],
  ['DECIMAL_ADDED', 'ru', 'Цена 1200 бат.',
    'ราคา 1,200.00 บาท', false],
  ['DECIMAL_CHANGED', 'ru', 'Цена 12.50 бат.',
    'ราคา 12.5 บาท', false],
  ['DECIMAL_PRESERVED', 'ru', 'Цена 12.50 бат.',
    'ราคา 12.50 บาท', true],
  ['ADDITIONAL_NUMBER', 'ru', 'Цена 1200 бат.',
    'ราคา 1,200 บาท รวม 100 บาท', false],
  ['ORDER_PRESERVED', 'ru', 'Цены 1200 и 1500 бат.',
    'ราคา 1,200 และ 1,500 บาท', true],
  ['ORDER_CHANGED', 'ru', 'Цены 1200 и 1500 бат.',
    'ราคา 1,500 และ 1,200 บาท', false],
  ['MAGNITUDE_CHANGED', 'en', 'Price 1500 baht.',
    'ราคา 1,500,000 บาท', false],
];

for (const [name, source, original, translation, expected] of cases) {
  test(name, async () => {
    let requests = 0;

    const adapter = new TyphoonTranslation(
      'synthetic-local-test-key',
      async () => {
        requests++;
        return Response.json({
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({translation}),
            },
          }],
        });
      },
    );

    const result = await adapter.translate(
      original,
      source,
      'th',
    );

    assert.equal(requests, 1);
    assert.equal(result.ok, expected);

    if (!expected) {
      assert.equal(
        result.error.code,
        'TranslationUnavailable',
      );
    }
  });
}
