import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../dist/application/queries.js';
import { catalog, policy, ratio, scope } from './f2-fixtures.mjs';
import { harness } from './f2-harness.mjs';
import { validateCatalog } from '../dist/domain/catalog.js';

const read = (h, session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
async function configure(h, mutate, version) {
  const draft = structuredClone(h.repository.state.published[h.repository.state.current]);
  draft.status = 'draft'; draft.version = version; draft.sequence = 1;
  for (const text of draft.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = null;
  mutate(draft);
  const key = `${draft.id}:${version}`;
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  await h.ok('admin', { type: 'approve_content_set', key, sequence: 1, confirmed: true, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })) });
  await h.ok('admin', { type: 'publish_catalog', key, sequence: 2 }); return draft;
}
test('CAT lifecycle create/edit/publish/disable/republish/remove and independent category/entity order preserve old scope', async () => {
  const h = harness(); await h.published(); const initial = structuredClone(h.repository.state.jobs.job.snapshot);
  await configure(h, draft => {
    draft.categories.push({ ...draft.categories[0], id: 'new-root', order: 99, architecture: 'equipment' });
    draft.entities.push({ ...draft.entities[0], id: 'new-service', categoryId: 'new-root', scenarioIds: ['new-scenario'], order: 7 });
    draft.scenarios.push({ ...draft.scenarios[0], id: 'new-scenario', entityId: 'new-service', action: 'new-action', form: { id: 'new-form', questions: [], photos: [], tables: [], routes: [], stops: [], linkedCategories: [] } });
  }, 2);
  await configure(h, draft => { draft.categories.find(c => c.id === 'new-root').order = 0; draft.entities.find(e => e.id === 'new-service').order = 2; }, 3);
  assert.equal(h.repository.state.published['test-catalog:3'].categories.find(c => c.id === 'new-root').order, 0);
  await configure(h, draft => { draft.entities.find(e => e.id === 'air-install').enabled = false; draft.entities.find(e => e.id === 'air-replace').enabled = false; draft.categories.find(c => c.id === 'air').enabled = false; }, 4);
  const disabled = h.repository.state.published['test-catalog:4'];
  await h.reject('client:client', { type: 'new_job', id: 'disabled', draft: { items: [scope(disabled, 'air-service', 'service')], cep: 1n, publicAddress: 'public district street', address: 'private' } }, 'InactiveEntity');
  assert.equal(h.repository.state.jobs.disabled, undefined);
  await configure(h, draft => { draft.categories.find(c => c.id === 'air').enabled = true; }, 5);
  const republished = h.repository.state.published['test-catalog:5'];
  assert.equal(republished.entities.find(e => e.id === 'air-install').enabled, false); assert.equal(republished.entities.find(e => e.id === 'air-service').enabled, true);
  await configure(h, draft => { draft.entities = draft.entities.filter(e => e.id !== 'new-service'); draft.scenarios = draft.scenarios.filter(s => s.id !== 'new-scenario'); draft.categories = draft.categories.filter(c => c.id !== 'new-root'); }, 6);
  assert.ok(h.repository.state.published['test-catalog:2'].entities.some(e => e.id === 'new-service'));
  assert.deepEqual(h.repository.state.jobs.job.snapshot, initial); assert.equal(h.translationCalls, 0);
  const broken = structuredClone(catalog()); broken.entities[0].categoryId = 'missing'; assert.equal(validateCatalog(broken).error.code, 'InvalidReference');
});
test('INF block lifecycle and versioned role composition; disable/remove does not rewrite historical rules', async () => {
  const h = harness(); await h.published(); const initial = structuredClone(h.repository.state.jobs.job.snapshot);
  await configure(h, draft => {
    const base = draft.blocks[0]; draft.blocks.push({ ...base, id: 'new-block', roles: ['master'], revision: 1 });
    draft.bindings.push({ id: 'new-binding', blockId: 'new-block', blockRevision: 1, role: 'master', order: 99, entityId: 'washer' });
  }, 2);
  let result = await read(h, 'master:master', { type: 'information', catalogKey: 'test-catalog:2', targets: [scope(h.fixture)], locale: 'ru' });
  assert.equal(result.ok, true); assert.ok(result.value.blocks.some(block => block.id === 'new-block'));
  result = await read(h, 'client:client', { type: 'information', catalogKey: 'test-catalog:2', targets: [scope(h.fixture)], locale: 'ru' }); assert.equal(result.value.blocks.some(block => block.id === 'new-block'), false);
  await configure(h, draft => { draft.blocks.find(b => b.id === 'new-block').enabled = false; draft.bindings = draft.bindings.filter(b => b.blockId !== 'new-block'); }, 3);
  await configure(h, draft => { draft.blocks.find(b => b.id === 'new-block').enabled = true; draft.bindings.push({ id: 'republished-binding', blockId: 'new-block', blockRevision: 1, role: 'master', order: 0 }); }, 4);
  await configure(h, draft => { draft.bindings = draft.bindings.filter(b => b.blockId !== 'new-block'); draft.blocks = draft.blocks.filter(b => b.id !== 'new-block'); }, 5);
  assert.deepEqual(h.repository.state.jobs.job.snapshot, initial);
  const invalid = structuredClone(catalog()); invalid.bindings[0].role = 'admin'; assert.equal(validateCatalog(invalid).error.code, 'InvalidReference');
});
test('TXT forged approvals through draft edit and concurrent publication/approval are rejected', async () => {
  const h = harness(); const draft = catalog({ approved: false, version: 2 }); await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  const forged = structuredClone(draft); forged.sequence = 2; for (const text of forged.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = 'forged';
  await h.reject('admin', { type: 'save_catalog', draft: forged, expectedSequence: 1 }, 'ApprovalRequired');
  const approve = { type: 'approve_text', key: 'test-catalog:2', textId: draft.texts[0].id, locale: 'ru', sequence: 1, revision: 1 };
  const results = await Promise.all([h.execute('admin', approve), h.execute('admin', { ...approve, locale: 'en' })]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).error.code, 'Conflict');
  const proposed = await h.core.draftTranslation('admin', 'TEST source', 'en', 'th'); assert.equal(proposed.ok, true); assert.equal(proposed.value.approved, false);
  assert.equal(h.repository.state.current, 'test-catalog:1');
});
test('NTF delivery exactly once under replay/concurrency, unauthorized recipients/channels rejected and feed unaffected', async () => {
  const h = harness(); let calls = 0; h.ports.notifications.deliver = async () => { calls++; return { ok: true, value: 'delivered' }; };
  await h.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['job_published'], channels: ['test-channel'], soundRequested: false } });
  await h.reject('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['unknown'], channels: ['test-channel'], soundRequested: true } }, 'InvalidConfiguration');
  await h.reject('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['job_published'], channels: ['unknown'], soundRequested: true } }, 'InvalidConfiguration');
  await h.published(); const notification = h.repository.state.events.find(e => e.type === 'job_published'); assert.ok(notification.recipients.includes('master')); assert.ok(!notification.recipients.includes('stranger'));
  const args = ['admin', notification.id, 'master', 'test-channel', 'delivery'];
  const delivered = await Promise.all([h.core.dispatchNotification(...args), h.core.dispatchNotification(...args)]); assert.ok(delivered.every(r => r.ok)); assert.equal(calls, 1);
  await h.core.dispatchNotification(...args); assert.equal(calls, 1);
  assert.equal((await h.core.dispatchNotification('master:master', notification.id, 'master', 'test-channel', 'forged')).error.code, 'Unauthorized');
  assert.equal((await h.core.dispatchNotification('admin', notification.id, 'stranger', 'test-channel', 'foreign')).error.code, 'Unauthorized');
  await h.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: [], channels: [], soundRequested: false } });
  assert.equal((await read(h, 'master:master', { type: 'feed' })).value.jobs.length, 1);
});
test('NTF negotiation and cancellation reminders use saved launch deadlines; next reminders use new policy', async () => {
  const h = harness(); await h.published(); await h.offer(); await h.message('client:client');
  const first = structuredClone(h.repository.state.threads['chat:job:master'].reminder);
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'new-reminders', effectiveAt: 101, negotiationFirstReminder: 5, negotiationRepeatReminder: 7 }) });
  h.clock.value = first.deadline - 1; await h.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h.repository.state.events.filter(e => e.type === 'negotiation_reminder').length, 0);
  h.clock.value++; await h.ok('admin', { type: 'reminders', jobId: 'job' }, 'reminder-once'); await h.ok('admin', { type: 'reminders', jobId: 'job' }, 'reminder-once');
  const reminder = h.repository.state.events.find(e => e.type === 'negotiation_reminder'); assert.deepEqual(reminder.recipients, ['master']);
  assert.equal(h.repository.state.threads['chat:job:master'].reminder.deadline, h.clock.value + 7);
  assert.equal(h.repository.state.threads['chat:job:master'].reminder.policyVersion, 'new-reminders');
  await h.message('master:master'); assert.equal(h.repository.state.threads['chat:job:master'].reminder.deadline, h.clock.value + 5);
});
test('PAY reset uses current duration/version without rewriting initial snapshot; next repeat cycle also uses current policy', async () => {
  const h = harness(); await h.reserved(); const financial = structuredClone(h.repository.state.jobs.job.financial); const initial = structuredClone(h.repository.state.jobs.job.reservation.countdown);
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' });
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'v2', effectiveAt: 101, paymentSelectionTimeout: 13, commission: ratio(80n) }) }); h.clock.value = 101;
  assert.deepEqual(h.repository.state.jobs.job.reservation.countdown, initial);
  h.outcomes.set('failed', { operationId: 'p', amount: 1000n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'failed' });
  assert.equal(h.repository.state.jobs.job.reservation.countdown.deadline, 114); assert.equal(h.repository.state.jobs.job.reservation.countdown.policyVersion, 'v2'); assert.deepEqual(h.repository.state.jobs.job.financial, financial);
});
test('MON concurrent payout calculations see actual debt once across two completed orders', async () => {
  const h = harness(); h.repository.state.debt.master = 300n;
  for (const jobId of ['a', 'b']) { await h.assigned('card', jobId); await h.ok('client:client', { type: 'accept_work', jobId, accepted: true, explanation: '' }); }
  const results = await Promise.all(['a', 'b'].map(jobId => h.execute('master:master', { type: 'complete', jobId })));
  assert.ok(results.every(r => r.ok)); const payouts = Object.values(h.repository.state.payouts);
  assert.equal(payouts.reduce((sum, p) => sum + p.debtRecovery, 0n), 300n); assert.equal(payouts.reduce((sum, p) => sum + p.amount, 0n), 1100n); assert.equal(h.repository.state.debt.master, 0n);
});
test('DBT global/independent override/removal and query access; no noncash eligibility restriction at threshold', async () => {
  const h = harness(); h.repository.state.debt.master = 1000n;
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 3000n }); await h.ok('admin', { type: 'threshold', masterId: 'master2', amount: 1000n });
  assert.equal((await read(h, 'master:master', { type: 'debt', masterId: 'master' })).value.view.effectiveMasterDebtThreshold, 3000n);
  assert.equal((await read(h, 'client:client', { type: 'cash_availability', masterId: 'master' })).value.mode, 'cash_and_noncash');
  assert.equal((await read(h, 'client:client', { type: 'debt', masterId: 'master' })).error.code, 'Unauthorized');
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: null });
  assert.equal((await read(h, 'client:client', { type: 'cash_availability', masterId: 'master' })).value.mode, 'noncash_only');
  await h.published(); assert.equal((await read(h, 'master:master', { type: 'feed' })).value.jobs.length, 1);
  await h.assigned('card'); assert.equal(h.repository.state.jobs.job.state, 'assigned');
});

const resolutionInput = (type, facts = {}, shares) => ({ id: `decision:${type}`, type, reason: 'verified circumstances', evidence: ['false_call', 'partial'].includes(type) ? ['master-evidence'] : ['cancel'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true, ...facts }, ...(shares ? { shares } : {}) });
for (const method of ['card', 'cash']) test(`RES mutual/False Call/partial authorized outcomes and exact obligations, method=${method}`, async () => {
  for (const type of ['mutual', 'false_call', 'partial']) {
    const h = harness(); await h.assigned(method);
    if (type === 'partial' || type === 'false_call') await h.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cancel', reason: type, explanation: 'cannot proceed', evidence: ['master-evidence'], confirmed: true, classification: type, remainingWork: type === 'partial' ? 'remaining installation' : '' });
    else {
      await h.ok('client:client', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'stop', explanation: 'cannot proceed', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' });
      await h.ok('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
    }
    const command = { type: 'decide_resolution', caseId: 'case:cancel', decision: resolutionInput(type, { arrived: type === 'false_call', partialWork: type === 'partial' }, type === 'partial' ? { clientRefund: 400n, masterCompensation: 300n } : undefined) };
    await h.reject('master:master', command, 'Unauthorized'); await h.ok('admin', command, `once:${type}`); await h.ok('admin', command, `once:${type}`);
    assert.equal(h.repository.state.jobs.job.state, 'cancelled'); assert.equal(h.repository.state.debt.master, undefined);
    const split = h.repository.state.cases['case:cancel'].decision.allocation;
    if (method === 'cash') { assert.equal(split, null); assert.equal(Object.keys(h.repository.state.obligations).length, 0); }
    else { assert.equal(split.clientRefund + split.masterCompensation + split.helpyShare, 1000n);
      if (type === 'mutual') assert.deepEqual(split, { clientRefund: 850n, masterCompensation: 0n, helpyShare: 150n });
      if (type === 'false_call') assert.deepEqual(split, { clientRefund: 700n, masterCompensation: 150n, helpyShare: 150n });
    }
    await h.reject('admin', command, 'InvalidTransition');
  }
});
test('WRK accepted ordinary cancellation forbidden, exceptional completion cannot complete unaccepted work, 36/6/120 never auto-completes', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
  await h.reject('admin', { type: 'decide_resolution', caseId: 'case', decision: resolutionInput('exceptional_completion') }, 'ResolutionRequired');
  assert.equal(h.repository.state.jobs.job.state, 'assigned');
  const h2 = harness(); await h2.assigned(); await h2.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h2.reject('client:client', { type: 'cancel', jobId: 'job', id: 'late', reason: 'late', explanation: 'late', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' }, 'InvalidTransition');
  h2.clock.value += 36 * 3600; await h2.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h2.repository.state.events.filter(e => e.type === 'inactivity_reminder').length, 1);
  h2.clock.value += 6 * 3600; await h2.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h2.repository.state.events.filter(e => e.type === 'inactivity_reminder').length, 2);
  h2.clock.value = h2.repository.state.jobs.job.inactivityThreshold.deadline; await h2.ok('admin', { type: 'reminders', jobId: 'job' }); assert.equal(h2.repository.state.jobs.job.state, 'client_accepted'); assert.equal(h2.repository.state.debt.master, undefined);
});
test('ACC expiry/occupied binding/concurrent recovery and role-count queries; method/locale never merges accounts', async () => {
  const h = harness();
  h.claims.set('occupied', { id: 'occupied', purpose: 'bind', identity: { method: 'email_otp', subject: 'client@test.invalid' }, email: 'client@test.invalid', phone: null, ownerId: 'master', expiresAt: 1000 });
  await h.reject('master:master', { type: 'bind_contact', proof: 'occupied' }, 'IdentityOccupied');
  h.claims.set('expired', { id: 'expired', purpose: 'recover', identity: { method: 'email_otp', subject: 'client@test.invalid' }, email: 'client@test.invalid', phone: null, ownerId: 'client', expiresAt: 99 });
  assert.equal((await h.core.authenticate('expired', 'client', 'expired', true)).error.code, 'ContactUnverified');
  h.claims.set('recovery', { ...h.claims.get('expired'), id: 'valid', expiresAt: 1000 });
  const results = await Promise.all([h.core.authenticate('recovery', 'client', 'recovery1', true), h.core.authenticate('recovery', 'client', 'recovery2', true)]); assert.equal(results.filter(r => r.ok).length, 1);
  const before = structuredClone(h.repository.state.users.client); await h.ok('client:client', { type: 'locale', locale: 'th' }); assert.deepEqual(h.repository.state.users.client.identities, before.identities);
  assert.equal((await read(h, 'client:client', { type: 'role_counts' })).error.code, 'Unauthorized'); assert.equal((await read(h, 'admin', { type: 'role_counts' })).value.masterProfiles, 2);
});

test('TXT meaning-preserving correction is explicitly authorized and original historical edition remains queryable', async () => {
  const h = harness(); await h.published(); const textId = h.fixture.categories[0].title;
  const original = (await read(h, 'client:client', { type: 'published_text', catalogKey: 'test-catalog:1', textId, locale: 'ru' })).value.text;
  await configure(h, draft => { const text = draft.texts.find(text => text.id === textId); text.revision = 2; for (const edition of Object.values(text.editions)) edition.revision = 2; text.editions.ru.text = 'TEST ONLY corrected, same meaning'; }, 2);
  const correction = { type: 'translation_correction', oldCatalogKey: 'test-catalog:1', newCatalogKey: 'test-catalog:2', textId, sameMeaningConfirmed: true };
  await h.reject('client:client', correction, 'Unauthorized'); await h.reject('admin', { ...correction, sameMeaningConfirmed: false }, 'ConfirmationRequired'); await h.ok('admin', correction);
  assert.equal((await read(h, 'client:client', { type: 'published_text', catalogKey: 'test-catalog:1', textId, locale: 'ru' })).value.text, original);
  assert.equal((await read(h, 'client:client', { type: 'published_text', catalogKey: 'test-catalog:1', textId, locale: 'ru', corrected: true })).value.text, 'TEST ONLY corrected, same meaning');
  await configure(h, draft => { draft.texts.find(text => text.id === textId).meaning++; }, 3);
  await h.reject('admin', { ...correction, newCatalogKey: 'test-catalog:3' }, 'StaleRevision'); assert.equal(h.repository.state.jobs.job.snapshot.catalogKey, 'test-catalog:1');
});
test('RET record-specific anchors and deadlines persist across policy changes; legal policy rejects shortening', async () => {
  const h = harness(); await h.completed(); const saved = structuredClone(h.repository.state.retention);
  assert.equal(saved['communication:job'].anchor, h.repository.state.jobs.job.completedAt);
  assert.equal(saved['financial:ledger:commission:job'].anchorKind, 'recorded');
  assert.notEqual(saved['financial:ledger:commission:job'].deadline, saved['communication:job'].deadline);
  const next = policy({ version: 'new-retention', effectiveAt: 101, communicationRetention: { value: 180, unit: 'days' } });
  await h.ok('admin', { type: 'publish_policy', policy: next });
  for (const [id, fact] of Object.entries(saved)) assert.deepEqual(h.repository.state.retention[id], fact);
  h.ports.legalRetention.validate = () => ({ ok: false, error: { code: 'RetentionBlocked', detail: 'Test legal minimum' } });
  await h.reject('admin', { type: 'publish_policy', policy: policy({ version: 'illegal', effectiveAt: 102, financialRetention: { value: 90, unit: 'days' } }) }, 'RetentionBlocked');
});
test('RES settlement transfer is separate from terminal decision; unknown blocks duplicate, failed retry immutable, refund source protected', async () => {
  const h = harness(); await h.assigned('card');
  await h.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'refusal', explanation: 'cannot work', evidence: [], confirmed: true, classification: 'unclassified', remainingWork: '' });
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: resolutionInput('master_refusal', { voluntaryRefusalProven: true }) });
  const obligationId = 'decision:master_refusal:refund'; const obligation = structuredClone(h.repository.state.obligations[obligationId]);
  await h.reject('client:client', { type: 'start_settlement', obligationId, attemptId: 'refund1' }, 'Unauthorized');
  const resolver = h.ports.payments.settlementDestination;
  h.ports.payments.settlementDestination = async value => { const resolved = await resolver(value); return { ok: true, value: { ...resolved.value, sourcePaymentId: 'wrong-payment' } }; };
  await h.reject('admin', { type: 'start_settlement', obligationId, attemptId: 'refund1' }, 'ProviderConflict'); h.ports.payments.settlementDestination = resolver;
  await h.ok('admin', { type: 'start_settlement', obligationId, attemptId: 'refund1' });
  h.outcomes.set('refund-unknown', { operationId: 'refund1', amount: 1000n, currency: 'THB', status: 'unknown' }); await h.ok('admin', { type: 'settlement_outcome', obligationId, proof: 'refund-unknown' });
  await h.reject('admin', { type: 'start_settlement', obligationId, attemptId: 'refund2' }, 'PaymentOutcomeUnknown');
  h.outcomes.set('refund-failed', { operationId: 'refund1', amount: 1000n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'settlement_outcome', obligationId, proof: 'refund-failed' });
  await h.ok('admin', { type: 'start_settlement', obligationId, attemptId: 'refund2' });
  h.outcomes.set('refund-success', { operationId: 'refund2', amount: 1000n, currency: 'THB', status: 'success' });
  await h.ok('admin', { type: 'settlement_outcome', obligationId, proof: 'refund-success' }); await h.ok('admin', { type: 'settlement_outcome', obligationId, proof: 'refund-success' });
  assert.equal(h.repository.state.obligations[obligationId].settled, true); assert.equal(h.repository.state.obligations[obligationId].amount, obligation.amount);
  assert.equal(h.repository.state.jobs.job.state, 'cancelled'); assert.equal(h.repository.state.refusalStreak.master, 1); assert.equal(h.repository.state.debt.master, undefined);
});
test('WRK evidence/corrections are independent immutable facts; authorized Resolution inspection records audit without changing work', async () => {
  const h = harness(); await h.assigned('card');
  await h.reject('client:client', { type: 'submit_result', jobId: 'job', explanation: 'result', photoIds: [] }, 'Unauthorized');
  await h.ok('master:master', { type: 'submit_result', jobId: 'job', explanation: 'result', photoIds: ['master-result'] }); assert.equal(h.repository.state.jobs.job.state, 'working');
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'please correct' });
  await h.ok('master:master', { type: 'submit_result', jobId: 'job', explanation: 'corrected', photoIds: [] }); assert.equal(h.repository.state.jobs.job.evidence.length, 2);
  const evidence = structuredClone(h.repository.state.jobs.job.evidence); await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  await h.reject('client:client', { type: 'inspect_resolution', caseId: 'case' }, 'Unauthorized');
  await h.ok('admin', { type: 'inspect_resolution', caseId: 'case' }, 'inspect-once'); await h.ok('admin', { type: 'inspect_resolution', caseId: 'case' }, 'inspect-once');
  assert.deepEqual(h.repository.state.jobs.job.evidence, evidence); assert.equal(h.repository.state.events.filter(event => event.type === 'resolution_inspected').length, 1);
  assert.equal(h.repository.state.jobs.job.funds, 'held'); assert.equal(h.repository.state.cases.case.status, 'admin_resolution_pending');
});
test('MON actual payout command rejects formula/amount overrides without changing frozen payout or debt', async () => {
  const h = harness(); h.repository.state.debt.master = 1000n; await h.completed('card'); const payout = structuredClone(h.repository.state.payouts.job);
  await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'override', recoveryRate: ratio(10n) }, 'FixedRecoveryRate');
  await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'override', amount: 999n }, 'InvalidConfiguration');
  assert.deepEqual(h.repository.state.payouts.job, payout); assert.equal(h.repository.state.debt.master, 510n);
});
test('WRK competing returning master and exceptional Admin completion each can win, with one financial effect/reset', async () => {
  for (const adminFirst of [false, true]) {
    const h = harness(); h.repository.state.refusalStreak.master = 2; await h.assigned('cash');
    await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
    h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
    const evidence = await h.reviewedCompletion('case');
    const normal = () => h.execute('master:master', { type: 'complete', jobId: 'job' });
    const exceptional = () => h.execute('admin', { type: 'decide_resolution', caseId: 'case', decision: { ...resolutionInput('exceptional_completion'), evidence } });
    const results = await Promise.all(adminFirst ? [exceptional(), normal()] : [normal(), exceptional()]);
    assert.equal(results.filter(result => result.ok).length, 1); assert.equal(h.repository.state.jobs.job.state, 'completed');
    assert.equal(h.repository.state.debt.master, 300n); assert.equal(Object.keys(h.repository.state.ledger).length, 1); assert.equal(h.repository.state.refusalStreak.master, 0);
    assert.equal(h.repository.state.events.filter(event => event.type === 'refusal_streak_reset').length, 1);
    assert.equal(h.repository.state.cases.case.status, adminFirst ? 'decided' : 'closed_by_master_completion');
  }
});
test('MON/DBT real concurrent receipt and payout creation serialize actual available debt in both schedules', async () => {
  for (const receiptFirst of [false, true]) {
    const h = harness(); h.repository.state.debt.master = 300n; await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true });
    await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
    await h.ok('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'cash', agreementId: 'a' });
    const receive = () => h.execute('admin', { type: 'receive_repayment', requestId: 'r', masterId: 'master', amount: 300n, receiptId: 'receipt', agreementId: 'a', actuallyReceived: true, evidence: 'cash actually received' });
    const complete = () => h.execute('master:master', { type: 'complete', jobId: 'job' });
    const results = await Promise.all(receiptFirst ? [receive(), complete()] : [complete(), receive()]);
    assert.equal(results[0].ok, true); assert.equal(results[1].ok, receiptFirst);
    const payout = h.repository.state.payouts.job;
    assert.equal(payout.debtRecovery, receiptFirst ? 0n : 300n); assert.equal(h.repository.state.debt.master, 0n);
    assert.equal(payout.amount, receiptFirst ? 700n : 400n);
  }
});
