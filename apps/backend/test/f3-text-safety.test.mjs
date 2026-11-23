import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalTextSafety, classifyJobChatContact } from '../dist/infrastructure/text-safety/local-text-safety.js';
import { ProtectedTranslation } from '../dist/application/text-safety.js';

const safety = new LocalTextSafety();

const cases = [
  ['Phone +66 812345678', 'job_chat', 'rejected', 'contact'],
  ['+ (66) 81 234-5678', 'job_chat', 'rejected', 'contact'],
  ['00 66 81 234 5678', 'job_chat', 'rejected', 'contact'],
  ['081.234.5678', 'job_chat', 'rejected', 'contact'],
  ['081/234/5678', 'job_chat', 'rejected', 'contact'],
  ['Call 081-234-5678', 'job_chat', 'rejected', 'contact'],
  ['x@example.invalid', 'job_chat', 'rejected', 'contact'],
  ['roman at example dot com', 'job_chat', 'rejected', 'contact'],
  ['LINE ID: somchai', 'job_chat', 'rejected', 'contact'],
  ['LINE ID is somchai', 'job_chat', 'rejected', 'contact'],
  ['my LINE is somchai', 'job_chat', 'rejected', 'contact'],
  ['Telegram @worker', 'job_chat', 'rejected', 'contact'],
  ['WeChat ID wxid_123', 'job_chat', 'rejected', 'contact'],
  ['Discord: helper#1234', 'job_chat', 'rejected', 'contact'],
  ['Facebook @worker', 'job_chat', 'rejected', 'contact'],
  ['@worker', 'job_chat', 'rejected', 'contact'],
  ['https://instagram.com/helper', 'job_chat', 'rejected', 'contact'],
  ['https://facebook.com/helper', 'job_chat', 'rejected', 'contact'],
  ['https://t.me/helper', 'job_chat', 'rejected', 'contact'],
  ['Address: 0812345678 Main Road', 'job_chat', 'allowed', null],
  ['Unit 0812345678, Bangkok', 'job_chat', 'allowed', null],
  ['Address: 0812345678', 'job_chat', 'allowed', null],
  ['Адрес: 0812345678, ул. Ленина', 'job_chat', 'allowed', null],
  ['Дом № 0812345678', 'job_chat', 'allowed', null],
  ['บ้านเลขที่ 0812345678 ถนนสุขุมวิท', 'job_chat', 'allowed', null],
  ['12 Main Road, Bangkok', 'job_chat', 'allowed', null],
  ['Floor 12, Room 5, Bangkok', 'job_chat', 'allowed', null],
  ['13.7563,100.5018', 'job_chat', 'allowed', null],
  ['1200 THB, 3 items, 60x80 cm, 2026-11-21 14:30', 'job_chat', 'allowed', null],
  ['9007199254 THB', 'job_chat', 'allowed', null],
  ['THB 9007199254', 'job_chat', 'allowed', null],
  ['$9007199254', 'job_chat', 'allowed', null],
  ['Phone: 9007199254 THB', 'job_chat', 'rejected', 'contact'],
  ['12345', 'job_chat', 'allowed', null],
  ['phone number', 'job_chat', 'allowed', null],
  ['email address', 'job_chat', 'allowed', null],
  ['I do not have an email address', 'job_chat', 'allowed', null],
  ['contact me tomorrow', 'job_chat', 'allowed', null],
  ['Telephone line repair, no number provided', 'job_chat', 'allowed', null],
  ['LINE ID is unavailable', 'job_chat', 'allowed', null],
  ['Telegram account for customer support', 'job_chat', 'allowed', null],
  ['LINE ID for business is unavailable', 'job_chat', 'allowed', null],
  ['Facebook profile picture is broken', 'job_chat', 'allowed', null],
  ['WhatsApp contact information is missing', 'job_chat', 'allowed', null],
  ['Telegram username is not available', 'job_chat', 'allowed', null],
  ['WhatsApp contact is broken', 'job_chat', 'allowed', null],
  ['Telegram account is down', 'job_chat', 'allowed', null],
  ['LINE ID is somchai', 'job_chat', 'rejected', 'contact'],
  ['WhatsApp is popular', 'job_chat', 'allowed', null],
  ['Facebook and Messenger are unavailable', 'job_chat', 'allowed', null],
  ['Use LINE for the platform announcement', 'job_chat', 'allowed', null],
  ['Telegram documentation', 'job_chat', 'allowed', null],
  ['https://example.com/manual', 'job_chat', 'allowed', null],
  ['https://maps.example/location', 'job_chat', 'allowed', null],
  ['https://facebook.com/help', 'job_chat', 'allowed', null],
  ['https://instagram.com/p/public-post', 'job_chat', 'allowed', null],
  ['Phone +66 812345678', 'external_translation', 'allowed', null],
  ['x@example.invalid', 'external_translation', 'allowed', null],
  ['contact me tomorrow', 'external_translation', 'allowed', null],
  ['account 123456', 'external_translation', 'rejected', 'account_identifier'],
  ['my name is Test', 'external_translation', 'rejected', 'personal_data'],
  ['abc\u200bdef', 'job_chat', 'unknown', null],
];


const platformContacts = [
  ['WhatsApp: somchai', 'messenger_contact'],
  ['Messenger ID helper', 'messenger_contact'],
  ['Viber: helper', 'messenger_contact'],
  ['Signal @helper', 'messenger_contact'],
  ['Instagram Direct @helper', 'social_network_contact'],
  ['Snapchat: helper', 'social_network_contact'],
  ['TikTok Direct Messages @helper', 'social_network_contact'],
  ['Skype: live:helper', 'messenger_contact'],
  ['Discord: helper#1234', 'messenger_contact'],
  ['https://wa.me/66812345678', 'messenger_contact'],
  ['https://m.me/helper', 'messenger_contact'],
  ['https://api.whatsapp.com/send?phone=66812345678', 'phone_number'],
  ['https://line.me/R/ti/p/@helper', 'messenger_contact'],
  ['https://t.me/helper', 'messenger_contact'],
  ['https://signal.me/#p/+66812345678', 'phone_number'],
  ['https://instagram.com/helper', 'social_network_contact'],
  ['https://snapchat.com/add/helper', 'social_network_contact'],
  ['https://tiktok.com/@helper', 'social_network_contact'],
  ['https://join.skype.com/helper', 'messenger_contact'],
  ['https://discord.gg/invite', 'messenger_contact'],
  ['https://discord.com/invite/abc', 'messenger_contact'],
];

for (const [text, reason] of platformContacts) {
  test(`F3 platform contact ${reason}: ${text}`, async () => {
    const result = await safety.inspect({ text, purpose: 'job_chat' });
    assert.equal(result.value.status, 'rejected');
    assert.equal(result.value.reason, 'contact');
    assert.equal(classifyJobChatContact(text), reason);
  });
}


const classifiedContacts = [
  ['Phone +66 812345678', 'phone_number'],
  ['x@example.invalid', 'email_address'],
  ['roman at example dot com', 'email_address'],
  ['my LINE is somchai', 'messenger_contact'],
  ['Telegram @worker', 'messenger_contact'],
  ['Facebook @worker', 'social_network_contact'],
  ['@worker', 'social_network_contact'],
];

for (const [text, category] of classifiedContacts) {
  test(`F3 exact contact category ${category}: ${text}`, () => {
    assert.equal(classifyJobChatContact(text), category);
  });
}

for (const [text, purpose, status, reason] of cases) {
  test(`F3 local safety ${purpose} ${status}: ${JSON.stringify(text)}`, async () => {
    const result = await safety.inspect({ text, purpose });
    assert.deepEqual(result, { ok: true, value: { text, purpose, status, reason } });
  });
}


test('F3 support translation does not apply Client–Master contact filtering', async () => {
  const calls = [];
  const provider = {
    async detect(text) {
      calls.push({ method: 'detect', text, purpose: 'legacy-default' });
      return { ok: true, value: { language: 'en', reliable: true } };
    },
    async translate(text, source, target) {
      calls.push({ method: 'translate', text, purpose: 'legacy-default' });
      return { ok: true, value: `${target}:${text}` };
    },
    async detectWithPurpose(text, purpose) {
      calls.push({ method: 'detect', text, purpose });
      return { ok: true, value: { language: 'en', reliable: true } };
    },
    async translateWithPurpose(text, source, target, purpose) {
      calls.push({ method: 'translate', text, purpose });
      return { ok: true, value: `${target}:${text}` };
    },
  };
  const protectedTranslation = new ProtectedTranslation(safety, provider);
  const access = async () => ({ ok: true, value: undefined });
  const contact = 'Phone +66 812345678';

  const detected = await protectedTranslation.detect(contact, 'external_translation', access);
  assert.equal(detected.result.ok, true);
  const translated = await protectedTranslation.translate(contact, 'en', 'ru', 'external_translation', access);
  assert.equal(translated.ok, true);
  assert.deepEqual(calls.map(call => call.purpose), ['external_translation', 'external_translation']);

  const blocked = await protectedTranslation.detect(contact, 'job_chat', access);
  assert.equal(blocked.result.ok, false);
  assert.equal(blocked.result.error.code, 'TextRejected');
  assert.equal(calls.length, 2);
});
