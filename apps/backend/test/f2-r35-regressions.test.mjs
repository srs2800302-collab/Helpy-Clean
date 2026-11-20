import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { harness, admin, FakeRepository } from './f2-harness.mjs';
import { DomainCore } from '../dist/application/domain-core.js';
import { checked, failure, success } from '../dist/domain/core.js';
import { sendMessage } from '../dist/domain/messaging.js';

const C = 'client:client', M = 'master:master', A = 'admin';
const chat = 'chat:job:master', records = [];
const allow = request => success({ ...request, status: 'allowed', reason: null });
const reject = request => success({ ...request, status: 'rejected', reason: 'contact' });
const message = (id, original, chatId = chat, sender = 'user', photoIds = []) => ({ type: 'message', id, original, chatId, sender, photoIds });
function scenario(id, norms, body) {
  test(`R35 REGRESSION ${id}`, async () => {
    const observations = await body();
    records.push({ id, norms, test: `R35 REGRESSION ${id}`, file: 'apps/backend/test/f2-r35-regressions.test.mjs', status: 'PASS', observations });
  });
}
async function fixture(mode) {
  const h = harness();
  if (mode === 'temporary') { await h.published(); await h.offer(); }
  else if (mode === 'working') await h.assigned();
  else {
    await h.completed();
    await h.ok(M, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true });
    await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
  }
  return h;
}
function watch(h, inspect = allow) {
  const checks = [], exports = [];
  h.ports.textSafety.inspect = async request => { checks.push(structuredClone(request)); return inspect(request); };
  h.ports.translation.detect = async (...args) => { exports.push({ method: 'detect', args }); return success({ language: 'en', reliable: true }); };
  h.ports.translation.translate = async (...args) => { exports.push({ method: 'translate', args }); return success(`translated:${args[0]}`); };
  return { checks, exports };
}
async function deny(h, action, code) {
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await action();
  assert.equal(result.ok, false); assert.equal(typeof result.error.detail, 'string');
  if (code) assert.equal(result.error.code, code); else assert.equal(typeof result.error.code, 'string');
  assert.deepEqual(await h.repository.read(), state); assert.deepEqual(h.repository.receipts, receipts);
  return result;
}
const invalidDecisions = [
  ['null envelope', () => null], ['absent envelope', () => undefined], ['false boolean', () => ({ ok: 'true', value: {} })],
  ['null value', () => success(null)], ['missing fields', () => success({})],
  ['unknown', request => success({ ...request, status: 'unknown', reason: null })],
  ['unknown status', request => success({ ...request, status: 'unchecked', reason: null })],
  ['wrong purpose', request => allow({ ...request, purpose: request.purpose === 'job_chat' ? 'external_translation' : 'job_chat' })],
  ['wrong text', request => allow({ ...request, text: 'different checked text' })],
  ['missing reason', request => success({ ...request, status: 'allowed' })],
  ['unrecognized reason', request => success({ ...request, status: 'allowed', reason: 'not-a-reason' })],
  ['allowed with reason', request => success({ ...request, status: 'allowed', reason: 'address' })],
  ['typed failure', () => failure('TextSafetyUnavailable')],
  ['unknown failure code', () => ({ ok: false, error: { code: 'NotADomainFailure', detail: 'fake' } })],
  ['throw', () => { throw new Error('controlled inspection outage'); }],
  ['accessor', request => success({ ...request, get status() { throw new Error('must not read accessor'); }, reason: null })],
];

for (const mode of ['temporary', 'working']) for (const session of [C, M]) {
  scenario(`job admission ${mode} ${session}`, ['SAF.1', 'SAF.2', 'SAF.3', 'SAF.4', 'SAF.9', 'SAF.11'], async () => {
    const h = await fixture(mode), numeric = 'Cost 1200 THB; 60 x 80 x 90 cm; 3 items; 2026-11-19 14:30';
    const control = watch(h); await h.ok(session, message('control', numeric));
    assert.deepEqual(control.checks, [{ text: numeric, purpose: 'job_chat' }, { text: numeric, purpose: 'external_translation' }]);
    assert.deepEqual(control.exports, [{ method: 'detect', args: [numeric] }]);
    for (const reason of ['contact', 'address', 'account_identifier', 'personal_data']) {
      const observed = watch(h, request => success({ ...request, status: 'rejected', reason }));
      let photos = 0; const lookup = h.ports.photos.lookup; h.ports.photos.lookup = async ids => { photos++; return lookup(ids); };
      const input = message(`rejected:${reason}`, `synthetic ${reason}`, chat, 'user', mode === 'working' ? [session === C ? 'client-photo' : 'master-photo'] : []);
      for (let attempt = 0; attempt < 2; attempt++) await deny(h, () => h.execute(session, input, 'same-rejected-key'), 'TextRejected');
      const restarted = new DomainCore(h.ports);
      await deny(h, () => restarted.execute(session, 'after-restart', input), 'TextRejected');
      assert.equal(observed.exports.length, 0); assert.equal(photos, 0);
      assert.ok(observed.checks.every(value => value.purpose === 'job_chat' && value.text === input.original));
      h.ports.photos.lookup = lookup;
    }
    for (const [name, inspect] of invalidDecisions) {
      const observed = watch(h, inspect);
      await deny(h, () => h.execute(session, message(`invalid:${name}`, numeric)), 'TextSafetyUnavailable');
      assert.equal(observed.exports.length, 0);
    }
    for (const textSafety of [undefined, {}, { inspect: null }]) {
      const core = new DomainCore({ ...h.ports, textSafety });
      await deny(h, () => core.execute(session, 'missing-safety', message('missing-safety', numeric)), 'TextSafetyUnavailable');
    }
    return { mode, session, exactPurposes: 2, prohibitedCategories: 4, atomicRetryRestartRefusals: 12, invalidDecisions: invalidDecisions.length, missingPorts: 3, numericControl: true };
  });
}

scenario('Domain admission cannot be omitted or rebound', ['SAF.1', 'SAF.2', 'SAF.4'], async () => {
  const h = await fixture('temporary'), state = await h.repository.read(), input = message('domain', 'original');
  for (const decision of [null, { text: 'other', purpose: 'job_chat', status: 'allowed', reason: null },
    { text: input.original, purpose: 'external_translation', status: 'allowed', reason: null },
    { text: input.original, purpose: 'job_chat', status: 'unknown', reason: null }]) {
    const copy = structuredClone(state), before = structuredClone(copy);
    const result = checked(() => sendMessage(copy, copy.threads[chat], { userId: 'client', role: 'client', permissions: [] }, input, null, h.config, h.clock.now(), false, decision));
    assert.equal(result.ok, false); assert.deepEqual(copy, before);
  }
  const copy = structuredClone(state);
  const result = checked(() => sendMessage(copy, copy.threads[chat], { userId: 'client', role: 'client', permissions: [] }, input, null, h.config, h.clock.now(), false, allow({ text: input.original, purpose: 'job_chat' }).value));
  assert.equal(result.ok, true); assert.equal(copy.messages.domain.original, input.original);
  return { rejectedBindings: 4, permittedDomainControl: true };
});

for (const mode of ['temporary', 'working', 'support']) scenario(`blocked detection preserves legal message ${mode}`, ['SAF.5', 'SAF.6', 'SAF.7'], async () => {
  const h = await fixture(mode), session = mode === 'support' ? M : C, chatId = mode === 'support' ? 'support' : chat;
  for (const [name, inspect] of [['rejected', reject], ...invalidDecisions]) {
    const observed = watch(h, request => request.purpose === 'job_chat' ? allow(request) : inspect(request));
    const original = mode === 'support' ? `personal contact for official review ${name}` : `Work ${name}`;
    const result = await h.ok(session, message(`degraded:${name}`, original, chatId));
    assert.equal(result.outcome.message.original, original); assert.equal(result.outcome.message.originalLanguage, null);
    assert.equal(observed.exports.length, 0);
    assert.deepEqual(observed.checks.map(value => value.purpose), mode === 'support' ? ['external_translation'] : ['job_chat', 'external_translation']);
  }
  const observed = watch(h); await h.ok(session, message('detect-control', 'Safe text 1200', chatId));
  assert.equal(h.repository.state.messages['detect-control'].originalLanguage, 'en'); assert.equal(observed.exports.length, 1);
  return { mode, degradedOutcomes: invalidDecisions.length + 1, successfulDetectionControl: true, originalsPreserved: true };
});

scenario('official Support remains valid without safety or translation availability', ['SAF.5', 'SAF.6', 'SAF.7'], async () => {
  const h = await fixture('support'), observed = watch(h);
  const core = new DomainCore({ ...h.ports, textSafety: undefined });
  for (const [session, sender] of [[A, 'helpy'], [M, 'user']]) {
    const input = message(`support:${sender}`, 'private@example.invalid [CONTACT] [ADDRESS]', 'support', sender);
    const result = await core.execute(session, `missing:${sender}`, input);
    assert.equal(result.ok, true); assert.equal(result.value.outcome.message.original, input.original); assert.equal(result.value.outcome.message.originalLanguage, null);
  }
  assert.equal(observed.exports.length, 0); assert.equal(h.repository.state.debt.master, 300n); assert.deepEqual(h.repository.state.receipts, {});
  const baseline = await h.repository.read();
  await deny(h, () => core.translateMessage(M, 'support:helpy', 'ru'), 'TextSafetyUnavailable');
  assert.deepEqual(await h.repository.read(), baseline);
  return { officialAndUserMessages: 2, externalExports: 0, debtUnchanged: true, forbiddenTranslationAtomic: true };
});

async function exportFixture(kind) {
  const mode = kind.includes('support') ? 'support' : kind === 'working' ? 'working' : 'temporary';
  const h = await fixture(mode); const observed = watch(h);
  if (kind === 'draft') return { h, observed, action: () => h.core.draftTranslation(A, 'Draft 1200 THB', 'en', 'ru'), session: A, purpose: 'catalog' };
  if (kind.startsWith('detect')) {
    const session = kind === 'detect-support-official' ? A : kind.includes('support') ? M : C;
    return { h, observed, action: () => h.execute(session, message('detection', 'Work 1200 THB', mode === 'support' ? 'support' : chat, session === A ? 'helpy' : 'user')),
      session, purpose: session === A ? 'support' : undefined };
  }
  const original = kind.startsWith('support') ? 'Official text 1200 THB' : 'Saved original 1200 THB';
  const sent = await h.ok(kind === 'support-official' ? A : kind.startsWith('support') ? M : C,
    message('source', original, mode === 'support' ? 'support' : chat, kind === 'support-official' ? 'helpy' : 'user'));
  observed.checks.length = 0; observed.exports.length = 0;
  const session = kind === 'support-official' ? A : M;
  return { h, observed, action: () => h.core.translateMessage(session, sent.outcome.message.id, 'ru'), session, purpose: session === A ? 'support' : undefined };
}
for (const kind of ['temporary', 'working', 'support-user', 'support-official', 'draft']) {
  scenario(`all outbound paths fail closed ${kind}`, ['SAF.3', 'SAF.4', 'SAF.5', 'SAF.8', 'SAF.10'], async () => {
    const { h, observed, action } = await exportFixture(kind), before = await h.repository.read();
    const control = await action(); assert.equal(control.ok, true); assert.deepEqual(await h.repository.read(), before);
    if (kind === 'draft') { assert.equal(control.value.approved, false); assert.equal(typeof control.value.candidate, 'string'); }
    else assert.equal(control.value.original, h.repository.state.messages.source.original);
    assert.equal(observed.exports.length, 1); assert.equal(observed.checks.length, 1); assert.equal(observed.checks[0].purpose, 'external_translation');
    const original = observed.checks[0].text;
    for (const [name, inspect] of [['rejected', reject], ...invalidDecisions]) {
      const guarded = watch(h, inspect);
      await deny(h, action, name === 'rejected' ? 'TextRejected' : 'TextSafetyUnavailable');
      assert.equal(guarded.exports.length, 0); assert.deepEqual(guarded.checks, [{ text: original, purpose: 'external_translation' }]);
    }
    const guarded = watch(h); h.ports.translation.translate = async () => { throw new Error('controlled provider outage'); };
    await deny(h, action, 'TranslationUnavailable'); assert.equal(guarded.checks.length, 1);
    return { kind, refusals: invalidDecisions.length + 1, permittedControl: true, providerFailureTyped: true, stateAndReceiptsUnchanged: true };
  });
}

for (const kind of ['temporary', 'working', 'support-user', 'support-official', 'draft', 'detect', 'detect-support-user', 'detect-support-official']) {
  scenario(`authorization changes during safety ${kind}`, ['SAF.8'], async () => {
    const changes = ['session', 'identity', ...(kind === 'draft' || kind === 'support-official' || kind === 'detect-support-official' ? ['permission'] : ['active-role'])];
    for (const change of changes) {
      const { h, action, session, purpose } = await exportFixture(kind);
      const auth = h.ports.auth.authenticate; let revoked = false, boundary;
      h.ports.auth.authenticate = async value => {
        if (!revoked || value !== session) return auth(value);
        if (change === 'session') return failure('Unauthorized');
        if (change === 'identity') return success({ userId: 'someone-else', role: session === A ? 'admin' : session.endsWith(':client') ? 'client' : 'master', permissions: [] });
        return change === 'permission' ? success({ ...admin, permissions: admin.permissions.filter(value => value !== purpose) }) : auth(value);
      };
      const observed = watch(h, request => {
        if (request.purpose === 'external_translation') {
          revoked = true;
          if (change === 'active-role') h.repository.state.users[session === C ? 'client' : 'master'][session === C ? 'clientActive' : 'masterActive'] = false;
          boundary = structuredClone(h.repository.state);
        }
        return allow(request);
      });
      const receipts = structuredClone(h.repository.receipts), result = await action();
      assert.equal(result.ok, false); assert.equal(observed.exports.length, 0);
      assert.deepEqual(await h.repository.read(), boundary); assert.deepEqual(h.repository.receipts, receipts);
    }
    return { kind, revokedForms: changes.length, forbiddenExports: 0, noCommandEffects: true };
  });
}

scenario('job closure while safety awaits blocks detection without command effects', ['SAF.8', 'SAF.9'], async () => {
  for (const purpose of ['job_chat', 'external_translation']) {
    const h = await fixture('temporary'); let boundary;
    const observed = watch(h, request => {
      if (request.purpose === purpose) { h.repository.state.threads[chat].mode = 'closed'; boundary = structuredClone(h.repository.state); }
      return allow(request);
    });
    const receipts = structuredClone(h.repository.receipts), result = await h.execute(C, message('late', 'Safe text'));
    assert.equal(result.ok, false); assert.equal(observed.exports.length, 0);
    assert.deepEqual(await h.repository.read(), boundary); assert.deepEqual(h.repository.receipts, receipts);
  }
  return { awaitingBoundaries: 2, exports: 0, noCommandEffects: true };
});

scenario('checked payload cannot be replaced while inspection awaits', ['SAF.4', 'SAF.8', 'SAF.10'], async () => {
  const h = await fixture('working'), input = message('frozen', 'Original 1200 THB'), observed = watch(h, request => {
    input.original = '[CONTACT] different unchecked input'; input.photoIds.push('client-photo'); return allow(request);
  });
  await h.ok(C, input);
  assert.equal(h.repository.state.messages.frozen.original, 'Original 1200 THB'); assert.deepEqual(h.repository.state.messages.frozen.photoIds, []);
  assert.deepEqual(observed.exports, [{ method: 'detect', args: ['Original 1200 THB'] }]);
  assert.ok(observed.checks.every(value => value.text === 'Original 1200 THB'));
  return { commandDetached: true, checkedAndExportedTextIdentical: true, originalPreserved: true };
});

scenario('replay restart and concurrent messages cannot bypass inspection', ['SAF.4', 'SAF.9'], async () => {
  const h = await fixture('temporary'), observed = watch(h), input = message('once', 'Original');
  const attempts = await Promise.all([h.execute(C, input, 'once'), h.execute(C, input, 'once')]);
  assert.ok(attempts.every(value => value.ok)); assert.equal(h.repository.state.threads[chat].messageIds.filter(id => id === 'once').length, 1);
  const exports = observed.exports.length; assert.ok(exports >= 1);
  const repository = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts));
  const core = new DomainCore({ ...h.ports, repository }); h.ports.textSafety.inspect = async () => { throw new Error('must not reinspect a lawful replay'); };
  assert.equal((await core.execute(C, 'once', input)).ok, true);
  const changed = await core.execute(C, 'once', { ...input, original: '[CONTACT]' }); assert.equal(changed.error.code, 'Conflict');
  assert.equal(observed.exports.length, exports);
  return { concurrentPersistedMessages: 1, authorizedExactReplay: true, alteredReplayRejected: true, replayExports: 0 };
});

scenario('replaceable translator and safety ports are honored on the next call', ['SAF.3', 'SAF.5'], async () => {
  const { h, action } = await exportFixture('temporary');
  h.ports.translation = { ...h.ports.translation, async translate() { return success('replacement provider'); } };
  const result = await action(); assert.equal(result.ok, true); assert.equal(result.value.translated, 'replacement provider');
  h.ports.textSafety = { async inspect(request) { return reject(request); } };
  let calls = 0; h.ports.translation.translate = async () => { calls++; return success('must not export'); };
  await deny(h, action, 'TextRejected'); assert.equal(calls, 0);
  return { translatorReplaced: true, replacementSafetyEnforced: true, prohibitedExports: 0 };
});

scenario('attachments and unauthorized senders retain their existing boundaries', ['SAF.1', 'SAF.8', 'CHT.7', 'CHT.9'], async () => {
  const h = await fixture('temporary'), observed = watch(h);
  await deny(h, () => h.execute('stranger:client', message('foreign', 'text')), 'Unauthorized');
  await deny(h, () => h.execute(C, message('temp-photo', '', chat, 'user', ['client-photo'])), 'InvalidPhoto');
  assert.equal(observed.checks.length, 0); assert.equal(observed.exports.length, 0);
  const working = await fixture('working'), work = watch(working);
  await working.ok(C, message('photo-only', '', chat, 'user', ['client-photo']));
  assert.equal(work.checks.length, 0); assert.equal(work.exports.length, 0);
  await deny(working, () => working.execute(M, message('two-photos', '', chat, 'user', ['master-one', 'master-two'])), 'InvalidPhoto');
  return { unauthorizedAndTemporaryPhotosRejected: true, legalPhotoOnlyMessage: true, workingPhotoCapUnchanged: true, noTextExports: true };
});

scenario('available safety does not depend on an available language detector', ['SAF.3', 'SAF.6', 'SAF.7'], async () => {
  for (const mode of ['temporary', 'working', 'support']) {
    const h = await fixture(mode), observed = watch(h); let calls = 0;
    for (const throwing of [false, true]) {
      h.ports.translation.detect = async () => { calls++; if (throwing) throw new Error('controlled detector outage'); return failure('TranslationUnavailable'); };
      const input = message(`outage:${throwing}`, 'Safe original 1200 THB', mode === 'support' ? 'support' : chat);
      const result = await h.ok(mode === 'support' ? M : C, input);
      assert.equal(result.outcome.message.original, input.original); assert.equal(result.outcome.message.originalLanguage, null);
    }
    assert.equal(calls, 2);
    assert.equal(observed.checks.length, mode === 'support' ? 2 : 4);
  }
  return { contexts: 3, typedAndThrownDetectorOutage: true, permittedOriginalsSaved: 6 };
});

scenario('saved originals are checked again for each requested locale after restart', ['SAF.4', 'SAF.5', 'SAF.10'], async () => {
  const h = await fixture('working'); watch(h);
  const original = 'Previously retained private@example.invalid';
  await h.ok(C, message('historical', original));
  const core = new DomainCore(h.ports), observed = watch(h, reject);
  for (const locale of ['th', 'ru', 'en']) {
    await h.ok(M, { type: 'locale', locale });
    await deny(h, () => core.translateMessage(M, 'historical', locale), 'TextRejected');
  }
  assert.equal(h.repository.state.messages.historical.original, original); assert.equal(observed.exports.length, 0);
  assert.deepEqual(observed.checks, ['th', 'ru', 'en'].map(() => ({ text: original, purpose: 'external_translation' })));
  return { previouslyRetainedOriginalChecked: true, locales: 3, restart: true, exports: 0, immutableOriginal: true };
});

scenario('publication deadline reached during safety prevents one-sided late export', ['SAF.8', 'SAF.9'], async () => {
  const h = await fixture('temporary'), observed = watch(h, request => {
    if (request.purpose === 'external_translation') h.clock.value = h.repository.state.jobs.job.cycles[0].countdown.deadline;
    return allow(request);
  });
  await deny(h, () => h.execute(C, message('late', 'Safe work text')), 'PublicationExpired');
  assert.equal(observed.exports.length, 0);
  return { deadlineBoundary: true, unprotectedMessageRefused: true, exports: 0 };
});

after(async () => {
  await writeFile(new URL('../../../docs/f2/evidence/r35-native-proofs.json', import.meta.url), JSON.stringify(records, null, 2) + '\n');
});
