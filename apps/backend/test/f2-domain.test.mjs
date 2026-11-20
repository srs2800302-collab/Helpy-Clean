import assert from 'node:assert/strict';
import test from 'node:test';
import { checked, money, portion, timer } from '../dist/domain/core.js';
import { evaluateRetention, retentionFact, validatePolicy } from '../dist/domain/policy.js';
import { information, publishedText, validateCatalog, validateScope } from '../dist/domain/catalog.js';
import { debtView, allocation, assertFixedRecovery } from '../dist/domain/finance.js';
import { address, feed } from '../dist/domain/marketplace.js';
import { history } from '../dist/domain/messaging.js';
import { orderHistory, reputation } from '../dist/domain/reputation.js';
import { privateContacts, switchRole } from '../dist/domain/accounts.js';
import { catalog, policy, ratio, scope } from './f2-fixtures.mjs';
import { admin, FakeRepository, harness, user } from './f2-harness.mjs';
import { DomainCore } from '../dist/application/domain-core.js';

function rejected(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); }
test('MON.1-5 exact THB half-up and conservation including zero/invalid values', () => {
  for (const [amount, expected] of [[101n, 30n], [102n, 31n], [105n, 32n]]) {
    assert.equal(portion(amount, ratio(30n)), expected); assert.equal(expected + amount - expected, amount);
  }
  rejected(checked(() => money(1.5)), 'InvalidMoney'); rejected(checked(() => money(-1n)), 'InvalidMoney');
  rejected(checked(() => money(1n, 'USD')), 'InvalidMoney');
  for (const invalid of [ratio(-1n), ratio(101n), ratio(1n, 0n), { numerator: NaN, denominator: 100n }]) rejected(checked(() => portion(100n, invalid)), 'InvalidRate');
  assert.equal(portion(0n, ratio(0n)), 0n); assert.equal(portion(1n, ratio(100n)), 1n);
});

const invalidPolicies = [
  ...['initialDuration', 'repeatFloor', 'negotiationFirstReminder', 'negotiationRepeatReminder', 'paymentSelectionTimeout', 'providerConfirmation', 'cancellationResponse', 'cancellationReminder', 'inactivityFirstReminder', 'inactivityRepeatReminder', 'inactivityThreshold', 'historyLimit'].flatMap(key => [0, -1, 0.5].map(value => [key, value])),
  ['initialAutoClose', 'yes'], ['repeatDurations', []], ['repeatDurations', [0]], ['clientPaymentRoutes', ['unknown']], ['clientPaymentRoutes', ['cash', 'cash']],
  ['masterPayoutRoutes', ['cash']], ['masterPayoutRoutes', ['unknown']], ['globalDebtThreshold', -1n], ['globalDebtThreshold', 1.5],
  ['locales', []], ['locales', ['ru', 'ru']], ['locales', ['UNKNOWN']],
  ...['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'].flatMap(key => [[key, ratio(-1n)], [key, ratio(101n)]]),
  ...['communicationRetention', 'evidenceRetention', 'financialRetention', 'auditRetention', 'accountRetention'].flatMap(key => [[key, { value: 0, unit: 'days' }], [key, { value: 1, unit: 'unknown' }]]),
];
for (const [index, [key, value]] of invalidPolicies.entries()) test(`CFG.${key} negative ${index}: invalid value rolls back authorized policy publication`, async () => {
  const h = harness(); const next = policy({ version: 'v2', effectiveAt: 200, [key]: value });
  await h.reject('admin', { type: 'publish_policy', policy: next }, ['locales'].includes(key) ? 'InvalidLocale' : ['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'].includes(key) ? 'InvalidRate' : key === 'globalDebtThreshold' ? 'InvalidMoney' : 'InvalidConfiguration');
});
test('POL/CFG all policy fields publish with effective time, authorization and immutable old timers', async () => {
  const h = harness(); await h.published(); const snapshot = structuredClone(h.repository.state.jobs.job);
  const next = policy({ version: 'v2', effectiveAt: 200, initialDuration: 1, repeatDurations: [5], repeatFloor: 5,
    negotiationFirstReminder: 2, negotiationRepeatReminder: 3, paymentSelectionTimeout: 5, providerConfirmation: 7,
    clientPaymentRoutes: [], masterPayoutRoutes: [], commission: ratio(0n), globalDebtThreshold: 0n,
    mutualCancellationFee: ratio(0n), falseCallFee: ratio(100n), falseCallMasterShare: ratio(40n),
    cancellationResponse: 10, cancellationReminder: 2, inactivityFirstReminder: 4, inactivityRepeatReminder: 5, inactivityThreshold: 12,
    historyLimit: 2, communicationRetention: { value: 1, unit: 'days' }, evidenceRetention: { value: 2, unit: 'days' },
    financialRetention: { value: 2, unit: 'years' }, auditRetention: { value: 3, unit: 'years' }, accountRetention: { value: 4, unit: 'years' }, locales: ['en'] });
  await h.reject('client:client', { type: 'publish_policy', policy: next }, 'Unauthorized');
  await h.ok('admin', { type: 'publish_policy', policy: next });
  assert.deepEqual(h.repository.state.jobs.job, snapshot); h.clock.value = 200;
  await h.published('new'); assert.equal(h.repository.state.jobs.new.cycles[0].countdown.deadline, 201);
  assert.equal(h.repository.state.jobs.new.cycles[0].countdown.policyVersion, 'v2');
  await h.reserved('new'); await h.reject('client:client', { type: 'cash', jobId: 'new' }, 'CashUnavailable');
  await h.reject('client:client', { type: 'initiate_payment', jobId: 'new', id: 'none', route: 'card' }, 'RouteUnavailable');
});
test('CFG.providerConfirmation absent never inherits client timeout; fixed recovery is not configurable', async () => {
  const h = harness({ providerConfirmation: undefined }); await h.reserved();
  await h.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' }, 'InvalidConfiguration');
  assert.equal(validatePolicy(policy()).ok, true);
  await h.reject('admin', { type: 'publish_policy', policy: policy({ version: 'v2', effectiveAt: 200, recoveryRate: ratio(10n) }) }, 'FixedRecoveryRate');
  rejected(checked(() => assertFixedRecovery({ masterId: 'master', rate: ratio(70n) })), 'FixedRecoveryRate');
});
for (const autoClose of [true, false]) test(`PUB.5 CFG.initialAutoClose ${autoClose} applies only to new first cycle`, async () => {
  const h = harness({ initialAutoClose: autoClose }); await h.published();
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'v2', effectiveAt: 101, initialAutoClose: !autoClose }) }); h.clock.value = 101;
  await h.published('new'); assert.equal(h.repository.state.jobs.job.cycles[0].countdown === null, !autoClose);
  assert.equal(h.repository.state.jobs.new.cycles[0].countdown === null, autoClose);
});

test('CAT/FRM complete 8/31 fixture validates every architecture/scenario and all complete forms; required fields/photos fail', () => {
  const c = catalog(); assert.equal(c.categories.length, 8); assert.equal(c.entities.length, 31); assert.equal(validateCatalog(c, true).ok, true);
  assert.equal(c.entities.filter(e => e.categoryId === 'locks').length, 2); assert.equal(c.entities.filter(e => e.categoryId === 'built-in').length, 11);
  for (const scenario of c.scenarios) {
    const item = scope(c, scenario.entityId, scenario.action); const photos = Object.values(item.photos).flat().map(id => ({ id, ownerId: 'client', present: true, format: 'image/jpeg' }));
    assert.equal(validateScope(c, [item], photos, 'client').ok, true, scenario.id);
    const incomplete = structuredClone(item); const required = scenario.form.questions.find(q => !q.when);
    if (required) { delete incomplete.answers[required.id]; rejected(validateScope(c, [incomplete], photos, 'client'), 'RequiredAnswer'); }
    const absent = structuredClone(item); const requiredPhoto = scenario.form.photos.find(photo => photo.minimum > 0 && !photo.when); absent.photos[requiredPhoto.id] = []; rejected(validateScope(c, [absent], photos, 'client'), 'RequiredPhoto');
  }
  const extended = structuredClone(c);
  for (let i = 0; i < 60; i++) extended.categories.push({ ...extended.categories[0], id: `extension:${i}`, order: i + 8 });
  assert.equal(validateCatalog(extended, true).ok, true);
});
test('FRM routes/stop conditions produce typed failure before job publication; conditional photos/tables independently validated', async () => {
  const h = harness();
  for (const entity of ['washer', 'dishwasher']) {
    const item = scope(h.fixture, entity); item.answers['built-in'] = true;
    await h.reject('client:client', { type: 'new_job', id: entity, draft: { items: [item], cep: 1n, address: 'private' } }, 'RouteRequired');
    assert.equal(h.repository.state.jobs[entity], undefined);
  }
  const disposer = scope(h.fixture, 'disposer', 'replace'); disposer.answers['old-installed'] = false;
  rejected(validateScope(h.fixture, [disposer], [], 'client'), 'RouteRequired');
  const cleaning = scope(h.fixture, 'post-repair', 'clean'); cleaning.answers['repair-completed'] = false;
  rejected(validateScope(h.fixture, [cleaning], [], 'client'), 'StopCondition');
  const cabinet = scope(h.fixture, 'cabinet', 'assemble'); assert.equal(cabinet.tables['furniture-list'].length, 3);
  cabinet.tables['furniture-list'].push(...Array.from({ length: 100 }, () => ({ type: 'chair', quantity: 1, dimensions: [1, 2, 3] })));
  const photos = Object.values(cabinet.photos).flat().map(id => ({ id, present: true, format: 'image/jpeg', ownerId: 'client' }));
  assert.equal(validateScope(h.fixture, [cabinet], photos, 'client').ok, true);
  cabinet.tables['furniture-list'][0].quantity = 0; rejected(validateScope(h.fixture, [cabinet], photos, 'client'), 'InvalidScope');
  const built = scope(h.fixture, 'built-in-furniture', 'assemble'); assert.equal(Object.keys(built.tables['niche-measurements'][0]).length, 14);
});
test('FRM Electrical points and item quantity differ; built-in equipment actions coexist without a global action', async () => {
  const h = harness(); const points = [scope(h.fixture, 'socket', 'install_connect', 'point1'), scope(h.fixture, 'switch', 'relocate', 'point2')];
  points[0].answers.quantity = 7; await h.published('points', '', '', points);
  assert.equal(h.repository.state.jobs.points.snapshot.items.length, 2); assert.equal(h.repository.state.jobs.points.snapshot.items[0].answers.quantity, 7);
  const appliances = [scope(h.fixture, 'bi-oven', 'install_connect', 'oven'), scope(h.fixture, 'bi-fridge', 'replace', 'fridge')];
  await h.published('appliances', '', '', appliances); assert.notEqual(appliances[0].scenarioId.split(':')[1], appliances[1].scenarioId.split(':')[1]);
  await h.reject('client:client', { type: 'edit_draft', jobId: 'points', draft: { items: points, cep: 10n, address: 'changed' } }, 'PublishedSnapshotImmutable');
});
test('TXT/INF authoring requires Admin, exact revisions and explicit three-language atomic approval', async () => {
  const h = harness(); const draft = catalog({ approved: false, version: 2 }); const key = 'test-catalog:2';
  await h.reject('client:client', { type: 'save_catalog', draft, expectedSequence: null }, 'Unauthorized');
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  await h.reject('admin', { type: 'publish_catalog', key, sequence: 1 }, 'ApprovalRequired');
  await h.reject('admin', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'ru', sequence: 1, revision: 2 }, 'StaleRevision');
  await h.ok('admin', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'ru', sequence: 1, revision: 1 });
  await h.ok('admin', { type: 'approve_content_set', key, sequence: 2, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  const sequence = 3;
  await h.reject('admin', { type: 'publish_catalog', key, sequence: sequence - 1 }, 'Conflict');
  await h.ok('admin', { type: 'publish_catalog', key, sequence });
  assert.equal(h.repository.state.current, key); assert.ok(h.repository.state.published['test-catalog:1']);
  const info = information(h.repository.state.published[key], [scope(h.fixture)], 'master', 'ru');
  assert.equal(new Set(info.map(b => b.id)).size, info.length); assert.ok(info.some(block => block.text.includes('При замене демонтированное оборудование')));
  rejected(checked(() => information(h.fixture, [], 'admin', 'en')), 'Unauthorized');
});
test('TXT edits preserve other languages; changed text cannot carry approval; missing locale stays unpublished after locale setting change', async () => {
  const h = harness(); const draft = catalog({ approved: false, version: 2 }); await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  const update = structuredClone(draft); update.sequence = 2; update.texts[0].revision = 2;
  for (const edition of Object.values(update.texts[0].editions)) edition.revision = 2;
  update.texts[0].editions.ru.text = 'TEST changed'; await h.ok('admin', { type: 'save_catalog', draft: update, expectedSequence: 1 });
  assert.equal(h.repository.state.drafts['test-catalog:2'].texts[0].editions.en.text, draft.texts[0].editions.en.text);
  await h.ok('admin', { type: 'approve_text', key: 'test-catalog:2', textId: update.texts[0].id, locale: 'ru', sequence: 2, revision: 2 });
  const stale = structuredClone(h.repository.state.drafts['test-catalog:2']); stale.sequence++; stale.texts[0].editions.ru.text += '!';
  await h.reject('admin', { type: 'save_catalog', draft: stale, expectedSequence: stale.sequence - 1 }, 'ApprovalRequired');
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'en-only', effectiveAt: 101, locales: ['en'] }) }); h.clock.value = 101;
  await h.reject('admin', { type: 'publish_catalog', key: 'test-catalog:2', sequence: 3 }, 'ApprovalRequired');
  assert.equal(h.repository.state.current, 'test-catalog:1');
});

test('FED category selection includes new entities; selected entities/empty selection do not; address hidden until assigned', async () => {
  const h = harness(); await h.published(); const job = h.repository.state.jobs.job;
  assert.equal(feed(h.repository.state, 'master', { categoryIds: ['appliance'], entityIds: [] }, h.clock.value).length, 1);
  assert.equal(feed(h.repository.state, 'master', { categoryIds: [], entityIds: ['dishwasher'] }, h.clock.value).length, 0);
  assert.equal(feed(h.repository.state, 'master', { categoryIds: [], entityIds: [] }, h.clock.value).length, 0);
  assert.doesNotMatch(JSON.stringify(feed(h.repository.state, 'master', { categoryIds: ['appliance'], entityIds: [] }, h.clock.value), (_, v) => typeof v === 'bigint' ? `${v}` : v), /PRIVATE/);
  rejected(checked(() => address(job, { userId: 'master', role: 'master', permissions: [] })), 'Unauthorized');
  h.repository.state.refusalStreak.master = 100; await h.assigned(); assert.equal(address(h.repository.state.jobs.job, { userId: 'master', role: 'master', permissions: [] }), 'PRIVATE EXACT ADDRESS');
});
for (const oneSided of [false, true]) test(`PUB initial empty/one-sided period closes without repeat, oneSided=${oneSided}`, async () => {
  const h = harness(); await h.published(); if (oneSided) { await h.offer(); await h.message('master:master'); }
  const deadline = h.repository.state.jobs.job.cycles[0].countdown.deadline; h.clock.value = deadline;
  await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  assert.equal(h.repository.state.jobs.job.state, 'expired'); assert.equal(h.repository.state.jobs.job.cycles.length, 1);
  await h.reject('master:master', { type: 'initial_offer', jobId: 'job', id: 'late', chatId: 'late' }, 'PublicationExpired');
  assert.equal(h.repository.state.refusalStreak.master, undefined);
});
for (const afterDeadline of [false, true]) test(`PUB/REF protected parallel negotiations and early/late close, afterDeadline=${afterDeadline}`, async () => {
  const h = harness(); await h.published(); await h.offer(); await h.offer('job', 'master2'); await h.bilateral(); await h.bilateral('job', 'master2');
  const snapshot = structuredClone(h.repository.state.jobs.job.snapshot); const deadline = h.repository.state.jobs.job.cycles[0].countdown.deadline;
  if (afterDeadline) { h.clock.value = deadline; await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 }); assert.equal(h.repository.state.jobs.job.cycles.length, 1); }
  await h.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'no agreement' });
  assert.equal(h.repository.state.threads['chat:job:master2'].mode, 'temporary');
  await h.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master2', confirmed: true, reason: 'no agreement' });
  if (!afterDeadline) { assert.equal(h.repository.state.jobs.job.cycles.length, 1); h.clock.value = deadline; await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 }); }
  assert.equal(h.repository.state.jobs.job.cycles[1].countdown.duration, 12 * 3600); assert.deepEqual(h.repository.state.jobs.job.snapshot, snapshot);
  h.clock.value = h.repository.state.jobs.job.cycles[1].countdown.deadline; await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 1 }); assert.equal(h.repository.state.jobs.job.state, 'expired');
  assert.equal(h.repository.state.refusalStreak.master, undefined);
});
test('OFR/A-03 confirmations, one change after discussion, final/selection distinct and closing window no mutation', async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'extra scope', confirmed: true }, 'DiscussionRequired');
  await h.bilateral(); await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: false }, 'ConfirmationRequired');
  await h.ok('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: true });
  await h.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true }, 'FinalApplicationRequired');
  await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: true }, 'ApprovalRequired');
  await h.ok('client:client', { type: 'approve_price', jobId: 'job', masterId: 'master', approved: true, confirmed: true });
  await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1300n, reason: 'reason', confirmed: true }, 'PriceAlreadyRevised');
  await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: false }, 'ConfirmationRequired');
  await h.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: true });
  const before = await h.repository.read(); const restarted = new DomainCore(h.ports); // Hiding/reopening a window sends no domain command.
  assert.deepEqual(await h.repository.read(), before); assert.ok(restarted);
  await h.reject('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: false, reason: '' }, 'ConfirmationRequired');
  await h.ok('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true });
  assert.equal(h.repository.state.jobs.job.state, 'reserved'); assert.equal(h.repository.state.jobs.job.financial.fap, 1200n); assert.equal(h.repository.state.jobs.job.chatId, 'chat:job:master');
});
test('REF first through fourth withdrawals warn once each without suspension; completed alone resets', async () => {
  const h = harness();
  for (let i = 1; i <= 4; i++) {
    await h.published(`j${i}`); await h.offer(`j${i}`);
    const command = { type: 'terminate_negotiation', jobId: `j${i}`, masterId: 'master', confirmed: true, reason: 'withdraw' };
    const [a, b] = await Promise.all([h.execute('master:master', command, `withdraw${i}`), h.execute('master:master', command, `withdraw${i}`)]);
    assert.equal(a.ok, true); assert.deepEqual(a, b); assert.equal(h.repository.state.refusalStreak.master, i);
    await h.reject('master:master', { type: 'initial_offer', jobId: `j${i}`, id: `again${i}`, chatId: `again${i}` }, 'Conflict');
  }
  await h.assigned(); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); assert.equal(h.repository.state.refusalStreak.master, 4);
  await h.ok('master:master', { type: 'complete', jobId: 'job' }); assert.equal(h.repository.state.refusalStreak.master, 0); assert.equal(Object.keys(h.repository.state.refusals).length, 4);
});
test('PUB close/select concurrency has one winner and preserves reservation or invalidates final', async () => {
  for (const closeFirst of [false, true]) {
    const h = harness(); await h.published(); await h.offer(); await h.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', confirmed: true, amount: 1000n, recipientId: 'client' });
    const close = () => h.execute('admin', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'reviewed' });
    const select = () => h.execute('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', confirmed: true, amount: 1000n });
    const results = await Promise.all(closeFirst ? [close(), select()] : [select(), close()]); assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(h.repository.state.jobs.job.state, closeFirst ? 'published' : 'reserved'); assert.equal(h.repository.state.refusalStreak.master, undefined);
  }
});
test('CHT source-language notice persists across restart, same language not repeated, changed language renewed; all translations separate', async () => {
  const h = harness(); await h.published(); await h.offer(); await h.message('client:client', 'RU:first');
  assert.deepEqual(h.repository.state.threads['chat:job:master'].languageNotice, { language: 'ru', pending: true });
  const restarted = new DomainCore(h.ports); assert.equal((await h.repository.read()).threads['chat:job:master'].languageNotice.pending, true);
  const messageId = h.repository.state.threads['chat:job:master'].messageIds[0]; const original = h.repository.state.messages[messageId].original;
  for (const target of ['th', 'ru', 'en']) { const result = await restarted.translateMessage('master:master', messageId, target); assert.equal(result.ok, true); assert.equal(result.value.original, original); }
  await h.message('master:master'); await h.message('client:client', 'RU:same'); assert.equal(h.repository.state.threads['chat:job:master'].languageNotice.pending, false);
  await h.message('client:client', 'EN:new'); assert.equal(h.repository.state.threads['chat:job:master'].languageNotice.pending, true);
  await h.message('master:master'); await h.message('client:client', '?unknown'); assert.equal(h.repository.state.threads['chat:job:master'].languageNotice.pending, false);
  h.setTranslatorFailure(true); rejected(await h.core.translateMessage('master:master', messageId, 'th'), 'TranslationUnavailable'); assert.equal(h.repository.state.messages[messageId].original, original);
  rejected(await h.core.translateMessage('stranger:client', messageId, 'en'), 'Unauthorized');
  assert.equal(publishedText(h.fixture, h.fixture.categories[0].title, 'th').includes('TEST ONLY'), true);
});
test('CHT temporary photos prohibited; same chat becomes work with max one photo per message, then read-only', async () => {
  const h = harness(); await h.published(); await h.offer();
  const message = { type: 'message', chatId: 'chat:job:master', id: 'photo', original: '', photoIds: ['master-photo'], sender: 'user' };
  await h.reject('master:master', message, 'InvalidPhoto'); await h.assigned();
  await h.ok('master:master', message);
  await h.reject('master:master', { ...message, id: 'two', photoIds: ['master-one', 'master-two'] }, 'InvalidPhoto');
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await h.ok('master:master', { type: 'complete', jobId: 'job' });
  await h.reject('master:master', { ...message, id: 'closed' }, 'ChatClosed');
});

test('PAY/E-04 pending past deadline retains reserve, blocks all alternate routes, late first failed resets only once', async () => {
  const h = harness(); await h.reserved(); const original = h.repository.state.jobs.job.reservation.countdown;
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p1', route: 'card' }); h.clock.value = original.deadline + 100;
  h.outcomes.set('unknown', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'unknown' });
  const unknown = await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'unknown' }); assert.equal(unknown.outcome.view.status, 'needsResolution'); assert.equal(unknown.outcome.view.operationId, 'p1');
  assert.equal(unknown.outcome.view.deadline, original.deadline);
  await h.reject('admin', { type: 'reservation_deadline', jobId: 'job' }, 'PaymentOutcomeUnknown');
  await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'PaymentOutcomeUnknown');
  await h.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p2', route: 'bank_transfer' }, 'PaymentOutcomeUnknown');
  h.outcomes.set('fail', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'failed', reason: 'insufficient_funds' });
  await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'fail' }); const reset = h.repository.state.jobs.job.reservation.countdown.deadline; assert.equal(reset, h.clock.value + 600);
  await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'fail' }); assert.equal(h.repository.state.jobs.job.reservation.countdown.deadline, reset);
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p2', route: 'bank_transfer' });
  h.outcomes.set('fail2', { operationId: 'p2', amount: 1000n, currency: 'THB', status: 'failed' }); h.clock.value++; await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'fail2' }); assert.equal(h.repository.state.jobs.job.reservation.countdown.deadline, reset);
  await h.ok('client:client', { type: 'cash', jobId: 'job' }); assert.equal(h.repository.state.jobs.job.state, 'assigned');
});
test('PAY callback identity/amount/currency/conflicting terminal rejected, duplicate success assigns once', async () => {
  const h = harness(); await h.reserved(); await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' });
  for (const [proof, value] of [['badAmount', { amount: 999n }], ['badCurrency', { currency: 'USD' }]]) {
    h.outcomes.set(proof, { operationId: 'p', amount: 1000n, currency: 'THB', status: 'success', ...value }); await h.reject('admin', { type: 'payment_outcome', jobId: 'job', proof }, 'ProviderConflict');
  }
  h.outcomes.set('success', { operationId: 'p', amount: 1000n, currency: 'THB', status: 'success' });
  await Promise.all([h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'success' }), h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'success' })]);
  assert.equal(h.repository.state.jobs.job.state, 'assigned'); h.outcomes.set('contradiction', { operationId: 'p', amount: 1000n, currency: 'THB', status: 'failed' });
  await h.reject('admin', { type: 'payment_outcome', jobId: 'job', proof: 'contradiction' }, 'ProviderConflict');
});
test('PAY terminal reservation expiry never republishes; cash personal thresholds only block Cash', async () => {
  const h = harness(); await h.reserved(); await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 0n });
  assert.equal(debtView(h.repository.state, 'master', h.config).mode, 'noncash_only'); await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'CashUnavailable');
  h.clock.value += 600; await h.ok('admin', { type: 'reservation_deadline', jobId: 'job' }); assert.equal(h.repository.state.jobs.job.state, 'expired');
  assert.equal(feed(h.repository.state, 'master', h.repository.state.users.master.specialization, h.clock.value).length, 0);
  await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'InvalidTransition');
});

test('WRK normal acceptance directly assigned without evidence is two-stage; duplicate completion cannot create commission twice', async () => {
  const h = harness(); await h.assigned();
  await h.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  await h.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: '' }, 'EvidenceRequired');
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'correct this' });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); assert.equal(h.repository.state.debt.master, undefined);
  await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'complete-once'); await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'complete-once');
  await h.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition'); assert.equal(h.repository.state.debt.master, 300n); assert.equal(Object.keys(h.repository.state.ledger).length, 1);
});
test('MON/04 payout failed retains debt recovery 300 and obligation 400, unknown prohibits retry, success only once', async () => {
  const h = harness(); h.repository.state.debt.master = 300n; await h.completed('card'); const payout = h.repository.state.payouts.job;
  assert.equal(payout.amount, 400n); assert.equal(payout.debtRecovery, 300n); assert.equal(h.repository.state.debt.master, 0n);
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out1' });
  h.outcomes.set('unknown', { operationId: 'out1', amount: 400n, currency: 'THB', status: 'unknown' });
  const waiting = await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'unknown' });
  assert.equal(waiting.outcome.execution.state, 'needsResolution'); assert.equal(waiting.outcome.execution.operationId, 'out1');
  assert.equal(waiting.outcome.execution.reason, 'provider_outcome_unknown');
  await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out2' }, 'PaymentOutcomeUnknown');
  h.outcomes.set('failed', { operationId: 'out1', amount: 400n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'failed' });
  assert.equal(h.repository.state.debt.master, 0n); assert.equal(h.repository.state.jobs.job.state, 'completed');
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out2' }); assert.equal(h.repository.state.payouts.job.attempts[1].amount, 400n);
  h.outcomes.set('success', { operationId: 'out2', amount: 400n, currency: 'THB', status: 'success' });
  await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'success' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'success' });
  assert.equal(h.repository.state.payouts.job.settled, true); assert.equal(Object.keys(h.repository.state.ledger).length, 1);
});
test('MON payouts exact half-up 105/101/1/0, zero transfer absent and missing destination leaves obligation intact', async () => {
  const { calculatePayout, initiatePayout } = await import('../dist/domain/finance.js');
  for (const [net, recovery, remaining] of [[105n, 74n, 31n], [101n, 71n, 30n], [1n, 1n, 0n], [0n, 0n, 0n]]) {
    const h = harness(); h.repository.state.debt.master = 1000n;
    const snapshot = { fap: net, currency: 'THB', policyVersion: 'test', commission: ratio(0n), mutualCancellationFee: ratio(15n), falseCallFee: ratio(30n), falseCallMasterShare: ratio(50n) };
    const payout = calculatePayout(h.repository.state, 'numeric', 'master', snapshot, 0, 'admin'); assert.equal(payout.debtRecovery, recovery); assert.equal(payout.amount, remaining);
    if (remaining === 0n) assert.equal(initiatePayout(payout, h.config, null, 0, 'zero'), null);
    else rejected(checked(() => initiatePayout(payout, h.config, null, 0, 'no-destination')), 'DestinationUnverified');
  }
});
test('DBT voluntary repayment requires official support and explicit actual Admin receipt, current debt and one ledger fact', async () => {
  const h = harness(); h.repository.state.debt.master = 1000n;
  await h.reject('master:master', { type: 'request_repayment', id: 'bad', amount: 1001n, confirmed: true }, 'InvalidRepayment');
  await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true }); assert.equal(h.repository.state.debt.master, 1000n);
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
  await h.reject('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'work_off', agreementId: 'agreement' }, 'InvalidRepayment');
  await h.ok('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'bank_transfer', agreementId: 'agreement' });
  const receipt = { type: 'receive_repayment', requestId: 'r', masterId: 'master', amount: 300n, receiptId: 'received', agreementId: 'agreement', actuallyReceived: true, evidence: 'received in bank' };
  await h.reject('master:master', receipt, 'Unauthorized'); await h.reject('admin', { ...receipt, actuallyReceived: false }, 'ReceiptUnconfirmed');
  await h.reject('admin', { ...receipt, masterId: 'master2' }, 'Unauthorized');
  await Promise.all([h.ok('admin', receipt, 'receipt-once'), h.ok('admin', receipt, 'receipt-once')]); assert.equal(h.repository.state.debt.master, 700n);
  await h.reject('admin', receipt, 'InvalidRepayment'); assert.equal(Object.keys(h.repository.state.ledger).length, 1);
});
test('DBT concurrent payout and receipt cannot overpay debt or silently change agreed amount', async () => {
  const h = harness(); h.repository.state.debt.master = 300n;
  await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true });
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
  await h.ok('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'cash', agreementId: 'a' }); await h.completed('card');
  await h.reject('admin', { type: 'receive_repayment', requestId: 'r', masterId: 'master', amount: 300n, receiptId: 'receipt', agreementId: 'a', actuallyReceived: true, evidence: 'cash' }, 'DebtChanged');
  assert.equal(h.repository.state.debt.master, 0n); assert.equal(h.repository.state.repayments.r.amount, 300n);
});
test('SUP official sender/access isolation and support lifetime distinct from order; text never changes debt', async () => {
  const h = harness(); h.repository.state.debt.master = 100n; await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 100n, confirmed: true });
  const create = { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' };
  await h.reject('master:master', create, 'Unauthorized'); await h.ok('admin', create);
  const command = { type: 'message', chatId: 'support', id: 'official', original: 'debt paid', photoIds: [], sender: 'helpy' };
  await h.ok('admin', command); await h.reject('master:master', { ...command, id: 'fake' }, 'Unauthorized');
  await h.reject('stranger:client', { ...command, id: 'stranger', sender: 'user' }, 'Unauthorized');
  await h.ok('master:master', { ...command, id: 'reply', sender: 'user' });
  assert.equal(h.repository.state.debt.master, 100n);
  const messages = history(h.repository.state, h.repository.state.threads.support, { userId: 'master', role: 'master', permissions: [] }); assert.equal(messages[0].authorId, 'helpy');
  await h.completed(); assert.equal(h.repository.state.threads.support.mode, 'support');
  const translated = await h.core.translateMessage('master:master', 'official', 'th'); assert.equal(translated.ok, true);
});

function decision(type, facts = {}, extra = {}) { return { id: `decision:${type}`, type, reason: 'reviewed evidence', evidence: ['cancel'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true, ...facts }, ...extra }; }
test('RES/E-01 accepted case before inactivity threshold remains open/held without financial/streak effects; Admin completion after threshold once', async () => {
  const h = harness(); h.repository.state.refusalStreak.master = 2; await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  const resolve = { type: 'decide_resolution', caseId: 'case', decision: decision('exceptional_completion', {}, { evidence: await h.reviewedCompletion('case') }) };
  await h.reject('admin', resolve, 'ResolutionRequired'); assert.equal(h.repository.state.jobs.job.state, 'client_accepted'); assert.equal(h.repository.state.jobs.job.funds, 'held'); assert.equal(h.repository.state.refusalStreak.master, 2);
  h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline; await h.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h.repository.state.refusalStreak.master, 2); assert.equal(h.repository.state.jobs.job.state, 'client_accepted');
  await h.ok('admin', resolve, 'exceptional'); await h.ok('admin', resolve, 'exceptional'); assert.equal(h.repository.state.jobs.job.state, 'completed'); assert.equal(h.repository.state.refusalStreak.master, 0); assert.ok(h.repository.state.payouts.job);
});
test('RES cancellation blocks completion, timeout escalates not consents; unclassified master request has no financial effect', async () => {
  const h = harness(); await h.assigned('card');
  await h.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'unsafe', explanation: 'needs review', evidence: [], confirmed: true, classification: 'unclassified', remainingWork: '' });
  assert.equal(h.repository.state.cases['case:cancel'].status, 'admin_resolution_pending'); assert.equal(h.repository.state.jobs.job.funds, 'held'); assert.equal(h.repository.state.refusalStreak.master, undefined);
  await h.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }, 'ResolutionRequired');
  await h.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal') }, 'ResolutionRequired');
  const h2 = harness(); await h2.assigned('card'); await h2.ok('client:client', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'changed', explanation: 'cannot proceed', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' });
  h2.clock.value += 8 * 3600; await h2.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h2.repository.state.cases['case:cancel'].status, 'admin_resolution_pending'); assert.equal(h2.repository.state.jobs.job.cancellation.financialConsent, null);
});
test('RES approved cancellation allocations integer/conserving, parameterized False Call and partial mismatch rejection', async () => {
  const snapshot = { fap: 101n, currency: 'THB', policyVersion: 'v', commission: ratio(30n), mutualCancellationFee: ratio(15n), falseCallFee: ratio(30n), falseCallMasterShare: ratio(50n) };
  assert.deepEqual(allocation(snapshot, 'partial', { clientRefund: 50n, masterCompensation: 21n }), { clientRefund: 50n, masterCompensation: 21n, helpyShare: 30n });
  rejected(checked(() => allocation(snapshot, 'partial', { clientRefund: 36n, masterCompensation: 36n })), 'FundsMismatch');
  for (const share of [50n, 40n]) {
    const split = allocation({ ...snapshot, fap: 103n, falseCallMasterShare: ratio(share) }, 'false_call'); assert.equal(split.clientRefund + split.masterCompensation + split.helpyShare, 103n);
    if (share === 50n) { assert.equal(split.helpyShare, 16n); assert.equal(split.masterCompensation, 15n); }
  }
  const h = harness(); await h.assigned('card'); await h.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'refusal', explanation: 'cannot work', evidence: [], confirmed: true, classification: 'unclassified', remainingWork: '' });
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal', { voluntaryRefusalProven: true }) });
  assert.equal(h.repository.state.jobs.job.state, 'cancelled'); assert.equal(h.repository.state.refusalStreak.master, 1); assert.equal(h.repository.state.obligations['decision:master_refusal:refund'].amount, 1000n); assert.equal(h.repository.state.debt.master, undefined);
});
test('REP public-only aggregates 4.5/0.5/2 with experience3; hiding preserves sources and all-hidden has no fabricated ratings', async () => {
  const h = harness();
  for (const [id, stars, marks] of [['a', 5, ['agreements_kept']], ['b', 1, []], ['c', 4, []]]) {
    await h.completed('cash', id); await h.ok('client:client', { type: 'review', jobId: id, id: `review:${id}`, stars, marks, comment: 'original' });
  }
  await h.reject('client:client', { type: 'hide_review', reviewId: 'review:b', reason: 'policy' }, 'Unauthorized');
  await h.ok('admin', { type: 'hide_review', reviewId: 'review:b', reason: 'policy' });
  let summary = reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master'); assert.equal(summary.workQuality, 4.5); assert.equal(summary.reliability, 0.5); assert.equal(summary.reviewsCount, 2); assert.equal(summary.experience, 3);
  const original = structuredClone(h.repository.state.reviews['review:a']); await h.ok('admin', { type: 'hide_review', reviewId: 'review:a', reason: 'policy' }); await h.ok('admin', { type: 'hide_review', reviewId: 'review:c', reason: 'policy' });
  summary = reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master'); assert.equal(summary.workQuality, null); assert.equal(summary.reliability, null); assert.equal(summary.experience, 3);
  assert.equal(h.repository.state.reviews['review:a'].comment, original.comment); assert.equal(h.repository.state.reviews['review:a'].stars, original.stars);
  await h.ok('client:client', { type: 'hide_history', jobId: 'a' }); assert.equal(orderHistory(h.repository.state, Object.values(h.repository.state.jobs), { userId: 'client', role: 'client', permissions: [] }, 60).length, 2);
  assert.equal(h.repository.state.jobs.a.state, 'completed');
});

test('ACC independent activation, verified claims/recovery bind to same user; reused/foreign claims do not merge', async () => {
  const h = harness(); const claim = { id: 'login', purpose: 'login', identity: { method: 'google', subject: 'subject' }, email: 'new@test.invalid', phone: null, expiresAt: 1000, ownerId: null };
  h.claims.set('google-proof', claim); const logged = await h.core.authenticate('google-proof', 'new', 'login'); assert.equal(logged.ok, true); assert.equal(logged.value.clientActive, false); assert.equal(logged.value.masterActive, false);
  await h.ok('new:client', { type: 'profile', displayName: 'New', photoId: null, specialization: { categoryIds: [], entityIds: [] } }); await h.ok('new:client', { type: 'activate', role: 'client' });
  await h.reject('new:client', { type: 'activate', role: 'master' }, 'ProfileIncomplete');
  h.claims.set('phone', { ...claim, id: 'phone', purpose: 'bind', identity: { method: 'phone_otp', subject: '+66111' }, email: null, phone: '+66111', ownerId: 'new' });
  h.photoMetadata.set('profile-photo', { id: 'profile-photo', ownerId: 'new', present: true, format: 'image/jpeg' });
  await h.ok('new:client', { type: 'bind_contact', proof: 'phone' }); await h.ok('new:client', { type: 'profile', displayName: 'New', photoId: 'profile-photo', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  await h.ok('new:client', { type: 'activate', role: 'master' }); const before = structuredClone(h.repository.state.users.new);
  assert.equal(switchRole(before, { userId: 'new', role: 'client', permissions: [] }, 'master').role, 'master');
  rejected(checked(() => privateContacts(before, { userId: 'stranger', role: 'client', permissions: [] })), 'Unauthorized'); assert.equal(privateContacts(before, admin).phone, '+66111');
  h.claims.set('recover', { ...claim, id: 'recover', purpose: 'recover', ownerId: 'new' }); const recovered = await h.core.authenticate('recover', 'new', 'recovery', true); assert.equal(recovered.ok, true); assert.deepEqual(recovered.value, before);
  rejected(await h.core.authenticate('recover', 'new', 'recovery-again', true), 'ClaimConsumed');
  h.claims.set('foreign', { ...claim, id: 'foreign', purpose: 'recover', ownerId: 'client' }); rejected(await h.core.authenticate('foreign', 'client', 'foreign', true), 'ContactUnverified');
});
test('RET independent calendar year and completed 90-day anchors; cancelled/expired/unresolved never borrow an anchor', () => {
  const h = harness(); const anchor = Date.UTC(2024, 0, 1) / 1000;
  for (const kind of ['communication', 'evidence', 'financial', 'audit', 'account']) {
    const fact = retentionFact(kind, anchor, ['communication', 'evidence'].includes(kind) ? 'completed' : 'recorded', h.config, h.clock);
    h.clock.value = fact.deadline - 1; assert.equal(evaluateRetention(fact, h.clock, { hold: false, notBefore: null }).eligibleForRetentionAction, false);
    h.clock.value++; assert.equal(evaluateRetention(fact, h.clock, { hold: false, notBefore: null }).eligibleForRetentionAction, true);
    assert.equal(evaluateRetention(fact, h.clock, { hold: true, notBefore: null }).eligibleForRetentionAction, false);
    if (kind === 'financial') assert.equal(fact.deadline, Date.UTC(2025, 0, 1) / 1000);
  }
  for (const outcome of ['cancelled', 'expired', 'admin_resolution_pending']) {
    const fact = retentionFact('communication', null, 'recorded', h.config, h.clock); assert.equal(evaluateRetention(fact, h.clock, { hold: false, notBefore: null }).eligibleForRetentionAction, false, outcome);
  }
  assert.equal(timer(100, 600, 'v1').deadline, 700);
});
test('PRC atomic rollback, operation collision, durable replay across repository restart', async () => {
  const h = harness(); h.repository.failNextCommit = true;
  await h.reject('client:client', { type: 'new_job', id: 'job', draft: { items: [scope(h.fixture)], cep: 1000n, address: 'private' } }, 'Conflict', 'atomic');
  await h.published(); await h.offer(); const command = { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'withdraw' };
  await h.ok('master:master', command, 'durable'); const restarted = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts));
  const core = new DomainCore({ ...h.ports, repository: restarted }); const replay = await core.execute('master:master', 'durable', command); assert.equal(replay.ok, true); assert.equal(restarted.state.refusalStreak.master, 1);
  rejected(await core.execute('client:client', 'durable', command), 'Conflict');
});
